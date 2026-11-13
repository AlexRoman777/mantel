import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: '/tmp/mantel-osm-test' } }));

const { compileOsm, osmWindows, regionalQuery } = await import('./osm');

describe('OpenStreetMap regional detail', () => {
	it('asks Overpass only for what reads from 100 to 600 km up', () => {
		const query = regionalQuery({ lon0: 17, lat0: 58.9, lon1: 19, lat1: 60 }, 120);
		expect(query).toContain('motorway|trunk|primary|secondary');
		expect(query).toContain('city|town|village|hamlet');
		expect(query).not.toContain('residential');
		expect(query).not.toContain('forest');
		expect(regionalQuery({ lon0: 0, lat0: 0, lon1: 5, lat1: 3 }, 320)).not.toContain('secondary');
		expect(osmWindows(600)).toEqual({ regionalKm: 320 });
		expect(osmWindows(50)).toEqual({ regionalKm: 80 });
	});

	it('compiles Overpass elements into classed, simplified layers', () => {
		const detail = compileOsm(
			[
				{ type: 'node', id: 1, lat: 59.44, lon: 18.07, tags: { place: 'town', name: 'Täby', population: '72000' } },
				{ type: 'node', id: 2, lat: 59.5, lon: 18.1, tags: { natural: 'peak', name: 'Hill', ele: '87' } },
				{ type: 'node', id: 3, lat: 59.65, lon: 17.93, tags: { aeroway: 'aerodrome', name: 'Arlanda', iata: 'ARN' } },
				{ type: 'way', id: 4, tags: { highway: 'motorway' }, geometry: [{ lat: 59.4, lon: 18 }, { lat: 59.4001, lon: 18.03 }, { lat: 59.4001, lon: 18.06 }, { lat: 59.4, lon: 18.1 }] },
				{ type: 'way', id: 5, tags: { highway: 'tertiary' }, geometry: [{ lat: 59.4, lon: 18 }, { lat: 59.41, lon: 18.01 }] },
				{ type: 'way', id: 6, tags: { waterway: 'river', name: 'Å' }, geometry: [{ lat: 59.3, lon: 18 }, { lat: 59.35, lon: 18.02 }] },
				{ type: 'way', id: 7, tags: { natural: 'water' }, geometry: [{ lat: 59.3, lon: 18 }, { lat: 59.31, lon: 18 }, { lat: 59.31, lon: 18.01 }, { lat: 59.3, lon: 18 }] },
				{ type: 'way', id: 8, tags: { railway: 'rail' }, geometry: [{ lat: 59.3, lon: 18 }, { lat: 59.32, lon: 18 }] }
			],
			{ lat: 59.44, lon: 18.07 },
			{ lon0: 17, lat0: 58.9, lon1: 19, lat1: 60 },
			0.001
		);
		expect(detail.places).toEqual([{ n: 'Täby', t: 'town', lat: 59.44, lon: 18.07, pop: 72000 }]);
		expect(detail.peaks[0]).toEqual({ n: 'Hill', lat: 59.5, lon: 18.1, ele: 87 });
		expect(detail.airports[0].n).toBe('Arlanda');
		expect(detail.roads.map((road) => road.c)).toEqual([0, 4]);
		// The nearly straight motorway loses its middle points to simplification.
		expect(detail.roads[0].g).toEqual([18, 59.4, 18.1, 59.4]);
		expect(detail.rivers[0].major).toBe(true);
		expect(detail.water).toHaveLength(1);
		expect(detail.rails).toHaveLength(1);
	});
});
