import { describe, expect, it } from 'vitest';
import {
	orderForMap,
	dedupeSlides,
	filterSlides,
	getOrderedPage,
	interleaveMemories,
	isPortrait,
	orderSlides,
	pairPortraits,
	seededShuffle
} from './playlist-core';
import type { SlideAsset } from '../types';

function slide(id: string, overrides: Partial<SlideAsset> = {}): SlideAsset {
	return {
		id,
		ratio: 1.5,
		thumbhash: null,
		takenAt: null,
		location: null,
		camera: null,
		isFavorite: false,
		rating: null,
		...overrides
	};
}

const ids = (slides: SlideAsset[]) => slides.map((s) => s.id);

describe('seededShuffle', () => {
	const items = Array.from({ length: 50 }, (_, i) => i);

	it('is deterministic for the same seed', () => {
		expect(seededShuffle(items, 'kitchen:2026-08-28')).toEqual(
			seededShuffle(items, 'kitchen:2026-08-28')
		);
	});

	it('differs across seeds and preserves all items', () => {
		const a = seededShuffle(items, 'kitchen:2026-08-28');
		const b = seededShuffle(items, 'kitchen:2026-08-29');
		expect(a).not.toEqual(b);
		expect([...a].sort((x, y) => x - y)).toEqual(items);
	});

	it('does not mutate the input', () => {
		const copy = items.slice();
		seededShuffle(items, 'seed');
		expect(items).toEqual(copy);
	});
});

describe('interleaveMemories', () => {
	it('returns input unchanged when there are no memories', () => {
		const slides = [slide('a'), slide('b')];
		expect(ids(interleaveMemories(slides))).toEqual(['a', 'b']);
	});

	it('keeps every slide and spreads memories through the deck', () => {
		const others = Array.from({ length: 20 }, (_, i) => slide(`o${i}`));
		const memories = Array.from({ length: 4 }, (_, i) =>
			slide(`m${i}`, { memoryYearsAgo: i + 1 })
		);
		const out = interleaveMemories([...others, ...memories]);
		expect(out).toHaveLength(24);
		expect(new Set(ids(out)).size).toBe(24);

		const positions = out
			.map((s, i) => (s.memoryYearsAgo !== undefined ? i : -1))
			.filter((i) => i >= 0);
		// First memory appears at the very start; they are not clumped at the end.
		expect(positions[0]).toBe(0);
		expect(positions[positions.length - 1]).toBeLessThan(24 - 1);
	});
});

