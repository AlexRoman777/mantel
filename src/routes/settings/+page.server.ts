import { getConfig } from '#lib/server/config.js';
import { getImmichConnectionStatus } from '#lib/server/immich-connection.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [config, immich] = await Promise.all([getConfig(), getImmichConnectionStatus()]);
	return {
		immich,
		displays: config.displays.map((d) => ({
			slug: d.slug,
			name: d.name,
			sources: d.sources.length
		}))
	};
};
