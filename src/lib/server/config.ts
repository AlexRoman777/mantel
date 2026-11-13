// Config persistence: a single JSON file in DATA_DIR (a mounted volume in
// Docker). Zod-validated on every read/write; a corrupt file is backed up and
// replaced with defaults rather than crash-looping an unattended photo frame.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import type { AppConfig, DisplayProfile, MapSettings } from '$lib/types';

const cornerSchema = z.enum([
	'top-left', 'top-center', 'top-right',
	'middle-left', 'center', 'middle-right',
	'bottom-left', 'bottom-center', 'bottom-right'
]);
const textAppearanceSchema = z.object({
	scale: z.number().min(0.5).max(3),
	colorMode: z.enum(['light', 'dark', 'custom', 'inverse']),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
});
const widgetBase = {
	id: z.string().min(1),
	enabled: z.boolean(),
	position: cornerSchema,
	appearance: textAppearanceSchema,
	presentation: z.enum(['card', 'ticker-top', 'ticker-bottom']),
	tickerSpeedSec: z.number().int().min(3).max(120)
};

const widgetSchema = z.discriminatedUnion('type', [
	z.object({
		...widgetBase,
		type: z.literal('message'),
		text: z.string().max(500)
	}),
	z.object({ ...widgetBase, type: z.literal('quote'), refreshMinutes: z.number().int().min(15).max(60) }),
	z.object({ ...widgetBase, type: z.literal('trivia'), refreshMinutes: z.number().int().min(15).max(60) }),
	z.object({
		...widgetBase,
		type: z.literal('school-meals'),
		schoolSlug: z.string().regex(/^[a-z0-9-]{1,100}$/),
		title: z.string().max(80)
	}),
	z.object({
		...widgetBase,
		type: z.literal('sl-departures'),
		title: z.string().max(80),
		siteIds: z.array(z.number().int().min(1).max(9_999_999)).min(1).max(6),
		maxDepartures: z.number().int().min(2).max(12),
		showTrains: z.boolean(),
		showBuses: z.boolean()
	})
]);

const sourceSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('album'), albumId: z.string().min(1), name: z.string(), connectionId: z.string().min(1).optional() }),
	z.object({ type: z.literal('person'), personId: z.string().min(1), name: z.string(), connectionId: z.string().min(1).optional() }),
	z.object({ type: z.literal('random'), connectionId: z.string().min(1).optional() }),
	z.object({ type: z.literal('memories'), connectionId: z.string().min(1).optional() })
]);

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const profileSchema = z.object({
	id: z.string().min(1),
	slug: z
		.string()
		.regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'lowercase letters, digits and dashes only'),
	name: z.string().min(1).max(60),
	sources: z.array(sourceSchema),
	slideshow: z.object({
		intervalSec: z.number().int().min(3).max(3600),
		pauseResumeMin: z.number().int().min(0).max(240).default(5),
		transition: z.enum(['none', 'crossfade', 'kenburns', 'slide', 'zoom', 'wipe', 'card', 'reveal', 'random']),
		transitionDurationMs: z.number().int().min(200).max(10000),
		order: z.enum(['random', 'newest', 'oldest']),
		portraitMode: z.enum(['blur-fill', 'pair']),
		layout: z.enum(['single', 'adaptive', 'portrait-stack', 'mosaic', 'filmstrip', 'instant', 'map', 'random']),
		mixedPortraitSide: z.enum(['left', 'right', 'alternate']),
		visualEffect: z.enum(['natural', 'warm', 'vivid', 'monochrome', 'negative', 'kodak', 'fuji', 'instant', 'art', 'noir', 'random']),
		motionStyle: z.enum([
			'off', 'gentle', 'cinematic', 'dynamic', 'drift', 'push-in', 'pull-out',
			'face-push-in', 'face-pull-out', 'face-journey', 'random'
		]),
		imageSize: z.enum(['preview', 'fullsize']),
		imageFit: z.enum(['contain', 'cover']),
		progressBar: z.enum(['off', 'top', 'bottom']),
		focusMode: z.enum(['photo', 'person']),
		faceZoom: z.number().min(1).max(6),
		frameInsetPx: z.number().int().min(0).max(300),
		photoGapPx: z.number().int().min(0).max(100),
		cornerRadiusPx: z.number().int().min(0).max(200),
		frameStyle: z.enum(['none', 'white', 'black', 'walnut', 'aluminium']),
		frameWidthPx: z.number().int().min(0).max(200),
		matWidthPx: z.number().int().min(0).max(300),
		matColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
		borderWidthPx: z.number().int().min(0).max(30),
		borderColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
		backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
		instant: z.object({
			arrangement: z.enum(['classic', 'hero-stack', 'scattered', 'gallery']),
			cardCount: z.number().int().min(1).max(5),
			cardScalePct: z.number().int().min(35).max(140),
			overlapPct: z.number().int().min(0).max(60),
			cardGapPx: z.number().int().min(0).max(240),
			maxAngleDeg: z.number().int().min(0).max(18),
			anglePattern: z.enum(['random', 'inward-v', 'outward-v']),
			paperRadiusPx: z.number().int().min(0).max(48),
			photoRadiusPx: z.number().int().min(0).max(36),
			paperSideBorderPct: z.number().min(1).max(15),
			paperBottomBorderPct: z.number().min(10).max(45),
			paperFinish: z.enum(['authentic', 'matte', 'glossy', 'warm']),
			visualEffect: z.enum(['natural', 'warm', 'vivid', 'monochrome', 'negative', 'kodak', 'fuji', 'instant', 'art', 'noir', 'random']),
			transition: z.enum(['none', 'fade', 'deal', 'develop', 'drop', 'random']),
			transitionDurationMs: z.number().int().min(300).max(5000),
			background: z.enum([
				'original', 'black', 'leather', 'cork', 'walnut', 'linen', 'felt', 'slate', 'metal',
				'bronze', 'travertine', 'marble', 'onyx', 'red-velvet', 'metal-mesh', 'indigo-plaster', 'terrazzo',
				'collage', 'collage-saved'
			]),
			captionFont: z.enum(['caveat', 'kalam', 'serif', 'mono']),
			captionScalePct: z.number().int().min(60).max(300),
			backgroundRestEnabled: z.boolean(),
			backgroundRestMinutes: z.number().int().min(1).max(5),
			backgroundRestSeconds: z.number().int().min(3).max(30),
			showDateTime: z.boolean(),
			showLocation: z.boolean(),
			showCamera: z.boolean(),
			showRating: z.boolean(),
			showPeople: z.boolean(),
			showAge: z.boolean()
		}),
		map: z.object({
			view: z.enum(['globe', 'flat']),
			renderer: z.enum(['shader', 'three']),
			theme: z.enum(['midnight', 'atlas', 'ink']),
			earthTexture: z.enum(['none', 'satellite', 'relief']),
			seasonalTexture: z.boolean(),
			imageryDetail: z.enum(['blue-marble', 'sentinel']),
			osmDetail: z.boolean(),
			lighting: z.enum(['studio', 'sun']),
			nightLights: z.boolean(),
			detailLayers: z.boolean(),
			holdSec: z.number().int().min(5).max(60),
			flightSec: z.number().min(1).max(8),
			worldDwellSec: z.number().min(0).max(15),
			// Accept the former 40 km minimum so existing saved profiles continue to load.
			// The current controller intentionally starts at the supported 50 km view.
			zoomKm: z.number().int().min(40).max(4000),
			photoStyle: z.enum(['fullscreen', 'card', 'split']),
			splitMapPct: z.number().int().min(30).max(70),
			splitFill: z.enum(['always', 'landscape', 'portrait', 'never']),
			splitBackground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
			splitFade: z.boolean(),
			splitFadePct: z.number().int().min(0).max(20),
			photoScalePct: z.number().int().min(20).max(90),
			photoFrame: z.enum(['none', 'thin', 'instant']),
			photoBorderPx: z.number().int().min(0).max(40),
			photoBorderColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
			photoRadiusPx: z.number().int().min(0).max(80),
			photoShadow: z.boolean(),
			photoEdge: z.enum(['sharp', 'feather']),
			photoDepth: z.enum(['flat', 'lift', 'tilt']),
			photoPlacement: z.enum(['near-pin', 'side']),
			showMarkers: z.boolean(),
			showLabels: z.boolean(),
			labelScalePct: z.number().int().min(60).max(220),
			labelMinPopulation: z.number().int().min(0).max(1_000_000),
			labelMaxCount: z.number().int().min(0).max(40),
			showGraticule: z.boolean(),
			idleSpin: z.boolean(),
			showMinimap: z.boolean(),
			showCaption: z.boolean(),
			showOverlays: z.boolean(),
			trivia: z.enum(['off', 'facts', 'online']),
			triviaDetail: z.enum(['short', 'full']),
			cardScalePct: z.number().int().min(60).max(220),
			triviaPosition: z.enum(['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']),
			triviaWidthPct: z.number().int().min(16).max(60),
			triviaMaxHeightPct: z.number().int().min(20).max(90),
			triviaUseThemeColors: z.boolean(),
			triviaTextColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
			triviaBackgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
			triviaAccentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
			triviaBackgroundOpacityPct: z.number().int().min(20).max(100),
			triviaBorderColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
			triviaBorderWidthPx: z.number().int().min(0).max(12),
			triviaRadiusPx: z.number().int().min(0).max(80),
			triviaPaddingPx: z.number().int().min(8).max(64),
			triviaBlurPx: z.number().int().min(0).max(40),
			triviaShadow: z.boolean(),
			home: z.object({ name: z.string().max(120), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).nullable()
		})
	}),
	filters: z.object({
		orientation: z.enum(['all', 'landscape', 'portrait']),
		dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
		dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
		favoritesOnly: z.boolean(),
		minRating: z.number().int().min(0).max(5),
		newestLimit: z.number().int().min(0).max(100_000),
		peopleMatch: z.enum(['any', 'all'])
	}),
	overlays: z.object({
		autoHideSec: z.number().int().min(0).max(300),
		clock: z.object({
			enabled: z.boolean(),
			style: z.enum(['digital', 'analog']),
			showDate: z.boolean(),
			showSeconds: z.boolean(),
			format24h: z.boolean(),
			locale: z.enum(['en-GB', 'sv-SE', 'ro-RO', 'en-US']),
			position: cornerSchema,
			appearance: textAppearanceSchema
		}),
		weather: z.object({
			enabled: z.boolean(),
			provider: z.enum(['location', 'home-assistant']),
			haEntityId: z.string().regex(/^weather\.[a-z0-9_]+$/).optional(),
			lat: z.number().min(-90).max(90),
			lon: z.number().min(-180).max(180),
			locationName: z.string().optional(),
			cities: z.array(z.object({
				id: z.string().min(1).max(80),
				name: z.string().min(1).max(120),
				lat: z.number().min(-90).max(90),
				lon: z.number().min(-180).max(180)
			})).max(8),
			units: z.enum(['celsius', 'fahrenheit']),
			position: cornerSchema,
			appearance: textAppearanceSchema
		}),
		calendar: z.object({
			enabled: z.boolean(),
			region: z.enum(['SE', 'RO', 'US', 'GLOBAL']),
			showHolidays: z.boolean(),
			showNameDays: z.boolean(),
			showWeekNumber: z.boolean(),
			position: cornerSchema,
			appearance: textAppearanceSchema
		}),
		ticker: z.object({
			enabled: z.boolean(),
			text: z.string().max(2000),
			speedSec: z.number().int().min(3).max(300),
			position: z.enum(['top', 'bottom']),
			background: z.boolean(),
			appearance: textAppearanceSchema
		}),
		metadata: z.object({
			enabled: z.boolean(),
			showDate: z.boolean(),
			showLocation: z.boolean(),
			showCamera: z.boolean(),
			showRating: z.boolean(),
			showPeople: z.boolean(),
			showAge: z.boolean(),
			showFaceCards: z.boolean(),
			position: cornerSchema,
			appearance: textAppearanceSchema
		})
		,
		widgets: z.array(widgetSchema).max(12)
	}),
	colorShortcuts: z.array(z.enum([
		'none', 'next', 'previous', 'play-pause', 'toggle-clock', 'toggle-calendar',
		'toggle-weather', 'toggle-text', 'photo-info', 'cycle-layout', 'cycle-motion',
		'cycle-color', 'random-everything', 'toggle-random', 'restore'
	])).length(4),
	offHours: z.object({ start: timeSchema, end: timeSchema }).optional()
});

