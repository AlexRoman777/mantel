import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import * as env from '$app/env/private';
import type { SlideAsset } from '#lib/types.js';
import { getCachedAssetImage, getImageCachePlan, prefetchImages } from './image-cache';

// Background generation is deliberately bounded so a one-off build cannot
// monopolize the NAS while Mantel and Immich are serving normal requests.
sharp.concurrency(2);
sharp.cache({ memory: 64, files: 20, items: 100 });

const WIDTH = 3840;
const HEIGHT = 2160;
const WORK_WIDTH = 5760;
const WORK_HEIGHT = 3240;
const CROP_LEFT = (WORK_WIDTH - WIDTH) / 2;
const CROP_TOP = (WORK_HEIGHT - HEIGHT) / 2;
const MOSAIC_COLUMNS = 12;
const MOSAIC_ROWS = 8;
const MAX_PHOTOS = 62;

type MosaicRect = { column: number; row: number; width: number; height: number };

export interface InstantBackgroundStatus {
	state: 'missing' | 'building' | 'ready' | 'error';
	createdAt?: string;
	photos?: number;
	bytes?: number;
	error?: string;
}

export interface InstantBackgroundPlan {
	seed: number;
	available: number;
	willUse: number;
	cached: number;
	missing: number;
	estimatedAdditionalBytes: number;
}

const jobs = new Map<string, InstantBackgroundStatus>();

function directory(): string {
	return path.join(env.DATA_DIR || './data', 'instant-backgrounds');
}

function safeId(profileId: string): string {
	return profileId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function imagePath(profileId: string): string {
	return path.join(directory(), `${safeId(profileId)}.jpg`);
}

function metadataPath(profileId: string): string {
	return path.join(directory(), `${safeId(profileId)}.json`);
}

function randomSample(slides: readonly SlideAsset[], count: number, seed = Date.now()): SlideAsset[] {
	const copy = slides.slice();
	let state = seed >>> 0 || 0x9e3779b9;
	const random = () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) / 0x1_0000_0000;
	};
	for (let index = copy.length - 1; index > 0; index--) {
		const swap = Math.floor(random() * (index + 1));
		[copy[index], copy[swap]] = [copy[swap], copy[index]];
	}
	return copy.slice(0, count);
}

export async function planInstantBackground(slides: readonly SlideAsset[], requestedSeed?: number): Promise<InstantBackgroundPlan> {
	const seed = Number.isInteger(requestedSeed) ? requestedSeed! >>> 0 : Number.parseInt(randomUUID().slice(0, 8), 16);
	const selected = randomSample(slides, Math.min(MAX_PHOTOS, slides.length), seed);
	const cache = await getImageCachePlan(selected, 'thumbnail');
	return {
		seed,
		available: slides.length,
		willUse: selected.length,
		cached: cache.cached,
		missing: cache.missing,
		estimatedAdditionalBytes: cache.estimatedAdditionalBytes
	};
}

export async function getInstantBackgroundStatus(profileId: string): Promise<InstantBackgroundStatus> {
	const running = jobs.get(profileId);
	if (running?.state === 'building' || running?.state === 'error') return running;
	try {
		const [metadata, stat] = await Promise.all([
			fs.readFile(metadataPath(profileId), 'utf8').then((raw) => JSON.parse(raw) as { createdAt: string; photos: number }),
			fs.stat(imagePath(profileId))
		]);
		return { state: 'ready', createdAt: metadata.createdAt, photos: metadata.photos, bytes: stat.size };
	} catch {
		return { state: 'missing' };
	}
}

function variedMosaicRects(): MosaicRect[] {
	const patternA: MosaicRect[] = [
		{ column: 0, row: 0, width: 2, height: 2 },
		{ column: 2, row: 0, width: 2, height: 1 }, { column: 2, row: 1, width: 2, height: 1 },
		{ column: 0, row: 2, width: 1, height: 2 }, { column: 1, row: 2, width: 1, height: 2 },
		{ column: 2, row: 2, width: 2, height: 2 }
	];
	const patternB: MosaicRect[] = [
		{ column: 0, row: 0, width: 2, height: 2 },
		{ column: 2, row: 0, width: 1, height: 2 }, { column: 3, row: 0, width: 1, height: 2 },
		{ column: 0, row: 2, width: 2, height: 1 }, { column: 0, row: 3, width: 2, height: 1 },
		{ column: 2, row: 2, width: 1, height: 1 }, { column: 3, row: 2, width: 1, height: 1 },
		{ column: 2, row: 3, width: 1, height: 1 }, { column: 3, row: 3, width: 1, height: 1 }
	];
	const patternC: MosaicRect[] = Array.from({ length: 16 }, (_, index) => ({
		column: index % 4, row: Math.floor(index / 4), width: 1, height: 1
	}));
	const patterns = [patternA, patternB, patternC, patternC, patternB, patternA];
	return patterns.flatMap((pattern, block) => {
		const blockColumn = (block % 3) * 4;
		const blockRow = Math.floor(block / 3) * 4;
		return pattern.map((rect) => ({ ...rect, column: rect.column + blockColumn, row: rect.row + blockRow }));
	});
}

