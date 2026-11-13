import { describe, expect, it } from 'vitest';
import { orientationRotatesDimensions, toSlideAsset } from './slides';
import type { ImmichAsset } from './immich';

describe('Immich image orientation', () => {
	it('recognizes numeric and descriptive rotated EXIF values', () => {
		expect(orientationRotatesDimensions('6')).toBe(true);
		expect(orientationRotatesDimensions('Rotate 90 CW')).toBe(true);
		expect(orientationRotatesDimensions('Rotate 270 CW')).toBe(true);
		expect(orientationRotatesDimensions('Horizontal (normal)')).toBe(false);
	});

	it('swaps metadata dimensions for a rotated image', () => {
		const asset: ImmichAsset = {
			id: 'portrait',
			type: 'IMAGE',
			thumbhash: null,
			localDateTime: null,
			exifInfo: {
				dateTimeOriginal: null,
				city: null,
				state: null,
				country: null,
				make: null,
				model: null,
				fNumber: null,
				focalLength: null,
				exifImageWidth: 4032,
				exifImageHeight: 3024,
				orientation: 'Rotate 90 CW'
			}
		};
		expect(toSlideAsset(asset).ratio).toBeCloseTo(0.75);
	});
});

describe('Immich photo coordinates', () => {
	it('preserves the exact GPS fix instead of replacing it with a nearby city', () => {
		const asset = {
			id: 'coast',
			type: 'IMAGE',
			thumbhash: null,
			localDateTime: '2026-09-04T12:00:00Z',
			exifInfo: { latitude: 43.263, longitude: 6.58, city: 'Ramatuelle', country: 'France' }
		} as ImmichAsset;
		const slide = toSlideAsset(asset);
		expect(slide.lat).toBe(43.263);
		expect(slide.lon).toBe(6.58);
		expect(slide.location).toBe('Ramatuelle, France');
	});

	it('rejects invalid coordinates before globe projection', () => {
		const asset = {
			id: 'invalid',
			type: 'IMAGE',
			thumbhash: null,
			localDateTime: '2026-09-04T12:00:00Z',
			exifInfo: { latitude: 181, longitude: Number.NaN }
		} as ImmichAsset;
		const slide = toSlideAsset(asset);
		expect(slide.lat).toBeUndefined();
		expect(slide.lon).toBeUndefined();
	});
});
