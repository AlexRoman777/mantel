// Regional map detail from OpenStreetMap (© OpenStreetMap contributors, ODbL)
// through the Overpass API: main roads, railways, rivers, lakes, every nearby
// settlement with its name, named peaks and airfields — what reads well from
// 100 to 600 km up; no streets. One query per place, fetched sequentially,
// simplified and cached forever under DATA_DIR/map-cache/osm. Players only
// ever read the cache.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const USER_AGENT = 'Mantel photo frame (self-hosted; https://github.com/AlexRoman777/mantel)';

/** Road classes, most important first; the renderer picks width and colour by index. */
export const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'] as const;
export type PlaceKind = 'city' | 'town' | 'village' | 'hamlet' | 'suburb' | 'neighbourhood';

export interface OsmDetail {
	/** Requested centre and the window this data covers (degrees). */
	center: { lat: number; lon: number };
	bounds: { lon0: number; lat0: number; lon1: number; lat1: number };
	roads: Array<{ c: number; g: number[] }>;
	rails: number[][];
	rivers: Array<{ major: boolean; g: number[] }>;
	water: number[][];
	forest: number[][];
	parks: number[][];
	places: Array<{ n: string; t: PlaceKind; lat: number; lon: number; pop: number }>;
	peaks: Array<{ n: string; lat: number; lon: number; ele: number | null }>;
	airports: Array<{ n: string; lat: number; lon: number }>;
	fetchedAt: number;
}

interface OverpassElement {
	type: 'node' | 'way' | 'relation';
	id: number;
	lat?: number;
	lon?: number;
	tags?: Record<string, string>;
	geometry?: Array<{ lat: number; lon: number }>;
}

function cacheDir(): string {
	return path.join(env.DATA_DIR || './data', 'map-cache', 'osm');
}

export function osmKey(lat: number, lon: number, zoomKm: number): string {
	return createHash('sha1').update(`${lat.toFixed(3)}:${lon.toFixed(3)}:${zoomKm}`).digest('hex').slice(0, 20);
}

/** Windows (km wide) for the two query sizes, bounded so Overpass stays fast. */
export function osmWindows(zoomKm: number): { regionalKm: number } {
	return { regionalKm: Math.min(320, Math.max(80, zoomKm * 1.6)) };
}

function bbox(lat: number, lon: number, widthKm: number): { lon0: number; lat0: number; lon1: number; lat1: number } {
	const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
	const halfLon = widthKm / 2 / 111 / cosLat;
	const halfLat = (widthKm * 0.6) / 2 / 111;
	return { lon0: lon - halfLon, lat0: lat - halfLat, lon1: lon + halfLon, lat1: lat + halfLat };
}

const box = (b: { lon0: number; lat0: number; lon1: number; lat1: number }) => `${b.lat0.toFixed(4)},${b.lon0.toFixed(4)},${b.lat1.toFixed(4)},${b.lon1.toFixed(4)}`;

export function regionalQuery(b: { lon0: number; lat0: number; lon1: number; lat1: number }, widthKm: number): string {
	const secondary = widthKm <= 200 ? '|secondary' : '';
	const smallPlaces = widthKm <= 200 ? '|hamlet' : '';
	return `[out:json][timeout:150];(
way["highway"~"^(motorway|trunk|primary${secondary})$"](${box(b)});
way["railway"="rail"]["usage"~"^(main|branch)$"](${box(b)});
way["waterway"="river"](${box(b)});
way["natural"="water"]["water"!~"^(pond|ditch|canal|basin|reflecting_pool)$"](${box(b)});
node["place"~"^(city|town|village${smallPlaces})$"](${box(b)});
node["natural"="peak"]["name"]["ele"](${box(b)});
node["aeroway"="aerodrome"]["name"]["iata"](${box(b)});
);out geom;`;
}

// ---- geometry helpers ---------------------------------------------------------------
function simplify(points: Array<[number, number]>, tolerance: number): Array<[number, number]> {
	if (points.length <= 3) return points;
	const keep = new Uint8Array(points.length);
	keep[0] = keep[points.length - 1] = 1;
	const stack: Array<[number, number]> = [[0, points.length - 1]];
	const sq = tolerance * tolerance;
	while (stack.length) {
		const [a, b] = stack.pop()!;
		let best = -1;
		let bestDistance = sq;
		const [ax, ay] = points[a];
		const [bx, by] = points[b];
		const dx = bx - ax;
		const dy = by - ay;
		const length = dx * dx + dy * dy;
		for (let i = a + 1; i < b; i++) {
			const [px, py] = points[i];
			let distance: number;
			if (length === 0) distance = (px - ax) ** 2 + (py - ay) ** 2;
			else {
				const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
				distance = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
			}
			if (distance > bestDistance) {
				bestDistance = distance;
				best = i;
			}
		}
		if (best !== -1) {
			keep[best] = 1;
			stack.push([a, best], [best, b]);
		}
	}
	return points.filter((_, i) => keep[i]);
}

function flat(points: Array<[number, number]>): number[] {
	const out: number[] = [];
	for (const [lon, lat] of points) out.push(Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5);
	return out;
}

function geometryOf(element: OverpassElement): Array<[number, number]> {
	return (element.geometry ?? []).map((p) => [p.lon, p.lat]);
}

function classOf(highway: string): number {
	if (highway.startsWith('motorway')) return 0;
	if (highway.startsWith('trunk')) return 1;
	if (highway.startsWith('primary')) return 2;
	if (highway === 'secondary') return 3;
	if (highway === 'tertiary') return 4;
	return 5;
}

