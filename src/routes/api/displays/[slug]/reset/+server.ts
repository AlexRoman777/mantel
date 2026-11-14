import { error, json } from '@sveltejs/kit';
import { getProfile } from '#lib/server/config.js';
import { resetProfile } from '#lib/server/control.js';
import { clearImageCache, getImageCacheStats } from '#lib/server/image-cache.js';
import { clearPlaylistCache } from '#lib/server/playlist.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	if (!(await getProfile(params.slug))) error(404, `No display named "${params.slug}"`);
	const body = (await request.json().catch(() => ({}))) as { clearImages?: boolean };
	await clearPlaylistCache();
	if (body.clearImages) await clearImageCache();
	const clients = resetProfile(params.slug);
	return json({ reset: true, clients, cache: await getImageCacheStats() });
};
