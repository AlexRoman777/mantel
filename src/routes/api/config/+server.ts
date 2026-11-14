import { json } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { getConfig, saveConfig } from '#lib/server/config.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await getConfig());

export const PUT: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	try {
		return json(await saveConfig(body));
	} catch (e) {
		if (e instanceof ZodError) {
			return json({ error: 'Invalid config', issues: e.issues }, { status: 400 });
		}
		throw e;
	}
};
