// Geometry for the map layout: compact-data decoding, projections, great
// circles and spherical helpers. Pure functions, no DOM, unit-tested.

export const EARTH_RADIUS_KM = 6371;
export const DEG = Math.PI / 180;
export const MAX_MERCATOR_LAT = 85 * DEG;

export interface Country {
	name: string;
	iso: string;
	continent: string;
	/** Flat [lon, lat, lon, lat, ...] in degrees, one entry per ring. */
	rings: Float64Array[];
}

export interface WorldData {
	countries: Country[];
	lakes: Float64Array[];
}

export interface Place {
	name: string;
	country: string;
	region: string;
	lat: number;
	lon: number;
	population: number;
	/** 2 = national capital, 1 = regional capital, 0 = other. */
	capital: number;
	rank: number;
	continent: string;
	/** IANA zone, when Natural Earth knows it. */
	timezone: string;
	wikidata: string;
}

interface CompactWorld {
	q: number;
	countries: Array<{ n: string; c: string; k: string; r: number[][] }>;
	lakes: number[][];
}

interface CompactPlaces {
	rows: Array<[string, string, string, number, number, number, number, number, string, string?, string?]>;
}

function decodeRing(ring: number[], q: number): Float64Array {
	const out = new Float64Array(ring.length);
	let x = 0;
	let y = 0;
	for (let i = 0; i < ring.length; i += 2) {
		x += ring[i];
		y += ring[i + 1];
		out[i] = x / q;
		out[i + 1] = y / q;
	}
	return out;
}

export function decodeWorld(json: unknown): WorldData {
	const data = json as CompactWorld;
	return {
		countries: data.countries.map((country) => ({
			name: country.n,
			iso: country.c,
			continent: country.k,
			rings: country.r.map((ring) => decodeRing(ring, data.q))
		})),
		lakes: data.lakes.map((ring) => decodeRing(ring, data.q))
	};
}

export function decodePlaces(json: unknown): Place[] {
	return (json as CompactPlaces).rows.map(([name, country, region, lat, lon, population, capital, rank, continent, timezone, wikidata]) => ({
		name, country, region, lat, lon, population, capital, rank, continent, timezone: timezone ?? '', wikidata: wikidata ?? ''
	}));
}

/** Great-circle distance in kilometres. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const dLat = (lat2 - lat1) * DEG;
	const dLon = (lon2 - lon1) * DEG;
	const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Angular distance in radians between two points given in degrees. */
export function angularDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
	return distanceKm(lat1, lon1, lat2, lon2) / EARTH_RADIUS_KM;
}

/** Point on the great circle from a to b at fraction t (degrees in, degrees out). */
export function slerp(lat1: number, lon1: number, lat2: number, lon2: number, t: number): [number, number] {
	const φ1 = lat1 * DEG, λ1 = lon1 * DEG, φ2 = lat2 * DEG, λ2 = lon2 * DEG;
	const d = angularDistance(lat1, lon1, lat2, lon2);
	if (d < 1e-9) return [lat1, lon1];
	const a = Math.sin((1 - t) * d) / Math.sin(d);
	const b = Math.sin(t * d) / Math.sin(d);
	const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
	const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
	const z = a * Math.sin(φ1) + b * Math.sin(φ2);
	return [Math.atan2(z, Math.hypot(x, y)) / DEG, Math.atan2(y, x) / DEG];
}

export function antipode(lat: number, lon: number): [number, number] {
	return [-lat, lon > 0 ? lon - 180 : lon + 180];
}

/** Ray-casting point-in-ring test in lon/lat space. */
export function ringContains(ring: Float64Array, lon: number, lat: number): boolean {
	let inside = false;
	const n = ring.length / 2;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const xi = ring[i * 2], yi = ring[i * 2 + 1];
		const xj = ring[j * 2], yj = ring[j * 2 + 1];
		if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

/** Mercator y in "world radians" for a latitude in degrees, clamped to the usable band. */
export function mercatorY(lat: number): number {
	const φ = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat * DEG));
	return Math.log(Math.tan(Math.PI / 4 + φ / 2));
}

/**
 * A projection turns degrees into pixels for one view. `null` marks a point
 * that must not be drawn (outside the usable band, or too close to the antipode).
 */
