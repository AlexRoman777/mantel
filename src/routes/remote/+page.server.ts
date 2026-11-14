import { getConfig } from '#lib/server/config.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const config = await getConfig();
	return {
		displays: config.displays.map((d) => ({ slug: d.slug, name: d.name }))
	};
};
