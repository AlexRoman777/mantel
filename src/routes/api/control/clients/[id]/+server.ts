import { error, json } from '@sveltejs/kit';
import { getConfig, updateConfig } from '#lib/server/config.js';
import { sendCommand, type ClientCommand } from '#lib/server/control.js';
import type { RequestHandler } from './$types';

const COMMANDS = new Set(['toggle', 'pause', 'resume', 'next', 'prev', 'switch', 'identify', 'refresh', 'blackout', 'wake']);

/** Send a command to one connected display. Body: { type, slug? } */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as ClientCommand | null;
	if (!body?.type || !COMMANDS.has(body.type)) {
		return json({ error: 'Unknown command' }, { status: 400 });
	}
	if (body.type === 'switch') {
		const config = await getConfig();
		if (!body.slug || !config.displays.some((d) => d.slug === body.slug)) {
			return json({ error: 'Unknown display slug' }, { status: 400 });
		}
		await updateConfig((latest) => ({
			...latest,
			clientProfiles: { ...latest.clientProfiles, [params.id]: body.slug! }
		}));
	}
	const delivered = sendCommand(params.id, { type: body.type, slug: body.slug });
	if (!delivered) error(404, 'Client is not connected');
	return json({ ok: true });
};

/** Rename a client device. Body: { name } */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as { name?: string } | null;
	const name = body?.name?.trim();
	if (name === undefined) return json({ error: 'name is required' }, { status: 400 });

	await updateConfig((config) => {
		const clientNames = { ...config.clientNames };
		if (name) clientNames[params.id] = name.slice(0, 60);
		else delete clientNames[params.id];
		return { ...config, clientNames };
	});
	return json({ ok: true });
};
