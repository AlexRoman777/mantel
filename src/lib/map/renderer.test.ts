import { describe, expect, it } from 'vitest';
import { mapResourcePolicy, subsolarPoint } from './renderer';

describe('map renderer resource policy', () => {
	it('keeps Pi-class players on 4K source textures and bounded decoded tile caches', () => {
		expect(mapResourcePolicy(4, 8, 16384)).toEqual({
			constrained: true,
			animationWidthPx: 1920,
			earthTextureSize: '4k',
			detailAtlasPx: 2048,
			sentinelCacheEntries: 6,
			baseTileCacheEntries: 12
		});
	});

	it('allows richer source textures on a capable desktop GPU', () => {
		expect(mapResourcePolicy(12, 32, 16384)).toMatchObject({
			constrained: false,
			animationWidthPx: 2560,
			earthTextureSize: '8k',
			detailAtlasPx: 4096,
			sentinelCacheEntries: 12,
			baseTileCacheEntries: 24
		});
	});

	it('never asks a smaller GPU for an unsupported 8K texture', () => {
		expect(mapResourcePolicy(12, 32, 4096).earthTextureSize).toBe('4k');
	});
});

describe('subsolar point', () => {
	it('returns finite geographic coordinates', () => {
		const point = subsolarPoint(new Date('2026-09-04T12:00:00Z'));
		expect(point.lat).toBeGreaterThanOrEqual(-24);
		expect(point.lat).toBeLessThanOrEqual(24);
		expect(point.lon).toBeGreaterThanOrEqual(-180);
		expect(point.lon).toBeLessThan(180);
	});
});
