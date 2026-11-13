import { json } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { clearHomeAssistant, getHomeAssistantStatus, getHomeAssistantWeatherEntities, saveHomeAssistant, testHomeAssistant } from '$lib/server/home-assistant';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const status = await getHomeAssistantStatus();
	if (!status.configured) return json({ ...status, weatherEntities: [] });
	try {
		return json({ ...status, weatherEntities: await getHomeAssistantWeatherEntities() });
	} catch (cause) {
		return json({ ...status, weatherEntities: [], entityError: cause instanceof Error ? cause.message : 'Could not read Home Assistant entities' });
	}
};

export const PUT: RequestHandler = async ({ request }) => {
	try {
		const connection = await testHomeAssistant(await request.json());
		await saveHomeAssistant(connection);
		return json({ configured: true, url: connection.url, weatherEntities: await getHomeAssistantWeatherEntities() });
	} catch (cause) {
		const message = cause instanceof ZodError ? cause.issues[0]?.message : cause instanceof Error ? cause.message : 'Connection failed';
		return json({ error: message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async () => {
	await clearHomeAssistant();
	return new Response(null, { status: 204 });
};
