import { describe, expect, it } from 'vitest';
import { selectMealDays, type MealDay } from './school-meals';

const days: MealDay[] = [
	{ date: '2026-08-28', year: 2026, week: 35, meals: ['Friday'] },
	{ date: '2026-08-31', year: 2026, week: 36, meals: ['Monday'] },
	{ date: '2026-09-01', year: 2026, week: 36, meals: ['Tuesday'] },
	{ date: '2026-09-07', year: 2026, week: 37, meals: ['Next Monday'] }
];

describe('selectMealDays', () => {
	it('shows the coming week on a weekend', () => {
		expect(selectMealDays(days, new Date('2026-08-30T12:00:00')).map((day) => day.date)).toEqual(['2026-08-31', '2026-09-01']);
	});

	it('shows today and the following week on a weekday', () => {
		expect(selectMealDays(days, new Date('2026-08-31T12:00:00')).map((day) => day.date)).toEqual(['2026-08-31', '2026-09-07']);
	});
});
