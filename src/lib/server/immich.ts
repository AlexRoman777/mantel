// Typed client for the Immich API. All requests happen server-side; the API key
// never reaches the browser. Endpoint choices favor paths that are stable across
// Immich v1.1xx/v2/v3 (notably POST /search/metadata for album/person assets,
// since v3 removed the `assets` array from GET /albums/{id}).

import { getImmichConnection, type ImmichConnection } from './immich-connection';

// ---- Immich DTOs (only the fields we consume) ----

export interface ImmichExifInfo {
	dateTimeOriginal: string | null;
	city: string | null;
	state: string | null;
	country: string | null;
	make: string | null;
	model: string | null;
	fNumber: number | null;
	focalLength: number | null;
	exifImageWidth: number | null;
	exifImageHeight: number | null;
	orientation: string | null;
	fileSizeInByte?: number | null;
	latitude?: number | null;
	longitude?: number | null;
}

export interface ImmichUserSummary {
	id: string;
	name: string;
	email?: string;
}

export interface ImmichAssetPerson {
	id: string;
	name: string;
	faces?: unknown[];
}

export interface ImmichAsset {
	id: string;
	type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'OTHER';
	isArchived?: boolean;
	isTrashed?: boolean;
	visibility?: string;
	thumbhash: string | null;
	localDateTime: string | null;
	isFavorite?: boolean;
	rating?: number | null;
	exifInfo?: ImmichExifInfo | null;
	owner?: ImmichUserSummary | null;
	people?: ImmichAssetPerson[];
}

export interface ImmichAlbum {
	id: string;
	albumName: string;
	description: string;
	assetCount: number;
	albumThumbnailAssetId: string | null;
	updatedAt?: string;
	albumUsers?: Array<{ role: string; user: ImmichUserSummary }>;
}

export interface ImmichPerson {
	id: string;
	name: string;
	isHidden: boolean;
	isFavorite?: boolean;
	birthDate?: string | null;
}

export interface ImmichAssetFace {
	id: string;
	imageHeight: number;
	imageWidth: number;
	boundingBoxX1: number;
	boundingBoxX2: number;
	boundingBoxY1: number;
	boundingBoxY2: number;
	person: ImmichPerson | null;
}

export interface ImmichMemory {
	id: string;
	type: string;
	data: { year: number };
	assets: ImmichAsset[];
}

export interface ImmichAssetStatistics {
	images: number;
	videos: number;
	total: number;
}

export interface ImmichAlbumStatistics {
	owned: number;
	shared: number;
	notShared: number;
}

interface SearchMetadataResponse {
	assets: {
		items: ImmichAsset[];
		nextPage: string | null;
		total: number;
		count: number;
	};
}

export function resolveScopedAlbumIds(
	allowedAlbumIds: readonly string[],
	requestedAlbumIds?: readonly string[]
): string[] | undefined {
	if (allowedAlbumIds.length === 0) return requestedAlbumIds ? [...requestedAlbumIds] : undefined;
	if (requestedAlbumIds?.some((id) => !allowedAlbumIds.includes(id))) {
		throw new Error('This album is not allowed for the selected Immich connection');
	}
	return requestedAlbumIds?.length ? [...requestedAlbumIds] : [...allowedAlbumIds];
}

export class ImmichError extends Error {
	constructor(
		public status: number,
		public path: string,
		message: string
	) {
		super(`Immich ${status} on ${path}: ${message}`);
		this.name = 'ImmichError';
	}
}

async function requiredConnection(connectionId?: string | null): Promise<ImmichConnection> {
	const connection = await getImmichConnection(connectionId);
	if (!connection) throw new Error('Immich is not configured. Open Mantel settings to connect it.');
	return connection;
}

// A stalled Immich must fail a request, not hold a player's slide load open
// indefinitely: the browser waits on these through Mantel's own endpoints.
const API_TIMEOUT_MS = 45_000;
const IMAGE_TIMEOUT_MS = 120_000;

