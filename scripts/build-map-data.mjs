#!/usr/bin/env node
// Compiles Natural Earth (public domain) into the compact vector files the map
// layout renders itself:
//   static/map/world.json   countries + lakes (loaded first, drives the world view)
//   static/map/detail.json  regions, rivers, urban areas, major roads, place-name
//                           polygons and lake names (loaded lazily for zoomed views)
//   static/map/places.json  populated places for labels and trivia (with time zones)
//   static/map/countries.json  country facts for the trivia card
//   static/map/places-local.json  GeoNames settlements (CC BY 4.0): every European
//                           place from 500 people up, the rest of the world from
//                           5,000, so close-up views can name towns and villages
//                           without asking any service
//
//   node scripts/build-map-data.mjs            # uses .cache/natural-earth, downloads when missing
//   TOLERANCE=0.006 node scripts/build-map-data.mjs
//
// Coordinates are quantised to 1/1000 degree and delta-encoded: each ring or
// line is [x0, y0, dx1, dy1, ...]. Shapes are simplified with Douglas–Peucker.

import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const run = promisify(execFile);

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const CACHE = path.join(ROOT, '.cache', 'natural-earth');
const OUT = path.join(ROOT, 'static', 'map');
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const TOLERANCE = Number(process.env.TOLERANCE) || 0.008; // degrees ≈ 900 m
const MIN_RING_SPAN = 0.03; // drop islets smaller than ~3 km across
const Q = 1000;

async function load(name) {
	const file = path.join(CACHE, `${name}.geojson`);
	try {
		return JSON.parse(await fs.readFile(file, 'utf8'));
	} catch {
		console.log(`downloading ${name}…`);
		const res = await fetch(`${BASE}${name}.geojson`);
		if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
		const text = await res.text();
		await fs.mkdir(CACHE, { recursive: true });
		await fs.writeFile(file, text);
		return JSON.parse(text);
	}
}

