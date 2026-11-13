export interface SlDeparture {
	id: string;
	stop: string;
	line: string;
	destination: string;
	display: string;
	expected: string;
	mode: 'train' | 'bus';
	platform: string | null;
}

interface RawDeparture {
	destination?: string;
	display?: string;
	scheduled?: string;
	expected?: string;
	journey?: { id?: string | number };
	stop_area?: { name?: string };
	stop_point?: { designation?: string };
	line?: { designation?: string; transport_mode?: string; group_of_lines?: string };
}

const cache = new Map<string, { expiresAt: number; value: SlDeparture[] }>();
const lastGood = new Map<string, SlDeparture[]>();

export function normalizeSlDepartures(input: unknown): SlDeparture[] {
	const rows = input && typeof input === 'object' && Array.isArray((input as { departures?: unknown }).departures)
		? (input as { departures: RawDeparture[] }).departures
		: [];
	return rows.flatMap((row, index) => {
		const mode = row.line?.transport_mode === 'BUS' ? 'bus' : row.line?.transport_mode === 'TRAM' ? 'train' : null;
		const expected = row.expected || row.scheduled;
		if (!mode || !expected || !row.destination || !row.line?.designation) return [];
		return [{
			id: String(row.journey?.id ?? `${row.line.designation}-${expected}-${index}`),
			stop: row.stop_area?.name ?? '',
			line: row.line.designation,
			destination: row.destination,
			display: row.display ?? new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit' }).format(new Date(expected)),
			expected,
			mode,
			platform: row.stop_point?.designation ?? null
		} satisfies SlDeparture];
	});
}

async function fetchSite(siteId: number): Promise<SlDeparture[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 8_000);
	try {
		const response = await fetch(`https://transport.integration.sl.se/v1/sites/${siteId}/departures`, { signal: controller.signal });
		if (!response.ok) throw new Error(`SL returned ${response.status} for stop ${siteId}`);
		return normalizeSlDepartures(await response.json());
	} finally { clearTimeout(timer); }
}

export async function getSlDepartures(siteIds: number[]): Promise<SlDeparture[]> {
	const ids = [...new Set(siteIds)].sort((a, b) => a - b);
	const key = ids.join(',');
	const hit = cache.get(key);
	if (hit && hit.expiresAt > Date.now()) return hit.value;
	try {
		const rows = (await Promise.all(ids.map(fetchSite))).flat();
		const seen = new Set<string>();
		const value = rows
			.sort((a, b) => Date.parse(a.expected) - Date.parse(b.expected))
			.filter((row) => {
				const id = `${row.id}:${row.stop}:${row.line}:${row.expected}`;
				if (seen.has(id)) return false;
				seen.add(id);
				return true;
			});
		cache.set(key, { expiresAt: Date.now() + 60_000, value });
		lastGood.set(key, value);
		return value;
	} catch (cause) {
		const stale = lastGood.get(key);
		if (stale) return stale;
		throw cause;
	}
}
