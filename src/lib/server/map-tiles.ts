// Close-up satellite imagery for the map layout: Sentinel-2 cloudless by EOX
// (Copernicus data, free for a self-hosted family frame). Blocks are 1024 px
// WebP on the same latitude/longitude pyramid the globe textures use, rendered
// by EOX's WMS and kept locally: the bundle ships a whole region under
// /map/sentinel, and anything missing is fetched once into
// DATA_DIR/map-cache/s2. Players only ever talk to Mantel.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import * as env from '$app/env/private';
import { sentinelPlan, SENTINEL_MAX_LEVEL, SENTINEL_TILE_PX, tileDegrees, tilesFor, type TileRef } from '#lib/map/geo.js';

export const SENTINEL_ATTRIBUTION = 'Sentinel-2 cloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data)';
const WMS = 'https://tiles.maps.eox.at/wms';
const LAYER = 's2cloudless-2020';
const USER_AGENT = 'Mantel photo frame (self-hosted, non-commercial; https://github.com/AlexRoman777/mantel)';
const CONCURRENCY = Math.min(8, Math.max(1, Number(env.MAP_TILE_CONCURRENCY) || 4));
const QUALITY = 78;

export { SENTINEL_MAX_LEVEL, SENTINEL_TILE_PX };

function cacheDir(): string {
	return path.join(env.DATA_DIR || './data', 'map-cache', 's2');
}

/** The three block pyramids, all on the same latitude/longitude grid. */
export const BLOCK_KINDS = ['sentinel', 'detail', 'relief'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/**
 * Where a pyramid lives: the directory in the data volume (several GB, built by
 * scripts/build-map-*.mjs and copied to the NAS by hand), then the build output,
 * then the source tree for development.
 *
 * The imagery is moved around by hand, so the layouts a human actually produces
 * are all accepted: the canonical one, a delivery moved into a directory that
 * already existed (which nests it one level), and a single set copied without
 * its `textures` parent.
 */
function bundledDirs(kind: BlockKind): string[] {
	// Lives in the persistent data volume by default: /volume1/docker/mantel-data/map.
	const root = env.MAP_DIR || path.join(env.DATA_DIR || './data', 'map');
	const relative = kind === 'sentinel' ? ['sentinel'] : ['textures', kind];
	const candidates = [
		path.join(root, ...relative),
		path.join(root, 'map', ...relative),
		path.join(root, kind),
		path.join(process.cwd(), 'build', 'client', 'map', ...relative),
		path.join(process.cwd(), 'static', 'map', ...relative)
	];
	return candidates.filter((dir, index) => candidates.indexOf(dir) === index);
}

/**
 * What imagery the server can actually see, for /api/cache. Cheap enough to walk:
 * it is asked for by a human looking at the diagnostics page, not during playback.
 */
export async function mapLibraryStats(): Promise<Record<BlockKind, { dir: string | null; files: number; bytes: number }>> {
	const entries = await Promise.all(
		BLOCK_KINDS.map(async (kind) => {
			for (const dir of bundledDirs(kind)) {
				const counted = await countBlocks(dir);
				if (counted.files > 0) return [kind, { dir, ...counted }] as const;
			}
			return [kind, { dir: null, files: 0, bytes: 0 }] as const;
		})
	);
	return Object.fromEntries(entries) as Record<BlockKind, { dir: string | null; files: number; bytes: number }>;
}

async function countBlocks(dir: string): Promise<{ files: number; bytes: number }> {
	let files = 0;
	let bytes = 0;
	const walk = async (current: string): Promise<void> => {
		const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) await walk(full);
			else if (entry.name.endsWith('.webp')) {
				files++;
				bytes += (await fs.stat(full).catch(() => ({ size: 0 }))).size;
			}
		}
	};
	await walk(dir);
	return { files, bytes };
}

export function blockPath(z: number, x: number, y: number): string {
	return path.join(cacheDir(), String(z), String(x), `${y}.webp`);
}

