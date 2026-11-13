import { error } from '@sveltejs/kit';
import { fetchPersonThumbnail } from '$lib/server/immich';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async ({ params, url, setHeaders }) => {
	if (!UUID_RE.test(params.id)) error(400, 'Invalid person id');

	const upstream = await fetchPersonThumbnail(params.id, url.searchParams.get('connection') || undefined);
	if (!upstream.ok || !upstream.body) {
		error(upstream.status === 404 ? 404 : 502, 'Thumbnail unavailable');
	}

	setHeaders({
		'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
		// Face crops can change when Immich re-clusters; cache for a day.
		'Cache-Control': 'public, max-age=86400'
	});
	return new Response(upstream.body);
};
