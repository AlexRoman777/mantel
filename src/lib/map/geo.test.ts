import { describe, expect, it } from 'vitest';
import {
	clusterPlaces, decodeWorld, distanceKm, mercatorProjection, nearestPlace, ringContains,
	scaleForWidth, slerp, stereographicProjection, worldMercatorScale
} from './geo';

describe('map geometry', () => {
	it('decodes delta-encoded rings back into degrees', () => {
		const world = decodeWorld({
			q: 1000,
			countries: [{ n: 'Test', c: 'TT', k: 'Europe', r: [[18000, 59000, 1000, 0, 0, 1000, -1000, 0]] }],
			lakes: []
		});
		expect(Array.from(world.countries[0].rings[0])).toEqual([18, 59, 19, 59, 19, 60, 18, 60]);
	});

	it('measures Stockholm to Iași at roughly 1,490 km', () => {
		expect(distanceKm(59.33, 18.07, 47.17, 27.58)).toBeGreaterThan(1470);
		expect(distanceKm(59.33, 18.07, 47.17, 27.58)).toBeLessThan(1510);
	});

	it('interpolates along the great circle', () => {
		const [lat, lon] = slerp(0, 0, 0, 90, 0.5);
		expect(lat).toBeCloseTo(0, 6);
		expect(lon).toBeCloseTo(45, 6);
		const [midLat] = slerp(59.33, 18.07, 47.17, 27.58, 0.5);
		expect(midLat).toBeGreaterThan(47.17);
		expect(midLat).toBeLessThan(59.33);
	});

	it('projects the view centre to the canvas centre in both projections', () => {
		const view = { lat: 59.33, lon: 18.07, scale: 1000, cx: 400, cy: 300 };
		expect(stereographicProjection(view)(18.07, 59.33)).toEqual([400, 300]);
		expect(mercatorProjection(view)(18.07, 59.33)).toEqual([400, 300]);
		// East is right, north is up, and the antipode is refused.
		const east = stereographicProjection(view)(19.07, 59.33)!;
		expect(east[0]).toBeGreaterThan(400);
		const north = mercatorProjection(view)(18.07, 60.33)!;
		expect(north[1]).toBeLessThan(300);
		expect(stereographicProjection(view)(-161.93, -59.33)).toBeNull();
	});

	it('sizes a 600 km wide view so that 600 km spans the screen width', () => {
		const scale = scaleForWidth('stereographic', 600, 3840, 59.33);
		const project = stereographicProjection({ lat: 59.33, lon: 18.07, scale, cx: 1920, cy: 1080 });
		// 300 km due east of the centre lands near the right edge.
		const eastLon = 18.07 + (300 / (111.32 * Math.cos((59.33 * Math.PI) / 180)));
		const [x] = project(eastLon, 59.33)!;
		expect(x).toBeGreaterThan(3700);
		expect(x).toBeLessThan(3900);
		expect(worldMercatorScale(1920, 1080)).toBeGreaterThan(0);
	});

	it('tests whether a ring encloses a point', () => {
		const square = new Float64Array([10, 10, 20, 10, 20, 20, 10, 20]);
		expect(ringContains(square, 15, 15)).toBe(true);
		expect(ringContains(square, 25, 15)).toBe(false);
	});

	it('clusters photos within a few kilometres and names the cluster by its commonest label', () => {
		const clusters = clusterPlaces([
			{ lat: 59.44, lon: 18.07, location: 'Täby, Sweden' },
			{ lat: 59.441, lon: 18.072, location: 'Täby, Sweden' },
			{ lat: 59.442, lon: 18.069, location: 'Stockholm, Sweden' },
			{ lat: 47.17, lon: 27.58, location: 'Iași, Romania' },
			{ lat: null, lon: null, location: 'Nowhere' },
			{ lat: 0, lon: 0, location: 'Null island' }
		]);
		expect(clusters).toHaveLength(2);
		const taby = clusters.find((cluster) => cluster.name === 'Täby, Sweden')!;
		expect(taby.count).toBe(3);
		expect(taby.lat).toBeCloseTo(59.441, 2);
	});

	it('finds the nearest known place within the radius', () => {
		const places = [
			{ name: 'Stockholm', country: 'Sweden', region: 'Stockholm', lat: 59.353, lon: 18.095, population: 1_264_000, capital: 2, rank: 1, continent: 'Europe', timezone: 'Europe/Stockholm', wikidata: 'Q1754' },
			{ name: 'Uppsala', country: 'Sweden', region: 'Uppsala', lat: 59.858, lon: 17.639, population: 140_000, capital: 1, rank: 6, continent: 'Europe', timezone: 'Europe/Stockholm', wikidata: 'Q25286' }
		];
		expect(nearestPlace(places, 59.44, 18.07)?.name).toBe('Stockholm');
		expect(nearestPlace(places, 62, 18)).toBeNull();
	});
});

