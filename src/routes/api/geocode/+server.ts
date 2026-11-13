import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Proxy for Open-Meteo's free geocoding search (weather location picker). */
export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q')?.trim();
	if (!q) error(400, 'q is required');
	const parts = q.split(',').map((part) => part.trim()).filter(Boolean);
	const countries: Record<string, string> = {
		sweden: 'SE', sverige: 'SE', romania: 'RO', românia: 'RO', usa: 'US',
		'us': 'US', 'united states': 'US', thailand: 'TH'
	};
	const countryCode = countries[parts.at(-1)?.toLocaleLowerCase() ?? ''];
	const searchName = parts[0] || q;
	const context = parts.slice(1, countryCode ? -1 : undefined).join(' ').toLocaleLowerCase();

	const upstream = new URL('https://geocoding-api.open-meteo.com/v1/search');
	upstream.searchParams.set('name', searchName);
	upstream.searchParams.set('count', '10');
	upstream.searchParams.set('language', 'en');
	if (countryCode) upstream.searchParams.set('countryCode', countryCode);

	const res = await fetch(upstream, { signal: AbortSignal.timeout(8_000) });
	if (!res.ok) error(502, 'Geocoding unavailable');
	const body = (await res.json()) as {
		results?: { name: string; country?: string; admin1?: string; admin2?: string; latitude: number; longitude: number }[];
	};

	const ranked = (body.results ?? []).sort((a, b) => {
		if (!context) return 0;
		const score = (result: typeof a) => [result.admin1, result.admin2, result.country]
			.filter(Boolean).join(' ').toLocaleLowerCase().split(/\s+/)
			.filter((word) => context.includes(word)).length;
		return score(b) - score(a);
	});

	return json(
		ranked.map((r) => ({
			name: [r.name, r.admin2, r.admin1, r.country].filter((part, index, all) => part && all.indexOf(part) === index).join(', '),
			shortName: r.name,
			lat: r.latitude,
			lon: r.longitude
		}))
	);
};