async function apiWithConnection<T>(
	connection: Pick<ImmichConnection, 'url' | 'apiKey'>,
	path: string,
	init?: RequestInit
): Promise<T> {
	const res = await fetch(`${connection.url}/api${path}`, {
		signal: AbortSignal.timeout(API_TIMEOUT_MS),
		...init,
		headers: {
			'x-api-key': connection.apiKey,
			Accept: 'application/json',
			...(init?.body ? { 'Content-Type': 'application/json' } : {}),
			...init?.headers
		}
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new ImmichError(res.status, path, body.slice(0, 300));
	}
	return res.json() as Promise<T>;
}

async function api<T>(path: string, init?: RequestInit, connectionId?: string): Promise<T> {
	return apiWithConnection(await requiredConnection(connectionId), path, init);
}

// ---- Endpoints ----

export function ping(connectionId?: string): Promise<{ res: string }> {
	return api('/server/ping', undefined, connectionId);
}

export async function getAlbums(connectionId?: string): Promise<ImmichAlbum[]> {
	const connection = await requiredConnection(connectionId);
	if (connection.allowedAlbumIds.length === 0) {
		return apiWithConnection(connection, '/albums');
	}
	return Promise.all(
		connection.allowedAlbumIds.map((albumId) =>
			apiWithConnection<ImmichAlbum>(connection, `/albums/${encodeURIComponent(albumId)}`)
		)
	);
}

export function getAssetStatistics(connectionId?: string): Promise<ImmichAssetStatistics> {
	return api('/assets/statistics', undefined, connectionId);
}

export function getAlbumStatistics(connectionId?: string): Promise<ImmichAlbumStatistics> {
	return api('/albums/statistics', undefined, connectionId);
}

export async function getPeople(connectionId?: string): Promise<ImmichPerson[]> {
	const res = await api<{ people: ImmichPerson[]; total: number }>(
		'/people?withHidden=false&size=500', undefined, connectionId
	);
	return res.people.filter((p) => !p.isHidden);
}

export function getMemories(forDate: string, connectionId?: string): Promise<ImmichMemory[]> {
	return api(`/memories?for=${encodeURIComponent(forDate)}&type=on_this_day`, undefined, connectionId);
}

/**
 * Paginated metadata search — the version-robust way to enumerate album or
 * person assets. Pages are 1-based; returns nextPage as a string or null.
 */
export function searchMetadata(query: {
	albumIds?: string[];
	personIds?: string[];
	connectionId?: string;
	page?: number;
	size?: number;
}): Promise<SearchMetadataResponse> {
	return requiredConnection(query.connectionId).then((connection) => {
		const albumIds = resolveScopedAlbumIds(connection.allowedAlbumIds, query.albumIds);
		return apiWithConnection<SearchMetadataResponse>(connection, '/search/metadata', {
		method: 'POST',
		body: JSON.stringify({
			type: 'IMAGE',
			withExif: true,
			withPeople: true,
			visibility: 'timeline',
			size: query.size ?? 250,
			page: query.page ?? 1,
			...(albumIds?.length ? { albumIds } : {}),
			...(query.personIds?.length ? { personIds: query.personIds } : {})
		})
		});
	});
}

/** Stream asset image bytes (preview/thumbnail) from Immich. */
export async function fetchAssetImage(
	assetId: string,
	size: 'preview' | 'thumbnail' | 'fullsize',
	connectionId?: string
): Promise<Response> {
	const connection = await requiredConnection(connectionId);
	return fetch(`${connection.url}/api/assets/${assetId}/thumbnail?size=${size}`, {
		headers: { 'x-api-key': connection.apiKey },
		signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS)
	});
}

/** Stream a person's face thumbnail from Immich. */
export async function fetchPersonThumbnail(personId: string, connectionId?: string): Promise<Response> {
	const connection = await requiredConnection(connectionId);
	return fetch(`${connection.url}/api/people/${personId}/thumbnail`, {
		headers: { 'x-api-key': connection.apiKey },
		signal: AbortSignal.timeout(API_TIMEOUT_MS)
	});
}

/** Face boxes and named-person data for one asset. Requires Immich face.read. */
export function getAssetFaces(assetId: string, connectionId?: string): Promise<ImmichAssetFace[]> {
	return api(`/faces?id=${encodeURIComponent(assetId)}`, undefined, connectionId);
}

/** Validate every permission used by Mantel before persisting a new key. */
export async function testImmichConnection(connection: Pick<ImmichConnection, 'url' | 'apiKey' | 'allowedAlbumIds'>): Promise<{
	albums: number;
	albumNames: string[];
	people: number;
	assetStatistics: ImmichAssetStatistics;
	albumStatistics: ImmichAlbumStatistics;
}> {
	await apiWithConnection<{ res: string }>(connection, '/server/ping');
	const [albums, people, assetStatistics, albumStatistics] = await Promise.all([
		Promise.all(connection.allowedAlbumIds.map((albumId) =>
			apiWithConnection<ImmichAlbum>(connection, `/albums/${encodeURIComponent(albumId)}`)
		)),
		apiWithConnection<{ people: ImmichPerson[]; total: number }>(
			connection,
			'/people?withHidden=false&size=1'
		),
		apiWithConnection<ImmichAssetStatistics>(connection, '/assets/statistics'),
		apiWithConnection<ImmichAlbumStatistics>(connection, '/albums/statistics')
	]);
	await apiWithConnection<ImmichMemory[]>(
		connection,
		`/memories?for=${new Date().toISOString().slice(0, 10)}&type=on_this_day`
	);
	const search = await apiWithConnection<SearchMetadataResponse>(connection, '/search/metadata', {
		method: 'POST',
		body: JSON.stringify({ type: 'IMAGE', withExif: true, visibility: 'timeline', albumIds: connection.allowedAlbumIds, size: 1, page: 1 })
	});
	const firstAsset = search.assets.items[0];
	if (firstAsset) {
		const thumbnail = await fetch(
			`${connection.url}/api/assets/${firstAsset.id}/thumbnail?size=thumbnail`,
			{ headers: { 'x-api-key': connection.apiKey } }
		);
		if (!thumbnail.ok) {
			throw new ImmichError(thumbnail.status, `/assets/${firstAsset.id}/thumbnail`, 'image access failed');
		}
		await thumbnail.body?.cancel();
		await apiWithConnection<ImmichAssetFace[]>(connection, `/faces?id=${firstAsset.id}`);
	}
	return { albums: albums.length, albumNames: albums.map((album) => album.albumName), people: people.total, assetStatistics, albumStatistics };
}
