import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as env from '$app/env/private';
import type { FaceInfo } from '#lib/types.js';
import { getAssetFaces } from './immich';

const inflight = new Map<string, Promise<FaceInfo[]>>();

function cacheDir(): string {
	return path.join(env.DATA_DIR || './data', 'face-cache');
}

function cachePath(assetId: string, connectionId?: string): string {
	const scope = connectionId ? `${connectionId.replace(/[^a-zA-Z0-9_-]/g, '_')}-` : '';
	return path.join(cacheDir(), `${scope}${assetId}.json`);
}

function ageAtDate(birthDate: string | null | undefined, takenAt: string | null): number | null {
	if (!birthDate || !takenAt) return null;
	const born = new Date(`${birthDate}T00:00:00`);
	const photo = new Date(takenAt);
	if (Number.isNaN(born.valueOf()) || Number.isNaN(photo.valueOf()) || photo < born) return null;
	let age = photo.getFullYear() - born.getFullYear();
	if (
		photo.getMonth() < born.getMonth() ||
		(photo.getMonth() === born.getMonth() && photo.getDate() < born.getDate())
	) age--;
	return age;
}

async function read(assetId: string, connectionId?: string): Promise<FaceInfo[] | null> {
	try {
		const raw = JSON.parse(await fs.readFile(cachePath(assetId, connectionId), 'utf8')) as { faces?: FaceInfo[] };
		return Array.isArray(raw.faces) ? raw.faces : null;
	} catch {
		return null;
	}
}

async function download(assetId: string, takenAt: string | null, connectionId?: string): Promise<FaceInfo[]> {
	const hit = await read(assetId, connectionId);
	if (hit) return hit;
	const faces = (await getAssetFaces(assetId, connectionId)).map((face) => {
		const width = Math.max(1, face.imageWidth);
		const height = Math.max(1, face.imageHeight);
		return {
			id: face.id,
			personId: face.person?.id ?? null,
			name: face.person?.name || null,
			birthDate: face.person?.birthDate ?? null,
			ageAtPhoto: ageAtDate(face.person?.birthDate, takenAt),
			centerX: ((face.boundingBoxX1 + face.boundingBoxX2) / 2) / width,
			centerY: ((face.boundingBoxY1 + face.boundingBoxY2) / 2) / height,
			width: Math.max(0, face.boundingBoxX2 - face.boundingBoxX1) / width,
			height: Math.max(0, face.boundingBoxY2 - face.boundingBoxY1) / height
		};
	});
	const target = cachePath(assetId, connectionId);
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(target, JSON.stringify({ faces }), 'utf8');
	return faces;
}

/** Persist face metadata so an asset is not queried from Immich on every display cycle. */
export function getCachedFaces(assetId: string, takenAt: string | null, connectionId?: string): Promise<FaceInfo[]> {
	const key = `${connectionId ?? 'default'}:${assetId}`;
	const existing = inflight.get(key);
	if (existing) return existing;
	const request = download(assetId, takenAt, connectionId).finally(() => inflight.delete(key));
	inflight.set(key, request);
	return request;
}

export async function clearFaceCache(): Promise<void> {
	inflight.clear();
	await fs.rm(cacheDir(), { recursive: true, force: true });
}
