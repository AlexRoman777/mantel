// Shared data model for Mantel. Server and client both import from here.

export type Source =
	| { type: 'album'; albumId: string; name: string; connectionId?: string }
	| { type: 'person'; personId: string; name: string; connectionId?: string }
	| { type: 'random'; connectionId?: string } // whole library
	| { type: 'memories'; connectionId?: string }; // "X years ago" today

export type Corner =
	| 'top-left' | 'top-center' | 'top-right'
	| 'middle-left' | 'center' | 'middle-right'
	| 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface TextAppearance {
	scale: number;
	colorMode: 'light' | 'dark' | 'custom' | 'inverse';
	color: string;
}

export type MotionStyle =
	| 'off'
	| 'gentle'
	| 'cinematic'
	| 'dynamic'
	| 'drift'
	| 'push-in'
	| 'pull-out'
	| 'face-push-in'
	| 'face-pull-out'
	| 'face-journey'
	| 'random';

export type VisualEffect =
	| 'natural'
	| 'warm'
	| 'vivid'
	| 'monochrome'
	| 'negative'
	| 'kodak'
	| 'fuji'
	| 'instant'
	| 'art'
	| 'noir'
	| 'random';

export interface InstantSettings {
	arrangement: 'classic' | 'hero-stack' | 'scattered' | 'gallery';
	cardCount: number;
	cardScalePct: number;
	overlapPct: number;
	cardGapPx: number;
	maxAngleDeg: number;
	anglePattern: 'random' | 'inward-v' | 'outward-v';
	paperRadiusPx: number;
	photoRadiusPx: number;
	paperSideBorderPct: number;
	paperBottomBorderPct: number;
	paperFinish: 'authentic' | 'matte' | 'glossy' | 'warm';
	visualEffect: VisualEffect;
	transition: 'none' | 'fade' | 'deal' | 'develop' | 'drop' | 'random';
	transitionDurationMs: number;
	background: 'original' | 'black' | 'leather' | 'cork' | 'walnut' | 'linen' | 'felt' | 'slate' | 'metal'
		| 'bronze' | 'travertine' | 'marble' | 'onyx' | 'red-velvet' | 'metal-mesh' | 'indigo-plaster' | 'terrazzo'
		| 'collage' | 'collage-saved';
	captionFont: 'caveat' | 'kalam' | 'serif' | 'mono';
	captionScalePct: number;
	backgroundRestEnabled: boolean;
	backgroundRestMinutes: number;
	backgroundRestSeconds: number;
	showDateTime: boolean;
	showLocation: boolean;
	showCamera: boolean;
	showRating: boolean;
	showPeople: boolean;
	showAge: boolean;
}

export interface MapHome {
	name: string;
	lat: number;
	lon: number;
}

