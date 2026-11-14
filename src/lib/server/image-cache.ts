import { createReadStream, createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as env from '$app/env/private';
import type { SlideAsset } from '#lib/types.js';
import { fetchAssetImage } from './immich';

export type ImageSize = 'preview' | 'thumbnail' | 'fullsize';

export interface CachedImage {
	path: string;
	contentType: string;
}

const inflight = new Map<string, Promise<CachedImage>>();
// Four parallel preview downloads fills the local cache materially faster
// without turning a confirmed album cache into an unbounded Immich stampede.
const PREFETCH_CONCURRENCY = Math.min(8, Math.max(1, Number(env.CACHE_CONCURRENCY) || 4));
const prefetchQueue: Array<{
	assetId: string;
	connectionId?: string;
	size: ImageSize;
	resolve: () => void;
}> = [];
const scheduledPrefetches = new Map<string, Promise<void>>();
let activePrefetches = 0;
let cacheEpoch = 0;

// The cache is persistent and fills with everything a player ever shows, so
// it needs a ceiling: least-recently-shown variants go first. 0 disables.
const configuredCacheGb = Number(env.IMAGE_CACHE_MAX_GB);
const MAX_CACHE_BYTES = (env.IMAGE_CACHE_MAX_GB === undefined || Number.isNaN(configuredCacheGb) ? 20 : Math.max(0, configuredCacheGb)) * 1024 ** 3;
const EVICTION_INTERVAL_MS = 2 * 60_000;
let lastEvictionAt = 0;
let evicting: Promise<void> | null = null;

function cacheDir(): string {
	return path.join(env.DATA_DIR || './data', 'image-cache');
}

function paths(assetId: string, size: ImageSize, connectionId?: string): { image: string; metadata: string } {
	const scope = connectionId ? `${connectionId.replace(/[^a-zA-Z0-9_-]/g, '_')}-` : '';
	const key = `${scope}${assetId}-${size}`;
	return {
		image: path.join(cacheDir(), `${key}.image`),
		metadata: path.join(cacheDir(), `${key}.json`)
	};
}

async function cacheHit(assetId: string, size: ImageSize, connectionId?: string): Promise<CachedImage | null> {
	const target = paths(assetId, size, connectionId);
	try {
		const stat = await fs.stat(target.image);
		if (!stat.isFile() || stat.size === 0) return null;
		const metadata: { contentType?: string } = await fs
			.readFile(target.metadata, 'utf8')
			.then((raw) => JSON.parse(raw) as { contentType?: string })
			.catch(() => ({} as { contentType?: string }));
		// Recency lives in mtime (atime is unreliable on many mounts). Cheap, fire-and-forget.
		const now = new Date();
		void fs.utimes(target.image, now, now).catch(() => {});
		return { path: target.image, contentType: metadata.contentType ?? 'image/jpeg' };
	} catch {
		return null;
	}
}

async function download(assetId: string, size: ImageSize, connectionId?: string): Promise<CachedImage> {
	const existing = await cacheHit(assetId, size, connectionId);
	if (existing) return existing;

	const upstream = await fetchAssetImage(assetId, size, connectionId);
	if (!upstream.ok || !upstream.body) {
		throw new Error(`Immich image ${assetId} (${size}) returned ${upstream.status}`);
	}

	const target = paths(assetId, size, connectionId);
	await fs.mkdir(cacheDir(), { recursive: true });
	const suffix = `${process.pid}-${randomUUID()}`;
	const imageTmp = `${target.image}.${suffix}.tmp`;
	const metadataTmp = `${target.metadata}.${suffix}.tmp`;
	const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';

	try {
		await pipeline(Readable.fromWeb(upstream.body as never), createWriteStream(imageTmp, { flags: 'wx' }));
		await fs.rename(imageTmp, target.image);
		await fs.writeFile(metadataTmp, JSON.stringify({ contentType }), { encoding: 'utf8', flag: 'wx' });
		await fs.rename(metadataTmp, target.metadata);
	} catch (error) {
		await Promise.allSettled([fs.rm(imageTmp, { force: true }), fs.rm(metadataTmp, { force: true })]);
		throw error;
	}

	scheduleEviction();
	return { path: target.image, contentType };
}

function scheduleEviction(): void {
	if (MAX_CACHE_BYTES === 0 || evicting || Date.now() - lastEvictionAt < EVICTION_INTERVAL_MS) return;
	lastEvictionAt = Date.now();
	evicting = evictImageCache()
		.then(() => undefined, (error) => console.error('image cache eviction failed:', error))
		.finally(() => (evicting = null));
}

/** Delete least-recently-used variants until the cache fits under its ceiling. */
export async function evictImageCache(maxBytes = MAX_CACHE_BYTES): Promise<{ removed: number; bytes: number }> {
	if (maxBytes <= 0) return { removed: 0, bytes: 0 };
	const dir = cacheDir();
	const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
	const files: Array<{ name: string; size: number; mtimeMs: number }> = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith('.image')) continue;
		const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
		if (stat) files.push({ name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs });
	}
	let total = files.reduce((sum, file) => sum + file.size, 0);
	if (total <= maxBytes) return { removed: 0, bytes: total };

	// Free down to 90% so eviction runs in batches, not on every download.
	const target = maxBytes * 0.9;
	files.sort((a, b) => a.mtimeMs - b.mtimeMs);
	let removed = 0;
	for (const file of files) {
		if (total <= target) break;
		const key = file.name.slice(0, -'.image'.length);
		await Promise.allSettled([
			fs.rm(path.join(dir, file.name), { force: true }),
			fs.rm(path.join(dir, `${key}.json`), { force: true })
		]);
		total -= file.size;
		removed++;
	}
	if (removed) console.info(`image cache: evicted ${removed} variants, now ${(total / 1024 ** 3).toFixed(2)} GB`);
	return { removed, bytes: total };
}

