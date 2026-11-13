import { error, json } from '@sveltejs/kit';
import { getProfile } from '$lib/server/config';
import { getWeather } from '$lib/server/weather';
import { getHomeAssistantWeather } from '$lib/server/home-assistant';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const slug = url.searchParams.get('slug');
	if (!slug) error(400, 'slug is required');

	const profile = await getProfile(slug);
	if (!profile) error(404, `No display named "${slug}"`);

	const w = profile.overlays.weather;
	if (!w.enabled) error(404, 'Weather is disabled for this display');

	try {
		if (w.provider === 'home-assistant' && w.haEntityId) {
			return json({ locations: [{ ...(await getHomeAssistantWeather(w.haEntityId, w.units)), locationName: w.locationName ?? 'Home' }] });
		}
		const cities = w.cities.length
			? w.cities
			: [{ id: 'primary', name: w.locationName ?? 'Weather', lat: w.lat, lon: w.lon }];
		const locations = await Promise.all(cities.map(async (city) => ({
			...(await getWeather(city.lat, city.lon, w.units)),
			locationName: city.name
		})));
		return json({ locations });
	} catch {
		error(502, 'Weather service unavailable');
	}
};
