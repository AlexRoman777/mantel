import { describe, expect, it } from 'vitest';
import type { FaceInfo, InstantSettings, SlideAsset } from '$lib/types';
import {
	AUTHENTIC_BOTTOM_BORDER_PCT,
	AUTHENTIC_INSTANT,
	AUTHENTIC_SIDE_BORDER_PCT,
	formatInstantDate,
	instantCardAspectRatio,
	instantImageStyle,
	instantTurn
} from './instant';

const settings: InstantSettings = {
	arrangement: 'classic', cardCount: 2, cardScalePct: 100, overlapPct: 0, cardGapPx: 24,
	maxAngleDeg: 6, anglePattern: 'outward-v', paperRadiusPx: 6, photoRadiusPx: 3,
	paperSideBorderPct: AUTHENTIC_SIDE_BORDER_PCT, paperBottomBorderPct: AUTHENTIC_BOTTOM_BORDER_PCT,
	paperFinish: 'authentic', visualEffect: 'natural', transition: 'develop', transitionDurationMs: 2200,
	background: 'original', captionFont: 'caveat', captionScalePct: 125,
	backgroundRestEnabled: true, backgroundRestMinutes: 3, backgroundRestSeconds: 10,
	showDateTime: true, showLocation: true, showCamera: false, showRating: false, showPeople: false, showAge: false
};

const slide: SlideAsset = {
	id: 'photo', ratio: 16 / 9, thumbhash: null, takenAt: null, location: null,
	camera: null, isFavorite: false, rating: null
};

const face = (overrides: Partial<FaceInfo> = {}): FaceInfo => ({
	id: 'face', personId: 'person', name: 'Person', birthDate: null, ageAtPhoto: null,
	centerX: 0.5, centerY: 0.5, width: 0.12, height: 0.2, ...overrides
});

describe('authentic Instant geometry', () => {
	it('derives the real film border percentages', () => {
		expect(AUTHENTIC_SIDE_BORDER_PCT).toBeCloseTo(5.38, 2);
		expect(AUTHENTIC_BOTTOM_BORDER_PCT).toBeCloseTo(29.33, 2);
	});

	it('reconstructs the physical 3.483 by 4.233 outer ratio', () => {
		expect(instantCardAspectRatio(settings)).toBeCloseTo(
			AUTHENTIC_INSTANT.width / AUTHENTIC_INSTANT.height,
			3
		);
	});

	it('keeps the default two-card composition inside a 4K canvas', () => {
		const viewport = { width: 3840, height: 2160 };
		const cardWidth = Math.min(viewport.width * 0.38, viewport.height * 0.58);
		const cardHeight = cardWidth / instantCardAspectRatio(settings);
		const angle = settings.maxAngleDeg * Math.PI / 180;
		const rotatedWidth = cardWidth * Math.cos(angle) + cardHeight * Math.sin(angle);
		const rotatedHeight = cardHeight * Math.cos(angle) + cardWidth * Math.sin(angle);
		expect(rotatedWidth * 2 + settings.cardGapPx).toBeLessThan(viewport.width);
		expect(rotatedHeight).toBeLessThan(viewport.height);
		expect(cardHeight / viewport.height).toBeGreaterThan(0.69);
		expect(cardHeight / viewport.height).toBeLessThan(0.72);
	});

	it('keeps every allowed border combination finite and positive', () => {
		for (const side of [1, 5.38, 15]) {
			for (const bottom of [10, 29.33, 45]) {
				const ratio = instantCardAspectRatio({ paperSideBorderPct: side, paperBottomBorderPct: bottom });
				expect(Number.isFinite(ratio)).toBe(true);
				expect(ratio).toBeGreaterThan(0.5);
				expect(ratio).toBeLessThan(1.1);
			}
		}
	});
});

describe('Instant directions and captions', () => {
	it('makes outward mode wider at the top', () => {
		const left = instantTurn(settings, 42, 0, 2);
		const right = instantTurn(settings, 42, 1, 2);
		expect(left).toBeLessThan(0);
		expect(right).toBeGreaterThan(0);
	});

	it('retains the inverse inward mode', () => {
		const inward = { ...settings, anglePattern: 'inward-v' as const };
		expect(instantTurn(inward, 42, 0, 2)).toBeGreaterThan(0);
		expect(instantTurn(inward, 42, 1, 2)).toBeLessThan(0);
	});

	it('never exceeds the configured maximum and supports perfectly straight cards', () => {
		for (const arrangement of ['classic', 'hero-stack', 'scattered', 'gallery'] as const) {
			for (const anglePattern of ['outward-v', 'inward-v', 'random'] as const) {
				for (let index = 0; index < 5; index += 1) {
					const turn = instantTurn({ ...settings, arrangement, anglePattern }, 9182, index, 5);
					expect(Math.abs(turn)).toBeLessThanOrEqual(settings.maxAngleDeg);
				}
			}
		}
		expect(instantTurn({ ...settings, maxAngleDeg: 0 }, 10, 0, 2)).toBe(0);
	});

	it('prints camera wall-clock time without timezone conversion', () => {
		expect(formatInstantDate('2029-01-27T14:30:45+11:00')).toBe('Saturday 27th of January, 2029 at 14:30');
		expect(formatInstantDate('2026-08-31T23:05:00-07:00')).toBe('Monday 31st of August, 2026 at 23:05');
		expect(formatInstantDate('2026-02-30T12:00:00Z')).toBe('');
	});
});

describe('face-safe Instant crop', () => {
	it('uses a centered cover crop when no face data exists', () => {
		expect(instantImageStyle(slide, [])).toBe('object-fit: cover; object-position: 50% 50%');
	});

	it('moves a safe crop toward an off-centre face', () => {
		const style = instantImageStyle(slide, [face({ centerX: 0.82 })]);
		expect(style).toContain('object-fit: cover');
		expect(style).not.toContain('50.0% 50.0%');
	});

	it('letterboxes instead of cutting apart a face group that cannot fit', () => {
		const style = instantImageStyle(slide, [
			face({ id: 'left', personId: 'left', centerX: 0.08, width: 0.15 }),
			face({ id: 'right', personId: 'right', centerX: 0.92, width: 0.15 })
		]);
		expect(style).toBe('object-fit: contain; object-position: 50% 50%');
	});
});