export async function bundledBlock(z: number, x: number, y: number, kind: BlockKind = 'sentinel'): Promise<string | null> {
	for (const dir of bundledDirs(kind)) {
		const file = path.join(dir, String(z), String(x), `${y}.webp`);
		try {
			if ((await fs.stat(file)).size > 0) return file;
		} catch {
			// next candidate
		}
	}
	return null;
}

/** A block from any pyramid: only Sentinel is ever fetched, the others ship with the data directory. */
export function getMapBlock(kind: BlockKind, z: number, x: number, y: number): Promise<string | null> {
	return kind === 'sentinel' ? getSentinelBlock(z, x, y) : bundledBlock(z, x, y, kind);
}

/** Latitude/longitude box of one block in the shared pyramid. */
export function blockBounds(z: number, x: number, y: number): { lon0: number; lat0: number; lon1: number; lat1: number } {
	const size = tileDegrees(z);
	return { lon0: x * size - 180, lat0: 90 - (y + 1) * size, lon1: (x + 1) * size - 180, lat1: 90 - y * size };
}

export function wmsUrl(bounds: { lon0: number; lat0: number; lon1: number; lat1: number }, pixels = SENTINEL_TILE_PX): string {
	const query = new URLSearchParams({
		service: 'WMS',
		request: 'GetMap',
		version: '1.1.1',
		layers: LAYER,
		srs: 'EPSG:4326',
		bbox: `${bounds.lon0},${bounds.lat0},${bounds.lon1},${bounds.lat1}`,
		width: String(pixels),
		height: String(pixels),
		format: 'image/jpeg'
	});
	return `${WMS}?${query}`;
}

// ---- fetching -----------------------------------------------------------------------------
const inflight = new Map<string, Promise<string | null>>();
let active = 0;
const waiting: Array<() => void> = [];

function slot(): Promise<void> {
	if (active < CONCURRENCY) {
		active++;
		return Promise.resolve();
	}
	return new Promise((resolve) => waiting.push(() => { active++; resolve(); }));
}

function release(): void {
	active--;
	waiting.shift()?.();
}

async function download(z: number, x: number, y: number): Promise<string | null> {
	const target = blockPath(z, x, y);
	await slot();
	try {
		const res = await fetch(wmsUrl(blockBounds(z, x, y)), { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(90_000) });
		if (!res.ok) return null;
		const jpeg = Buffer.from(await res.arrayBuffer());
		// A WMS error comes back as a tiny image; a real block is never that small.
		if (jpeg.length < 4096) return null;
		const webp = await sharp(jpeg).webp({ quality: QUALITY, effort: 4 }).toBuffer();
		await fs.mkdir(path.dirname(target), { recursive: true });
		const temporary = `${target}.${process.pid}.tmp`;
		await fs.writeFile(temporary, webp);
		await fs.rename(temporary, target);
		return target;
	} catch {
		return null;
	} finally {
		release();
	}
}

/** Local file for one imagery block, fetching it once when neither bundle nor cache has it. */
export function getSentinelBlock(z: number, x: number, y: number): Promise<string | null> {
	const key = `${z}/${x}/${y}`;
	const pending = inflight.get(key);
	if (pending) return pending;
	const job = (async () => {
		const bundled = await bundledBlock(z, x, y);
		if (bundled) return bundled;
		const target = blockPath(z, x, y);
		try {
			if ((await fs.stat(target)).size > 0) return target;
		} catch {
			// fetch below
		}
		return download(z, x, y);
	})().finally(() => inflight.delete(key));
	inflight.set(key, job);
	return job;
}

