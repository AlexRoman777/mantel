import type { SwedishCalendarDay } from './swedish-calendar';

export type CalendarRegion = 'RO' | 'US' | 'GLOBAL';

const FIXED: Record<CalendarRegion, Record<string, string>> = {
	RO: {
		'01-01': 'Anul Nou', '01-02': 'A doua zi de Anul Nou', '01-24': 'Ziua Unirii Principatelor Române',
		'05-01': 'Ziua Muncii', '06-01': 'Ziua Copilului', '08-15': 'Adormirea Maicii Domnului',
		'11-30': 'Sfântul Andrei', '12-01': 'Ziua Națională a României', '12-25': 'Crăciunul', '12-26': 'A doua zi de Crăciun'
	},
	US: {
		'01-01': "New Year's Day", '06-19': 'Juneteenth', '07-04': 'Independence Day',
		'11-11': 'Veterans Day', '12-25': 'Christmas Day'
	},
	GLOBAL: {
		'01-01': "New Year's Day", '03-08': "International Women's Day", '04-22': 'Earth Day',
		'06-05': 'World Environment Day', '09-21': 'International Day of Peace',
		'10-24': 'United Nations Day', '12-10': 'Human Rights Day'
	}
};

function dateInZone(now: Date, timeZone: string): { iso: string; year: number; month: number; day: number } {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
	}).formatToParts(now);
	const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
	const year = value('year');
	const month = value('month');
	const day = value('day');
	return { iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, year, month, day };
}

function nthWeekday(year: number, month: number, weekday: number, nth: number): number {
	const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
	return 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
}

function lastWeekday(year: number, month: number, weekday: number): number {
	const last = new Date(Date.UTC(year, month, 0));
	return last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7);
}

function isoWeek(year: number, month: number, day: number): number {
	const date = new Date(Date.UTC(year, month - 1, day));
	date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
	const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
	return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function movingUsHoliday(year: number, month: number, day: number): string | null {
	if (month === 1 && day === nthWeekday(year, 1, 1, 3)) return 'Martin Luther King Jr. Day';
	if (month === 2 && day === nthWeekday(year, 2, 1, 3)) return "Presidents' Day";
	if (month === 5 && day === lastWeekday(year, 5, 1)) return 'Memorial Day';
	if (month === 9 && day === nthWeekday(year, 9, 1, 1)) return 'Labor Day';
	if (month === 10 && day === nthWeekday(year, 10, 1, 2)) return 'Columbus Day';
	if (month === 11 && day === nthWeekday(year, 11, 4, 4)) return 'Thanksgiving';
	return null;
}

export function getRegionalCalendarDay(region: CalendarRegion, now = new Date()): SwedishCalendarDay {
	const timeZone = region === 'RO' ? 'Europe/Bucharest' : region === 'US' ? 'America/New_York' : 'UTC';
	const current = dateInZone(now, timeZone);
	const key = current.iso.slice(5);
	const holiday = FIXED[region][key] ?? (region === 'US' ? movingUsHoliday(current.year, current.month, current.day) : null);
	return {
		date: current.iso,
		weekday: new Intl.DateTimeFormat(region === 'RO' ? 'ro-RO' : 'en-US', { weekday: 'long', timeZone }).format(now),
		week: isoWeek(current.year, current.month, current.day),
		nameDays: [],
		holiday,
		flagDay: null,
		isRedDay: Boolean(holiday)
	};
}
