import { error, json } from '@sveltejs/kit';
import { getCachedFaces } from '$lib/server/face-cache';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async ({ params, url }) => {
	if (!UUID.test(params.assetId)) error(400, 'Invalid asset id');
	const takenAt = url.searchParams.get('takenAt');
	return json(await getCachedFaces(params.assetId, takenAt, url.searchParams.get('connection') || undefined));
};
