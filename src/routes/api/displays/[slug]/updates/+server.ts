import { error, json } from '@sveltejs/kit';
import { getProfile } from '#lib/server/config.js';
import { pollDisplayUpdates } from '#lib/server/playlist.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const profile = await getProfile(params.slug);
	if (!profile) error(404, `No display named "${params.slug}"`);
	return json(await pollDisplayUpdates(profile));
};
