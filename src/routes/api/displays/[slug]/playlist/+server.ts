import { error, json } from '@sveltejs/kit';
import { getProfile } from '#lib/server/config.js';
import { getPlaylistPage } from '#lib/server/playlist.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const profile = await getProfile(params.slug);
	if (!profile) error(404, `No display named "${params.slug}"`);

	const count = Math.min(Math.max(Number(url.searchParams.get('count')) || 30, 1), 100);
	const cursor = url.searchParams.get('cursor');
	const portraitViewport = url.searchParams.get('viewport') === 'portrait';
	const personId = url.searchParams.get('person')?.slice(0, 80);
	const connectionId = url.searchParams.get('connection')?.slice(0, 80);
	return json(await getPlaylistPage(
		profile,
		cursor,
		count,
		portraitViewport,
		personId ? { id: personId, ...(connectionId ? { connectionId } : {}) } : undefined
	));
};
