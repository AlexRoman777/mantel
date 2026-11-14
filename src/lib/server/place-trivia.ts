// Glanceable facts about a photo's location for the map layout.
//
// Offline (always): the place ladder from bundled Natural Earth data (island,
// region, country, continent), local time, sunrise/sunset, population, capital
// status, distance from home, photo count.
// Online (opt-in): street/neighbourhood/town names from OpenStreetMap's
// Nominatim (1 request/s, cached forever), one Wikipedia sentence (cached
// 60 days) and the current weather from Open-Meteo (cached 30 minutes).

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as env from '$app/env/private';
import {
	containingShape, decodeDetail, decodePlaces, decodeWorld, distanceKm, nearestPlace, sunTimes,
	type Country, type DetailData, type Place, type WorldData
} from '#lib/map/geo.js';
import placesJson from '../../../static/map/places.json';
import countriesJson from '../../../static/map/countries.json';
import worldJson from '../../../static/map/world.json';
import detailJson from '../../../static/map/detail.json';

export type LadderLevel = 'street' | 'neighbourhood' | 'place' | 'municipality' | 'region' | 'island' | 'country' | 'continent';

export interface PlaceTrivia {
	/** Display title: the best name we have for the spot. */
	title: string;
	/** "Region, Country" or just the country. */
	subtitle: string | null;
	/** Where the spot sits, from the most local name outward. */
	ladder: Array<{ level: LadderLevel; name: string }>;
	/** Short facts in reading order; each fits on one line. */
	facts: string[];
	localTime: string | null;
	timezone: string | null;
	sun: { sunrise: string; sunset: string } | null;
	weather: { temperatureC: number; code: number; text: string; isDay: boolean } | null;
	/** Optional Wikipedia extract, one or two sentences. */
	summary: string | null;
	summarySource: string | null;
}

interface CountryFacts {
	name: string;
	iso: string;
	continent: string;
	subregion: string;
	population: number;
	formalName: string;
	admin: string;
}

interface Bounded<T> {
	shape: T;
	minLat: number;
	maxLat: number;
	minLon: number;
	maxLon: number;
}

const WIKI_TIMEOUT_MS = 8_000;
const WIKI_CACHE_TTL_MS = 60 * 24 * 60 * 60_000;
const WEATHER_TTL_MS = 30 * 60_000;
const USER_AGENT = 'Mantel photo frame (self-hosted; https://github.com/AlexRoman777/mantel)';

let places: Place[] | null = null;
let countries: Map<string, CountryFacts> | null = null;
let world: WorldData | null = null;
let detail: DetailData | null = null;
let countryIndex: Bounded<Country>[] | null = null;
let regionIndex: Bounded<DetailData['regions'][number]>[] | null = null;
let islandIndex: Bounded<DetailData['islands'][number]>[] | null = null;
const wikiMemory = new Map<string, Promise<{ extract: string | null; title: string | null }>>();
const reverseMemory = new Map<string, Promise<ReverseResult | null>>();
const weatherMemory = new Map<string, { at: number; value: PlaceTrivia['weather'] }>();

function allPlaces(): Place[] {
	places ??= decodePlaces(placesJson);
	return places;
}

function allCountries(): Map<string, CountryFacts> {
	if (!countries) {
		countries = new Map();
		for (const [name, iso, continent, subregion, population, formalName, admin] of (countriesJson as unknown as { rows: Array<[string, string, string, string, number, string, string]> }).rows) {
			countries.set(name, { name, iso, continent, subregion, population, formalName, admin });
		}
	}
	return countries;
}

function bounded<T extends { rings: Float64Array[] }>(shapes: readonly T[]): Bounded<T>[] {
	return shapes.map((shape) => {
		let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
		for (const ring of shape.rings) {
			for (let i = 0; i < ring.length; i += 2) {
				if (ring[i] < minLon) minLon = ring[i];
				if (ring[i] > maxLon) maxLon = ring[i];
				if (ring[i + 1] < minLat) minLat = ring[i + 1];
				if (ring[i + 1] > maxLat) maxLat = ring[i + 1];
			}
		}
		return { shape, minLat, maxLat, minLon, maxLon };
	});
}

