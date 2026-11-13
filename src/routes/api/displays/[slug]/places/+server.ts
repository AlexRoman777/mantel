import { error, json } from '@sveltejs/kit';
import { getProfile } from '$lib/server/config';
import { getDisplayCandidates } from '$lib/server/playlist';
import { clusterPlaces } from '$lib/map/geo';
import type { RequestHandler } from './$types';

/** Every place this display has photos for: the map layout draws them as markers. */
export const GET: RequestHandler = async ({ params, setHeaders }) => {
	const profile = await getProfile(params.slug);
	if (!profile) error(404, `No display named "${params.slug}"`);
	const candidates = await getDisplayCandidates(profile);
	const places = clusterPlaces(candidates).map(({ key, name, lat, lon, count }) => ({
		key,
		name,
		lat: Math.round(lat * 1000) / 1000,
		lon: Math.round(lon * 1000) / 1000,
		count
	}));
	// Do not enqueue enrichment for the whole album here. A large gallery could
	// put hundreds of Sentinel/OSM/trivia jobs ahead of the photograph currently
	// on screen. MapStage requests its active stop directly; all results are then
	// served from Mantel's persistent cache on subsequent visits.
	setHeaders({ 'Cache-Control': 'private, max-age=300' });
	return json({ places, located: places.reduce((sum, place) => sum + place.count, 0), total: candidates.length });
};
