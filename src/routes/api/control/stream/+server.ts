import { error } from '@sveltejs/kit';
import { registerClient, touchClient, unregisterClient, type Session } from '$lib/server/control';
import { getConfig, updateConfig } from '$lib/server/config';
import type { RequestHandler } from './$types';

/**
 * SSE command channel: a /display page opens this once and receives commands
 * (pause, next, switch, …) pushed from the /remote dashboard.
 */
export const GET: RequestHandler = async ({ url, request }) => {
	const clientId = url.searchParams.get('client');
	const slug = url.searchParams.get('slug');
	if (!clientId || !slug) error(400, 'client and slug are required');
	const config = await getConfig();
	const assignedSlug = config.clientProfiles[clientId];
	if (!assignedSlug && config.displays.some((display) => display.slug === slug)) {
		// Remember even the initial URL assignment. This lets the controller know
		// about shared presentations and isolate edits before changing another TV.
		await updateConfig((latest) => ({
			...latest,
			clientProfiles: { ...latest.clientProfiles, [clientId]: slug }
		}));
	}
	const platform = (url.searchParams.get('platform') ?? '').slice(0, 80);
	const screen = /^\d{2,5}x\d{2,5}$/.test(url.searchParams.get('screen') ?? '')
		? url.searchParams.get('screen')!
		: '';
	const dpr = Number(url.searchParams.get('dpr') ?? '1');
	const touch = url.searchParams.get('touch') === '1';

	const encoder = new TextEncoder();
	let session: Session | null = null;
	let pingTimer: ReturnType<typeof setInterval> | undefined;

	const stream = new ReadableStream({
		start(controller) {
			const push: Session['push'] = (msg) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
				} catch {
					// Stream already closed; the cancel() path cleans up.
				}
			};
			const close = () => {
				clearInterval(pingTimer);
				try {
					controller.close();
				} catch {
					// Already closed.
				}
			};
			session = registerClient({
				clientId,
				slug,
				userAgent: request.headers.get('user-agent') ?? '',
				platform,
				screen,
				dpr,
				touch,
				push,
				close
			});
			push({ type: 'hello' });
			if (assignedSlug && assignedSlug !== slug) push({ type: 'switch', slug: assignedSlug });
			// Keep intermediaries from timing the idle connection out.
			pingTimer = setInterval(() => {
				if (session) touchClient(session);
				push({ type: 'ping' });
			}, 25_000);
		},
		cancel() {
			clearInterval(pingTimer);
			if (session) unregisterClient(session);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
