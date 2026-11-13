#!/usr/bin/env node
// Builds the earth imagery Mantel ships with:
//
//   static/map/textures/<style>/earth-8k.jpg   globe texture (8192x4096), one per month
//   static/map/textures/<style>/earth-4k.jpg   fallback for small GPUs
//   static/map/textures/detail/<L>/<x>/<y>.webp   2048 px blocks sliced from the
//   static/map/textures/relief/<L>/<x>/<y>.webp   full-resolution sources, on the
//                                                 same latitude/longitude pyramid
//                                                 the Sentinel blocks use
//
// Sources (public domain): NASA Blue Marble Next Generation monthly mosaics,
// its full-resolution 86,400 x 43,200 quadrants for the detail pyramid, NASA
// Black Marble night lights, and Natural Earth's shaded relief.
//
//   node scripts/build-map-textures.mjs
//   STYLES=satellite-07,relief node scripts/build-map-textures.mjs
//   DETAIL_MAX_LEVEL=4 QUALITY=78 node scripts/build-map-textures.mjs

import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';

const run = promisify(execFile);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const CACHE = path.join(ROOT, '.cache', 'natural-earth');
const OUT = path.join(ROOT, 'static', 'map', 'textures');
const BLOCK_PX = Number(process.env.BLOCK_PX ?? 2048);
const QUALITY = Number(process.env.QUALITY ?? 78);
const DETAIL_MAX_LEVEL = Number(process.env.DETAIL_MAX_LEVEL ?? 4);
const RELIEF_MAX_LEVEL = Number(process.env.RELIEF_MAX_LEVEL ?? 3);

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const RECORDS = { 1: 73580, 2: 73605, 3: 73630, 4: 73655, 5: 73701, 6: 73726, 7: 73751, 8: 73776, 9: 73801, 10: 73826, 11: 73851, 12: 73909 };
// The detail pyramid comes from July: at mid zoom the month is not visible, and
// Sentinel-2 takes over long before it would be.
const DETAIL_MONTH = Number(process.env.DETAIL_MONTH ?? 7);

const monthUrl = (month) => `https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/${RECORDS[month]}/world.topo.bathy.2004${String(month).padStart(2, '0')}.3x21600x10800.jpg`;
const quadrantUrl = (month, quadrant) => `https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/${RECORDS[month]}/world.topo.bathy.2004${String(month).padStart(2, '0')}.3x21600x21600.${quadrant}.jpg`;
const QUADRANTS = ['A1', 'B1', 'C1', 'D1', 'A2', 'B2', 'C2', 'D2'];

const SOURCES = {
	relief: { urls: ['https://naturalearth.s3.amazonaws.com/10m_raster/HYP_HR_SR_OB_DR.zip'], file: 'HYP_HR_SR_OB_DR.zip', inner: 'HYP_HR_SR_OB_DR.tif' },
	night: { urls: ['https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg'], file: 'black-marble-2016-3km.jpg' }
};
for (let month = 1; month <= 12; month++) {
	SOURCES[`satellite-${String(month).padStart(2, '0')}`] = { urls: [monthUrl(month)], file: `blue-marble-2004${String(month).padStart(2, '0')}.jpg` };
}
SOURCES.satellite = { alias: `satellite-${String(DETAIL_MONTH).padStart(2, '0')}` };

const STYLES = (process.env.STYLES ?? [...Object.keys(SOURCES).filter((s) => s !== 'satellite'), 'satellite'].join(',')).split(',');

