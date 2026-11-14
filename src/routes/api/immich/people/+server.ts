import { json } from '@sveltejs/kit';
import { getPeople } from '#lib/server/immich.js';
import type { RequestHandler } from './$types';

/** Named, visible people for the settings picker. */
export const GET: RequestHandler = async ({ url }) => {
	const connectionId = url.searchParams.get('connection') || undefined;
	const people = await getPeople(connectionId).catch(() => null);
	if (!people) return json({ error: 'Immich is not configured or unavailable' }, { status: 503 });
	return json(
		people
			.filter((p) => p.name)
			.map((p) => ({ id: p.id, name: p.name, connectionId }))
			.sort((a, b) => a.name.localeCompare(b.name))
	);
};
