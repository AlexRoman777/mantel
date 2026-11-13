import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// The module reads its data directory through $env, so it is fixed before import.
process.env.MANTEL_TEST_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'mantel-map-tiles-'));
vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: process.env.MANTEL_TEST_DATA_DIR } }));

const { bundledBlock, mapLibraryStats } = await import('./map-tiles');

const dataDir = process.env.MANTEL_TEST_DATA_DIR;
const mapDir = path.join(dataDir, 'map');

async function block(...segments: string[]) {
	const file = path.join(mapDir, ...segments);
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, 'webp');
	return file;
}

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true });
});

describe('finding copied imagery', () => {
	it('reads the canonical layout', async () => {
		const file = await block('textures', 'relief', '3', '8', '2.webp');
		expect(await bundledBlock(3, 8, 2, 'relief')).toBe(file);
	});

	it('reads a delivery that was moved into a directory that already existed', async () => {
		// `mv map /data/map` with /data/map already present nests it: /data/map/map/…
		const file = await block('map', 'textures', 'detail', '3', '8', '2.webp');
		expect(await bundledBlock(3, 8, 2, 'detail')).toBe(file);
	});

	it('reads a single set copied without its textures parent', async () => {
		const file = await block('relief', '4', '9', '3.webp');
		expect(await bundledBlock(4, 9, 3, 'relief')).toBe(file);
	});

	it('returns nothing for a block that was never copied', async () => {
		// The relief pyramid stops at level 4, so nothing answers for level 5.
		expect(await bundledBlock(5, 1, 1, 'relief')).toBeNull();
	});

	it('reports what it found and where, so a bare map can be diagnosed', async () => {
		await block('sentinel', '5', '34', '5.webp');
		const stats = await mapLibraryStats();

		expect(stats.sentinel).toEqual({ dir: path.join(mapDir, 'sentinel'), files: 1, bytes: 4 });
		expect(stats.detail.dir).toBe(path.join(mapDir, 'map', 'textures', 'detail'));
		expect(stats.relief.dir).toBe(path.join(mapDir, 'textures', 'relief'));
		expect(stats.relief.files).toBe(1);
	});
});
