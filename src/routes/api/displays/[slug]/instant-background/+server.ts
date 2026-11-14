import { error, json } from '@sveltejs/kit';
import { getProfile } from '#lib/server/config.js';
import { getDisplayCandidates } from '#lib/server/playlist.js';
import {
	deleteInstantBackground,
	getInstantBackgroundStatus,
	planInstantBackground,
	instantBackgroundBody,
	startInstantBackground
} from '#lib/server/instant-background.js';
import type { RequestHandler } from './$types';

async function profileForSlug(slug: string) {
	const profile = await getProfile(slug);
	if (!profile) error(404, `No presentation named "${slug}"`);
	return profile;
}

function requireAlbumOnly(profile: Awaited<ReturnType<typeof profileForSlug>>): void {
	if (profile.sources.length === 0 || profile.sources.some((source) => source.type !== 'album')) {
		error(409, 'A saved Living memories background requires one or more selected albums and no whole-library source.');
	}
}

export const GET: RequestHandler = async ({ params, url, request, setHeaders }) => {
	const profile = await profileForSlug(params.slug);
	if (url.searchParams.get('status') === '1') return json(await getInstantBackgroundStatus(profile.id));
	if (url.searchParams.get('plan') === '1') {
		requireAlbumOnly(profile);
		return json(await planInstantBackground(await getDisplayCandidates(profile)));
	}
	const status = await getInstantBackgroundStatus(profile.id);
	const body = await instantBackgroundBody(profile.id);
	if (!body) error(404, 'No saved Living memories background has been built yet.');
	const etag = `"instant-${profile.id}-${status.createdAt ?? 'existing'}"`;
	if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
	setHeaders({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=300, must-revalidate', ETag: etag });
	return new Response(body);
};

export const POST: RequestHandler = async ({ params, request }) => {
	const profile = await profileForSlug(params.slug);
	requireAlbumOnly(profile);
	const body = (await request.json().catch(() => null)) as { confirmed?: boolean; expectedAssets?: number; seed?: number } | null;
	if (!body?.confirmed || !Number.isInteger(body.expectedAssets) || !Number.isInteger(body.seed)) error(400, 'Review and confirm the background build first.');
	const slides = await getDisplayCandidates(profile);
	if (slides.length !== body.expectedAssets) {
		return json({ error: 'The selected album contents changed. Review the build again.', plan: await planInstantBackground(slides) }, { status: 409 });
	}
	const started = startInstantBackground(profile.id, slides, body.seed!);
	return json({ started, status: await getInstantBackgroundStatus(profile.id) }, { status: started ? 202 : 200 });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const profile = await profileForSlug(params.slug);
	try {
		await deleteInstantBackground(profile.id);
		return new Response(null, { status: 204 });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : 'Could not remove background' }, { status: 409 });
	}
};
