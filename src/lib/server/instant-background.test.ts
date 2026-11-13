import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import type { SlideAsset } from '$lib/types';

let temporaryDirectory = '';

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.resetModules();
	if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
	temporaryDirectory = '';
});

describe('saved Instant background', () => {
	it('composes cached thumbnails into one persistent 4K JPEG', async () => {
		temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mantel-instant-'));
		vi.stubEnv('DATA_DIR', temporaryDirectory);
		vi.doMock('$env/dynamic/private', () => ({ env: { DATA_DIR: temporaryDirectory, CACHE_CONCURRENCY: '2' } }));
		const cache = path.join(temporaryDirectory, 'image-cache');
		await fs.mkdir(cache, { recursive: true });
		const fixture = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#b5674d' } }).jpeg().toBuffer();
		const slides: SlideAsset[] = [];
		for (let index = 0; index < 6; index++) {
			const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
			await fs.writeFile(path.join(cache, `${id}-thumbnail.image`), fixture);
			await fs.writeFile(path.join(cache, `${id}-thumbnail.json`), JSON.stringify({ contentType: 'image/jpeg' }));
			slides.push({ id, ratio: index % 2 ? 0.75 : 1.33 } as SlideAsset);
		}

		const module = await import('./instant-background');
		const plan = await module.planInstantBackground(slides, 1234);
		expect(plan).toMatchObject({ seed: 1234, available: 6, willUse: 6, cached: 6, missing: 0 });
		expect(module.startInstantBackground('test-profile', slides, plan.seed)).toBe(true);

		let status = await module.getInstantBackgroundStatus('test-profile');
		for (let attempt = 0; attempt < 100 && status.state === 'building'; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			status = await module.getInstantBackgroundStatus('test-profile');
		}
		expect(status).toMatchObject({ state: 'ready', photos: 6 });
		const output = path.join(temporaryDirectory, 'instant-backgrounds', 'test-profile.jpg');
		const metadata = await sharp(output).metadata();
		expect(metadata).toMatchObject({ width: 3840, height: 2160, format: 'jpeg' });
		const stats = await sharp(output).stats();
		// The fixture is warm red. This catches reopening a four-channel composite
		// as three-channel RGB, which produces a striped/corrupted mosaic.
		expect(stats.channels[0].mean).toBeGreaterThan(stats.channels[1].mean + 40);
		expect(stats.channels[1].mean).toBeGreaterThan(stats.channels[2].mean + 15);
	});
});
