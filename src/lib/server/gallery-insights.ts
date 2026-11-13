import type { DisplayProfile, SlideAsset } from '$lib/types';
import { getAlbums } from './immich';
import { isPortrait } from './playlist-core';

export interface GalleryInsights {
	uniqueAssets: number;
	estimatedCompositions: number;
	estimatedCycleSeconds: number;
	dateFrom: string | null;
	dateTo: string | null;
	orientations: { portrait: number; landscape: number; square: number };
	originalBytes: number;
	originalSizeAssets: number;
	favorites: number;
	rated: number;
	withLocation: number;
	cameras: number;
	recognizedFaces: number;
	recognizedPeople: Array<{ id: string; name: string; appearances: number }>;
	contributors: Array<{ id: string; name: string; role: string }>;
}

function estimateCompositions(profile: DisplayProfile, slides: readonly SlideAsset[]): number {
	const total = slides.length;
	switch (profile.slideshow.layout) {
		case 'mosaic':
			return Math.ceil(total / 6);
		case 'filmstrip':
			return Math.ceil(total / 5);
		case 'instant':
			// The player deliberately alternates one- and two-card arrangements.
			return Math.ceil((total * 3) / 5);
		case 'adaptive': {
			if (profile.slideshow.portraitMode !== 'pair') return total;
			const portraits = slides.filter(isPortrait).length;
			return total - portraits + Math.ceil(portraits / 2);
		}
		default:
			// Random layouts cannot be predicted before playback; the one-photo
			// duration is a conservative upper estimate.
			return total;
	}
}

export async function getGalleryInsights(
	profile: DisplayProfile,
	slides: readonly SlideAsset[]
): Promise<GalleryInsights> {
	let dateFrom: string | null = null;
	let dateTo: string | null = null;
	let originalBytes = 0;
	let originalSizeAssets = 0;
	let portrait = 0;
	let landscape = 0;
	let square = 0;
	let favorites = 0;
	let rated = 0;
	let withLocation = 0;
	let recognizedFaces = 0;
	const cameras = new Set<string>();
	const people = new Map<string, { id: string; name: string; appearances: number }>();
	const contributors = new Map<string, { id: string; name: string; role: string }>();

	for (const slide of slides) {
		if (slide.ratio < 0.95) portrait++;
		else if (slide.ratio > 1.05) landscape++;
		else square++;
		if (slide.takenAt && (!dateFrom || slide.takenAt < dateFrom)) dateFrom = slide.takenAt;
		if (slide.takenAt && (!dateTo || slide.takenAt > dateTo)) dateTo = slide.takenAt;
		if (slide.originalBytes && slide.originalBytes > 0) {
			originalBytes += slide.originalBytes;
			originalSizeAssets++;
		}
		if (slide.isFavorite) favorites++;
		if ((slide.rating ?? 0) > 0) rated++;
		if (slide.location) withLocation++;
		if (slide.camera) cameras.add(slide.camera.split(' · ')[0]);
		if (slide.owner?.name) contributors.set(slide.owner.id, { ...slide.owner, role: 'asset owner' });
		for (const person of slide.people ?? []) {
			recognizedFaces += person.faces;
			const current = people.get(person.id);
			people.set(person.id, {
				id: person.id,
				name: person.name || 'Unnamed person',
				appearances: (current?.appearances ?? 0) + person.faces
			});
		}
	}

	const albumSources = profile.sources.filter((source) => source.type === 'album');
	const connectionIds = [...new Set(albumSources.map((source) => source.connectionId))];
	const albumGroups = await Promise.allSettled(
		connectionIds.map(async (connectionId) => ({ connectionId, albums: await getAlbums(connectionId) }))
	);
	for (const group of albumGroups) {
		if (group.status !== 'fulfilled') continue;
		const selectedIds = new Set(
			albumSources
				.filter((source) => source.connectionId === group.value.connectionId)
				.map((source) => source.albumId)
		);
		for (const album of group.value.albums.filter((item) => selectedIds.has(item.id))) {
			for (const member of album.albumUsers ?? []) {
				contributors.set(member.user.id, {
					id: member.user.id,
					name: member.user.name || member.user.email || 'Immich member',
					role: member.role
				});
			}
		}
	}

	const estimatedCompositions = estimateCompositions(profile, slides);
	return {
		uniqueAssets: slides.length,
		estimatedCompositions,
		estimatedCycleSeconds: estimatedCompositions * profile.slideshow.intervalSec,
		dateFrom,
		dateTo,
		orientations: { portrait, landscape, square },
		originalBytes,
		originalSizeAssets,
		favorites,
		rated,
		withLocation,
		cameras: cameras.size,
		recognizedFaces,
		recognizedPeople: [...people.values()]
			.sort((a, b) => b.appearances - a.appearances || a.name.localeCompare(b.name)),
		contributors: [...contributors.values()].sort((a, b) => a.name.localeCompare(b.name))
	};
}