function lookup<T extends { rings: Float64Array[] }>(index: Bounded<T>[], lat: number, lon: number): T | null {
	const candidates = index.filter((b) => lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon).map((b) => b.shape);
	return containingShape(candidates, lat, lon);
}

function geoIndexes(): { countries: Bounded<Country>[]; regions: Bounded<DetailData['regions'][number]>[]; islands: Bounded<DetailData['islands'][number]>[] } {
	world ??= decodeWorld(worldJson);
	detail ??= decodeDetail(detailJson);
	countryIndex ??= bounded(world.countries);
	regionIndex ??= bounded(detail.regions);
	islandIndex ??= bounded(detail.islands);
	return { countries: countryIndex, regions: regionIndex, islands: islandIndex };
}

function wikiCacheDir(): string {
	return path.join(env.DATA_DIR || './data', 'trivia-cache');
}

export function formatPopulation(population: number): string {
	if (population >= 1_000_000) return `${(population / 1_000_000).toFixed(population >= 10_000_000 ? 0 : 1)} million people`;
	if (population >= 10_000) return `${Math.round(population / 1000).toLocaleString('en-US')},000 people`;
	if (population >= 1000) return `about ${(Math.round(population / 100) * 100).toLocaleString('en-US')} people`;
	return population > 0 ? `${population} people` : '';
}