export const configSchema = z.object({
	version: z.literal(2),
	clientNames: z.record(z.string(), z.string().max(60)).default({}),
	clientProfiles: z.record(z.string(), z.string().max(40)).default({}),
	displays: z.array(profileSchema).superRefine((displays, ctx) => {
		const slugs = new Set<string>();
		for (const d of displays) {
			if (slugs.has(d.slug)) {
				ctx.addIssue({ code: 'custom', message: `duplicate slug "${d.slug}"` });
			}
			slugs.add(d.slug);
		}
	})
});

function defaultTextAppearance() {
	return { scale: 1, colorMode: 'light' as const, color: '#ffffff' };
}

export const DEFAULT_MAP_SETTINGS: MapSettings = {
	view: 'globe',
	renderer: 'shader',
	theme: 'midnight',
	earthTexture: 'satellite',
	seasonalTexture: true,
	imageryDetail: 'sentinel',
	osmDetail: true,
	lighting: 'sun',
	nightLights: true,
	detailLayers: true,
	holdSec: 15,
	flightSec: 3,
	worldDwellSec: 2,
	zoomKm: 600,
	photoStyle: 'card',
	splitMapPct: 50,
	splitFill: 'always',
	splitBackground: '#000000',
	splitFade: true,
	splitFadePct: 10,
	photoScalePct: 55,
	photoFrame: 'thin',
	photoBorderPx: 8,
	photoBorderColor: '#ffffff',
	photoRadiusPx: 10,
	photoShadow: true,
	photoEdge: 'sharp',
	photoDepth: 'lift',
	photoPlacement: 'near-pin',
	showMarkers: true,
	showLabels: true,
	labelScalePct: 130,
	labelMinPopulation: 10_000,
	labelMaxCount: 8,
	showGraticule: false,
	idleSpin: true,
	showMinimap: true,
	showCaption: true,
	showOverlays: true,
	trivia: 'facts',
	triviaDetail: 'full',
	cardScalePct: 120,
	triviaPosition: 'bottom-left',
	triviaWidthPct: 30,
	triviaMaxHeightPct: 70,
	triviaUseThemeColors: true,
	triviaTextColor: '#f4f2ee',
	triviaBackgroundColor: '#171a22',
	triviaAccentColor: '#ef725d',
	triviaBackgroundOpacityPct: 92,
	triviaBorderColor: '#ffffff',
	triviaBorderWidthPx: 0,
	triviaRadiusPx: 22,
	triviaPaddingPx: 22,
	triviaBlurPx: 14,
	triviaShadow: true,
	home: { name: 'Täby Park, Täby', lat: 59.4449, lon: 18.0896 }
};

