import { error, json } from '@sveltejs/kit';
import { getProfile } from '#lib/server/config.js';
import { getSwedishCalendarDay } from '#lib/server/swedish-calendar.js';
import { getRegionalCalendarDay } from '#lib/server/regional-calendar.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const slug = url.searchParams.get('slug');
	if (!slug) error(400, 'slug is required');
	const profile = await getProfile(slug);
	if (!profile) error(404, 'Display not found');
	if (!profile.overlays.calendar.enabled) error(403, 'Calendar is disabled');
	try {
		const region = profile.overlays.calendar.region;
		return json(region === 'SE' ? await getSwedishCalendarDay() : getRegionalCalendarDay(region));
	} catch (cause) {
		error(502, cause instanceof Error ? cause.message : 'Calendar unavailable');
	}
};
