import { json } from '@sveltejs/kit';
import { broadcastCommand } from '#lib/server/control.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as {
		text?: string;
		mode?: 'popup' | 'ticker';
		position?: 'top' | 'bottom';
		durationSec?: number;
		speedSec?: number;
		clientIds?: string[];
	} | null;
	const text = body?.text?.trim().slice(0, 1000);
	if (!text) return json({ error: 'Message text is required' }, { status: 400 });
	const messageMode = body?.mode === 'ticker' ? 'ticker' : 'popup';
	const durationSec = Math.max(5, Math.min(60, Number(body?.durationSec) || (messageMode === 'popup' ? 7 : 20)));
	const speedSec = Math.max(3, Math.min(60, Number(body?.speedSec) || 10));
	const clientIds = Array.isArray(body?.clientIds)
		? body.clientIds.filter((id): id is string => typeof id === 'string').slice(0, 100)
		: undefined;
	const delivered = broadcastCommand({
		type: 'message',
		text,
		messageMode,
		position: body?.position === 'top' ? 'top' : 'bottom',
		durationSec,
		speedSec
	}, clientIds);
	return json({ ok: true, delivered });
};
