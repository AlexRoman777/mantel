// Resolves a display profile's sources into an ordered, paged slide queue.
// The server does all the work; the client just consumes lean SlideAsset pages.

import type { DisplayProfile, PlaylistResponse, SlideAsset } from '$lib/types';
import { env } from '$env/dynamic/private';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getAlbums, getMemories, searchMetadata, type ImmichAsset } from './immich';
import { prefetchImages } from './image-cache';
import { dedupeSlides, filterSlides, getOrderedPage } from './playlist-core';
import { isDisplayable, toSlideAsset } from './slides';

const CACHE_TTL_MS = Math.max(1, Number(env.PLAYLIST_REFRESH_MINUTES) || 60) * 60_000;
const MAX_PAGES = 400; // defensive ceiling: 100,000 assets per source

const cache = new Map<string, { at: number; slides: SlideAsset[] }>();
const UPDATE_POLL_MS = Math.max(1, Number(env.IMMICH_UPDATE_POLL_MINUTES) || 5) * 60_000;
const albumWatch = new Map<string, { signature: string; ids: Set<string>; checkedAt: number; result: DisplayUpdate }>();
const albumPolls = new Map<string, Promise<DisplayUpdate>>();
const cycleDecks = new Map<string, { at: number; seed: string; slides: SlideAsset[] }>();

function deckDir(): string {
	return path.join(env.DATA_DIR || './data', 'playback-decks');
}

function deckPath(key: string): string {
	return path.join(deckDir(), `${createHash('sha256').update(key).digest('hex')}.json`);
}

async function loadDeck(key: string): Promise<{ at: number; seed: string; slides: SlideAsset[] } | null> {
	try {
		const parsed = JSON.parse(await fs.readFile(deckPath(key), 'utf8')) as {
			at?: number;
			seed?: string;
			slides?: SlideAsset[];
		};
		if (!parsed.seed || !Array.isArray(parsed.slides)) return null;
		return { at: parsed.at ?? Date.now(), seed: parsed.seed, slides: parsed.slides };
	} catch {
		return null;
	}
}