export type Projection = ((lon: number, lat: number) => [number, number] | null) & {
	/** Cylindrical projections: the pixel width of one full turn, so rings can be unwrapped across the seam. */
	wrapWidth?: number;
};

export interface View {
	/** Centre of the view in degrees. */
	lat: number;
	lon: number;
	/** Pixels per projection unit (unit-sphere radius for azimuthal, radian for Mercator). */
	scale: number;
	/** Pixel position of the centre on the canvas. */
	cx: number;
	cy: number;
}

export function mercatorProjection(view: View): Projection {
	const y0 = mercatorY(view.lat);
	const λ0 = view.lon * DEG;
	const project: Projection = (lon, lat) => {
		let dλ = lon * DEG - λ0;
		if (dλ > Math.PI) dλ -= 2 * Math.PI;
		else if (dλ < -Math.PI) dλ += 2 * Math.PI;
		return [view.cx + dλ * view.scale, view.cy - (mercatorY(lat) - y0) * view.scale];
	};
	project.wrapWidth = 2 * Math.PI * view.scale;
	return project;
}

/**
 * Stereographic projection centred on the view. Unlike orthographic it maps the
 * whole sphere without mirroring the far side into the disc, so rings only need
 * an antipode check, not hemisphere clipping.
 */
export function stereographicProjection(view: View): Projection {
	const φ0 = view.lat * DEG;
	const λ0 = view.lon * DEG;
	const sinφ0 = Math.sin(φ0);
	const cosφ0 = Math.cos(φ0);
	return (lon, lat) => {
		const φ = lat * DEG;
		const dλ = lon * DEG - λ0;
		const cosφ = Math.cos(φ);
		const sinφ = Math.sin(φ);
		const cosc = sinφ0 * sinφ + cosφ0 * cosφ * Math.cos(dλ);
		const denominator = 1 + cosc;
		if (denominator < 0.05) return null; // near the antipode: off any sane view
		const k = 2 / denominator;
		return [view.cx + k * cosφ * Math.sin(dλ) * view.scale, view.cy - k * (cosφ0 * sinφ - sinφ0 * cosφ * Math.cos(dλ)) * view.scale];
	};
}

/** Plate carrée onto a rectangle: used for the GPU texture atlases. */
export function equirectangularProjection(bounds: { lon0: number; lat0: number; lon1: number; lat1: number }, width: number, height: number): Projection {
	const sx = width / (bounds.lon1 - bounds.lon0);
	const sy = height / (bounds.lat1 - bounds.lat0);
	return (lon, lat) => [(lon - bounds.lon0) * sx, (bounds.lat1 - lat) * sy];
}

/** Scale (pixels per projection unit) that fits `widthKm` of ground across `widthPx`. */
export function scaleForWidth(kind: 'mercator' | 'stereographic', widthKm: number, widthPx: number, lat: number): number {
	const radians = widthKm / EARTH_RADIUS_KM;
	if (kind === 'mercator') return (widthPx * Math.cos(lat * DEG)) / radians;
	return widthPx / radians;
}

/** Latitude in degrees for a Mercator y value. */
export function mercatorLat(y: number): number {
	return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / DEG;
}

/**
 * Flat world framing: the inhabited world from 57°S to 84°N. Leaving out the
 * Mercator-inflated Antarctic fills a 16:9 screen far better.
 */
export const FLAT_WORLD_LAT = { south: -57, north: 84 };

/** Scale that shows the framed flat world within the given box, and the centre latitude to use. */
export function worldMercatorScale(widthPx: number, heightPx: number): number {
	const height = mercatorY(FLAT_WORLD_LAT.north) - mercatorY(FLAT_WORLD_LAT.south);
	return Math.min(widthPx / (2 * Math.PI), heightPx / height);
}

export function worldMercatorCenterLat(): number {
	return mercatorLat((mercatorY(FLAT_WORLD_LAT.north) + mercatorY(FLAT_WORLD_LAT.south)) / 2);
}

export interface PhotoPlace {
	key: string;
	name: string;
	lat: number;
	lon: number;
	count: number;
}

