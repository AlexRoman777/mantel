export interface MealDay {
	date: string;
	week: number;
	year: number;
	meals: string[];
}

export interface SchoolMealSchedule {
	school: string;
	days: MealDay[];
}

interface SkolmatenMeal { name?: string }
interface SkolmatenDay { date?: string; Meals?: SkolmatenMeal[] }
interface SkolmatenResponse {
	School?: { name?: string };
	WeekState?: { week?: number; year?: number; Days?: SkolmatenDay[] } | null;
}

const cache = new Map<string, { at: number; schedule: SchoolMealSchedule }>();
const TTL = 60 * 60_000;
// Public token shipped in skolmaten.se's own browser application, not a
// household credential. Server-side fetching still prevents player fan-out.
const SKOLMATEN_WEB_TOKEN = 'web-eaa12e50-c84c-4b4a-9cfe-4e3fcbcd9165';

function isoWeek(date: Date): { year: number; week: number } {
	const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const day = utc.getUTCDay() || 7;
	utc.setUTCDate(utc.getUTCDate() + 4 - day);
	const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
	return { year: utc.getUTCFullYear(), week: Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7) };
}

function addDays(date: Date, days: number): Date {
	const result = new Date(date);
	result.setDate(result.getDate() + days);
	return result;
}

function localDate(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeWeek(response: SkolmatenResponse): MealDay[] {
	const state = response.WeekState;
	if (!state) return [];
	return (state.Days ?? []).flatMap((day) => {
		const date = day.date?.slice(0, 10);
		if (!date) return [];
		const meals = [...new Set((day.Meals ?? []).map((meal) => meal.name?.trim()).filter((name): name is string => Boolean(name)))];
		if (!meals.length) return [];
		return [{ date, week: state.week ?? 0, year: state.year ?? 0, meals }];
	});
}

/** Today on weekdays plus the complete next week; weekends show the coming week. */
export function selectMealDays(days: readonly MealDay[], now = new Date()): MealDay[] {
	const weekday = now.getDay();
	const today = localDate(now);
	const daysUntilNextMonday = weekday === 0 ? 1 : 8 - weekday;
	const nextWeek = isoWeek(addDays(now, daysUntilNextMonday));
	return days.filter((day) => {
		if (weekday >= 1 && weekday <= 5 && day.date === today) return true;
		return day.year === nextWeek.year && day.week === nextWeek.week;
	});
}

async function fetchWeek(schoolSlug: string, year: number, week: number): Promise<SkolmatenResponse> {
	const response = await fetch(`https://skolmaten.se/api/4/menu/school/${schoolSlug}?year=${year}&week=${week}`, {
		headers: {
			Accept: 'application/json',
			Referer: 'https://skolmaten.se/',
			'client-token': SKOLMATEN_WEB_TOKEN
		},
		signal: AbortSignal.timeout(10_000)
	});
	if (!response.ok) throw new Error(`Skolmaten returned ${response.status}`);
	return response.json() as Promise<SkolmatenResponse>;
}

export async function getSchoolMeals(schoolSlug: string, now = new Date()): Promise<SchoolMealSchedule> {
	const hit = cache.get(schoolSlug);
	if (hit && Date.now() - hit.at < TTL) return hit.schedule;
	const current = isoWeek(now);
	const next = isoWeek(addDays(now, now.getDay() === 0 ? 1 : 8 - now.getDay()));
	const weeks = current.year === next.year && current.week === next.week ? [current] : [current, next];
	const responses = await Promise.all(weeks.map(({ year, week }) => fetchWeek(schoolSlug, year, week)));
	const allDays = responses.flatMap(normalizeWeek).sort((a, b) => a.date.localeCompare(b.date));
	const schedule = {
		school: responses.find((response) => response.School?.name)?.School?.name ?? schoolSlug,
		days: selectMealDays(allDays, now)
	};
	if (!schedule.days.length) throw new Error('Skolmaten returned no upcoming menu entries');
	cache.set(schoolSlug, { at: Date.now(), schedule });
	return schedule;
}
