import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { BLOCK_KINDS, getMapBlock, SENTINEL_MAX_LEVEL, type BlockKind } from '$lib/server/map-tiles';
import type { RequestHandler } from './$types';

/**
 * One imagery block: Sentinel-2 close-ups, or the Blue Marble / relief
 * backdrop. All three pyramids share one latitude/longitude grid and live in
 * the mounted map directory, so the container image stays small.
 */
export const GET: RequestHandler = async ({ params, setHeaders }) => {
	const kind = params.kind as BlockKind;
	if (!BLOCK_KINDS.includes(kind)) error(400, 'Unknown imagery');
	const z = Number(params.z);
	const x = Number(params.x);
	const y = Number(params.y);
	const columns = 2 ** (z + 1);
	if (![z, x, y].every(Number.isInteger) || z < 0 || z > SENTINEL_MAX_LEVEL || x < 0 || y < 0 || x >= columns || y >= columns / 2) {
		error(400, 'Invalid block');
	}
	const file = await getMapBlock(kind, z, x, y);
	if (!file) error(404, 'Imagery unavailable');
	setHeaders({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' });
	return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream);
};