describe('raster tiles and the sun', () => {
	it('picks the finest tile level that meets the requested resolution', async () => {
		const { levelForDetail, tileDegrees, tilesFor } = await import('./geo');
		expect(tileDegrees(0)).toBe(180);
		expect(tileDegrees(5)).toBeCloseTo(5.625, 3);
		expect(levelForDetail(1, 5)).toBe(0);
		expect(levelForDetail(10, 5)).toBe(3);
		expect(levelForDetail(1000, 5)).toBe(5);
		// A 12°×8° window around Stockholm at level 5 needs a 3×2 block of tiles.
		const tiles = tilesFor(5, { lon0: 12, lat0: 55, lon1: 24, lat1: 63 });
		expect(tiles.length).toBeGreaterThanOrEqual(6);
		expect(tiles.every((tile) => tile.lon1 > 12 && tile.lon0 < 24 && tile.lat1 > 55 && tile.lat0 < 63)).toBe(true);
		// Longitudes wrap across the antimeridian instead of overflowing the column count.
		const wrapped = tilesFor(2, { lon0: 170, lat0: -10, lon1: 190, lat1: 10 });
		expect(wrapped.some((tile) => tile.x === 0)).toBe(true);
	});

	it('computes sunrise and sunset in UTC and the subsolar point', async () => {
		const { sunTimes } = await import('./geo');
		const { subsolarPoint } = await import('./renderer');
		const day = new Date('2026-09-04T10:00:00Z');
		const stockholm = sunTimes(59.33, 18.07, day)!;
		expect(stockholm.sunrise.toISOString()).toMatch(/^2026-09-04T03:4/);
		expect(stockholm.sunset.toISOString()).toMatch(/^2026-09-04T17:4/);
		expect(sunTimes(85, 0, new Date('2026-06-21T12:00:00Z'))).toBeNull();
		const sun = subsolarPoint(new Date('2026-09-04T12:00:00Z'));
		expect(sun.lat).toBeGreaterThan(6);
		expect(sun.lat).toBeLessThan(8);
		expect(Math.abs(sun.lon)).toBeLessThan(2);
	});
});

describe('Sentinel imagery planning', () => {
	it('plans levels on the shared latitude/longitude grid within the block budget', async () => {
		const { levelForDetail, sentinelPlan, SENTINEL_TILE_PX, tileDegrees, tilesFor } = await import('./geo');
		// Big blocks reach a given resolution four levels earlier than the 256 px globe textures.
		expect(levelForDetail(2900, 10, SENTINEL_TILE_PX)).toBe(7);
		expect(levelForDetail(2900, 10)).toBe(10);
		expect(tileDegrees(7)).toBeCloseTo(1.406, 3);
		for (const km of [50, 100, 600]) {
			const plan = sentinelPlan(59.44, 18.07, km, 5760);
			expect(plan.map((w) => w.role)).toEqual(['atlas0', 'atlas1', 'crisp']);
			for (const w of plan) expect(tilesFor(w.z, w.bounds).length).toBeLessThanOrEqual(90);
			expect(plan[2].z).toBeGreaterThanOrEqual(plan[1].z);
		}
		// A 50 km stop is drawn from roughly 0.7-degree blocks.
		expect(sentinelPlan(59.44, 18.07, 50, 5760)[2].z).toBe(8);
	});
});

describe('map labels', () => {
	const place = (name: string, lat: number, lon: number, population: number) => ({ name, lat, lon, population, rank: 0, country: 'SE' });
	// Sorted by population, the way the bundled file is.
	const places = [
		place('Stockholm', 59.33, 18.07, 1_515_017),
		place('Uppsala', 59.86, 17.64, 140_454),
		place('Täby', 59.44, 18.07, 63_000),
		place('Åkersberga', 59.48, 18.3, 12_000),
		place('Vallentuna', 59.53, 18.08, 9_000),
		place('Stockholm', 59.34, 18.08, 8_000),
		place('Neighbour of Täby', 59.4405, 18.0705, 40_000)
	];
	const view = { lat: 59.44, lon: 18.07 };

	it('names only places above the chosen size, near the photo, and never repeats one', async () => {
		const { localPlacesForView } = await import('./geo');
		const named = localPlacesForView(places, view, 100, { minPopulation: 10_000, limit: 8 }).map((p) => p.name);
		// Vallentuna is under the floor, the second Stockholm repeats a name, and the
		// neighbour sits on top of Täby, so none of the three is named.
		expect(named).toEqual(['Stockholm', 'Täby', 'Åkersberga']);
		expect(named).not.toContain('Vallentuna');
		expect(named).not.toContain('Neighbour of Täby');
		// Uppsala is 47 km away, outside the 45 km reach of a 100 km view.
		expect(named).not.toContain('Uppsala');
		expect(localPlacesForView(places, view, 100, { minPopulation: 0, limit: 2 })).toHaveLength(2);
		expect(localPlacesForView(places, view, 100, { limit: 0 })).toEqual([]);
	});

	it('names fewer places the higher the view, whatever the setting says', async () => {
		const { localPlacesForView } = await import('./geo');
		const at = (widthKm: number) => localPlacesForView(places, view, widthKm, { minPopulation: 0, limit: 20 }).map((p) => p.name);
		// Close in, small towns are named; from 400 km only cities; from 800 km only the biggest.
		expect(at(60)).toContain('Åkersberga');
		expect(at(400)).toEqual(['Stockholm', 'Uppsala']);
		expect(at(800)).toEqual(['Stockholm']);
		expect(at(3000)).toEqual(['Stockholm']);
	});
});