sharp.cache(false);
sharp.concurrency(2);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function download(urls, file) {
	const target = path.join(CACHE, file);
	try {
		if ((await fs.stat(target)).size > 1_000_000) return target;
	} catch {
		// download below
	}
	await fs.mkdir(CACHE, { recursive: true });
	for (const url of urls) {
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				console.log(`downloading ${url}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
				const res = await fetch(url, { headers: { 'User-Agent': 'Mantel map texture build (self-hosted photo frame)' }, signal: AbortSignal.timeout(900_000) });
				if (res.status === 404) break;
				if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
				await pipeline(Readable.fromWeb(res.body), createWriteStream(`${target}.part`));
				if ((await fs.stat(`${target}.part`)).size < 1_000_000) throw new Error('suspiciously small file');
				await fs.rename(`${target}.part`, target);
				return target;
			} catch (error) {
				console.log(`  failed: ${error.message}`);
				await sleep(5000 * attempt);
			}
		}
	}
	throw new Error(`no source could be downloaded for ${file}`);
}

async function sourceImage(style) {
	const source = SOURCES[style];
	const file = await download(source.urls, source.file);
	if (!source.inner) return file;
	const inner = path.join(CACHE, source.inner);
	try {
		await fs.stat(inner);
	} catch {
		console.log(`extracting ${source.inner}`);
		await run('unzip', ['-o', '-j', file, source.inner, '-d', CACHE], { maxBuffer: 1 << 24 });
	}
	return inner;
}

async function globeTextures(style, input) {
	const out = path.join(OUT, style);
	await fs.mkdir(out, { recursive: true });
	for (const width of [8192, 4096]) {
		const target = path.join(out, `earth-${width / 1024}k.jpg`);
		try {
			await fs.stat(target);
			continue;
		} catch {
			// build
		}
		await sharp(input, { limitInputPixels: false })
			.resize(width, width / 2, { kernel: 'lanczos3' })
			.jpeg({ quality: 84, mozjpeg: true, chromaSubsampling: '4:2:0' })
			.toFile(target);
		console.log(`${style}: wrote earth-${width / 1024}k.jpg`);
	}
}

const tileDegrees = (level) => 360 / 2 ** (level + 1);

/**
 * Slice one equirectangular source into pyramid blocks. `region` is the
 * lon/lat box the source covers, so full-resolution quadrants can be sliced
 * one at a time without ever holding the whole mosaic in memory.
 */
async function sliceBlocks(input, outDir, maxLevel, region = { lon0: -180, lat0: -90, lon1: 180, lat1: 90 }) {
	const meta = await sharp(input, { limitInputPixels: false }).metadata();
	const pxPerDegX = meta.width / (region.lon1 - region.lon0);
	const pxPerDegY = meta.height / (region.lat1 - region.lat0);
	let written = 0;
	for (let level = 0; level <= maxLevel; level++) {
		const size = tileDegrees(level);
		const columns = 2 ** (level + 1);
		const rows = 2 ** level;
		for (let x = 0; x < columns; x++) {
			const lon0 = x * size - 180;
			if (lon0 + size <= region.lon0 || lon0 >= region.lon1) continue;
			for (let y = 0; y < rows; y++) {
				const lat1 = 90 - y * size;
				const lat0 = lat1 - size;
				if (lat1 <= region.lat0 || lat0 >= region.lat1) continue;
				const target = path.join(outDir, String(level), String(x), `${y}.webp`);
				try {
					if ((await fs.stat(target)).size > 0) continue;
				} catch {
					// build it
				}
				const left = Math.round((lon0 - region.lon0) * pxPerDegX);
				const top = Math.round((region.lat1 - lat1) * pxPerDegY);
				const width = Math.min(Math.round(size * pxPerDegX), meta.width - left);
				const height = Math.min(Math.round(size * pxPerDegY), meta.height - top);
				if (left < 0 || top < 0 || width < 2 || height < 2) continue;
				await fs.mkdir(path.dirname(target), { recursive: true });
				await sharp(input, { limitInputPixels: false })
					.extract({ left, top, width, height })
					.resize(BLOCK_PX, BLOCK_PX, { kernel: 'lanczos3', fit: 'fill' })
					.webp({ quality: QUALITY, effort: 4 })
					.toFile(target);
				written++;
			}
		}
	}
	return written;
}

async function detailPyramid() {
	const outDir = path.join(OUT, 'detail');
	const marker = path.join(outDir, '.done');
	try {
		await fs.stat(marker);
		return;
	} catch {
		// build
	}
	console.log(`detail pyramid: levels 0-${DETAIL_MAX_LEVEL} from the full-resolution ${MONTHS[DETAIL_MONTH - 1]} mosaic`);
	let written = 0;
	for (const [index, quadrant] of QUADRANTS.entries()) {
		const column = index % 4;
		const row = Math.floor(index / 4);
		const region = { lon0: -180 + column * 90, lon1: -90 + column * 90, lat1: 90 - row * 90, lat0: row * 90 - 90 + (row === 0 ? 0 : 0) };
		region.lat0 = region.lat1 - 90;
		const file = await download([quadrantUrl(DETAIL_MONTH, quadrant)], `blue-marble-2004${String(DETAIL_MONTH).padStart(2, '0')}-${quadrant}.jpg`);
		written += await sliceBlocks(file, outDir, DETAIL_MAX_LEVEL, region);
		console.log(`  ${quadrant} done (${written} blocks so far)`);
	}
	await fs.writeFile(marker, new Date().toISOString());
}

const failures = [];
for (const style of STYLES) {
	const source = SOURCES[style];
	if (!source) throw new Error(`unknown style ${style}`);
	try {
		if (source.alias) {
			await fs.mkdir(path.join(OUT, style), { recursive: true });
			for (const name of ['earth-8k.jpg', 'earth-4k.jpg']) {
				await fs.copyFile(path.join(OUT, source.alias, name), path.join(OUT, style, name)).catch(() => {});
			}
			continue;
		}
		const input = await sourceImage(style);
		await globeTextures(style, input);
		if (style === 'relief') {
			const written = await sliceBlocks(input, path.join(OUT, 'relief'), RELIEF_MAX_LEVEL);
			console.log(`relief pyramid: ${written} new blocks`);
		}
	} catch (error) {
		console.error(`${style}: ${error.message}`);
		failures.push(style);
	}
}
try {
	await detailPyramid();
} catch (error) {
	console.error(`detail pyramid: ${error.message}`);
	failures.push('detail');
}
if (failures.length) console.error(`incomplete: ${failures.join(', ')} (rerun later; sources are retried)`);

let bytes = 0;
let files = 0;
async function walk(dir) {
	for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) await walk(full);
		else {
			files++;
			bytes += (await fs.stat(full)).size;
		}
	}
}
await walk(OUT);
console.log(`textures: ${files} files, ${(bytes / 1e9).toFixed(2)} GB in ${OUT}`);
