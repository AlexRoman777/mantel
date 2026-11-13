// Pure playlist ordering logic — no IO, unit-tested in isolation.
// Uses relative imports so vitest can run it without the SvelteKit runtime.

import type { FilterSettings, PlaylistResponse, SlideAsset } from '../types';
import { clusterPlaces } from '../map/geo';

/** FNV-1a 32-bit hash: turns "kitchen:2026-08-28" into a shuffle seed. */
export function hashSeed(str: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** mulberry32 — tiny deterministic PRNG. */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Fisher–Yates with a seeded PRNG: same seed → same order (stable paging). */
export function seededShuffle<T>(items: readonly T[], seedStr: string): T[] {
	const rand = mulberry32(hashSeed(seedStr));
	const out = items.slice();
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/**
 * Spread memory slides ("X years ago") evenly through the deck so they
 * actually get seen instead of drowning in the shuffle.
 */
export function interleaveMemories(slides: readonly SlideAsset[]): SlideAsset[] {
	const memories = slides.filter((s) => s.memoryYearsAgo !== undefined);
	const others = slides.filter((s) => s.memoryYearsAgo === undefined);
	if (memories.length === 0 || others.length === 0) return slides.slice();

	const spacing = Math.max(2, Math.floor(others.length / memories.length));
	const out: SlideAsset[] = [];
	let m = 0;
	for (let i = 0; i < others.length; i++) {
		// Memory first at each interval boundary so one appears near the start.
		if (i % spacing === 0 && m < memories.length) out.push(memories[m++]);
		out.push(others[i]);
	}
	out.push(...memories.slice(m));
	return out;
}

const PORTRAIT_RATIO = 0.95;

export function isPortrait(s: SlideAsset): boolean {
	return s.ratio < PORTRAIT_RATIO;
}

/**
 * Pair every portrait with another unused portrait from anywhere later in the
 * cycle. If the cycle has an odd number of portraits, only the final orphan
 * reuses the first portrait, after every unique portrait has already appeared.
 */
export function pairPortraits(slides: readonly SlideAsset[]): SlideAsset[] {
	const src = slides.map((s) => ({ ...s, pairWithNext: false }));
	const out: SlideAsset[] = [];
	const used = new Set<number>();
	let orphan: SlideAsset | null = null;

	for (let i = 0; i < src.length; i++) {
		if (used.has(i)) continue;
		const current = src[i];
		if (!isPortrait(current)) {
			out.push(current);
			continue;
		}
		let partner = -1;
		for (let j = i + 1; j < src.length; j++) {
			if (!used.has(j) && isPortrait(src[j])) {
				partner = j;
				break;
			}
		}
		if (partner === -1) {
			const prior = out.find((slide) => isPortrait(slide));
			if (prior) orphan = current;
			else out.push(current);
		} else {
			used.add(partner);
			out.push({ ...current, pairWithNext: true }, src[partner]);
		}
	}
	if (orphan) {
		const prior = out.find((slide) => isPortrait(slide));
		if (prior) out.push({ ...orphan, pairWithNext: true }, { ...prior, pairWithNext: false });
	}
	return out;
}

export interface OrderOptions {
	order: 'random' | 'newest' | 'oldest';
	seed: string;
	pair: boolean;
	/** Map layout: located photos only, visiting every place in turn. */
	mode?: 'map';
}

/**
 * Map deck: one photo per place per round, so the camera keeps travelling and
 * a place with 300 photos does not monopolise the screen. Every photo still
 * appears exactly once per cycle. Photos without coordinates are left out.
 */
export function orderForMap(slides: readonly SlideAsset[], seed: string, order: OrderOptions['order']): SlideAsset[] {
	const places = clusterPlaces(slides);
	if (places.length === 0) return [];
	const rand = mulberry32(hashSeed(`${seed}:places`));
	const rounds = places.map((place, index) => {
		let photos = place.slides.slice();
		if (order === 'random') photos = seededShuffle(photos, `${seed}:place:${index}`);
		else {
			const direction = order === 'newest' ? -1 : 1;
			photos.sort((a, b) => direction * (a.takenAt ?? '').localeCompare(b.takenAt ?? ''));
		}
		return photos;
	});
	// Shuffle the visiting order per round with the seed, keeping consecutive
	// stops apart: the last place of a round never opens the next one.
	const out: SlideAsset[] = [];
	let previousLast = -1;
	for (let round = 0; rounds.some((photos) => photos.length > round); round++) {
		const active = rounds.map((photos, index) => (photos.length > round ? index : -1)).filter((index) => index >= 0);
		for (let i = active.length - 1; i > 0; i--) {
			const j = Math.floor(rand() * (i + 1));
			[active[i], active[j]] = [active[j], active[i]];
		}
		if (active.length > 1 && active[0] === previousLast) [active[0], active[active.length - 1]] = [active[active.length - 1], active[0]];
		for (const index of active) out.push(rounds[index][round]);
		previousLast = active[active.length - 1];
	}
	return out;
}

/** Full ordering pipeline: shuffle/sort → memory interleave → portrait pairing. */
export function orderSlides(slides: readonly SlideAsset[], opts: OrderOptions): SlideAsset[] {
	let out: SlideAsset[];
	if (opts.mode === 'map') return orderForMap(slides, opts.seed, opts.order);
	if (opts.order === 'random') {
		out = interleaveMemories(seededShuffle(slides, opts.seed));
	} else {
		const direction = opts.order === 'newest' ? -1 : 1;
		out = slides.slice().sort((a, b) => {
			if (!a.takenAt) return b.takenAt ? 1 : 0;
			if (!b.takenAt) return -1;
			return direction * a.takenAt.localeCompare(b.takenAt);
		});
	}
	if (opts.pair) out = pairPortraits(out);
	return out;
}

/**
 * Page one explicit playback cycle. The cursor carries the cycle number so a
 * random deck is reshuffled only after every asset in the previous one was sent.
 */
export function getOrderedPage(
	slides: readonly SlideAsset[],
	opts: OrderOptions,
	cursor: string | null,
	count: number
): PlaylistResponse {
	const parsed = cursor?.match(/^(\d+):(\d+)$/);
	const cycle = parsed ? Number(parsed[1]) : 0;
	const requestedOffset = parsed ? Number(parsed[2]) : Math.abs(Number(cursor) || 0);
	const all = orderSlides(slides, { ...opts, seed: `${opts.seed}:cycle-${cycle}` });
	const total = all.length;
	if (total === 0) return { slides: [], cursor: null, total: 0 };

	const offset = Math.abs(requestedOffset) % total;
	let end = Math.min(offset + count, total);
	if (end < total && all[end - 1]?.pairWithNext) end++;

	return {
		slides: all.slice(offset, end),
		cursor: end >= total ? `${cycle + 1}:0` : `${cycle}:${end}`,
		total
	};
}

/** Dedupe by asset id; entries carrying a memory label win over plain ones. */
export function dedupeSlides(slides: readonly SlideAsset[]): SlideAsset[] {
	const byId = new Map<string, SlideAsset>();
	for (const s of slides) {
		const existing = byId.get(s.id);
		if (!existing || (s.memoryYearsAgo !== undefined && existing.memoryYearsAgo === undefined)) {
			byId.set(s.id, s);
		}
	}
	return [...byId.values()];
}

/** Apply metadata-only filters after source results have been combined. */
export function filterSlides(
	slides: readonly SlideAsset[],
	filters: FilterSettings
): SlideAsset[] {
	let out = slides.filter((slide) => {
		if (filters.orientation === 'portrait' && !isPortrait(slide)) return false;
		if (filters.orientation === 'landscape' && isPortrait(slide)) return false;
		if (filters.favoritesOnly && !slide.isFavorite) return false;
		if (filters.minRating > 0 && (slide.rating ?? 0) < filters.minRating) return false;
		const date = slide.takenAt?.slice(0, 10) ?? null;
		if (filters.dateFrom && (!date || date < filters.dateFrom)) return false;
		if (filters.dateTo && (!date || date > filters.dateTo)) return false;
		return true;
	});

	if (filters.newestLimit > 0 && out.length > filters.newestLimit) {
		out = out
			.slice()
			.sort((a, b) => (b.takenAt ?? '').localeCompare(a.takenAt ?? ''))
			.slice(0, filters.newestLimit);
	}
	return out;
}