export function defaultProfile(slug: string, name: string): DisplayProfile {
	return {
		id: randomUUID(),
		slug,
		name,
		sources: [],
		slideshow: {
			intervalSec: 15,
			pauseResumeMin: 5,
			transition: 'crossfade',
			transitionDurationMs: 1500,
			order: 'random',
			portraitMode: 'pair',
			layout: 'adaptive',
			mixedPortraitSide: 'alternate',
			visualEffect: 'natural',
			motionStyle: 'off',
			imageSize: 'preview',
			imageFit: 'contain',
			progressBar: 'off',
			focusMode: 'photo',
			faceZoom: 2.2,
			frameInsetPx: 0,
			photoGapPx: 3,
			cornerRadiusPx: 0,
			frameStyle: 'none',
			frameWidthPx: 24,
			matWidthPx: 0,
			matColor: '#f3f0e8',
			borderWidthPx: 0,
			borderColor: '#ffffff',
			backgroundColor: '#000000',
			instant: {
				arrangement: 'classic',
				cardCount: 2,
				cardScalePct: 100,
				overlapPct: 6,
				cardGapPx: 24,
				maxAngleDeg: 3,
				anglePattern: 'outward-v',
				paperRadiusPx: 6,
				photoRadiusPx: 3,
				paperSideBorderPct: 5.38,
				paperBottomBorderPct: 29.33,
				paperFinish: 'authentic',
				visualEffect: 'natural',
				transition: 'develop',
				transitionDurationMs: 2200,
				background: 'original',
				captionFont: 'caveat',
				captionScalePct: 125,
				backgroundRestEnabled: true,
				backgroundRestMinutes: 3,
				backgroundRestSeconds: 10,
				showDateTime: true,
				showLocation: true,
				showCamera: false,
				showRating: false,
				showPeople: false,
				showAge: false
			},
			map: { ...DEFAULT_MAP_SETTINGS }
		},
		filters: {
			orientation: 'all',
			dateFrom: null,
			dateTo: null,
			favoritesOnly: false,
			minRating: 0,
			newestLimit: 0,
			peopleMatch: 'any'
		},
		overlays: {
			autoHideSec: 30,
			clock: {
				enabled: true,
				style: 'digital',
				showDate: true,
				showSeconds: false,
				format24h: true,
				locale: 'en-GB',
				position: 'top-right',
				appearance: defaultTextAppearance()
			},
			weather: {
				enabled: false,
				provider: 'location',
				haEntityId: 'weather.home',
				lat: 0,
				lon: 0,
				cities: [],
				units: 'celsius',
				position: 'top-left',
				appearance: defaultTextAppearance()
			},
			calendar: {
				enabled: false,
				region: 'SE',
				showHolidays: true,
				showNameDays: true,
				showWeekNumber: false,
				position: 'top-left',
				appearance: defaultTextAppearance()
			},
			ticker: { enabled: false, text: '', speedSec: 35, position: 'bottom', background: false, appearance: defaultTextAppearance() },
			metadata: {
				enabled: true,
				showDate: true,
				showLocation: true,
				showCamera: false,
				showRating: false,
				showPeople: false,
				showAge: false,
				showFaceCards: true,
				position: 'bottom-left',
				appearance: defaultTextAppearance()
			},
			widgets: []
		},
		colorShortcuts: ['cycle-layout', 'cycle-motion', 'cycle-color', 'toggle-random']
	};
}

