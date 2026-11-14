import { json } from '@sveltejs/kit';
import { clearImageCache, getImageCacheStats } from '#lib/server/image-cache.js';
import { mapLibraryStats, regionJobStatus, sentinelCacheStats } from '#lib/server/map-tiles.js';
import { osmCacheStats } from '#lib/server/osm.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () =>
	json({
		...(await getImageCacheStats()),
		map: {
			// Which imagery the server found on disk, and where: the one question
			// worth answering when the map looks bare after copying files onto a NAS.
			library: await mapLibraryStats(),
			sentinel: await sentinelCacheStats(),
			osm: await osmCacheStats(),
			region: regionJobStatus()
		}
	});

export const DELETE: RequestHandler = async () => {
	await clearImageCache();
	return json(await getImageCacheStats());
};
