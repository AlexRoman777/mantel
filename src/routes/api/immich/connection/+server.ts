import { json } from '@sveltejs/kit';
import { clearFaceCache } from '#lib/server/face-cache.js';
import { clearImageCache } from '#lib/server/image-cache.js';
import {
	clearImmichConnection,
	getImmichConnection,
	getImmichConnectionStatus,
	normalizeAlbumIds,
	normalizeImmichUrl,
	saveImmichConnection
} from '#lib/server/immich-connection.js';
import { ImmichError, testImmichConnection } from '#lib/server/immich.js';
import { clearPlaylistCache } from '#lib/server/playlist.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await getImmichConnectionStatus());

export const PUT: RequestHandler = async ({ request }) => {
	let input: { id?: unknown; name?: unknown; url?: unknown; apiKey?: unknown; allowedAlbums?: unknown };
	try {
		input = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	if (typeof input.url !== 'string' || typeof input.name !== 'string' || (input.id != null && typeof input.id !== 'string') || (input.apiKey !== undefined && typeof input.apiKey !== 'string') || (input.allowedAlbums !== undefined && typeof input.allowedAlbums !== 'string' && !Array.isArray(input.allowedAlbums))) {
		return json({ error: 'Connection name, Immich URL, API key and allowed albums must be text' }, { status: 400 });
	}

	try {
		const current = await getImmichConnection(typeof input.id === 'string' ? input.id : undefined);
		const allowedAlbumIds = input.allowedAlbums === undefined
			? current?.allowedAlbumIds ?? []
			: normalizeAlbumIds(input.allowedAlbums as string | string[]);
		if (allowedAlbumIds.length === 0) {
			return json({ error: 'Add at least one allowed Immich album ID or album URL' }, { status: 400 });
		}
		const candidate = {
			id: typeof input.id === 'string' && input.id ? input.id : undefined,
			name: input.name.trim(),
			url: normalizeImmichUrl(input.url),
			apiKey: input.apiKey?.trim() || current?.apiKey || '',
			allowedAlbumIds
		};
		if (!candidate.apiKey) return json({ error: 'Immich API key is required' }, { status: 400 });
		const result = await testImmichConnection(candidate);
		const changed = !current || current.url !== candidate.url || current.apiKey !== candidate.apiKey || current.allowedAlbumIds.join(',') !== candidate.allowedAlbumIds.join(',');
		const savedConnection = await saveImmichConnection(candidate);
		if (changed) {
			await clearPlaylistCache();
			await Promise.all([clearImageCache(), clearFaceCache()]);
		}
		return json({ ...(await getImmichConnectionStatus()), savedConnectionId: savedConnection.id, ...result });
	} catch (error) {
		const message =
			error instanceof ImmichError
				? `Immich rejected the connection (${error.status}) on ${error.path}. Check the API-key permissions.`
				: error instanceof Error
					? error.message
					: 'Could not connect to Immich';
		return json({ error: message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ url }) => {
	await clearImmichConnection(url.searchParams.get('id'));
	await clearPlaylistCache();
	await Promise.all([clearImageCache(), clearFaceCache()]);
	return json(await getImmichConnectionStatus());
};
