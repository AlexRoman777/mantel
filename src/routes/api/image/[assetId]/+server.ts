import { error } from '@sveltejs/kit';
import { cachedImageBody, getCachedAssetImage, type ImageSize } from '#lib/server/image-cache.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIZES = new Set(['preview', 'thumbnail', 'fullsize'] as const);

/**
 * Persistent image proxy: browsers only talk to Mantel, and Mantel downloads an
 * asset variant from Immich once before serving the local cached copy.
 */
export const GET: RequestHandler = async ({ params, url, request, setHeaders }) => {
	const { assetId } = params;
	if (!UUID_RE.test(assetId)) error(400, 'Invalid asset id');

	const size = (url.searchParams.get('size') ?? 'preview') as ImageSize;
	if (!SIZES.has(size)) error(400, 'Invalid size');
	const connectionId = url.searchParams.get('connection') || undefined;

	const etag = `"${connectionId ?? 'default'}-${assetId}-${size}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304, headers: { ETag: etag } });
	}

	const cached = await getCachedAssetImage(assetId, size, connectionId).catch((cause) => {
		console.error('image cache fill failed:', cause);
		error(502, 'Image unavailable');
	});

	setHeaders({
		'Content-Type': cached.contentType,
		'Cache-Control': 'public, max-age=31536000, immutable',
		ETag: etag
	});
	return new Response(cachedImageBody(cached));
};