export interface MapSettings {
	view: 'globe' | 'flat';
	/** Globe drawing engine: the full-screen shader, or a Three.js textured sphere. */
	renderer: 'shader' | 'three';
	theme: 'midnight' | 'atlas' | 'ink';
	/** Raster earth under the vector map: none, NASA Blue Marble, or Natural Earth relief. */
	earthTexture: 'none' | 'satellite' | 'relief';
	/** Use the Blue Marble mosaic of the current month. */
	seasonalTexture: boolean;
	/** Close-up imagery: Blue Marble only, or Sentinel-2 cloudless tiles fetched around each place. */
	imageryDetail: 'blue-marble' | 'sentinel';
	/** OpenStreetMap roads, water, forests and every nearby settlement around each place. */
	osmDetail: boolean;
	/** Studio lamp, or the real sun with a moving day/night terminator. */
	lighting: 'studio' | 'sun';
	nightLights: boolean;
	/** Regions, rivers, urban areas and major roads when zoomed in. */
	detailLayers: boolean;
	/** Seconds the photo stays once the camera has arrived. */
	holdSec: number;
	/** Seconds for each flight (world → place, place → world). */
	flightSec: number;
	/** Seconds spent on the world view between places. */
	worldDwellSec: number;
	/** Ground width of the arrived view in kilometres (50 km with Sentinel detail). */
	zoomKm: number;
	photoStyle: 'fullscreen' | 'card' | 'split';
	/** Split screen: share of the width the map keeps, so the photo panel can be wider than half. */
	splitMapPct: number;
	/** Legacy saved preference; current split presentations always fill the panel. */
	splitFill: 'always' | 'landscape' | 'portrait' | 'never';
	/** Split screen: panel colour behind the photo. */
	splitBackground: string;
	/** Split screen: fade the panel into the map instead of a hard edge. */
	splitFade: boolean;
	/** Split screen: crossfade distance on each side of the dividing line, in viewport percent. */
	splitFadePct: number;
	/** Photo height as a percentage of the screen height (card style only). */
	photoScalePct: number;
	photoFrame: 'none' | 'thin' | 'instant';
	photoBorderPx: number;
	photoBorderColor: string;
	photoRadiusPx: number;
	photoShadow: boolean;
	/** Soften the photo's edge so it blends into the map instead of cutting hard. */
	photoEdge: 'sharp' | 'feather';
	/** Flat on the map, lifted with a deep shadow, or tilted to face the map. */
	photoDepth: 'flat' | 'lift' | 'tilt';
	/** Card sits next to the pin (never over the corners), or on a fixed side. */
	photoPlacement: 'near-pin' | 'side';
	showMarkers: boolean;
	showLabels: boolean;
	/** Map label size, as a percentage of the default. */
	labelScalePct: number;
	/** Smallest place worth naming, in inhabitants. */
	labelMinPopulation: number;
	/** Most names on screen at once, the photo's own place aside. */
	labelMaxCount: number;
	showGraticule: boolean;
	/** Globe turns slowly while resting on the world view. */
	idleSpin: boolean;
	/** Fullscreen style keeps a small map with the pin in a corner. */
	showMinimap: boolean;
	showCaption: boolean;
	/** Corner overlays (clock, weather, …) stay visible in this layout. */
	showOverlays: boolean;
	trivia: 'off' | 'facts' | 'online';
	/** Short card, or the full place ladder with every fact available. */
	triviaDetail: 'short' | 'full';
	/** Place card size as a percentage of the default. */
	cardScalePct: number;
	/** Fixed screen anchor for the place card. Split mode interprets it within the map pane. */
	triviaPosition: Corner;
	triviaWidthPct: number;
	triviaMaxHeightPct: number;
	triviaUseThemeColors: boolean;
	triviaTextColor: string;
	triviaBackgroundColor: string;
	triviaAccentColor: string;
	triviaBackgroundOpacityPct: number;
	triviaBorderColor: string;
	triviaBorderWidthPx: number;
	triviaRadiusPx: number;
	triviaPaddingPx: number;
	triviaBlurPx: number;
	triviaShadow: boolean;
	/** Home base for "km from home"; falls back to the weather location. */
	home: MapHome | null;
}

export type RemoteShortcutAction =
	| 'none'
	| 'next'
	| 'previous'
	| 'play-pause'
	| 'toggle-clock'
	| 'toggle-calendar'
	| 'toggle-weather'
	| 'toggle-text'
	| 'photo-info'
	| 'cycle-layout'
	| 'cycle-motion'
	| 'cycle-color'
	| 'random-everything'
	| 'toggle-random'
	| 'restore';

export interface WeatherLocation {
	id: string;
	name: string;
	lat: number;
	lon: number;
}

type DashboardWidgetBase = {
	id: string;
	enabled: boolean;
	position: Corner;
	appearance: TextAppearance;
	presentation: 'card' | 'ticker-top' | 'ticker-bottom';
	tickerSpeedSec: number;
};

export type DashboardWidget = DashboardWidgetBase & (
	| {
			type: 'message';
			text: string;
		}
	| {
			type: 'quote';
			refreshMinutes: number;
		}
	| {
			type: 'trivia';
			refreshMinutes: number;
		}
	| {
			type: 'school-meals';
			schoolSlug: string;
			title: string;
		}
	| {
			type: 'sl-departures';
			title: string;
			siteIds: number[];
			maxDepartures: number;
			showTrains: boolean;
			showBuses: boolean;
		}
);