function formatCoordinates(lat: number, lon: number): string {
	const ns = lat >= 0 ? 'N' : 'S';
	const ew = lon >= 0 ? 'E' : 'W';
	return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(2)}° ${ew}`;
}

function formatTime(date: Date, timeZone: string): string | null {
	try {
		return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(date);
	} catch {
		return null;
	}
}

/** IANA zone for a spot: nearest populated place with a zone within 250 km, else a longitude estimate. */
export function timezoneFor(lat: number, lon: number): string | null {
	let best: Place | null = null;
	let bestKm = 250;
	for (const place of allPlaces()) {
		if (!place.timezone || Math.abs(place.lat - lat) > 2.5 || Math.abs(place.lon - lon) > 5) continue;
		const km = distanceKm(lat, lon, place.lat, place.lon);
		if (km < bestKm) {
			bestKm = km;
			best = place;
		}
	}
	if (best?.timezone) return best.timezone;
	const offset = Math.round(lon / 15);
	return `Etc/GMT${offset === 0 ? '' : offset > 0 ? `-${offset}` : `+${-offset}`}`;
}

export interface FactsInput {
	lat: number;
	lon: number;
	locationLabel?: string | null;
	photoCount?: number;
	home?: { lat: number; lon: number; name?: string } | null;
	now?: Date;
}

/** Pure part: everything the bundled dataset can say. */
export function buildFacts(input: FactsInput): Omit<PlaceTrivia, 'summary' | 'summarySource' | 'weather'> & { place: Place | null; country: CountryFacts | null } {
	const now = input.now ?? new Date();
	const place = nearestPlace(allPlaces(), input.lat, input.lon, 40);
	const indexes = geoIndexes();
	const countryShape = lookup(indexes.countries, input.lat, input.lon);
	const region = lookup(indexes.regions, input.lat, input.lon);
	const island = lookup(indexes.islands, input.lat, input.lon);
	const labelParts = (input.locationLabel ?? '').split(',').map((part) => part.trim()).filter(Boolean);
	const title = labelParts[0] || place?.name || formatCoordinates(input.lat, input.lon);
	const countryName = countryShape?.name || place?.country || labelParts[labelParts.length - 1] || null;
	const country = countryName ? allCountries().get(countryName) ?? null : null;
	const regionName = region?.name && region.name !== title ? region.name : place?.region && place.region !== title ? place.region : null;
	const subtitle = [regionName, countryName].filter(Boolean).join(', ') || null;

	const ladder: PlaceTrivia['ladder'] = [];
	if (labelParts[0]) ladder.push({ level: 'place', name: labelParts[0] });
	else if (place) ladder.push({ level: 'place', name: place.name });
	if (regionName) ladder.push({ level: 'region', name: region?.type ? `${regionName} (${region.type.toLowerCase()})` : regionName });
	if (island) ladder.push({ level: 'island', name: island.name });
	if (countryName) ladder.push({ level: 'country', name: countryName });
	const continent = countryShape?.continent || country?.continent || place?.continent || null;
	if (continent) ladder.push({ level: 'continent', name: continent });

	const facts: string[] = [];
	const timezone = timezoneFor(input.lat, input.lon);
	const localTime = timezone ? formatTime(now, timezone) : null;
	if (localTime) facts.push(`${localTime} local time`);
	const sunToday = sunTimes(input.lat, input.lon, now);
	const sun = sunToday && timezone
		? { sunrise: formatTime(sunToday.sunrise, timezone) ?? '', sunset: formatTime(sunToday.sunset, timezone) ?? '' }
		: null;
	if (sun?.sunrise && sun.sunset) facts.push(`Sun ${sun.sunrise} – ${sun.sunset}`);
	if (place) {
		const samePlace = place.name.toLowerCase() === title.toLowerCase();
		if (place.capital === 2 && samePlace) facts.push(`Capital of ${place.country}`);
		else if (place.capital === 1 && samePlace && place.region) facts.push(`Capital of ${place.region}`);
		const population = formatPopulation(place.population);
		if (population && samePlace) facts.push(population);
		else if (!samePlace) {
			const km = Math.round(distanceKm(input.lat, input.lon, place.lat, place.lon));
			facts.push(km >= 2 ? `${km} km from ${place.name}${population ? ` (${population})` : ''}` : `Near ${place.name}`);
		}
	}
	if (country && country.population) facts.push(`${country.name}: ${formatPopulation(country.population)}${country.subregion ? ` · ${country.subregion}` : ''}`);
	if (input.home && (input.home.lat !== 0 || input.home.lon !== 0)) {
		const km = Math.round(distanceKm(input.lat, input.lon, input.home.lat, input.home.lon));
		facts.push(km >= 5 ? `${km.toLocaleString('en-US')} km from ${input.home.name?.split(',')[0] || 'home'}` : 'Home');
	}
	if (input.photoCount && input.photoCount > 1) facts.push(`${input.photoCount} photos here`);
	facts.push(formatCoordinates(input.lat, input.lon));
	return { title, subtitle, ladder, facts, localTime, timezone, sun, place, country };
}

// ---- online extras -------------------------------------------------------------

async function readCache<T>(bucket: string, key: string, ttlMs: number): Promise<T | null> {
	try {
		const raw = await fs.readFile(path.join(wikiCacheDir(), bucket, `${key}.json`), 'utf8');
		const parsed = JSON.parse(raw) as { at: number; value: T };
		if (Date.now() - parsed.at > ttlMs) return null;
		return parsed.value;
	} catch {
		return null;
	}
}

async function writeCache<T>(bucket: string, key: string, value: T): Promise<void> {
	try {
		await fs.mkdir(path.join(wikiCacheDir(), bucket), { recursive: true });
		await fs.writeFile(path.join(wikiCacheDir(), bucket, `${key}.json`), JSON.stringify({ at: Date.now(), value }));
	} catch {
		// A read-only data directory only costs a refetch later.
	}
}

async function fetchJson<T>(url: string, timeoutMs = WIKI_TIMEOUT_MS): Promise<T | null> {
	try {
		const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

function trimExtract(extract: string): string {
	const sentences = extract.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+(\s|$)/g) ?? [extract];
	let out = '';
	for (const sentence of sentences) {
		if (out && out.length + sentence.length > 260) break;
		out += sentence;
		if (out.length > 160) break;
	}
	return out.trim();
}

async function fetchWikipedia(lat: number, lon: number, name: string | null): Promise<{ extract: string | null; title: string | null }> {
	type Summary = { title?: string; extract?: string; type?: string; coordinates?: { lat: number; lon: number } };
	if (name) {
		const summary = await fetchJson<Summary>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, '_'))}`);
		if (summary?.extract && summary.type !== 'disambiguation') {
			const near = !summary.coordinates || distanceKm(lat, lon, summary.coordinates.lat, summary.coordinates.lon) < 60;
			if (near) return { extract: trimExtract(summary.extract), title: summary.title ?? name };
		}
	}
	const search = await fetchJson<{ query?: { geosearch?: Array<{ title: string }> } }>(
		`https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=10000&gslimit=1&format=json`
	);
	const title = search?.query?.geosearch?.[0]?.title;
	if (!title) return { extract: null, title: null };
	const summary = await fetchJson<Summary>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
	return { extract: summary?.extract ? trimExtract(summary.extract) : null, title: summary?.title ?? title };
}