async function saveDeck(key: string, deck: { at: number; seed: string; slides: SlideAsset[] }): Promise<void> {
	await fs.mkdir(deckDir(), { recursive: true });
	const target = deckPath(key);
	const temporary = `${target}.${process.pid}-${randomUUID()}.tmp`;
	await fs.writeFile(temporary, JSON.stringify(deck), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
	await fs.rename(temporary, target);

	const entries = await fs.readdir(deckDir(), { withFileTypes: true }).catch(() => []);
	const files = await Promise.all(
		entries
			.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
			.map(async (entry) => ({
				path: path.join(deckDir(), entry.name),
				mtime: (await fs.stat(path.join(deckDir(), entry.name))).mtimeMs
			}))
	);
	files.sort((a, b) => b.mtime - a.mtime);
	await Promise.allSettled(files.slice(32).map((file) => fs.rm(file.path, { force: true })));
}

export async function clearPlaylistCache(): Promise<void> {
	cache.clear();
	albumWatch.clear();
	albumPolls.clear();
	cycleDecks.clear();
	await fs.rm(deckDir(), { recursive: true, force: true });
}

async function fetchAllPages(query: { albumIds?: string[]; personIds?: string[]; connectionId?: string }): Promise<ImmichAsset[]> {
	const assets: ImmichAsset[] = [];
	for (let page = 1; page <= MAX_PAGES; page++) {
		const res = await searchMetadata({ ...query, page, size: 250 });
		assets.push(...res.assets.items);
		if (!res.assets.nextPage) break;
	}
	return assets;
}

function localDateString(): string {
	// Local date, not UTC: "today's memories" should follow the frame's timezone (TZ env).
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

async function resolveSource(
	source: DisplayProfile['sources'][number],
	today: string
): Promise<SlideAsset[]> {
	switch (source.type) {
		case 'album': {
			const assets = await fetchAllPages({ albumIds: [source.albumId], connectionId: source.connectionId });
			return assets.filter(isDisplayable).map((a) => toSlideAsset(a, undefined, source.connectionId));
		}
		case 'person': {
			const assets = await fetchAllPages({ personIds: [source.personId], connectionId: source.connectionId });
			return assets.filter(isDisplayable).map((a) => toSlideAsset(a, undefined, source.connectionId));
		}
		case 'random': {
			// Enumerate the connection's complete allowed-album set. A random API
			// sample can omit assets forever, which breaks one-show-per-cycle.
			const assets = await fetchAllPages({ connectionId: source.connectionId });
			return assets.filter(isDisplayable).map((a) => toSlideAsset(a, undefined, source.connectionId));
		}
		case 'memories': {
			const [memories, allowedAssets] = await Promise.all([
				getMemories(today, source.connectionId),
				fetchAllPages({ connectionId: source.connectionId })
			]);
			const allowedIds = new Set(allowedAssets.map((asset) => asset.id));
			const currentYear = Number(today.slice(0, 4));
			return memories.flatMap((memory) =>
				memory.assets
					.filter((asset) => allowedIds.has(asset.id) && isDisplayable(asset))
					.map((a) => toSlideAsset(a, currentYear - memory.data.year, source.connectionId))
			);
		}
	}
}

function candidateKey(profile: DisplayProfile): string {
	const today = localDateString();
	return JSON.stringify([
		profile.id,
		profile.sources,
		profile.slideshow.order,
		profile.slideshow.portraitMode,
		profile.filters,
		today
	]);
}

async function resolveCandidates(profile: DisplayProfile, force = false): Promise<SlideAsset[]> {
	const today = localDateString();
	const key = candidateKey(profile);

	const hit = cache.get(key);
	if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.slides;

	const settled = await Promise.allSettled(profile.sources.map((s) => resolveSource(s, today)));
	const failures = settled.filter((r) => r.status === 'rejected');
	for (const f of failures) console.error('playlist source failed:', f.reason);

	const resolved = settled.flatMap((result, index) =>
		result.status === 'fulfilled' ? [{ source: profile.sources[index], slides: result.value }] : []
	);
	let candidates = resolved.flatMap((result) => result.slides);

	// If every source failed (Immich down), surface it instead of caching emptiness.
	if (candidates.length === 0 && failures.length > 0) {
		throw (failures[0] as PromiseRejectedResult).reason;
	}

	const selectedPeople = profile.sources.filter((source) => source.type === 'person');
	if (profile.filters.peopleMatch === 'all' && selectedPeople.length > 1) {
		const personSets = resolved
			.filter((result) => result.source.type === 'person')
			.map((result) => new Set(result.slides.map((slide) => slide.id)));
		if (personSets.length === selectedPeople.length) {
			candidates = candidates.filter((slide) => personSets.every((ids) => ids.has(slide.id)));
		}
	}

	const slides = filterSlides(dedupeSlides(candidates), profile.filters);
	cache.set(key, { at: Date.now(), slides });
	// Drop stale entries so the map doesn't grow across days/edits.
	for (const [k, v] of cache) if (Date.now() - v.at >= CACHE_TTL_MS) cache.delete(k);
	return slides;
}

/** Resolve the exact deduplicated/filtered asset set used by this display. */
export function getDisplayCandidates(profile: DisplayProfile): Promise<SlideAsset[]> {
	return resolveCandidates(profile);
}

export interface DisplayUpdate {
	checkedAt: string;
	newSlides: SlideAsset[];
	total: number;
	watching: boolean;
}

/**
 * Check cheap album metadata at a globally throttled interval. Multiple players
 * share the same result, so adding screens does not multiply Immich requests. Only enumerate assets when an
 * album's count/update timestamp changed, then return just newly added photos.
 */
async function pollDisplayUpdatesInner(profile: DisplayProfile): Promise<DisplayUpdate> {
	const albumSources = profile.sources.filter((source) => source.type === 'album');
	if (albumSources.length === 0 || albumSources.length !== profile.sources.length) {
		return { checkedAt: new Date().toISOString(), newSlides: [], total: 0, watching: false };
	}
	const previous = albumWatch.get(profile.id);
	if (previous && Date.now() - previous.checkedAt < UPDATE_POLL_MS) return previous.result;
	const connectionIds = [...new Set(albumSources.map((source) => source.connectionId))];
	const albumGroups = await Promise.all(connectionIds.map(async (connectionId) => ({
		connectionId,
		albums: await getAlbums(connectionId)
	})));
	const albumRows = albumGroups.flatMap(({ connectionId, albums }) => {
		const selected = new Set(albumSources.filter((source) => source.connectionId === connectionId).map((source) => source.albumId));
		return albums.filter((album) => selected.has(album.id)).map((album) => ({ connectionId, album }));
	});
	const signature = albumRows
		.map(({ connectionId, album }) => `${connectionId ?? 'default'}:${album.id}:${album.assetCount}:${album.updatedAt ?? ''}`)
		.sort()
		.join('|');
	const current = await resolveCandidates(profile, previous !== undefined && previous.signature !== signature);
	const ids = new Set(current.map((slide) => slide.id));
	if (!previous) {
		const result = { checkedAt: new Date().toISOString(), newSlides: [], total: ids.size, watching: true };
		albumWatch.set(profile.id, { signature, ids, checkedAt: Date.now(), result });
		return result;
	}
	const newSlides = previous.signature === signature
		? []
		: current.filter((slide) => !previous.ids.has(slide.id));
	const result = { checkedAt: new Date().toISOString(), newSlides, total: ids.size, watching: true };
	albumWatch.set(profile.id, { signature, ids, checkedAt: Date.now(), result });
	return result;
}

export function pollDisplayUpdates(profile: DisplayProfile): Promise<DisplayUpdate> {
	const running = albumPolls.get(profile.id);
	if (running) return running;
	const poll = pollDisplayUpdatesInner(profile).finally(() => albumPolls.delete(profile.id));
	albumPolls.set(profile.id, poll);
	return poll;
}

export async function getPlaylistPage(
	profile: DisplayProfile,
	cursor: string | null,
	count: number,
	portraitViewport = false,
	person?: { id: string; connectionId?: string }
): Promise<PlaylistResponse> {
	const parsed = cursor?.match(/^(\d+):(\d+)$/);
	const cycle = parsed ? Number(parsed[1]) : 0;
	const deckKey = JSON.stringify([
		profile.id,
		profile.sources,
		profile.filters,
		profile.slideshow.order,
		profile.slideshow.portraitMode,
		profile.slideshow.layout,
		person,
		cycle
	]);
	let deck = cycleDecks.get(deckKey) ?? (await loadDeck(deckKey)) ?? undefined;
	if (!deck) {
		let candidates = await resolveCandidates(profile);
		if (person) {
			const personAssets = await fetchAllPages({ personIds: [person.id], connectionId: person.connectionId });
			const personIds = new Set(personAssets.map((asset) => asset.id));
			// Intersect with the configured presentation. A remote shortcut can
			// narrow an album, but can never escape its allowed photo sources.
			candidates = candidates.filter((slide) => personIds.has(slide.id));
		}
		deck = { at: Date.now(), seed: `${profile.slug}:${localDateString()}`, slides: candidates.slice() };
		cycleDecks.set(deckKey, deck);
		await saveDeck(deckKey, deck);
		// A frozen deck prevents an album addition from shifting offsets midway
		// through a cycle. Keep the map bounded across many displays/config edits.
		while (cycleDecks.size > 32) cycleDecks.delete(cycleDecks.keys().next().value!);
	} else cycleDecks.set(deckKey, deck);
	const page = getOrderedPage(
		deck.slides,
		{
			order: profile.slideshow.order,
			seed: deck.seed,
			pair: !portraitViewport && profile.slideshow.layout === 'adaptive' && profile.slideshow.portraitMode === 'pair',
			...(profile.slideshow.layout === 'map' ? { mode: 'map' as const } : {})
		},
		cursor,
		count
	);
	// Warm only the immediately requested page. Bulk album caching is an explicit,
	// confirmed controller action so a broad account can never fill the NAS by surprise.
	void prefetchImages(page.slides, profile.slideshow.imageSize);
	return page;
}
