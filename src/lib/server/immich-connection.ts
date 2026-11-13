import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { z } from 'zod';

export interface ImmichConnection {
	id: string;
	name: string;
	url: string;
	apiKey: string;
	allowedAlbumIds: string[];
}

export interface ImmichConnectionStatus {
	id: string;
	name: string;
	url: string;
	allowedAlbumIds: string[];
	apiKeyStored: boolean;
	source: 'stored' | 'environment';
}

export interface ImmichConnectionsStatus {
	configured: boolean;
	defaultId: string | null;
	connections: ImmichConnectionStatus[];
}

const connectionSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1).max(60),
	url: z.string().min(1),
	apiKey: z.string().min(1),
	allowedAlbumIds: z.array(z.string()).default([])
});
const storedV3Schema = z.object({
	version: z.literal(3),
	defaultId: z.string().min(1),
	connections: z.array(connectionSchema).min(1)
});
const storedV2Schema = z.object({
	version: z.literal(2),
	defaultId: z.string().min(1),
	connections: z.array(connectionSchema).min(1)
});
const storedV1Schema = z.object({ version: z.literal(1), url: z.string().min(1), apiKey: z.string().min(1) });

interface ConnectionStore {
	defaultId: string | null;
	connections: ImmichConnection[];
}

const dataDir = () => env.DATA_DIR || './data';
const connectionPath = () => path.join(dataDir(), 'immich-connection.json');
let cached: ConnectionStore | undefined;
let writeChain: Promise<unknown> = Promise.resolve();

export function normalizeImmichUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error('Immich URL is required');
	let parsed: URL;
	try { parsed = new URL(trimmed); } catch { throw new Error('Enter a valid Immich URL, including http:// or https://'); }
	if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Immich URL must use http:// or https://');
	if (parsed.username || parsed.password) throw new Error('Do not put credentials in the Immich URL');
	parsed.hash = '';
	parsed.search = '';
	parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(/\/api$/, '') || '/';
	return parsed.toString().replace(/\/$/, '');
}

const ALBUM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeAlbumIds(value: string | string[]): string[] {
	const references = (Array.isArray(value) ? value : value.split(/[\s,]+/))
		.map((item) => item.trim())
		.filter(Boolean);
	const ids = references.map((reference) => {
		if (ALBUM_ID.test(reference)) return reference.toLowerCase();
		try {
			const parts = new URL(reference).pathname.split('/').filter(Boolean);
			const albumIndex = parts.lastIndexOf('albums');
			const id = albumIndex >= 0 ? parts[albumIndex + 1] : '';
			if (ALBUM_ID.test(id)) return id.toLowerCase();
		} catch {
			// The shared validation message below covers malformed URLs and IDs.
		}
		throw new Error(`Invalid Immich album ID or URL: ${reference}`);
	});
	return [...new Set(ids)];
}

function fromEnvironment(): ConnectionStore {
	if (!env.IMMICH_URL || !env.IMMICH_API_KEY) return { defaultId: null, connections: [] };
	const connection: ImmichConnection = {
		id: 'environment', name: 'Immich', url: normalizeImmichUrl(env.IMMICH_URL), apiKey: env.IMMICH_API_KEY.trim(), allowedAlbumIds: []
	};
	return { defaultId: connection.id, connections: [connection] };
}

async function loadStore(): Promise<ConnectionStore> {
	if (cached) return cached;
	try {
		const input = JSON.parse(await fs.readFile(connectionPath(), 'utf8')) as unknown;
		const v3 = storedV3Schema.safeParse(input);
		if (v3.success) {
			cached = { defaultId: v3.data.defaultId, connections: v3.data.connections.map((item) => ({ ...item, url: normalizeImmichUrl(item.url), allowedAlbumIds: normalizeAlbumIds(item.allowedAlbumIds) })) };
			return cached;
		}
		const v2 = storedV2Schema.safeParse(input);
		if (v2.success) {
			cached = { defaultId: v2.data.defaultId, connections: v2.data.connections.map((item) => ({ ...item, url: normalizeImmichUrl(item.url), allowedAlbumIds: [] })) };
			return cached;
		}
		const v1 = storedV1Schema.parse(input);
		const connection: ImmichConnection = { id: 'primary', name: 'Immich', url: normalizeImmichUrl(v1.url), apiKey: v1.apiKey, allowedAlbumIds: [] };
		cached = { defaultId: connection.id, connections: [connection] };
		return cached;
	} catch (error) {
		const fileError = error as NodeJS.ErrnoException;
		if (fileError.code !== 'ENOENT') console.error(`Invalid Immich connections at ${connectionPath()}; using environment fallback`);
		cached = fromEnvironment();
		return cached;
	}
}

async function persist(store: ConnectionStore): Promise<void> {
	if (!store.defaultId || store.connections.length === 0) {
		await fs.rm(connectionPath(), { force: true });
		return;
	}
	writeChain = writeChain.then(async () => {
		await fs.mkdir(dataDir(), { recursive: true });
		const target = connectionPath();
		const temporary = `${target}.tmp`;
		await fs.writeFile(temporary, JSON.stringify({ version: 3, ...store }, null, '\t'), { encoding: 'utf8', mode: 0o600 });
		await fs.rename(temporary, target);
		await fs.chmod(target, 0o600);
	});
	await writeChain;
}

export async function getImmichConnections(): Promise<ImmichConnection[]> {
	return (await loadStore()).connections.slice();
}

export async function getImmichConnection(id?: string | null): Promise<ImmichConnection | null> {
	const store = await loadStore();
	return store.connections.find((connection) => connection.id === (id || store.defaultId)) ?? null;
}

export async function getImmichConnectionStatus(): Promise<ImmichConnectionsStatus> {
	const store = await loadStore();
	const stored = await fs.stat(connectionPath()).then(() => true).catch(() => false);
	return {
		configured: store.connections.length > 0,
		defaultId: store.defaultId,
		connections: store.connections.map(({ id, name, url, allowedAlbumIds }) => ({
			id, name, url, allowedAlbumIds, apiKeyStored: stored && id !== 'environment', source: stored && id !== 'environment' ? 'stored' : 'environment'
		}))
	};
}

export async function saveImmichConnection(input: { id?: string; name: string; url: string; apiKey: string; allowedAlbumIds: string[] }): Promise<ImmichConnection> {
	const store = await loadStore();
	const id = input.id?.trim() || randomUUID();
	const connection = connectionSchema.parse({ id, name: input.name.trim(), url: normalizeImmichUrl(input.url), apiKey: input.apiKey.trim(), allowedAlbumIds: normalizeAlbumIds(input.allowedAlbumIds) });
	const index = store.connections.findIndex((item) => item.id === id);
	if (index >= 0) store.connections[index] = connection;
	else store.connections.push(connection);
	store.defaultId ||= id;
	await persist(store);
	cached = store;
	return connection;
}

export async function clearImmichConnection(id?: string | null): Promise<void> {
	const store = await loadStore();
	if (!id) {
		cached = fromEnvironment();
		await fs.rm(connectionPath(), { force: true });
		return;
	}
	store.connections = store.connections.filter((connection) => connection.id !== id);
	if (store.defaultId === id) store.defaultId = store.connections[0]?.id ?? null;
	await persist(store);
	cached = store.connections.length ? store : fromEnvironment();
}