function wikipedia(lat: number, lon: number, name: string | null): Promise<{ extract: string | null; title: string | null }> {
	const key = createHash('sha1').update(`${lat.toFixed(2)}:${lon.toFixed(2)}:${name ?? ''}`).digest('hex');
	let pending = wikiMemory.get(key);
	if (!pending) {
		pending = (async () => {
			const cached = await readCache<{ extract: string | null; title: string | null }>('wikipedia', key, WIKI_CACHE_TTL_MS);
			if (cached) return cached;
			const fetched = await fetchWikipedia(lat, lon, name);
			await writeCache('wikipedia', key, fetched);
			return fetched;
		})();
		wikiMemory.set(key, pending);
		if (wikiMemory.size > 500) wikiMemory.delete(wikiMemory.keys().next().value!);
	}
	return pending;
}

interface ReverseResult {
	street: string | null;
	neighbourhood: string | null;
	place: string | null;
	placeType: string | null;
	municipality: string | null;
	region: string | null;
	island: string | null;
	country: string | null;
}

// Nominatim's usage policy: at most one request per second, identify yourself, cache.
let nominatimChain: Promise<void> = Promise.resolve();
function throttled<T>(work: () => Promise<T>): Promise<T> {
	const result = nominatimChain.then(work);
	nominatimChain = result.then(() => new Promise((resolve) => setTimeout(resolve, 1100)), () => new Promise((resolve) => setTimeout(resolve, 1100)));
	return result;
}

async function fetchReverse(lat: number, lon: number): Promise<ReverseResult | null> {
	type Nominatim = { address?: Record<string, string> };
	const data = await throttled(() => fetchJson<Nominatim>(
		`https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&format=jsonv2&zoom=18&addressdetails=1&accept-language=en`
	));
	const a = data?.address;
	if (!a) return null;
	const pick = (...keys: string[]) => keys.map((key) => a[key]).find(Boolean) ?? null;
	const placeType = ['city', 'town', 'village', 'hamlet', 'municipality'].find((key) => a[key]) ?? null;
	return {
		street: pick('road', 'pedestrian', 'footway', 'path'),
		neighbourhood: pick('neighbourhood', 'suburb', 'quarter', 'city_district', 'borough'),
		place: pick('city', 'town', 'village', 'hamlet', 'municipality'),
		placeType,
		municipality: pick('municipality', 'county', 'state_district'),
		region: pick('state', 'region', 'province', 'county'),
		island: pick('island', 'archipelago'),
		country: pick('country')
	};
}

function reverse(lat: number, lon: number): Promise<ReverseResult | null> {
	const key = `${lat.toFixed(3)}:${lon.toFixed(3)}`;
	let pending = reverseMemory.get(key);
	if (!pending) {
		pending = (async () => {
			const cached = await readCache<ReverseResult | null>('reverse', key.replace(':', '_'), Number.POSITIVE_INFINITY);
			if (cached) return cached;
			const fetched = await fetchReverse(lat, lon);
			if (fetched) await writeCache('reverse', key.replace(':', '_'), fetched);
			return fetched;
		})();
		reverseMemory.set(key, pending);
		if (reverseMemory.size > 2000) reverseMemory.delete(reverseMemory.keys().next().value!);
	}
	return pending;
}

const WEATHER_TEXT: Array<[number, string]> = [
	[0, 'Clear'], [1, 'Mostly clear'], [2, 'Partly cloudy'], [3, 'Overcast'], [45, 'Fog'], [48, 'Rime fog'],
	[51, 'Light drizzle'], [53, 'Drizzle'], [55, 'Heavy drizzle'], [61, 'Light rain'], [63, 'Rain'], [65, 'Heavy rain'],
	[66, 'Freezing rain'], [67, 'Freezing rain'], [71, 'Light snow'], [73, 'Snow'], [75, 'Heavy snow'], [77, 'Snow grains'],
	[80, 'Showers'], [81, 'Showers'], [82, 'Heavy showers'], [85, 'Snow showers'], [86, 'Snow showers'],
	[95, 'Thunderstorm'], [96, 'Thunderstorm with hail'], [99, 'Thunderstorm with hail']
];

