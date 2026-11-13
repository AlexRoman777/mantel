import { z } from 'zod';

const responseSchema = z.object({
	dagar: z.array(z.object({
		datum: z.string(),
		veckodag: z.string().optional(),
		vecka: z.string().optional(),
		namnsdag: z.array(z.string()).optional(),
		flaggdag: z.string().optional(),
		helgdag: z.string().optional(),
		'rod dag': z.string().optional(),
		'röd dag': z.string().optional(),
		'arbetsfri dag': z.string().optional()
	})).min(1)
});

export interface SwedishCalendarDay {
	date: string;
	weekday: string | null;
	week: number | null;
	nameDays: string[];
	holiday: string | null;
	flagDay: string | null;
	isRedDay: boolean;
}

export function parseSwedishCalendarResponse(input: unknown): SwedishCalendarDay {
	const day = responseSchema.parse(input).dagar[0];
	const red = day['röd dag'] ?? day['rod dag'];
	return {
		date: day.datum,
		weekday: day.veckodag ?? null,
		week: day.vecka && Number.isFinite(Number(day.vecka)) ? Number(day.vecka) : null,
		nameDays: day.namnsdag ?? [],
		holiday: day.helgdag?.trim() || null,
		flagDay: day.flaggdag?.trim() || null,
		isRedDay: red === 'Ja'
	};
}

let cache: { key: string; expiresAt: number; value: SwedishCalendarDay } | null = null;

function stockholmDate(): string {
	const parts = new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit'
	}).formatToParts(new Date());
	const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
	return `${get('year')}-${get('month')}-${get('day')}`;
}

export async function getSwedishCalendarDay(): Promise<SwedishCalendarDay> {
	const date = stockholmDate();
	if (cache?.key === date && cache.expiresAt > Date.now()) return cache.value;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 8_000);
	try {
		const response = await fetch(`https://sholiday.faboul.se/dagar/v2.1/${date.replaceAll('-', '/')}`, {
			signal: controller.signal
		});
		if (!response.ok) throw new Error(`Calendar service returned ${response.status}`);
		const value = parseSwedishCalendarResponse(await response.json());
		cache = { key: date, expiresAt: Date.now() + 6 * 60 * 60_000, value };
		return value;
	} finally {
		clearTimeout(timer);
	}
}
