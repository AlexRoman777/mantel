import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { defaultProfile, updateConfig } from '$lib/server/config';
import type { RequestHandler } from './$types';

function slugify(name: string): string {
	return name
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
}

/** Create a new presentation, optionally cloning an existing one. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { name?: string; copyFrom?: string } | null;
	const name = body?.name?.trim();
	if (!name) return json({ error: 'Name is required' }, { status: 400 });

	let createdSlug = '';
	let sourceMissing = false;
	const saved = await updateConfig((config) => {
		let slug = slugify(name) || 'display';
		let suffix = 2;
		while (config.displays.some((display) => display.slug === slug)) {
			slug = `${(slugify(name) || 'display').slice(0, 36)}-${suffix++}`.slice(0, 40);
		}

		const source = body?.copyFrom
			? config.displays.find((display) => display.slug === body.copyFrom)
			: null;
		if (body?.copyFrom && !source) {
			sourceMissing = true;
			return config;
		}
		const profile = source
			? { ...structuredClone(source), id: randomUUID(), slug, name }
			: defaultProfile(slug, name);
		createdSlug = slug;
		return { ...config, displays: [...config.displays, profile] };
	});
	if (sourceMissing) return json({ error: 'Presentation to copy was not found' }, { status: 404 });
	return json(saved.displays.find((display) => display.slug === createdSlug), { status: 201 });
};
