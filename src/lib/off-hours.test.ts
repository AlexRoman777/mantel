import { describe, expect, it } from 'vitest';
import { isOffHours } from './off-hours';

const at = (h: number, m = 0) => new Date(2026, 7, 28, h, m);

describe('isOffHours', () => {
	it('is always false without a window', () => {
		expect(isOffHours(at(3))).toBe(false);
	});

	it('handles a same-day window', () => {
		const w = { start: '13:00', end: '15:00' };
		expect(isOffHours(at(12, 59), w)).toBe(false);
		expect(isOffHours(at(13, 0), w)).toBe(true);
		expect(isOffHours(at(14, 30), w)).toBe(true);
		expect(isOffHours(at(15, 0), w)).toBe(false);
	});

	it('handles an overnight window', () => {
		const w = { start: '23:00', end: '07:00' };
		expect(isOffHours(at(22, 59), w)).toBe(false);
		expect(isOffHours(at(23, 0), w)).toBe(true);
		expect(isOffHours(at(2, 0), w)).toBe(true);
		expect(isOffHours(at(6, 59), w)).toBe(true);
		expect(isOffHours(at(7, 0), w)).toBe(false);
	});

	it('treats an empty window (start == end) as always on', () => {
		expect(isOffHours(at(5), { start: '08:00', end: '08:00' })).toBe(false);
	});
});