describe('pairPortraits', () => {
	it('pairs adjacent portraits and flags only the first of each pair', () => {
		const out = pairPortraits([
			slide('p1', { ratio: 0.7 }),
			slide('l1', { ratio: 1.5 }),
			slide('p2', { ratio: 0.7 }),
			slide('l2', { ratio: 1.5 })
		]);
		expect(ids(out)).toEqual(['p1', 'p2', 'l1', 'l2']);
		expect(out[0].pairWithNext).toBe(true);
		expect(out[1].pairWithNext).toBe(false);
	});

	it('leaves a lone portrait unpaired', () => {
		const out = pairPortraits([slide('p1', { ratio: 0.7 }), slide('l1', { ratio: 1.5 })]);
		expect(ids(out)).toEqual(['p1', 'l1']);
		expect(out.every((s) => !s.pairWithNext)).toBe(true);
	});

	it('pairs an odd final portrait with one already shown portrait', () => {
		const portraits = Array.from({ length: 5 }, (_, i) => slide(`p${i}`, { ratio: 0.6 }));
		const out = pairPortraits(portraits);
		expect(out[out.length - 1].pairWithNext).toBe(false);
		expect(out.filter((s) => s.pairWithNext)).toHaveLength(3);
		expect(out).toHaveLength(6);
		expect(new Set(ids(out)).size).toBe(5);
		expect(ids(out).slice(0, 5)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
	});

	it('keeps every slide exactly once', () => {
		const mixed = Array.from({ length: 30 }, (_, i) =>
			slide(`s${i}`, { ratio: i % 3 === 0 ? 0.7 : 1.4 })
		);
		const out = pairPortraits(mixed);
		expect(new Set(ids(out)).size).toBe(30);
	});
});

describe('dedupeSlides', () => {
	it('prefers the memory-labeled duplicate', () => {
		const out = dedupeSlides([slide('a'), slide('a', { memoryYearsAgo: 3 }), slide('b')]);
		expect(out).toHaveLength(2);
		expect(out.find((s) => s.id === 'a')?.memoryYearsAgo).toBe(3);
	});
});

describe('orderSlides', () => {
	it('sorts by takenAt descending when shuffle is off', () => {
		const out = orderSlides(
			[
				slide('old', { takenAt: '2020-01-01T00:00:00Z' }),
				slide('new', { takenAt: '2026-01-01T00:00:00Z' }),
				slide('mid', { takenAt: '2023-01-01T00:00:00Z' })
			],
			{ order: 'newest', seed: 'x', pair: false }
		);
		expect(ids(out)).toEqual(['new', 'mid', 'old']);
	});

	it('is stable for a given seed with shuffle on', () => {
		const slides = Array.from({ length: 40 }, (_, i) => slide(`s${i}`));
		const a = orderSlides(slides, { order: 'random', seed: 'frame:2026-08-28', pair: true });
		const b = orderSlides(slides, { order: 'random', seed: 'frame:2026-08-28', pair: true });
		expect(ids(a)).toEqual(ids(b));
	});

	it('sorts oldest first and leaves undated assets last', () => {
		const out = orderSlides(
			[
				slide('new', { takenAt: '2026-01-01T00:00:00Z' }),
				slide('unknown'),
				slide('old', { takenAt: '2020-01-01T00:00:00Z' })
			],
			{ order: 'oldest', seed: 'x', pair: false }
		);
		expect(ids(out)).toEqual(['old', 'new', 'unknown']);
	});
});

describe('isPortrait', () => {
	it('classifies by ratio', () => {
		expect(isPortrait(slide('a', { ratio: 0.66 }))).toBe(true);
		expect(isPortrait(slide('b', { ratio: 1.5 }))).toBe(false);
		expect(isPortrait(slide('c', { ratio: 1.0 }))).toBe(false);
	});
});

describe('getOrderedPage', () => {
	it('returns every asset exactly once before starting a newly shuffled cycle', () => {
		const source = Array.from({ length: 1000 }, (_, i) => slide(`s${i}`));
		const cycles: string[][] = [[], []];
		let cursor: string | null = null;

		for (let cycle = 0; cycle < 2; cycle++) {
			while (cycles[cycle].length < source.length) {
				const page = getOrderedPage(
					source,
					{ order: 'random', seed: 'living-room:2026-08-29', pair: false },
					cursor,
					37
				);
				cycles[cycle].push(...ids(page.slides));
				cursor = page.cursor;
			}
			expect(new Set(cycles[cycle]).size).toBe(1000);
		}

		expect(cycles[0]).not.toEqual(cycles[1]);
	});
});

describe('filterSlides', () => {
	const defaults = {
		orientation: 'all' as const,
		dateFrom: null,
		dateTo: null,
		favoritesOnly: false,
		minRating: 0,
		newestLimit: 0,
		peopleMatch: 'any' as const
	};

	it('combines orientation, date, favorite, and rating filters', () => {
		const out = filterSlides(
			[
				slide('match', { ratio: 0.7, takenAt: '2024-06-01T12:00:00Z', isFavorite: true, rating: 4 }),
				slide('landscape', { ratio: 1.5, takenAt: '2024-06-01T12:00:00Z', isFavorite: true, rating: 5 }),
				slide('old', { ratio: 0.7, takenAt: '2020-01-01T00:00:00Z', isFavorite: true, rating: 5 }),
				slide('low', { ratio: 0.7, takenAt: '2024-06-01T12:00:00Z', isFavorite: true, rating: 2 })
			],
			{ ...defaults, orientation: 'portrait', dateFrom: '2024-01-01', favoritesOnly: true, minRating: 4 }
		);
		expect(ids(out)).toEqual(['match']);
	});

	it('limits to the newest matching assets before playback ordering', () => {
		const out = filterSlides(
			[
				slide('old', { takenAt: '2020-01-01T00:00:00Z' }),
				slide('new', { takenAt: '2025-01-01T00:00:00Z' }),
				slide('mid', { takenAt: '2023-01-01T00:00:00Z' })
			],
			{ ...defaults, newestLimit: 2 }
		);
		expect(ids(out)).toEqual(['new', 'mid']);
	});
});

describe('orderForMap', () => {
	const located = [
		slide('taby-1', { lat: 59.44, lon: 18.07, location: 'Täby, Sweden', takenAt: '2024-01-01' }),
		slide('taby-2', { lat: 59.441, lon: 18.071, location: 'Täby, Sweden', takenAt: '2024-02-01' }),
		slide('taby-3', { lat: 59.442, lon: 18.072, location: 'Täby, Sweden', takenAt: '2024-03-01' }),
		slide('iasi-1', { lat: 47.17, lon: 27.58, location: 'Iași, Romania', takenAt: '2023-01-01' }),
		slide('lisbon-1', { lat: 38.72, lon: -9.14, location: 'Lisbon, Portugal', takenAt: '2022-01-01' }),
		slide('nowhere', { location: null })
	];

	it('keeps only located photos and visits every place once per round', () => {
		const out = orderForMap(located, 'living-room:2026-09-04', 'random');
		expect(out).toHaveLength(5);
		expect(out.map((s) => s.id)).not.toContain('nowhere');
		// Round one holds one photo from each of the three places.
		const firstRound = out.slice(0, 3).map((s) => s.location);
		expect(new Set(firstRound).size).toBe(3);
		// Täby's remaining photos follow, one per round, never two in a row within a round.
		expect(out.slice(3).every((s) => s.location === 'Täby, Sweden')).toBe(true);
		expect(new Set(out.map((s) => s.id)).size).toBe(5);
	});

	it('is deterministic for a seed and changes with it', () => {
		const a = orderForMap(located, 'seed-a', 'random').map((s) => s.id);
		const b = orderForMap(located, 'seed-a', 'random').map((s) => s.id);
		expect(a).toEqual(b);
		const differs = ['seed-b', 'seed-c', 'seed-d', 'seed-e'].some((seed) => orderForMap(located, seed, 'random').map((s) => s.id).join() !== a.join());
		expect(differs).toBe(true);
	});

	it('orders photos within a place chronologically when asked', () => {
		const out = orderForMap(located, 'seed', 'oldest');
		const taby = out.filter((s) => s.location === 'Täby, Sweden').map((s) => s.id);
		expect(taby).toEqual(['taby-1', 'taby-2', 'taby-3']);
	});

	it('is what getOrderedPage uses for the map layout', () => {
		const page = getOrderedPage(located, { order: 'random', seed: 'seed', pair: true, mode: 'map' }, null, 10);
		expect(page.total).toBe(5);
		expect(page.slides.every((s) => typeof s.lat === 'number')).toBe(true);
		expect(page.slides.every((s) => !s.pairWithNext)).toBe(true);
	});
});