/** Group located slides into places roughly 5 km across; the commonest label names the place. */
export function clusterPlaces<T extends { lat?: number | null; lon?: number | null; location?: string | null }>(
	slides: readonly T[]
): Array<PhotoPlace & { slides: T[] }> {
	const clusters = new Map<string, { lat: number; lon: number; names: Map<string, number>; slides: T[] }>();
	for (const slide of slides) {
		if (typeof slide.lat !== 'number' || typeof slide.lon !== 'number' || !Number.isFinite(slide.lat) || !Number.isFinite(slide.lon)) continue;
		if (slide.lat === 0 && slide.lon === 0) continue;
		const key = `${Math.round(slide.lat / 0.05)}:${Math.round(slide.lon / 0.05)}`;
		let cluster = clusters.get(key);
		if (!cluster) {
			cluster = { lat: 0, lon: 0, names: new Map(), slides: [] };
			clusters.set(key, cluster);
		}
		cluster.slides.push(slide);
		cluster.lat += slide.lat;
		cluster.lon += slide.lon;
		if (slide.location) cluster.names.set(slide.location, (cluster.names.get(slide.location) ?? 0) + 1);
	}
	return [...clusters.entries()].map(([key, cluster]) => {
		let name = '';
		let best = 0;
		for (const [candidate, count] of cluster.names) if (count > best) { best = count; name = candidate; }
		return {
			key,
			name,
			lat: cluster.lat / cluster.slides.length,
			lon: cluster.lon / cluster.slides.length,
			count: cluster.slides.length,
			slides: cluster.slides
		};
	});
}

/** Nearest known place within `maxKm`, or null. */
export function nearestPlace(places: readonly Place[], lat: number, lon: number, maxKm = 40): Place | null {
	let best: Place | null = null;
	let bestKm = maxKm;
	for (const place of places) {
		if (Math.abs(place.lat - lat) > maxKm / 100 || Math.abs(place.lon - lon) > maxKm / 50) continue;
		const km = distanceKm(lat, lon, place.lat, place.lon);
		if (km < bestKm) {
			bestKm = km;
			best = place;
		}
	}
	return best;
}

// ---- detail layers -------------------------------------------------------------

export type NameKind = 'river' | 'island' | 'terrain' | 'area' | 'lake';

export interface DetailData {
	regions: Array<{ name: string; admin: string; type: string; center: [number, number] | null; rings: Float64Array[] }>;
	rivers: Array<{ rank: number; line: Float64Array }>;
	urban: Float64Array[];
	roads: Array<{ weight: number; line: Float64Array }>;
	islands: Array<{ name: string; rings: Float64Array[] }>;
	names: Array<{ kind: NameKind; name: string; lat: number; lon: number; rank: number }>;
}

interface CompactDetail {
	q: number;
	regions: Array<{ n: string; a: string; t: string; c: [number, number] | null; r: number[][] }>;
	rivers: Array<[number, number[]]>;
	urban: number[][];
	roads: Array<[number, number[]]>;
	islands: Array<{ n: string; r: number[][] }>;
	names: Array<[NameKind, string, number, number, number]>;
}

export function decodeDetail(json: unknown): DetailData {
	const data = json as CompactDetail;
	const ring = (encoded: number[]) => {
		const out = new Float64Array(encoded.length);
		let x = 0;
		let y = 0;
		for (let i = 0; i < encoded.length; i += 2) {
			x += encoded[i];
			y += encoded[i + 1];
			out[i] = x / data.q;
			out[i + 1] = y / data.q;
		}
		return out;
	};
	return {
		regions: data.regions.map((region) => ({ name: region.n, admin: region.a, type: region.t, center: region.c, rings: region.r.map(ring) })),
		rivers: data.rivers.map(([rank, line]) => ({ rank, line: ring(line) })),
		urban: data.urban.map(ring),
		roads: data.roads.map(([weight, line]) => ({ weight, line: ring(line) })),
		islands: (data.islands ?? []).map((island) => ({ name: island.n, rings: island.r.map(ring) })),
		names: data.names.map(([kind, name, lat, lon, rank]) => ({ kind, name, lat, lon, rank }))
	};
}

/** Name of the first shape (regions, islands, …) whose rings contain the point. */
export function containingShape<T extends { rings: Float64Array[] }>(shapes: readonly T[], lat: number, lon: number): T | null {
	for (const shape of shapes) {
		let inside = false;
		for (const ring of shape.rings) if (ringContains(ring, lon, lat)) inside = !inside;
		if (inside) return shape;
	}
	return null;
}