/**
 * Return a persistent local copy, downloading it once when absent. Concurrent
 * requests for the same asset share one download instead of stampeding Immich.
 */
export function getCachedAssetImage(assetId: string, size: ImageSize, connectionId?: string): Promise<CachedImage> {
	const key = `${connectionId ?? 'default'}:${assetId}:${size}`;
	const existing = inflight.get(key);
	if (existing) return existing;

	const request = download(assetId, size, connectionId).finally(() => inflight.delete(key));
	inflight.set(key, request);
	return request;
}

export function cachedImageBody(image: CachedImage): ReadableStream<Uint8Array> {
	return Readable.toWeb(createReadStream(image.path)) as ReadableStream<Uint8Array>;
}

function pumpPrefetchQueue(): void {
	while (activePrefetches < PREFETCH_CONCURRENCY && prefetchQueue.length > 0) {
		const job = prefetchQueue.shift()!;
		const key = `${job.connectionId ?? 'default'}:${job.assetId}:${job.size}`;
		activePrefetches++;
		void getCachedAssetImage(job.assetId, job.size, job.connectionId)
			.catch((error) => console.error('image prefetch failed for asset:', job.assetId, error))
			.finally(() => {
				activePrefetches--;
				scheduledPrefetches.delete(key);
				job.resolve();
				pumpPrefetchQueue();
			});
	}
}

function schedulePrefetch(assetId: string, size: ImageSize, connectionId?: string): Promise<void> {
	const key = `${connectionId ?? 'default'}:${assetId}:${size}`;
	const existing = scheduledPrefetches.get(key);
	if (existing) return existing;

	let resolve!: () => void;
	const scheduled = new Promise<void>((done) => (resolve = done));
	scheduledPrefetches.set(key, scheduled);
	prefetchQueue.push({ assetId, connectionId, size, resolve });
	pumpPrefetchQueue();
	return scheduled;
}

/** Cache assets through one process-wide, low-concurrency IO queue. */
export function prefetchImages(slides: readonly SlideAsset[], size: ImageSize): Promise<void> {
	const unique = new Map(slides.map((slide) => [`${slide.connectionId ?? 'default'}:${slide.id}`, slide]));
	return Promise.all([...unique.values()].map((slide) => schedulePrefetch(slide.id, size, slide.connectionId))).then(() => undefined);
}

export interface ImageCacheStats {
	files: number;
	bytes: number;
	/** Ceiling enforced by least-recently-used eviction; 0 means unlimited. */
	maxBytes: number;
	queued: number;
	active: number;
}

export interface ImageCachePlan {
	assets: number;
	cached: number;
	cachedBytes: number;
	missing: number;
	estimatedAdditionalBytes: number;
	estimatedTotalBytes: number;
	size: ImageSize;
}

export function getImageCacheEpoch(): number {
	return cacheEpoch;
}

export async function getImageCacheStats(): Promise<ImageCacheStats> {
	let files = 0;
	let bytes = 0;
	const entries = await fs.readdir(cacheDir(), { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith('.image')) continue;
		const stat = await fs.stat(path.join(cacheDir(), entry.name)).catch(() => null);
		if (!stat) continue;
		files++;
		bytes += stat.size;
	}
	return { files, bytes, maxBytes: MAX_CACHE_BYTES, queued: prefetchQueue.length, active: activePrefetches };
}

/** Estimate a requested cache job without downloading any image bytes. */
export async function getImageCachePlan(
	slides: readonly SlideAsset[],
	size: ImageSize
): Promise<ImageCachePlan> {
	const items = [...new Map(slides.map((slide) => [`${slide.connectionId ?? 'default'}:${slide.id}`, slide])).values()];
	let cached = 0;
	let cachedBytes = 0;
	for (const slide of items) {
		const hit = await cacheHit(slide.id, size, slide.connectionId);
		if (!hit) continue;
		const stat = await fs.stat(hit.path).catch(() => null);
		if (!stat) continue;
		cached++;
		cachedBytes += stat.size;
	}
	const missing = items.length - cached;
	// Existing files give the best local estimate. Before the first download,
	// use deliberately conservative defaults and label the UI value as estimated.
	const fallback = size === 'fullsize' ? 12 * 1024 * 1024 : size === 'preview' ? 2 * 1024 * 1024 : 160 * 1024;
	const average = cached > 0 ? Math.ceil(cachedBytes / cached) : fallback;
	const estimatedAdditionalBytes = missing * average;
	return {
		assets: items.length,
		cached,
		cachedBytes,
		missing,
		estimatedAdditionalBytes,
		estimatedTotalBytes: cachedBytes + estimatedAdditionalBytes,
		size
	};
}

/** Atomically detach the current cache, then remove it without blocking requests. */
export async function clearImageCache(): Promise<void> {
	const current = cacheDir();
	const detached = `${current}.purge-${randomUUID()}`;
	await fs.rename(current, detached).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== 'ENOENT') throw error;
	});
	await fs.mkdir(current, { recursive: true });
	cacheEpoch++;
	void fs.rm(detached, { recursive: true, force: true }).catch((error) => {
		console.error('detached image cache cleanup failed:', error);
	});
}
