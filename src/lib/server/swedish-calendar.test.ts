import { describe, expect, it } from 'vitest';
import { parseSwedishCalendarResponse } from './swedish-calendar';

describe('Swedish calendar', () => {
	it('reads name days, week number and a red public holiday', () => {
		expect(parseSwedishCalendarResponse({ dagar: [{
			datum: '2026-12-25', veckodag: 'Fredag', vecka: '52', namnsdag: [],
			helgdag: 'Juldagen', flaggdag: '', 'röd dag': 'Ja', 'arbetsfri dag': 'Ja'
		}] })).toEqual({
			date: '2026-12-25', weekday: 'Fredag', week: 52, nameDays: [],
			holiday: 'Juldagen', flagDay: null, isRedDay: true
		});
	});

	it('reads ordinary Swedish name days without marking a holiday', () => {
		const result = parseSwedishCalendarResponse({ dagar: [{
			datum: '2026-08-30', veckodag: 'Söndag', vecka: '35',
			namnsdag: ['Albert', 'Albertina'], flaggdag: '', 'röd dag': 'Nej'
		}] });
		expect(result.nameDays).toEqual(['Albert', 'Albertina']);
		expect(result.isRedDay).toBe(false);
	});
});