async function weatherNow(lat: number, lon: number): Promise<PlaceTrivia['weather']> {
	const key = `${lat.toFixed(2)}:${lon.toFixed(2)}`;
	const cached = weatherMemory.get(key);
	if (cached && Date.now() - cached.at < WEATHER_TTL_MS) return cached.value;
	const data = await fetchJson<{ current?: { temperature_2m?: number; weather_code?: number; is_day?: number } }>(
		`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,weather_code,is_day`,
		6000
	);
	const current = data?.current;
	let value: PlaceTrivia['weather'] = null;
	if (current && typeof current.temperature_2m === 'number') {
		const code = current.weather_code ?? 0;
		const text = WEATHER_TEXT.filter(([c]) => c <= code).at(-1)?.[1] ?? 'Clear';
		value = { temperatureC: Math.round(current.temperature_2m), code, text, isDay: current.is_day !== 0 };
	}
	weatherMemory.set(key, { at: Date.now(), value });
	return value;
}

export async function getPlaceTrivia(input: FactsInput & { online: boolean }): Promise<PlaceTrivia> {
	const base = buildFacts(input);
	const { place, country, ...offline } = base;
	void country;
	if (!input.online) return { ...offline, weather: null, summary: null, summarySource: null };

	const [reverseResult, wiki, weather] = await Promise.all([
		reverse(input.lat, input.lon),
		wikipedia(input.lat, input.lon, place?.name ?? base.title),
		weatherNow(input.lat, input.lon)
	]);
	let ladder = offline.ladder;
	let title = offline.title;
	if (reverseResult) {
		const local: PlaceTrivia['ladder'] = [];
		if (reverseResult.street) local.push({ level: 'street', name: reverseResult.street });
		if (reverseResult.neighbourhood) local.push({ level: 'neighbourhood', name: reverseResult.neighbourhood });
		if (reverseResult.place) {
			local.push({ level: 'place', name: reverseResult.placeType && reverseResult.placeType !== 'city' ? `${reverseResult.place} (${reverseResult.placeType})` : reverseResult.place });
			if (!input.locationLabel) title = reverseResult.place;
		}
		if (reverseResult.municipality && reverseResult.municipality !== reverseResult.place) local.push({ level: 'municipality', name: reverseResult.municipality });
		const rest = offline.ladder.filter((step) => step.level !== 'place' && !(step.level === 'region' && reverseResult.region) && !(step.level === 'island' && reverseResult.island));
		if (reverseResult.region) local.push({ level: 'region', name: reverseResult.region });
		if (reverseResult.island) local.push({ level: 'island', name: reverseResult.island });
		ladder = [...local, ...rest];
	}
	const facts = weather ? [`${weather.temperatureC}°C, ${weather.text.toLowerCase()} now`, ...offline.facts] : offline.facts;
	return {
		...offline,
		title,
		ladder,
		facts,
		weather,
		summary: wiki.extract,
		summarySource: wiki.title ? `Wikipedia · ${wiki.title}` : null
	};
}

// ---- background warm-up -------------------------------------------------------------
const warmed = new Set<string>();

/**
 * Pre-fetch the slow online parts for a bounded upcoming-stop list. Facts are
 * computed on demand (they are cheap and time-dependent); only Wikipedia and
 * reverse geocoding are warmed.
 */
export function warmPlaceTrivia(places: ReadonlyArray<{ lat: number; lon: number; name: string }>, online: boolean): void {
	if (!online) return;
	const pending = places.filter((place) => !warmed.has(`${place.lat.toFixed(3)}:${place.lon.toFixed(3)}`));
	for (const place of pending) warmed.add(`${place.lat.toFixed(3)}:${place.lon.toFixed(3)}`);
	if (!pending.length) return;
	void (async () => {
		for (const place of pending) {
			try {
				await reverse(place.lat, place.lon);
				const nearest = nearestPlace(allPlaces(), place.lat, place.lon, 40);
				await wikipedia(place.lat, place.lon, nearest?.name ?? place.name.split(',')[0] ?? null);
			} catch {
				// Best effort; the card fetches on demand anyway.
			}
		}
	})();
}
