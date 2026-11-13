import { describe, expect, it } from 'vitest';
import { getRegionalCalendarDay } from './regional-calendar';

describe('regional calendar', () => {
	it('shows Romanian National Day', () => {
		expect(getRegionalCalendarDay('RO', new Date('2026-12-01T12:00:00Z')).holiday)
			.toBe('Ziua Națională a României');
	});

	it('calculates US Thanksgiving', () => {
		expect(getRegionalCalendarDay('US', new Date('2026-11-26T15:00:00Z')).holiday)
			.toBe('Thanksgiving');
	});

	it('includes global celebrations', () => {
		expect(getRegionalCalendarDay('GLOBAL', new Date('2026-04-22T12:00:00Z')).holiday)
			.toBe('Earth Day');
	});
});