function defaultConfig(): AppConfig {
	return { version: 2, clientNames: {}, clientProfiles: {}, displays: [defaultProfile('default', 'Default')] };
}

const dataDir = () => env.DATA_DIR || './data';
const configPath = () => path.join(dataDir(), 'config.json');

let cached: AppConfig | null = null;
let writeChain: Promise<unknown> = Promise.resolve();
let updateChain: Promise<unknown> = Promise.resolve();

/** Upgrade the original shuffle boolean without invalidating existing config files. */
function normalizeConfig(input: unknown): unknown {
	if (!input || typeof input !== 'object') return input;
	const normalized = structuredClone(input) as Record<string, unknown>;
	normalized.clientProfiles ??= {};
	if (!Array.isArray(normalized.displays)) return normalized;
	if (normalized.version === 1) {
		// The original default silently meant "random from the whole library".
		// Remove only that exact untouched legacy source. User-created random
		// sources and named displays remain unchanged.
		for (const display of normalized.displays) {
			if (!display || typeof display !== 'object') continue;
			const record = display as Record<string, unknown>;
			if (record.slug !== 'default' || !Array.isArray(record.sources)) continue;
			if (record.sources.length === 1) {
				const source = record.sources[0];
				if (
					source &&
					typeof source === 'object' &&
					(source as Record<string, unknown>).type === 'random' &&
					Object.keys(source).length === 1
				) {
					record.sources = [];
					const slideshow = record.slideshow;
					if (slideshow && typeof slideshow === 'object') {
						const standard = slideshow as Record<string, unknown>;
						standard.layout = 'adaptive';
						standard.portraitMode = 'pair';
						standard.motionStyle = 'off';
						standard.transition = 'crossfade';
						standard.imageFit = 'contain';
					}
				}
			}
		}
		normalized.version = 2;
	}
	for (const display of normalized.displays) {
		if (!display || typeof display !== 'object') continue;
		const record = display as Record<string, unknown>;
		record.colorShortcuts ??= ['cycle-layout', 'cycle-motion', 'cycle-color', 'toggle-random'];
		const slideshow = record.slideshow;
		if (!slideshow || typeof slideshow !== 'object') continue;
		const settings = slideshow as Record<string, unknown>;
		if (settings.order === undefined) {
			settings.order = settings.shuffle === false ? 'newest' : 'random';
		}
		delete settings.shuffle;
		settings.imageFit ??= 'contain';
		settings.pauseResumeMin ??= 5;
		settings.layout ??= settings.portraitMode === 'pair' ? 'adaptive' : 'single';
		settings.mixedPortraitSide ??= 'alternate';
		settings.visualEffect ??= 'natural';
		settings.motionStyle ??= settings.transition === 'kenburns' ? 'gentle' : 'off';
		settings.progressBar ??= 'off';
		settings.focusMode ??= 'photo';
		settings.faceZoom ??= 2.2;
		settings.frameInsetPx ??= 0;
		settings.photoGapPx ??= 3;
		settings.cornerRadiusPx ??= 0;
		settings.frameStyle ??= 'none';
		settings.frameWidthPx ??= 24;
		settings.matWidthPx ??= 0;
		settings.matColor ??= '#f3f0e8';
		settings.borderWidthPx ??= 0;
		settings.borderColor ??= '#ffffff';
		settings.backgroundColor ??= '#000000';
		settings.instant ??= {
			arrangement: 'classic', cardCount: 2, cardScalePct: 100, overlapPct: 6, cardGapPx: 24,
			maxAngleDeg: 3, anglePattern: 'outward-v', paperRadiusPx: 6, photoRadiusPx: 3,
			paperSideBorderPct: 5.38, paperBottomBorderPct: 29.33, background: 'original',
			paperFinish: 'authentic', visualEffect: 'natural', transition: 'develop', transitionDurationMs: 2200,
			captionFont: 'caveat', captionScalePct: 125, showDateTime: true,
			backgroundRestEnabled: true, backgroundRestMinutes: 3, backgroundRestSeconds: 10,
			showLocation: true, showCamera: false, showRating: false,
			showPeople: false, showAge: false
		};
		const instant = settings.instant as Record<string, unknown>;
		instant.cardGapPx ??= 24;
		instant.anglePattern ??= 'outward-v';
		instant.paperSideBorderPct ??= 5.38;
		instant.paperBottomBorderPct ??= 29.33;
		// v0.0.29 shipped 16/12px as the initial rounding. Move only that exact
		// untouched legacy pair to the restrained authentic-film baseline.
		if (instant.paperFinish === undefined && instant.paperRadiusPx === 16 && instant.photoRadiusPx === 12) {
			instant.paperRadiusPx = 6;
			instant.photoRadiusPx = 3;
		}
		instant.paperFinish ??= 'authentic';
		instant.visualEffect ??= 'natural';
		instant.transition ??= 'develop';
		instant.transitionDurationMs ??= 2200;
		instant.backgroundRestEnabled ??= true;
		instant.backgroundRestMinutes ??= 3;
		instant.backgroundRestSeconds ??= 10;
		const savedMap = (settings.map as Record<string, unknown> | undefined) ?? {};
		if (savedMap.trivia === 'wikipedia') savedMap.trivia = 'online';
		if (savedMap.splitPortraitFill !== undefined) {
			savedMap.splitFill ??= savedMap.splitPortraitFill === false ? 'never' : 'portrait';
			delete savedMap.splitPortraitFill;
		}
		settings.map = { ...DEFAULT_MAP_SETTINGS, ...savedMap };

		if (!record.filters || typeof record.filters !== 'object') record.filters = {};
		const filters = record.filters as Record<string, unknown>;
		filters.orientation ??= 'all';
		filters.dateFrom ??= null;
		filters.dateTo ??= null;
		filters.favoritesOnly ??= false;
		filters.minRating ??= 0;
		filters.newestLimit ??= 0;
		filters.peopleMatch ??= 'any';

		const overlays = record.overlays;
		if (overlays && typeof overlays === 'object') {
			const overlaySettings = overlays as Record<string, unknown>;
			overlaySettings.autoHideSec ??= 30;
			overlaySettings.widgets ??= [];
			overlaySettings.ticker ??= { enabled: false, text: '', speedSec: 35, position: 'bottom', background: false, appearance: defaultTextAppearance() };
			overlaySettings.calendar ??= {
				enabled: false,
				region: 'SE',
				showHolidays: true,
				showNameDays: true,
				showWeekNumber: false,
				position: 'top-left',
				appearance: defaultTextAppearance()
			};
			for (const key of ['clock', 'weather', 'calendar', 'ticker', 'metadata']) {
				const value = overlaySettings[key];
				if (value && typeof value === 'object') {
					(value as Record<string, unknown>).appearance ??= defaultTextAppearance();
				}
			}
			const clock = overlaySettings.clock;
			if (clock && typeof clock === 'object') {
				const clockSettings = clock as Record<string, unknown>;
				clockSettings.style ??= 'digital';
				clockSettings.showSeconds ??= false;
				clockSettings.locale ??= 'en-GB';
			}
			if (Array.isArray(overlaySettings.widgets)) {
				for (const widget of overlaySettings.widgets) {
					if (!widget || typeof widget !== 'object') continue;
					const item = widget as Record<string, unknown>;
					item.appearance ??= defaultTextAppearance();
					item.presentation ??= 'card';
					item.tickerSpeedSec ??= 12;
					if (item.type === 'quote' || item.type === 'trivia') item.refreshMinutes ??= 30;
				}
			}
			const weather = overlaySettings.weather;
			if (weather && typeof weather === 'object') {
				const weatherSettings = weather as Record<string, unknown>;
				weatherSettings.provider ??= 'location';
				weatherSettings.haEntityId ??= 'weather.home';
				if (!Array.isArray(weatherSettings.cities)) {
					const lat = typeof weatherSettings.lat === 'number' ? weatherSettings.lat : 0;
					const lon = typeof weatherSettings.lon === 'number' ? weatherSettings.lon : 0;
					weatherSettings.cities = lat || lon ? [{
						id: 'primary',
						name: typeof weatherSettings.locationName === 'string' ? weatherSettings.locationName : `${lat}, ${lon}`,
						lat,
						lon
					}] : [];
				}
			}
			const calendar = overlaySettings.calendar;
			if (calendar && typeof calendar === 'object') {
				(calendar as Record<string, unknown>).region ??= 'SE';
			}
			const metadata = overlaySettings.metadata;
			if (metadata && typeof metadata === 'object') {
				(metadata as Record<string, unknown>).showRating ??= false;
				(metadata as Record<string, unknown>).showPeople ??= false;
				(metadata as Record<string, unknown>).showAge ??= false;
				(metadata as Record<string, unknown>).showFaceCards ??= true;
			}
		}
	}
	return normalized;
}

