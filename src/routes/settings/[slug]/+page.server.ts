import { error } from '@sveltejs/kit';
import { getProfile } from '#lib/server/config.js';
import { getImmichConnectionStatus } from '#lib/server/immich-connection.js';
import { getHomeAssistantStatus } from '#lib/server/home-assistant.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const profile = await getProfile(params.slug);
	if (!profile) error(404, `No display named "${params.slug}"`);
	return {
		profile,
		immich: await getImmichConnectionStatus(),
		homeAssistant: await getHomeAssistantStatus(),
		clientId: url.searchParams.get('client') || null
	};
};