/** Every block the player will draw for a stop, mirroring the player's own plan. */
export function blocksForStop(lat: number, lon: number, zoomKm: number, screenWidthPx = 3840): TileRef[] {
	const out: TileRef[] = [];
	const seen = new Set<string>();
	for (const window of sentinelPlan(lat, lon, zoomKm, screenWidthPx)) {
		for (const tile of tilesFor(window.z, window.bounds)) {
			const key = `${tile.level}/${tile.x}/${tile.y}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(tile);
		}
	}
	return out;
}

const warmed = new Set<string>();

/** Fetch blocks for a small caller-supplied stop lookahead, in the background. */
export function warmSentinelTiles(places: ReadonlyArray<{ lat: number; lon: number }>, zoomKm: number): void {
	const pending = places.filter((place) => {
		const key = `${place.lat.toFixed(2)}:${place.lon.toFixed(2)}:${zoomKm}`;
		if (warmed.has(key)) return false;
		warmed.add(key);
		return true;
	});
	if (!pending.length) return;
	void (async () => {
		for (const place of pending) {
			for (const block of blocksForStop(place.lat, place.lon, zoomKm)) {
				await getSentinelBlock(block.level, block.x, block.y);
			}
		}
	})();
}

export async function sentinelCacheStats(): Promise<{ files: number; bytes: number }> {
	let files = 0;
	let bytes = 0;
	async function walk(dir: string): Promise<void> {
		const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) await walk(full);
			else if (entry.name.endsWith('.webp')) {
				files++;
				bytes += (await fs.stat(full).catch(() => ({ size: 0 }))).size;
			}
		}
	}
	await walk(cacheDir());
	return { files, bytes };
}

// ---- bulk region prefetch ------------------------------------------------------------
export interface RegionJob {
	name: string;
	bounds: { lon0: number; lat0: number; lon1: number; lat1: number };
	maxZoom: number;
	total: number;
	done: number;
	skipped: number;
	failed: number;
	startedAt: number;
	finishedAt: number | null;
	running: boolean;
}

export const REGIONS: Record<string, { name: string; bounds: RegionJob['bounds'] }> = {
	europe: { name: 'Europe', bounds: { lon0: -11, lat0: 34, lon1: 42, lat1: 71.5 } },
	world: { name: 'Whole world', bounds: { lon0: -180, lat0: -60, lon1: 180, lat1: 80 } }
};

let regionJob: RegionJob | null = null;

export function regionJobStatus(): RegionJob | null {
	return regionJob;
}

/** Blocks a region needs from level 4 up to maxLevel. */
export function regionTileCount(bounds: RegionJob['bounds'], maxLevel: number, minLevel = 4): number {
	let total = 0;
	for (let z = minLevel; z <= maxLevel; z++) total += tilesFor(z, bounds).length;
	return total;
}

/**
 * Fill a whole region's imagery, resuming across restarts (blocks already on
 * disk are skipped), one region at a time.
 */
export function startRegionPrefetch(region: keyof typeof REGIONS, maxLevel: number): RegionJob {
	if (regionJob?.running) return regionJob;
	const spec = REGIONS[region];
	const safeMaxLevel = Math.max(4, Math.min(SENTINEL_MAX_LEVEL, Math.floor(maxLevel)));
	const job: RegionJob = {
		name: spec.name,
		bounds: spec.bounds,
		maxZoom: safeMaxLevel,
		total: regionTileCount(spec.bounds, safeMaxLevel),
		done: 0,
		skipped: 0,
		failed: 0,
		startedAt: Date.now(),
		finishedAt: null,
		running: true
	};
	regionJob = job;
	void (async () => {
		for (let z = 4; z <= safeMaxLevel && regionJob === job; z++) {
			const blocks = tilesFor(z, spec.bounds);
			for (let i = 0; i < blocks.length && regionJob === job; i += CONCURRENCY) {
				await Promise.all(blocks.slice(i, i + CONCURRENCY).map(async (block) => {
					if (await bundledBlock(block.level, block.x, block.y)) {
						job.skipped++;
						job.done++;
						return;
					}
					try {
						if ((await fs.stat(blockPath(block.level, block.x, block.y))).size > 0) {
							job.skipped++;
							job.done++;
							return;
						}
					} catch {
						// not cached yet
					}
					if (!(await getSentinelBlock(block.level, block.x, block.y))) job.failed++;
					job.done++;
				}));
			}
		}
		job.running = false;
		job.finishedAt = Date.now();
	})();
	return job;
}

export function stopRegionPrefetch(): void {
	if (regionJob) {
		regionJob.running = false;
		regionJob.finishedAt = Date.now();
		regionJob = null;
	}
}
