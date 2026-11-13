import { error, json } from '@sveltejs/kit';
import { getSlDepartures } from '$lib/server/sl-departures';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const siteIds = (url.searchParams.get('sites') ?? '')
		.split(',').map(Number).filter((id) => Number.isInteger(id) && id > 0 && id <= 9_999_999).slice(0, 6);
	if (!siteIds.length) error(400, 'At least one valid SL site ID is required');
	const max = Math.max(2, Math.min(12, Number(url.searchParams.get('max')) || 6));
	const trains = url.searchParams.get('trains') !== 'false';
	const buses = url.searchParams.get('buses') !== 'false';
	try {
		const departures = (await getSlDepartures(siteIds))
			.filter((row) => (row.mode === 'train' ? trains : buses))
			.slice(0, max);
		return json({ departures, attribution: 'Data från Trafiklab.se / SL' }, {
			headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=90' }
		});
	} catch (cause) {
		error(502, cause instanceof Error ? cause.message : 'SL departures unavailable');
	}
};
