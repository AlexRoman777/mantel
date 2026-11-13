import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let temporaryDirectory = '';

afterEach(async () => {
	vi.resetModules();
	if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
	temporaryDirectory = '';
});

async function writeVariant(dir: string, key: string, bytes: number, ageMinutes: number): Promise<void> {
	await fs.writeFile(path.join(dir, `${key}.image`), Buffer.alloc(bytes, 1));
	await fs.writeFile(path.join(dir, `${key}.json`), JSON.stringify({ contentType: 'image/jpeg' }));
	const when = new Date(Date.now() - ageMinutes * 60_000);
	await fs.utimes(path.join(dir, `${key}.image`), when, when);
}

describe('image cache ceiling', () => {
	it('evicts the least-recently shown variants until the cache fits under the ceiling', async () => {
		temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mantel-cache-'));
		vi.doMock('$env/dynamic/private', () => ({ env: { DATA_DIR: temporaryDirectory, IMAGE_CACHE_MAX_GB: '0' } }));
		const dir = path.join(temporaryDirectory, 'image-cache');
		await fs.mkdir(dir, { recursive: true });
		await writeVariant(dir, 'old-preview', 400, 60);
		await writeVariant(dir, 'older-preview', 400, 120);
		await writeVariant(dir, 'fresh-preview', 400, 1);
		await writeVariant(dir, 'newest-preview', 400, 0);

		const { evictImageCache, getImageCacheStats } = await import('./image-cache');
		const result = await evictImageCache(1000);

		expect(result.removed).toBe(2);
		expect(result.bytes).toBe(800);
		const remaining = (await fs.readdir(dir)).sort();
		expect(remaining).toEqual(['fresh-preview.image', 'fresh-preview.json', 'newest-preview.image', 'newest-preview.json']);
		// IMAGE_CACHE_MAX_GB=0 means unlimited: nothing is touched automatically.
		expect((await getImageCacheStats()).maxBytes).toBe(0);
		expect(await evictImageCache()).toEqual({ removed: 0, bytes: 0 });
	});

	it('defaults the ceiling to 20 GB when the variable is unset', async () => {
		temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mantel-cache-'));
		vi.doMock('$env/dynamic/private', () => ({ env: { DATA_DIR: temporaryDirectory } }));
		const { getImageCacheStats } = await import('./image-cache');
		expect((await getImageCacheStats()).maxBytes).toBe(20 * 1024 ** 3);
	});
});
