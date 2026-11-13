import type { FaceInfo, InstantSettings, SlideAsset } from '$lib/types';

/** Dimensions shared by SX-70, 600 and i-Type film, expressed in inches. */
export const AUTHENTIC_INSTANT = Object.freeze({
	width: 3.483,
	height: 4.233,
	imageWidth: 3.108,
	imageHeight: 3.024
});

export const AUTHENTIC_SIDE_BORDER_PCT = Number(
	(((AUTHENTIC_INSTANT.width - AUTHENTIC_INSTANT.imageWidth) / 2 / AUTHENTIC_INSTANT.width) * 100).toFixed(2)
);

export const AUTHENTIC_BOTTOM_BORDER_PCT = Number(
	(((AUTHENTIC_INSTANT.height - AUTHENTIC_INSTANT.imageHeight - (AUTHENTIC_INSTANT.width - AUTHENTIC_INSTANT.imageWidth) / 2)
		/ AUTHENTIC_INSTANT.width) * 100).toFixed(2)
);

/** Outer card width / height for the selected opening and paper borders. */
export function instantCardAspectRatio(settings: Pick<InstantSettings, 'paperSideBorderPct' | 'paperBottomBorderPct'>): number {
	const openingWidth = 1 - (settings.paperSideBorderPct * 2) / 100;
	const openingHeight = openingWidth * (AUTHENTIC_INSTANT.imageHeight / AUTHENTIC_INSTANT.imageWidth);
	const totalHeight = settings.paperSideBorderPct / 100 + openingHeight + settings.paperBottomBorderPct / 100;
	return 1 / totalHeight;
}

export function instantTurn(
	settings: Pick<InstantSettings, 'maxAngleDeg' | 'anglePattern' | 'arrangement' | 'cardCount'>,
	seed: number,
	index: number,
	galleryLength: number
): number {
	if (settings.maxAngleDeg === 0) return 0;
	const hash = Math.imul((seed + 11) ^ Math.imul(index + 5, 0x45d9f3b), 0x27d4eb2d) >>> 0;
	const magnitude = settings.maxAngleDeg * (0.35 + ((hash % 651) / 1000));
	let direction = (seed + index) % 2 === 0 ? -1 : 1;
	if (settings.anglePattern !== 'random') {
		const arrangementPositions: Record<InstantSettings['arrangement'], number[]> = {
			classic: [],
			gallery: [],
			'hero-stack': [0.37, 0.63, 0.18, 0.5, 0.82],
			scattered: [0.24, 0.55, 0.78, 0.35, 0.68]
		};
		const orderedRow = settings.arrangement === 'classic' || settings.arrangement === 'gallery';
		const position = orderedRow
			? (index + 0.5) / Math.max(1, Math.min(settings.cardCount, galleryLength))
			: arrangementPositions[settings.arrangement][index] ?? 0.5;
		const inwardDirection = position < 0.48 ? 1 : position > 0.52 ? -1 : direction;
		direction = settings.anglePattern === 'outward-v' ? inwardDirection * -1 : inwardDirection;
	}
	return Number((magnitude * direction).toFixed(2));
}

export function formatInstantDate(value: string): string {
	// Immich localDateTime is the camera's wall-clock time. Read its ISO fields
	// directly so viewing in another timezone never changes the printed moment.
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
	if (!match) return '';
	const year = Number(match[1]);
	const monthNumber = Number(match[2]);
	const day = Number(match[3]);
	const calendarDate = new Date(Date.UTC(year, monthNumber - 1, day));
	if (
		calendarDate.getUTCFullYear() !== year
		|| calendarDate.getUTCMonth() !== monthNumber - 1
		|| calendarDate.getUTCDate() !== day
	) return '';
	const tens = day % 100;
	const suffix = tens >= 11 && tens <= 13
		? 'th'
		: day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
	const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(calendarDate);
	const month = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(calendarDate);
	const recordedTime = match[4] && match[5] ? ` at ${match[4]}:${match[5]}` : '';
	return `${weekday} ${day}${suffix} of ${month}, ${year}${recordedTime}`;
}

export function instantImageStyle(image: SlideAsset, imageFaces: FaceInfo[]): string {
	if (!imageFaces.length) return 'object-fit: cover; object-position: 50% 50%';
	const left = Math.max(0, Math.min(...imageFaces.map((face) => face.centerX - face.width / 2)));
	const right = Math.min(1, Math.max(...imageFaces.map((face) => face.centerX + face.width / 2)));
	const top = Math.max(0, Math.min(...imageFaces.map((face) => face.centerY - face.height / 2)));
	const bottom = Math.min(1, Math.max(...imageFaces.map((face) => face.centerY + face.height / 2)));
	const centerX = (left + right) / 2;
	const centerY = (top + bottom) / 2;
	const openingRatio = AUTHENTIC_INSTANT.imageWidth / AUTHENTIC_INSTANT.imageHeight;
	const visibleWidth = image.ratio > openingRatio ? openingRatio / image.ratio : 1;
	const visibleHeight = image.ratio < openingRatio ? image.ratio / openingRatio : 1;
	const facesFit = right - left <= visibleWidth * 0.86 && bottom - top <= visibleHeight * 0.86;
	if (!facesFit) return 'object-fit: contain; object-position: 50% 50%';

	let x = 0.5;
	let y = 0.5;
	if (visibleWidth < 1) x = Math.max(0, Math.min(1, (centerX - visibleWidth / 2) / (1 - visibleWidth)));
	if (visibleHeight < 1) y = Math.max(0, Math.min(1, (centerY - visibleHeight / 2) / (1 - visibleHeight)));
	return `object-fit: cover; object-position: ${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%`;
}