async function persist(config: AppConfig): Promise<void> {
	// Atomic write (tmp + rename), serialized so concurrent PUTs can't interleave.
	writeChain = writeChain.then(async () => {
		await fs.mkdir(dataDir(), { recursive: true });
		const tmp = `${configPath()}.tmp`;
		await fs.writeFile(tmp, JSON.stringify(config, null, '\t'), 'utf8');
		await fs.rename(tmp, configPath());
	});
	await writeChain;
}

export async function getConfig(): Promise<AppConfig> {
	if (cached) return cached;

	let raw: string;
	try {
		raw = await fs.readFile(configPath(), 'utf8');
	} catch {
		cached = defaultConfig();
		await persist(cached);
		return cached;
	}

	try {
		cached = configSchema.parse(normalizeConfig(JSON.parse(raw)));
	} catch (e) {
		console.error(`Invalid config at ${configPath()}, backing up and using defaults:`, e);
		await fs.copyFile(configPath(), `${configPath()}.bad`).catch(() => {});
		cached = defaultConfig();
		await persist(cached);
	}
	return cached;
}

/** Validate and save a full replacement config. Throws ZodError on bad input. */
export async function saveConfig(input: unknown): Promise<AppConfig> {
	const config = configSchema.parse(normalizeConfig(input));
	cached = config;
	await persist(config);
	return config;
}

/**
 * Apply a partial config mutation against the latest committed value. Routes
 * that edit one player/profile use this instead of read-spread-save, which can
 * otherwise lose a concurrent player rename during presentation autosave.
 */
export async function updateConfig(mutator: (current: AppConfig) => unknown): Promise<AppConfig> {
	let result!: AppConfig;
	const operation = updateChain.then(async () => {
		const current = structuredClone(await getConfig());
		result = configSchema.parse(normalizeConfig(mutator(current)));
		cached = result;
		await persist(result);
	});
	updateChain = operation.catch(() => undefined);
	await operation;
	return result;
}

export async function getProfile(slug: string): Promise<DisplayProfile | null> {
	const config = await getConfig();
	return config.displays.find((d) => d.slug === slug) ?? null;
}
