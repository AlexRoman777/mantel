import { json } from '@sveltejs/kit';
import { getAlbums } from '$lib/server/immich';
import type { RequestHandler } from './$types';

/** Album list for the settings picker (lean shape, thumbnails via the image proxy). */
export const GET: RequestHandler = async ({ url }) => {
	const connectionId = url.searchParams.get('connection') || undefined;
	const albums = await getAlbums(connectionId).catch(() => null);
	if (!albums) return json({ error: 'Immich is not configured or unavailable' }, { status: 503 });
	return json(
		albums
			.map((a) => ({
				id: a.id,
				name: a.albumName,
				assetCount: a.assetCount,
				thumbAssetId: a.albumThumbnailAssetId,
				connectionId
			}))
			.sort((a, b) => a.name.localeCompare(b.name))
	);
};
