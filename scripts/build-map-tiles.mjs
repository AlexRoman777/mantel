#!/usr/bin/env node
// Fetches Sentinel-2 cloudless imagery (EOX, Copernicus data) for a whole
// region into static/map/sentinel/<level>/<x>/<y>.webp, on the same
// latitude/longitude pyramid the globe textures use. Blocks are 4096 px and
// recompressed to WebP, so a region is a couple of thousand files rather than
// hundreds of thousands. Resumable: existing blocks are skipped.
//
//   node scripts/build-map-tiles.mjs                       # Europe, levels 4–7 (≈1,400 blocks, ≈3 GB)
//   REGION=world MAX_LEVEL=6 node scripts/build-map-tiles.mjs
//   BBOX="-11,34,42,71.5" MAX_LEVEL=8 node scripts/build-map-tiles.mjs
//   QUALITY=72 CONCURRENCY=6 node scripts/build-map-tiles.mjs
//
// Level L covers the globe in 2^(L+1) x 2^L blocks, so a block spans
// 360/2^(L+1) degrees: level 7 is 1.4 degrees, about 2,900 px per degree.
// EOX's WMS renders at most 4096 px per request.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'static', 'map', 'sentinel');
const WMS = 'https://tiles.maps.eox.at/wms';
const LAYER = 's2cloudless-2020';
const USER_AGENT = 'Mantel photo frame build (self-hosted, non-commercial; https://github.com/AlexRoman777/mantel)';
const REGIONS = {
	europe: [-11, 34, 42, 71.5],
	nordics: [4, 54, 32, 71.5],
	world: [-180, -60, 180, 80]
};
const MIN_LEVEL = Number(process.env.MIN_LEVEL ?? 4);
const MAX_LEVEL = Number(process.env.MAX_LEVEL ?? 7);
const PIXELS = Number(process.env.PIXELS ?? 4096);
const QUALITY = Number(process.env.QUALITY ?? 78);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const bbox = process.env.BBOX ? process.env.BBOX.split(',').map(Number) : REGIONS[process.env.REGION ?? 'europe'];
if (!bbox || bbox.length !== 4) throw new Error('unknown region / bad BBOX');
if (!Number.isInteger(MIN_LEVEL) || !Number.isInteger(MAX_LEVEL) || MIN_LEVEL < 0 || MAX_LEVEL < MIN_LEVEL || MAX_LEVEL > 9) {
	throw new Error('levels must be integers with 0 <= MIN_LEVEL <= MAX_LEVEL <= 9 (the player cannot use deeper levels)');
}
if (!Number.isInteger(PIXELS) || PIXELS < 256 || PIXELS > 4096) throw new Error('PIXELS must be an integer from 256 to 4096');
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 8) throw new Error('CONCURRENCY must be an integer from 1 to 8');
if (!Number.isFinite(QUALITY) || QUALITY < 1 || QUALITY > 100) throw new Error('QUALITY must be from 1 to 100');
const [lon0, lat0, lon1, lat1] = bbox;

sharp.cache(false);
sharp.concurrency(2);

const tileDegrees = (level) => 360 / 2 ** (level + 1);

function* blocks() {
	for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
		const size = tileDegrees(level);
		const columns = 2 ** (level + 1);
		const rows = 2 ** level;
		const x0 = Math.floor((lon0 + 180) / size);
		const x1 = Math.floor((lon1 + 180) / size);
		const y0 = Math.max(0, Math.floor((90 - lat1) / size));
		const y1 = Math.min(rows - 1, Math.floor((90 - lat0) / size));
		for (let xi = x0; xi <= x1; xi++) {
			const x = ((xi % columns) + columns) % columns;
			for (let y = y0; y <= y1; y++) {
				yield { level, x, y, lon0: x * size - 180, lat0: 90 - (y + 1) * size, lon1: (x + 1) * size - 180, lat1: 90 - y * size };
			}
		}
	}
}

let total = 0;
for (const _ of blocks()) total++;
console.log(
	`region ${process.env.REGION ?? 'europe'} [${bbox.join(', ')}] levels ${MIN_LEVEL}-${MAX_LEVEL}: ` +
	`${total} blocks of ${PIXELS}px WebP q${QUALITY} -> ${OUT}`
);

let done = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;
const started = Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchBlock(block) {
	const target = path.join(OUT, String(block.level), String(block.x), `${block.y}.webp`);
	try {
		const stat = await fs.stat(target);
		if (stat.size > 0) {
			skipped++;
			bytes += stat.size;
			return;
		}
	} catch {
		// fetch below
	}
	const query = new URLSearchParams({
		service: 'WMS',
		request: 'GetMap',
		version: '1.1.1',
		layers: LAYER,
		srs: 'EPSG:4326',
		bbox: `${block.lon0},${block.lat0},${block.lon1},${block.lat1}`,
		width: String(PIXELS),
		height: String(PIXELS),
		format: 'image/jpeg'
	});
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const res = await fetch(`${WMS}?${query}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(240_000) });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const jpeg = Buffer.from(await res.arrayBuffer());
			// WMS reports errors as a tiny image; a real block is never that small.
			if (jpeg.length < 4096) throw new Error('empty response');
			const webp = await sharp(jpeg).webp({ quality: QUALITY, effort: 4 }).toBuffer();
			await fs.mkdir(path.dirname(target), { recursive: true });
			const temporary = `${target}.${process.pid}.tmp`;
			await fs.writeFile(temporary, webp);
			await fs.rename(temporary, target);
			bytes += webp.length;
			return;
		} catch (error) {
			if (attempt === 3) {
				failed++;
				console.error(`failed ${block.level}/${block.x}/${block.y}: ${error.message}`);
			} else await sleep(4000 * attempt);
		}
	}
}

const iterator = blocks();
async function worker() {
	for (;;) {
		const next = iterator.next();
		if (next.done) return;
		await fetchBlock(next.value);
		done++;
		if (done % 25 === 0) {
			const elapsed = (Date.now() - started) / 1000;
			const rate = (done - skipped) / Math.max(1, elapsed);
			const remaining = rate > 0 ? Math.round((total - done) / rate / 60) : '?';
			console.log(`${done}/${total} (${skipped} cached, ${failed} failed) - ${(bytes / 1e9).toFixed(2)} GB - ~${remaining} min left`);
		}
	}
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`finished: ${done} blocks, ${skipped} already present, ${failed} failed, ${(bytes / 1e9).toFixed(2)} GB`);
