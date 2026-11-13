import { error, json } from '@sveltejs/kit';
import { getProfile } from '$lib/server/config';
import { getDisplayCandidates } from '$lib/server/playlist';
import { getImageCachePlan, prefetchImages } from '$lib/server/image-cache';
import { getGalleryInsights } from '$lib/server/gallery-insights';
import type { RequestHandler } from './$types';

async function albumOnlyProfile(slug: string) {
	const profile = await getProfile(slug);
	if (!profile) error(404, `No display named "${slug}"`);
	if (profile.sources.length === 0 || profile.sources.some((source) => source.type !== 'album')) {
		error(409, 'Bulk caching requires one or more albums and no whole-library, people, or memories sources.');
	}
	return profile;
}

export const GET: RequestHandler = async ({ params, url }) => {
	const profile = await albumOnlyProfile(params.slug);
	const slides = await getDisplayCandidates(profile);
	const plan = await getImageCachePlan(slides, profile.slideshow.imageSize);
	if (url.searchParams.get('progress') === '1') return json(plan);
	return json({ ...plan, gallery: await getGalleryInsights(profile, slides) });
};

export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as { confirmed?: boolean; expectedAssets?: number } | null;
	if (!body?.confirmed || !Number.isInteger(body.expectedAssets)) error(400, 'Explicit cache confirmation is required.');
	const profile = await albumOnlyProfile(params.slug);
	const slides = await getDisplayCandidates(profile);
	const plan = await getImageCachePlan(slides, profile.slideshow.imageSize);
	if (plan.assets !== body.expectedAssets) {
		return json({ error: 'The selected album contents changed. Review the updated estimate.', plan }, { status: 409 });
	}
	void prefetchImages(slides, profile.slideshow.imageSize).catch((cause) => {
		console.error(`confirmed cache job failed for ${profile.slug}:`, cause);
	});
	return json({ started: true, plan });
};