// ---- raster tiles -------------------------------------------------------------------

export const TILE_PX = 256;

export interface TileRef {
	level: number;
	x: number;
	y: number;
	/** Degrees covered by this tile. */
	lon0: number;
	lat0: number;
	lon1: number;
	lat1: number;
}

/** Plate-carrée pyramid: level L has 2^(L+1) × 2^L tiles of TILE_PX. */
export function tileDegrees(level: number): number {
	return 360 / 2 ** (level + 1);
}

/** Highest level whose tiles give at least `pixelsPerDegree` without exceeding `maxLevel`. */
export function levelForDetail(pixelsPerDegree: number, maxLevel: number, tilePx = TILE_PX): number {
	let level = 0;
	while (level < maxLevel && tilePx / tileDegrees(level) < pixelsPerDegree) level++;
	return level;
}

/** Sentinel-2 blocks are big: 1024 px covering the same latitude/longitude grid as the globe textures. */
// Big blocks: one 4096 px block covers what 256 of the globe-texture tiles do,
// so a region is thousands of files instead of hundreds of thousands. Decoded
// it costs 67 MB, so the player caps how many it keeps in memory.
export const SENTINEL_TILE_PX = 4096;
export const SENTINEL_MAX_LEVEL = 9;
/** Blue Marble / relief blocks: same grid, sliced from the full-resolution sources. */
export const TEXTURE_TILE_PX = 2048;
export const TEXTURE_MAX_LEVEL = 4;

/** Tiles of one level covering a lon/lat window (longitudes wrap). */
export function tilesFor(level: number, bounds: { lon0: number; lat0: number; lon1: number; lat1: number }): TileRef[] {
	const size = tileDegrees(level);
	const columns = 2 ** (level + 1);
	const rows = 2 ** level;
	const out: TileRef[] = [];
	const y0 = Math.max(0, Math.floor((90 - bounds.lat1) / size));
	const y1 = Math.min(rows - 1, Math.floor((90 - bounds.lat0) / size));
	const x0 = Math.floor((bounds.lon0 + 180) / size);
	const x1 = Math.floor((bounds.lon1 + 180) / size);
	for (let xi = x0; xi <= x1; xi++) {
		const x = ((xi % columns) + columns) % columns;
		for (let y = y0; y <= y1; y++) {
			out.push({ level, x, y, lon0: xi * size - 180, lat0: 90 - (y + 1) * size, lon1: (xi + 1) * size - 180, lat1: 90 - y * size });
		}
	}
	return out;
}

// ---- sun -----------------------------------------------------------------------------

/** Sunrise and sunset (UTC Date objects) for a calendar day, NOAA algorithm; null in polar day/night. */
export function sunTimes(lat: number, lon: number, date: Date): { sunrise: Date; sunset: Date } | null {
	const dayOfYear = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000);
	const γ = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (12 - 12) / 24);
	const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(γ) - 0.032077 * Math.sin(γ) - 0.014615 * Math.cos(2 * γ) - 0.040849 * Math.sin(2 * γ));
	const decl = 0.006918 - 0.399912 * Math.cos(γ) + 0.070257 * Math.sin(γ) - 0.006758 * Math.cos(2 * γ) + 0.000907 * Math.sin(2 * γ) - 0.002697 * Math.cos(3 * γ) + 0.00148 * Math.sin(3 * γ);
	const φ = lat * DEG;
	const cosHa = (Math.cos(90.833 * DEG) / (Math.cos(φ) * Math.cos(decl))) - Math.tan(φ) * Math.tan(decl);
	if (cosHa < -1 || cosHa > 1) return null;
	const ha = Math.acos(cosHa) / DEG;
	const base = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
	const sunrise = 720 - 4 * (lon + ha) - eqTime;
	const sunset = 720 - 4 * (lon - ha) - eqTime;
	return { sunrise: new Date(base + sunrise * 60_000), sunset: new Date(base + sunset * 60_000) };
}

