import { describe, expect, it } from 'vitest';
import { normalizeSlDepartures } from './sl-departures';

describe('SL departures', () => {
	it('normalizes Roslagsbanan trains and buses', () => {
		const result = normalizeSlDepartures({ departures: [
			{ destination: 'Stockholms östra', display: '2 min', expected: '2026-08-30T08:04:57', journey: { id: 1 }, stop_area: { name: 'Galoppfältet' }, stop_point: { designation: '2' }, line: { designation: '28', transport_mode: 'TRAM', group_of_lines: 'Roslagsbanan' } },
			{ destination: 'Täby centrum', display: '4 min', expected: '2026-08-30T08:07:02', journey: { id: 2 }, stop_area: { name: 'Kemistvägen' }, line: { designation: '614', transport_mode: 'BUS' } }
		] });
		expect(result.map(({ mode, stop, line }) => ({ mode, stop, line }))).toEqual([
			{ mode: 'train', stop: 'Galoppfältet', line: '28' },
			{ mode: 'bus', stop: 'Kemistvägen', line: '614' }
		]);
	});
});
