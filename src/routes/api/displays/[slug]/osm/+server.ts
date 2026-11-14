import { error, json } from '@sveltejs/kit';
import { getProfile } from '#lib/server/config.js';
import { getOsmDetail } from '#lib/server/osm.js';
import type { RequestHandler } from './$types';

/**
 * OpenStreetMap detail for one stop. Answers from the cache; when the stop
 * has not been fetched yet it queues the fetch and returns 202 so the player
 * can draw Natural Earth detail now and refresh when the data arrives.
 */
export const GET: RequestHandler = async ({ params, url, setHeaders }) => {
	const profile = await getProfile(params.slug);
	if (!profile) error(404, `No display named "${params.slug}"`);
	const lat = Number(url.searchParams.get('lat'));
	const lon = Number(url.searchParams.get('lon'));
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) error(400, 'lat and lon are required');
	const zoomKm = profile.slideshow.map.zoomKm;
	const wait = url.searchParams.get('wait') === '1';
	const detail = await getOsmDetail(lat, lon, zoomKm, wait);
	if (!detail) return json({ status: 'pending' }, { status: 202 });
	setHeaders({ 'Cache-Control': 'private, max-age=86400' });
	return json(detail);
};
