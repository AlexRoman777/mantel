import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { defaultProfile, getConfig, updateConfig } from '$lib/server/config';
import { getImmichConnectionStatus } from '$lib/server/immich-connection';
import type { DisplayProfile } from '$lib/types';
import type { RequestHandler } from './$types';

function slugify(value: string): string {
	return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'player';
}

export const GET: RequestHandler = async ({ url }) => {
	const clientId = url.searchParams.get('client')?.slice(0, 80);
	if (!clientId) return json({ error: 'client is required' }, { status: 400 });
	const requested = url.searchParams.get('requested');
	const embedded = url.searchParams.get('embedded') === 'true';
	const width = Number(url.searchParams.get('width'));
	const height = Number(url.searchParams.get('height'));
	const kind = embedded
		? 'Home Assistant player'
		: Number.isFinite(width) && Number.isFinite(height) && height > width
			? 'Mobile player'
			: Number.isFinite(width) && width >= 3000
				? 'TV player'
				: 'Browser player';
	let config = await getConfig();
	const assigned = config.displays.find((profile) => profile.slug === config.clientProfiles[clientId]);
	if (assigned) return json(assigned);

	const explicit = requested && requested !== 'auto' ? config.displays.find((profile) => profile.slug === requested) : null;
	if (explicit) {
		config = await updateConfig((latest) => ({
			...latest,
			clientProfiles: { ...latest.clientProfiles, [clientId]: explicit.slug },
			clientNames: { ...latest.clientNames, [clientId]: latest.clientNames[clientId] || kind }
		}));
		return json(config.displays.find((profile) => profile.slug === explicit.slug));
	}

	let template = config.displays.find((profile) => profile.sources.length > 0) ?? config.displays[0];
	if (!template) {
		template = defaultProfile('family-frame', 'Family frame');
		const immich = await getImmichConnectionStatus();
		const connection = immich.connections.find((item) => item.id === immich.defaultId) ?? immich.connections[0];
		const albumId = connection?.allowedAlbumIds[0];
		if (connection && albumId) template.sources = [{ type: 'album', albumId, name: 'Family album', connectionId: connection.id }];
	}

	let created: DisplayProfile | null = null;
	config = await updateConfig((latest) => {
		const alreadyAssigned = latest.displays.find((profile) => profile.slug === latest.clientProfiles[clientId]);
		if (alreadyAssigned) { created = alreadyAssigned; return latest; }
		let slug = slugify(`${kind}-presentation`);
		let suffix = 2;
		while (latest.displays.some((profile) => profile.slug === slug)) slug = `${slugify(`${kind}-presentation`).slice(0, 35)}-${suffix++}`;
		created = { ...structuredClone(template!), id: randomUUID(), slug, name: `${kind} presentation` };
		return {
			...latest,
			displays: [...latest.displays, created!],
			clientProfiles: { ...latest.clientProfiles, [clientId]: slug },
			clientNames: { ...latest.clientNames, [clientId]: latest.clientNames[clientId] || kind }
		};
	});
	return json(created ?? config.displays.find((profile) => profile.slug === config.clientProfiles[clientId]));
};