function simpleGridRects(total: number): MosaicRect[] {
	const columns = Math.max(1, Math.ceil(Math.sqrt(total * (WORK_WIDTH / WORK_HEIGHT))));
	const rows = Math.max(1, Math.ceil(total / columns));
	return Array.from({ length: total }, (_, index) => {
		const row = Math.floor(index / columns);
		const column = index % columns;
		const rowItems = Math.min(columns, total - row * columns);
		return { column: (column * MOSAIC_COLUMNS) / rowItems, row: (row * MOSAIC_ROWS) / rows, width: MOSAIC_COLUMNS / rowItems, height: MOSAIC_ROWS / rows };
	});
}

function orderForShapes(slides: readonly SlideAsset[], rects: readonly MosaicRect[]): SlideAsset[] {
	const remaining = slides.slice();
	return rects.map((rect) => {
		const targetRatio = (rect.width * WORK_WIDTH / MOSAIC_COLUMNS) / (rect.height * WORK_HEIGHT / MOSAIC_ROWS);
		let best = 0;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (let index = 0; index < remaining.length; index++) {
			const ratio = Math.max(0.25, Math.min(4, remaining[index].ratio || 1));
			const distance = Math.abs(Math.log(ratio / targetRatio));
			if (distance < bestDistance) { bestDistance = distance; best = index; }
		}
		return remaining.splice(best, 1)[0];
	});
}

async function makeTile(slide: SlideAsset, rect: MosaicRect): Promise<{ input: Buffer; left: number; top: number }> {
	const cached = await getCachedAssetImage(slide.id, 'thumbnail', slide.connectionId);
	const left = Math.floor((rect.column * WORK_WIDTH) / MOSAIC_COLUMNS);
	const right = Math.floor(((rect.column + rect.width) * WORK_WIDTH) / MOSAIC_COLUMNS);
	const top = Math.floor((rect.row * WORK_HEIGHT) / MOSAIC_ROWS);
	const bottom = Math.floor(((rect.row + rect.height) * WORK_HEIGHT) / MOSAIC_ROWS);
	const tile = await sharp(cached.path)
		.rotate()
		.resize(right - left, bottom - top, { fit: 'cover', position: 'attention' })
		.jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
		.toBuffer();
	return { input: tile, left, top };
}

async function generate(profileId: string, slides: readonly SlideAsset[], seed: number): Promise<void> {
	const selected = randomSample(slides, Math.min(MAX_PHOTOS, slides.length), seed);
	if (selected.length === 0) throw new Error('This presentation has no photographs to use.');
	await prefetchImages(selected, 'thumbnail');
	const rects = selected.length === MAX_PHOTOS ? variedMosaicRects() : simpleGridRects(selected.length);
	const ordered = orderForShapes(selected, rects);
	const tiles: Array<{ input: Buffer; left: number; top: number }> = [];
	for (let index = 0; index < ordered.length; index++) tiles.push(await makeTile(ordered[index], rects[index]));

	await fs.mkdir(directory(), { recursive: true });
	const suffix = `${process.pid}-${randomUUID()}`;
	const target = imagePath(profileId);
	const temporary = `${target}.${suffix}.tmp`;
	const work = await sharp({ create: { width: WORK_WIDTH, height: WORK_HEIGHT, channels: 3, background: '#101112' } })
		.composite(tiles)
		.raw()
		.toBuffer({ resolveWithObject: true });
	await sharp(work.data, { raw: { width: work.info.width, height: work.info.height, channels: work.info.channels } })
		.extract({ left: CROP_LEFT, top: CROP_TOP, width: WIDTH, height: HEIGHT })
		.jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true })
		.toFile(temporary);
	await fs.rename(temporary, target);
	const metadata = { createdAt: new Date().toISOString(), photos: selected.length, width: WIDTH, height: HEIGHT };
	await fs.writeFile(metadataPath(profileId), JSON.stringify(metadata), { encoding: 'utf8', mode: 0o600 });
	const stat = await fs.stat(target);
	jobs.set(profileId, { state: 'ready', createdAt: metadata.createdAt, photos: selected.length, bytes: stat.size });
}

export function startInstantBackground(profileId: string, slides: readonly SlideAsset[], seed: number): boolean {
	if (jobs.get(profileId)?.state === 'building') return false;
	jobs.set(profileId, { state: 'building' });
	void generate(profileId, slides, seed).catch(async (cause) => {
		console.error('Instant background generation failed for profile:', profileId, cause);
		const message = cause instanceof Error ? cause.message : 'Background generation failed';
		jobs.delete(profileId);
		const previous = await getInstantBackgroundStatus(profileId);
		jobs.set(profileId, previous.state === 'ready' ? { ...previous, error: message } : { state: 'error', error: message });
	});
	return true;
}

export async function deleteInstantBackground(profileId: string): Promise<void> {
	if (jobs.get(profileId)?.state === 'building') throw new Error('The background is still being built.');
	jobs.delete(profileId);
	await Promise.allSettled([fs.rm(imagePath(profileId), { force: true }), fs.rm(metadataPath(profileId), { force: true })]);
}

export async function instantBackgroundBody(profileId: string): Promise<ReadableStream<Uint8Array> | null> {
	try {
		await fs.access(imagePath(profileId));
		return Readable.toWeb(createReadStream(imagePath(profileId))) as ReadableStream<Uint8Array>;
	} catch {
		return null;
	}
}
