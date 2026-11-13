import { json } from '@sveltejs/kit';
import { registerPassiveClient, updateClientState, type ClientDiagnostics, type ClientState } from '$lib/server/control';
import { getConfig, updateConfig } from '$lib/server/config';
import type { RequestHandler } from './$types';

/** Displays report their playback state here (paused, current photo). */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as
		| { clientId?: string; slug?: string; state?: ClientState; client?: { platform?: string; screen?: string; dpr?: number; touch?: boolean; diagnostics?: ClientDiagnostics } }
		| null;
	if (!body?.clientId || !body.slug || !body.state) {
		return json({ error: 'clientId, slug and state are required' }, { status: 400 });
	}
	let known = updateClientState(body.clientId, body.slug, body.state, body.client?.diagnostics);
	if (!known) {
		registerPassiveClient({
			clientId: body.clientId,
			slug: body.slug,
			userAgent: request.headers.get('user-agent') ?? '',
			platform: body.client?.platform,
			screen: body.client?.screen,
			dpr: body.client?.dpr,
			touch: body.client?.touch
		});
		known = updateClientState(body.clientId, body.slug, body.state, body.client?.diagnostics);
		const config = await getConfig();
		if (!config.clientProfiles[body.clientId] && config.displays.some((display) => display.slug === body.slug)) {
			await updateConfig((latest) => ({
				...latest,
				clientProfiles: { ...latest.clientProfiles, [body.clientId!]: body.slug! }
			}));
		}
	}
	return json({ known });
};
