import { json } from '@sveltejs/kit';
import { REGIONS, regionJobStatus, regionTileCount, SENTINEL_MAX_LEVEL, startRegionPrefetch, stopRegionPrefetch } from '#lib/server/map-tiles.js';
import type { RequestHandler } from './$types';

/** Bulk Sentinel imagery prefetch for a region: status, start, stop. */
export const GET: RequestHandler = async () =>
	json({
		job: regionJobStatus(),
		maxZoom: SENTINEL_MAX_LEVEL,
		regions: Object.entries(REGIONS).map(([id, region]) => ({
			id,
			name: region.name,
			tilesToZoom7: regionTileCount(region.bounds, 7),
			tilesToZoom8: regionTileCount(region.bounds, 8),
			tilesToZoom9: regionTileCount(region.bounds, 9)
		}))
	});

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { region?: string; maxZoom?: number };
	const region = body.region && body.region in REGIONS ? (body.region as keyof typeof REGIONS) : 'europe';
	const maxZoom = Math.max(5, Math.min(SENTINEL_MAX_LEVEL, Number(body.maxZoom) || 7));
	return json({ job: startRegionPrefetch(region, maxZoom) });
};

export const DELETE: RequestHandler = async () => {
	stopRegionPrefetch();
	return json({ job: null });
};
