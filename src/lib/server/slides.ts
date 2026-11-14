import type { SlideAsset } from '#lib/types.js';
import type { ImmichAsset } from './immich';

/** EXIF orientations 5–8 are rotated 90°/270°: width and height swap. */
export function orientationRotatesDimensions(orientation: string | null | undefined): boolean {
	if (!orientation) return false;
	const numeric = Number(orientation);
	if (Number.isFinite(numeric)) return numeric >= 5 && numeric <= 8;
	const normalized = orientation.toLowerCase().replace(/[_-]+/g, ' ').trim();
	return (
		/\b(90|270)\b/.test(normalized) ||
		['left top', 'right top', 'right bottom', 'left bottom'].includes(normalized)
	);
}

export function toSlideAsset(asset: ImmichAsset, memoryYearsAgo?: number, connectionId?: string): SlideAsset {
	const exif = asset.exifInfo;
	const lat = exif?.latitude;
	const lon = exif?.longitude;
	const hasCoordinates = typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
		&& typeof lon === 'number' && Number.isFinite(lon) && Math.abs(lon) <= 180
		&& (lat !== 0 || lon !== 0);

	let ratio = 3 / 2;
	if (exif?.exifImageWidth && exif?.exifImageHeight) {
		ratio = orientationRotatesDimensions(exif.orientation)
			? exif.exifImageHeight / exif.exifImageWidth
			: exif.exifImageWidth / exif.exifImageHeight;
	}

	const location =
		[exif?.city, exif?.country].filter(Boolean).join(', ') || null;

	let camera: string | null = null;
	if (exif?.make || exif?.model) {
		// Some vendors repeat the make inside the model ("Canon Canon EOS R5")
		const model = exif.model ?? '';
		const name = model.toLowerCase().includes((exif.make ?? '').toLowerCase())
			? model
			: [exif.make, model].filter(Boolean).join(' ');
		const lens = [
			exif.focalLength ? `${Math.round(exif.focalLength)}mm` : null,
			exif.fNumber ? `f/${exif.fNumber}` : null
		]
			.filter(Boolean)
			.join(' ');
		camera = lens ? `${name} · ${lens}` : name;
	}

	return {
		id: asset.id,
		...(connectionId ? { connectionId } : {}),
		ratio,
		thumbhash: asset.thumbhash,
		takenAt: exif?.dateTimeOriginal ?? asset.localDateTime,
		location,
		...(hasCoordinates ? { lat, lon }
			: {}),
		camera,
		isFavorite: asset.isFavorite ?? false,
		rating: asset.rating ?? null,
		originalBytes: exif?.fileSizeInByte ?? null,
		owner: asset.owner ? { id: asset.owner.id, name: asset.owner.name } : null,
		people: (asset.people ?? []).map((person) => ({
			id: person.id,
			name: person.name,
			faces: Math.max(1, person.faces?.length ?? 0)
		})),
		...(memoryYearsAgo !== undefined ? { memoryYearsAgo } : {})
	};
}

/** Keep only displayable images (no videos, trash, or archived assets). */
export function isDisplayable(asset: ImmichAsset): boolean {
	if (asset.type !== 'IMAGE') return false;
	if (asset.isTrashed || asset.isArchived) return false;
	if (asset.visibility && asset.visibility !== 'timeline') return false;
	return true;
}
