import { error, json } from '@sveltejs/kit';
import { getProfile } from '#lib/server/config.js';
import { warmSentinelTiles } from '#lib/server/map-tiles.js';
import { warmOsmDetail } from '#lib/server/osm.js';
import { warmPlaceTrivia } from '#lib/server/place-trivia.js';
import type { RequestHandler } from './$types';

interface RequestedPlace {
	lat: number;
	lon: number;
	name?: string;
}

/**
 * Prepare only the next stops in this player's real deck order. The client is
 * deliberately limited to two places so a large gallery can never recreate a
 * bulk warm-up queue ahead of the photograph currently being shown.
 */
export const POST: RequestHandler = async ({ params, request, setHeaders }) => {
	const profile = await getProfile(params.slug);
	if (!profile) error(404, `No display named "${params.slug}"`);

	const body = (await request.json().catch(() => null)) as { places?: RequestedPlace[] } | null;
	const places = (Array.isArray(body?.places) ? body.places : [])
		.filter((place) => Number.isFinite(place?.lat) && Number.isFinite(place?.lon) && Math.abs(place.lat) <= 90 && Math.abs(place.lon) <= 180)
		.slice(0, 2)
		.map((place) => ({ lat: place.lat, lon: place.lon, name: typeof place.name === 'string' ? place.name.slice(0, 160) : '' }));

	if (places.length) {
		const settings = profile.slideshow.map;
		if (settings.imageryDetail === 'sentinel') warmSentinelTiles(places, settings.zoomKm);
		if (settings.osmDetail) warmOsmDetail(places, settings.zoomKm);
		warmPlaceTrivia(places, settings.trivia === 'online');
	}

	setHeaders({ 'Cache-Control': 'no-store' });
	return json({ accepted: places.length }, { status: 202 });
};