export interface SlideshowSettings {
	intervalSec: number;
	/** Minutes a paused player waits before resuming by itself; 0 keeps it paused. */
	pauseResumeMin: number;
	transition: 'none' | 'crossfade' | 'kenburns' | 'slide' | 'zoom' | 'wipe' | 'card' | 'reveal' | 'random';
	transitionDurationMs: number;
	order: 'random' | 'newest' | 'oldest';
	portraitMode: 'blur-fill' | 'pair';
	layout: 'single' | 'adaptive' | 'portrait-stack' | 'mosaic' | 'filmstrip' | 'instant' | 'map' | 'random';
	mixedPortraitSide: 'left' | 'right' | 'alternate';
	visualEffect: VisualEffect;
	motionStyle: MotionStyle;
	imageSize: 'preview' | 'fullsize';
	imageFit: 'contain' | 'cover';
	progressBar: 'off' | 'top' | 'bottom';
	focusMode: 'photo' | 'person';
	faceZoom: number;
	frameInsetPx: number;
	photoGapPx: number;
	cornerRadiusPx: number;
	frameStyle: 'none' | 'white' | 'black' | 'walnut' | 'aluminium';
	frameWidthPx: number;
	matWidthPx: number;
	matColor: string;
	borderWidthPx: number;
	borderColor: string;
	backgroundColor: string;
	instant: InstantSettings;
	map: MapSettings;
}

export interface FilterSettings {
	orientation: 'all' | 'landscape' | 'portrait';
	dateFrom: string | null;
	dateTo: string | null;
	favoritesOnly: boolean;
	minRating: number;
	newestLimit: number;
	peopleMatch: 'any' | 'all';
}

export interface OverlaySettings {
	autoHideSec: number;
	clock: {
		enabled: boolean;
		style: 'digital' | 'analog';
		showDate: boolean;
		showSeconds: boolean;
		format24h: boolean;
		locale: 'en-GB' | 'sv-SE' | 'ro-RO' | 'en-US';
		position: Corner;
		appearance: TextAppearance;
	};
	weather: {
		enabled: boolean;
		provider: 'location' | 'home-assistant';
		haEntityId?: string;
		lat: number;
		lon: number;
		locationName?: string;
		cities: WeatherLocation[];
		units: 'celsius' | 'fahrenheit';
		position: Corner;
		appearance: TextAppearance;
	};
	calendar: {
		enabled: boolean;
		region: 'SE' | 'RO' | 'US' | 'GLOBAL';
		showHolidays: boolean;
		showNameDays: boolean;
		showWeekNumber: boolean;
		position: Corner;
		appearance: TextAppearance;
	};
	ticker: {
		enabled: boolean;
		text: string;
		speedSec: number;
		position: 'top' | 'bottom';
		background: boolean;
		appearance: TextAppearance;
	};
	metadata: {
		enabled: boolean;
		showDate: boolean;
		showLocation: boolean;
		showCamera: boolean;
		showRating: boolean;
		showPeople: boolean;
		showAge: boolean;
		showFaceCards: boolean;
		position: Corner;
		appearance: TextAppearance;
	};
	widgets: DashboardWidget[];
}

export interface FaceInfo {
	id: string;
	personId: string | null;
	name: string | null;
	birthDate: string | null;
	ageAtPhoto: number | null;
	centerX: number;
	centerY: number;
	width: number;
	height: number;
}

export interface DisplayProfile {
	id: string;
	slug: string; // url-safe, unique -> /display/kitchen
	name: string;
	sources: Source[];
	slideshow: SlideshowSettings;
	filters: FilterSettings;
	overlays: OverlaySettings;
	/** LG colored buttons in physical order: red, green, yellow, blue. */
	colorShortcuts: RemoteShortcutAction[];
	offHours?: { start: string; end: string }; // "23:00"–"07:00" screen off
}

export interface AppConfig {
	version: 2;
	displays: DisplayProfile[];
	/** Friendly names for connected client devices, keyed by client id. */
	clientNames: Record<string, string>;
	/** Persistent presentation assignment for each physical/browser player. */
	clientProfiles: Record<string, string>;
}

/** Lean slide descriptor returned by the playlist endpoint — decoupled from Immich DTOs. */
export interface SlideAsset {
	id: string;
	connectionId?: string;
	ratio: number; // width / height after orientation
	thumbhash: string | null; // base64
	takenAt: string | null; // ISO date
	location: string | null; // "Lisbon, Portugal"
	lat?: number | null;
	lon?: number | null;
	camera: string | null; // "Fujifilm X-T5 · 23mm f/2"
	isFavorite: boolean;
	rating: number | null;
	memoryYearsAgo?: number;
	pairWithNext?: boolean; // portrait pairing hint
	/** Statistics metadata populated server-side while resolving a gallery. */
	originalBytes?: number | null;
	owner?: { id: string; name: string } | null;
	people?: Array<{ id: string; name: string; faces: number }>;
}

export interface PlaylistResponse {
	slides: SlideAsset[];
	cursor: string | null; // opaque; pass back to get the next batch
	total: number;
}