export function compileOsm(elements: OverpassElement[], center: { lat: number; lon: number }, bounds: OsmDetail['bounds'], tolerance: number, into?: OsmDetail): OsmDetail {
	const out: OsmDetail = into ?? {
		center, bounds, roads: [], rails: [], rivers: [], water: [], forest: [], parks: [], places: [], peaks: [], airports: [], fetchedAt: Date.now()
	};
	const seenPlaces = new Set(out.places.map((p) => `${p.n}:${p.t}`));
	for (const element of elements) {
		const tags = element.tags ?? {};
		if (element.type === 'node') {
			if (typeof element.lat !== 'number' || typeof element.lon !== 'number') continue;
			if (tags.place && tags.name) {
				const key = `${tags.name}:${tags.place}`;
				if (seenPlaces.has(key)) continue;
				seenPlaces.add(key);
				out.places.push({ n: tags.name, t: tags.place as PlaceKind, lat: element.lat, lon: element.lon, pop: Number(tags.population) || 0 });
			} else if (tags.natural === 'peak' && tags.name) {
				out.peaks.push({ n: tags.name, lat: element.lat, lon: element.lon, ele: Number.isFinite(Number(tags.ele)) ? Math.round(Number(tags.ele)) : null });
			} else if (tags.aeroway === 'aerodrome' && tags.name) {
				out.airports.push({ n: tags.name, lat: element.lat, lon: element.lon });
			}
			continue;
		}
		const points = geometryOf(element);
		if (points.length < 2) continue;
		const g = flat(simplify(points, tolerance));
		if (g.length < 4) continue;
		if (tags.highway) out.roads.push({ c: classOf(tags.highway), g });
		else if (tags.railway === 'rail') out.rails.push(g);
		else if (tags.waterway) out.rivers.push({ major: tags.waterway === 'river', g });
		else if (tags.natural === 'water' || tags.landuse === 'reservoir') out.water.push(g);
		else if (tags.landuse === 'forest' || tags.natural === 'wood') out.forest.push(g);
		else if (tags.leisure) out.parks.push(g);
		else if (tags.aeroway === 'aerodrome' && tags.name) {
			const mid = points[Math.floor(points.length / 2)];
			out.airports.push({ n: tags.name, lat: mid[1], lon: mid[0] });
		}
	}
	return out;
}

// ---- fetching ----------------------------------------------------------------------------
let chain: Promise<void> = Promise.resolve();
const inflight = new Map<string, Promise<OsmDetail | null>>();

async function overpass(query: string): Promise<OverpassElement[] | null> {
	for (const endpoint of ENDPOINTS) {
		try {
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
				body: `data=${encodeURIComponent(query)}`,
				signal: AbortSignal.timeout(150_000)
			});
			if (res.status === 429 || res.status === 504) continue;
			if (!res.ok) return null;
			const data = (await res.json()) as { elements?: OverpassElement[] };
			return data.elements ?? [];
		} catch {
			// try the next mirror
		}
	}
	return null;
}

async function readCached(key: string): Promise<OsmDetail | null> {
	try {
		return JSON.parse(await fs.readFile(path.join(cacheDir(), `${key}.json`), 'utf8')) as OsmDetail;
	} catch {
		return null;
	}
}

/** Cached detail for a stop, or null when it has not been fetched yet (a fetch is queued). */
export async function getOsmDetail(lat: number, lon: number, zoomKm: number, wait = false): Promise<OsmDetail | null> {
	const key = osmKey(lat, lon, zoomKm);
	const cached = await readCached(key);
	if (cached) return cached;
	const job = fetchOsmDetail(lat, lon, zoomKm, key);
	return wait ? job : null;
}

export function fetchOsmDetail(lat: number, lon: number, zoomKm: number, key = osmKey(lat, lon, zoomKm)): Promise<OsmDetail | null> {
	const pending = inflight.get(key);
	if (pending) return pending;
	const job = new Promise<OsmDetail | null>((resolve) => {
		// Overpass asks for one query at a time per client; keep a polite gap between them.
		chain = chain.then(async () => {
			const cached = await readCached(key);
			if (cached) return resolve(cached);
			const { regionalKm } = osmWindows(zoomKm);
			const regional = bbox(lat, lon, regionalKm);
			const elements = await overpass(regionalQuery(regional, regionalKm));
			if (!elements) return resolve(null);
			const detail = compileOsm(elements, { lat, lon }, regional, 0.0005);
			try {
				await fs.mkdir(cacheDir(), { recursive: true });
				const target = path.join(cacheDir(), `${key}.json`);
				await fs.writeFile(`${target}.tmp`, JSON.stringify(detail));
				await fs.rename(`${target}.tmp`, target);
			} catch {
				// cache is best effort
			}
			resolve(detail);
			await new Promise((r) => setTimeout(r, 2000));
		}).catch(() => resolve(null));
	}).finally(() => inflight.delete(key));
	inflight.set(key, job);
	return job;
}

const warmed = new Set<string>();

/** Queue map detail for a small caller-supplied stop lookahead. */
export function warmOsmDetail(places: ReadonlyArray<{ lat: number; lon: number }>, zoomKm: number): void {
	for (const place of places) {
		const key = osmKey(place.lat, place.lon, zoomKm);
		if (warmed.has(key)) continue;
		warmed.add(key);
		void fetchOsmDetail(place.lat, place.lon, zoomKm, key);
	}
}

export async function osmCacheStats(): Promise<{ places: number; bytes: number }> {
	const entries = await fs.readdir(cacheDir(), { withFileTypes: true }).catch(() => []);
	let places = 0;
	let bytes = 0;
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
		places++;
		bytes += (await fs.stat(path.join(cacheDir(), entry.name)).catch(() => ({ size: 0 }))).size;
	}
	return { places, bytes };
}
