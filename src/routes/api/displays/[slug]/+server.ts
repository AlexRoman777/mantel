import { error, json } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { getProfile, updateConfig } from '#lib/server/config.js';
import { refreshProfile, sendCommand } from '#lib/server/control.js';
import type { RequestHandler } from './$types';

/** Public profile for one display — what the slideshow client needs to render. */
export const GET: RequestHandler = async ({ params }) => {
	const profile = await getProfile(params.slug);
	if (!profile) error(404, `No display named "${params.slug}"`);
	return json(profile);
};

/** Replace one display's profile. */
export const PUT: RequestHandler = async ({ params, request }) => {
	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Invalid JSON' }, { status: 400 });

	try {
		const saved = await updateConfig((config) => {
			const index = config.displays.findIndex((d) => d.slug === params.slug);
			if (index === -1) error(404, `No display named "${params.slug}"`);
			const displays = config.displays.slice();
			displays[index] = body;
			return { ...config, displays };
		});
		refreshProfile(params.slug);
		return json(saved.displays.find((display) => display.slug === params.slug));
	} catch (e) {
		if (e instanceof ZodError) {
			return json({ error: 'Invalid profile', issues: e.issues }, { status: 400 });
		}
		throw e;
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	let fallback: string | undefined;
	let reassigned: string[] = [];
	await updateConfig((latest) => {
		if (!latest.displays.some((display) => display.slug === params.slug)) {
			error(404, `No display named "${params.slug}"`);
		}
		const displays = latest.displays.filter((display) => display.slug !== params.slug);
		if (displays.length === 0) error(409, 'Keep at least one presentation. Create its replacement before deleting this one.');
		fallback = displays[0]?.slug;
		const clientProfiles = { ...latest.clientProfiles };
		reassigned = [];
		for (const [clientId, slug] of Object.entries(clientProfiles)) {
			if (slug !== params.slug) continue;
			if (fallback) clientProfiles[clientId] = fallback;
			else delete clientProfiles[clientId];
			reassigned.push(clientId);
		}
		return { ...latest, displays, clientProfiles };
	});
	if (fallback) for (const clientId of reassigned) sendCommand(clientId, { type: 'switch', slug: fallback });
	return new Response(null, { status: 204 });
};
