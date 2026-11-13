import { json } from '@sveltejs/kit';
import { getProfile } from '$lib/server/config';
import { getPlaceTrivia } from '$lib/server/place-trivia';
import type { RequestHandler } from './$types';

/** Glanceable facts for the map layout's trivia card. */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const lat = Number(url.searchParams.get('lat'));
	const lon = Number(url.searchParams.get('lon'));
	if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
		return json({ error: 'lat and lon are required' }, { status: 400 });
	}
	const slug = url.searchParams.get('slug');
	const profile = slug ? await getProfile(slug) : null;
	const weather = profile?.overlays.weather;
	const configuredHome = profile?.slideshow.map.home;
	const home = configuredHome && (configuredHome.lat !== 0 || configuredHome.lon !== 0)
		? { lat: configuredHome.lat, lon: configuredHome.lon, name: configuredHome.name }
		: weather && (weather.lat !== 0 || weather.lon !== 0)
			? { lat: weather.lat, lon: weather.lon, name: weather.locationName ?? 'home' }
			: null;
	const trivia = await getPlaceTrivia({
		lat,
		lon,
		locationLabel: url.searchParams.get('name')?.slice(0, 120) ?? null,
		photoCount: Number(url.searchParams.get('count')) || 0,
		home,
		online: url.searchParams.get('online') === '1' || url.searchParams.get('wiki') === '1'
	});
	setHeaders({ 'Cache-Control': 'private, max-age=3600' });
	return json(trivia);
};