/** One raster window the player will draw for a stop, with the Sentinel zoom to use. */
export interface RasterWindow {
	role: 'atlas0' | 'atlas1' | 'crisp';
	/** Pyramid level in the shared latitude/longitude grid. */
	z: number;
	bounds: { lon0: number; lat0: number; lon1: number; lat1: number };
	/** Pixels the window is drawn at (chooses the level). */
	pixelsWide: number;
}

/**
 * The windows a stop needs: a wide atlas for the end of the flight, a tight
 * one for the last second, and the crisp view itself. Zooms are chosen for the
 * drawing size and then lowered until each window needs at most `maxTiles`.
 */
export function sentinelPlan(lat: number, lon: number, zoomKm: number, screenWidthPx: number, aspect = 0.5625, maxTiles = 90): RasterWindow[] {
	const cosLat = Math.max(0.15, Math.cos(lat * DEG));
	const spec: Array<[RasterWindow['role'], number, number]> = [
		['atlas0', 3.2, 2048],
		['atlas1', 1.3, 4096],
		['crisp', 1.5, screenWidthPx * 1.5]
	];
	return spec.map(([role, factor, pixelsWide]) => {
		const halfLon = (zoomKm * factor * 0.5) / 111 / cosLat;
		const halfLat = (zoomKm * factor * 0.5 * aspect) / 111;
		const bounds = { lon0: lon - halfLon, lat0: Math.max(-85, lat - halfLat), lon1: lon + halfLon, lat1: Math.min(85, lat + halfLat) };
		let z = levelForDetail((pixelsWide * 0.75) / (2 * halfLon), SENTINEL_MAX_LEVEL, SENTINEL_TILE_PX);
		while (z > 0 && tilesFor(z, bounds).length > maxTiles) z--;
		return { role, z, bounds, pixelsWide };
	});
}


/** A settlement from the bundled GeoNames extract. */
export interface LocalPlace {
	name: string;
	lat: number;
	lon: number;
	population: number;
	/** 4 national capital, 3 regional capital, 2/1 lesser seats, 0 plain place. */
	rank: number;
	country: string;
}

export function decodeLocalPlaces(json: unknown): LocalPlace[] {
	const rows = (json as { rows: Array<[string, number, number, number, number, string]> }).rows;
	return rows.map(([name, lat, lon, population, rank, country]) => ({ name, lat, lon, population, rank, country }));
}

/**
 * Settlements to label for a view: inside the window, big enough for this
 * height, biggest first. The source list is sorted by population, so the scan
 * stops as soon as enough have been collected.
 */
export function localPlacesForView(
	places: readonly LocalPlace[],
	view: { lat: number; lon: number },
	widthKm: number,
	options: { limit?: number; minPopulation?: number } = {}
): LocalPlace[] {
	const limit = options.limit ?? 8;
	if (limit <= 0) return [];
	const cosLat = Math.max(0.2, Math.cos(view.lat * DEG));
	// The floor is the setting; height raises it further, because a country on
	// screen should show its cities, not the market towns between them.
	const byWidth = widthKm > 1500 ? 500_000 : widthKm > 700 ? 200_000 : widthKm > 350 ? 100_000 : widthKm > 150 ? 40_000 : widthKm > 70 ? 8_000 : 0;
	const minPopulation = Math.max(options.minPopulation ?? 10_000, byWidth);
	// Only name places near the photo: the edges of the view are context, not subject.
	const maxKm = widthKm * 0.45;
	// Keep names apart on screen: nothing closer than a tenth of the view.
	const minSeparation = widthKm / 10 / 111;
	const out: LocalPlace[] = [];
	const seen = new Set<string>();
	for (const place of places) {
		if (place.population < minPopulation) continue;
		// Cheap box test before the great-circle distance.
		if (Math.abs(place.lat - view.lat) > maxKm / 111 || Math.abs(place.lon - view.lon) * cosLat > maxKm / 111) continue;
		if (distanceKm(view.lat, view.lon, place.lat, place.lon) > maxKm) continue;
		// The source lists every settlement, so the same name appears many times.
		if (seen.has(place.name)) continue;
		if (out.some((other) => Math.abs(other.lat - place.lat) < minSeparation && Math.abs(other.lon - place.lon) * cosLat < minSeparation)) continue;
		seen.add(place.name);
		out.push(place);
		if (out.length >= limit) break;
	}
	return out;
}