function simplify(points, tolerance) {
	if (points.length <= 3) return points;
	const keep = new Uint8Array(points.length);
	keep[0] = keep[points.length - 1] = 1;
	const stack = [[0, points.length - 1]];
	const sq = tolerance * tolerance;
	while (stack.length) {
		const [a, b] = stack.pop();
		let best = -1;
		let bestDistance = sq;
		const [ax, ay] = points[a];
		const [bx, by] = points[b];
		const dx = bx - ax;
		const dy = by - ay;
		const length = dx * dx + dy * dy;
		for (let i = a + 1; i < b; i++) {
			const [px, py] = points[i];
			let distance;
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

function span(points) {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const [x, y] of points) {
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	return Math.max(maxX - minX, maxY - minY);
}

function encode(points) {
	const out = [];
	let px = 0, py = 0;
	for (const [x, y] of points) {
		const qx = Math.round(x * Q);
		const qy = Math.round(y * Q);
		if (out.length && qx === px && qy === py) continue;
		out.push(qx - px, qy - py);
		px = qx;
		py = qy;
	}
	return out;
}

function ringsOf(geometry) {
	if (!geometry) return [];
	if (geometry.type === 'Polygon') return geometry.coordinates;
	if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
	return [];
}

function linesOf(geometry) {
	if (!geometry) return [];
	if (geometry.type === 'LineString') return [geometry.coordinates];
	if (geometry.type === 'MultiLineString') return geometry.coordinates;
	return [];
}

function compileRings(geometry, tolerance, minSpan = MIN_RING_SPAN) {
	const rings = [];
	for (const ring of ringsOf(geometry)) {
		if (span(ring) < minSpan) continue;
		const simplified = simplify(ring, tolerance);
		if (simplified.length < 4) continue;
		rings.push(encode(simplified));
	}
	return rings;
}

function compileLines(geometry, tolerance) {
	const lines = [];
	for (const line of linesOf(geometry)) {
		const simplified = simplify(line, tolerance);
		if (simplified.length < 2) continue;
		lines.push(encode(simplified));
	}
	return lines;
}

function centroid(geometry) {
	// Area-weighted centroid of the largest ring: good enough for a label anchor.
	let best = null;
	let bestArea = 0;
	for (const ring of ringsOf(geometry)) {
		let area = 0, cx = 0, cy = 0;
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
			area += f;
			cx += (ring[j][0] + ring[i][0]) * f;
			cy += (ring[j][1] + ring[i][1]) * f;
		}
		area /= 2;
		if (Math.abs(area) > bestArea && area !== 0) {
			bestArea = Math.abs(area);
			best = [cx / (6 * area), cy / (6 * area)];
		}
	}
	return best;
}

const round3 = (value) => Math.round(value * 1000) / 1000;
const count = (items) => items.reduce((sum, shape) => sum + shape.length / 2, 0);
let coordinates = 0;

// ---- world.json ------------------------------------------------------------
const countries = await load('ne_10m_admin_0_countries');
const lakes = await load('ne_10m_lakes');
const world = { v: 2, q: Q, attribution: 'Made with Natural Earth (public domain)', countries: [], lakes: [] };
for (const feature of countries.features) {
	const p = feature.properties;
	const rings = compileRings(feature.geometry, TOLERANCE);
	if (!rings.length) continue;
	coordinates += count(rings);
	const iso = p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2 !== '-99' ? p.ISO_A2 : '';
	world.countries.push({ n: p.NAME_EN || p.NAME, c: iso, k: p.CONTINENT, r: rings });
}
const lakeNames = [];
for (const feature of lakes.features) {
	if ((feature.properties.scalerank ?? 10) > 7) continue;
	const rings = compileRings(feature.geometry, TOLERANCE * 1.5);
	coordinates += count(rings);
	world.lakes.push(...rings);
	const name = feature.properties.name_en || feature.properties.name;
	const center = centroid(feature.geometry);
	if (name && center && (feature.properties.scalerank ?? 10) <= 6) lakeNames.push([name, round3(center[1]), round3(center[0]), feature.properties.scalerank ?? 6]);
}

// ---- detail.json -----------------------------------------------------------
const admin1 = await load('ne_10m_admin_1_states_provinces');
const rivers = await load('ne_10m_rivers_lake_centerlines');
const urban = await load('ne_10m_urban_areas');
const roads = await load('ne_10m_roads');
const regions = await load('ne_10m_geography_regions_polys');

const detail = { v: 1, q: Q, regions: [], rivers: [], urban: [], roads: [], names: [] };
let detailCoordinates = 0;
for (const feature of admin1.features) {
	const p = feature.properties;
	const rings = compileRings(feature.geometry, TOLERANCE * 1.6, 0.05);
	if (!rings.length) continue;
	detailCoordinates += count(rings);
	const center = centroid(feature.geometry);
	detail.regions.push({
		n: p.name_en || p.name || '',
		a: p.admin || '',
		t: p.type_en || '',
		c: center ? [round3(center[1]), round3(center[0])] : null,
		r: rings
	});
}
for (const feature of rivers.features) {
	const p = feature.properties;
	if ((p.scalerank ?? 10) > 8) continue;
	const lines = compileLines(feature.geometry, TOLERANCE * 1.2);
	detailCoordinates += count(lines);
	for (const line of lines) detail.rivers.push([p.scalerank ?? 8, line]);
	if (p.name && (p.scalerank ?? 10) <= 5 && lines.length) {
		const raw = linesOf(feature.geometry)[0];
		const mid = raw[Math.floor(raw.length / 2)];
		detail.names.push(['river', p.name, round3(mid[1]), round3(mid[0]), p.scalerank ?? 5]);
	}
}
for (const feature of urban.features) {
	const rings = compileRings(feature.geometry, TOLERANCE * 0.8, 0.02);
	detailCoordinates += count(rings);
	detail.urban.push(...rings);
}
const roadWeight = { 'Major Highway': 3, Beltway: 3, Bypass: 2, 'Secondary Highway': 2, Road: 1 };
for (const feature of roads.features) {
	const p = feature.properties;
	const weight = roadWeight[p.type];
	if (!weight || (p.scalerank ?? 10) > 8) continue;
	if (weight === 1 && (p.scalerank ?? 10) > 6) continue;
	const lines = compileLines(feature.geometry, TOLERANCE * 1.2);
	detailCoordinates += count(lines);
	for (const line of lines) detail.roads.push([weight, line]);
}
const islandClasses = new Set(['Island', 'Island group']);
detail.islands = [];
for (const feature of regions.features) {
	const p = feature.properties;
	const name = p.NAME_EN || p.NAME;
	if (!name) continue;
	const center = centroid(feature.geometry);
	if (!center) continue;
	const kind = islandClasses.has(p.FEATURECLA) ? 'island' : /Range|Plateau|Desert|Plain|Basin|Valley|Lowland|Depression|Tundra/i.test(p.FEATURECLA) ? 'terrain' : 'area';
	detail.names.push([kind, name, round3(center[1]), round3(center[0]), p.SCALERANK ?? 5]);
	if (kind === 'island') {
		// Coarse outline so a photo can be attributed to its island offline.
		const rings = compileRings(feature.geometry, TOLERANCE * 3, 0.02);
		if (rings.length) detail.islands.push({ n: name, r: rings });
	}
}
for (const [name, lat, lon, rank] of lakeNames) detail.names.push(['lake', name, lat, lon, rank]);

// ---- places.json / countries.json ------------------------------------------------
const places = await load('ne_10m_populated_places');
const continentByCountry = new Map(countries.features.map((f) => [f.properties.ADMIN, f.properties.CONTINENT]));
const placeRows = places.features
	.map((f) => ({ ...f.properties, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
	.filter((p) => p.NAME && Number.isFinite(p.lat) && Number.isFinite(p.lon))
	.map((p) => [
		p.NAME_EN || p.NAME,
		p.ADM0NAME || '',
		p.ADM1NAME || '',
		round3(p.lat),
		round3(p.lon),
		Math.max(0, Math.round(p.POP_MAX || 0)),
		p.FEATURECLA === 'Admin-0 capital' || p.FEATURECLA === 'Admin-0 capital alt' ? 2 : p.FEATURECLA === 'Admin-1 capital' ? 1 : 0,
		p.SCALERANK ?? 10,
		continentByCountry.get(p.ADM0NAME) || '',
		p.TIMEZONE || '',
		p.WIKIDATAID || ''
	])
	.sort((a, b) => b[5] - a[5]);

const countryRows = countries.features.map((f) => {
	const p = f.properties;
	return [
		p.NAME_EN || p.NAME,
		p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : '',
		p.CONTINENT || '',
		p.SUBREGION || '',
		Math.max(0, Math.round(p.POP_EST || 0)),
		p.FORMAL_EN || '',
		p.ADMIN || ''
	];
});

// ---- places-local.json (GeoNames) -------------------------------------------------
const GEONAMES_URL = 'https://download.geonames.org/export/dump/cities500.zip';
const EUROPE = { lon0: -32, lat0: 33, lon1: 45, lat1: 72 };
// PPLC national capital, PPLA regional capital, PPLA2/3/4 lesser seats, everything else a plain place.
const PLACE_RANK = { PPLC: 4, PPLA: 3, PPLA2: 2, PPLA3: 1, PPLA4: 1 };

async function geonames() {
	const zip = path.join(CACHE, 'cities500.zip');
	const text = path.join(CACHE, 'cities500.txt');
	try {
		await fs.stat(text);
	} catch {
		try {
			await fs.stat(zip);
		} catch {
			console.log(`downloading ${GEONAMES_URL}`);
			const res = await fetch(GEONAMES_URL);
			if (!res.ok) throw new Error(`GeoNames: HTTP ${res.status}`);
			await fs.mkdir(CACHE, { recursive: true });
			await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
		}
		await run('unzip', ['-o', '-j', zip, 'cities500.txt', '-d', CACHE], { maxBuffer: 1 << 28 });
	}
	return fs.readFile(text, 'utf8');
}

const geonamesRows = [];
for (const line of (await geonames()).split('\n')) {
	if (!line) continue;
	const f = line.split('\t');
	const lat = Number(f[4]);
	const lon = Number(f[5]);
	const population = Number(f[14]) || 0;
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
	const inEurope = lon >= EUROPE.lon0 && lon <= EUROPE.lon1 && lat >= EUROPE.lat0 && lat <= EUROPE.lat1;
	if (!inEurope && population < 5000) continue;
	geonamesRows.push([f[1], round3(lat), round3(lon), population, PLACE_RANK[f[7]] ?? 0, f[8] || '']);
}
// Biggest first: the renderer takes the first N that fit the view.
geonamesRows.sort((a, b) => b[3] - a[3] || b[4] - a[4]);
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(
	path.join(OUT, 'places-local.json'),
	JSON.stringify({
		v: 1,
		attribution: 'GeoNames (CC BY 4.0)',
		fields: ['name', 'lat', 'lon', 'population', 'rank', 'country'],
		rows: geonamesRows
	})
);

await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'world.json'), JSON.stringify(world));
await fs.writeFile(path.join(OUT, 'detail.json'), JSON.stringify(detail));
await fs.writeFile(
	path.join(OUT, 'places.json'),
	JSON.stringify({ v: 2, fields: ['name', 'country', 'region', 'lat', 'lon', 'population', 'capital', 'rank', 'continent', 'timezone', 'wikidata'], rows: placeRows })
);
await fs.writeFile(
	path.join(OUT, 'countries.json'),
	JSON.stringify({ v: 1, fields: ['name', 'iso', 'continent', 'subregion', 'population', 'formalName', 'admin'], rows: countryRows })
);
const size = async (name) => ((await fs.stat(path.join(OUT, name))).size / 1e6).toFixed(2);
console.log(`world.json: ${world.countries.length} countries, ${world.lakes.length} lakes, ${coordinates} points, ${await size('world.json')} MB`);
console.log(`detail.json: ${detail.regions.length} regions, ${detail.rivers.length} river lines, ${detail.urban.length} urban rings, ${detail.roads.length} road lines, ${detail.islands.length} islands, ${detail.names.length} names, ${detailCoordinates} points, ${await size('detail.json')} MB`);
console.log(`places.json: ${placeRows.length} places, ${await size('places.json')} MB · countries.json: ${countryRows.length}, ${await size('countries.json')} MB`);
console.log(`places-local.json: ${geonamesRows.length} settlements, ${await size('places-local.json')} MB`);
