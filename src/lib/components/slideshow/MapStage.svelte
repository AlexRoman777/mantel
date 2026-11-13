<script lang="ts">
	// The map layout: a self-hosted world (globe or flat map, shader or Three.js)
	// that flies to each photo's place, rests there while the photo shows, and
	// returns to the world before the next stop. The GPU animates; Canvas 2D
	// draws crisp views at rest; everything else is DOM with compositor-only
	// transitions.
	import { onMount } from 'svelte';
	import type { FaceInfo, MapSettings, SlideAsset } from '$lib/types';
	import {
		decodeDetail, decodeLocalPlaces, decodeWorld, distanceKm, equirectangularProjection, levelForDetail, localPlacesForView, mercatorProjection,
		scaleForWidth, sentinelPlan, SENTINEL_MAX_LEVEL, SENTINEL_TILE_PX, slerp, stereographicProjection, TEXTURE_MAX_LEVEL, TEXTURE_TILE_PX, tilesFor, worldMercatorCenterLat, worldMercatorScale,
		type DetailData, type LocalPlace, type PhotoPlace, type RasterWindow, type TileRef, type View, type WorldData
	} from '$lib/map/geo';
	import { drawMap, THEMES, type MapTheme, type OsmLayers, type RasterPatch } from '$lib/map/render';
	import { mapResourcePolicy, subsolarPoint, type MapRenderer, type MapResourcePolicy } from '$lib/map/renderer';
	import { MapGL } from '$lib/map/map-gl';

	type LadderLevel = 'street' | 'neighbourhood' | 'place' | 'municipality' | 'region' | 'island' | 'country' | 'continent';
	interface Trivia {
		title: string;
		subtitle: string | null;
		ladder: Array<{ level: LadderLevel; name: string }>;
		facts: string[];
		localTime: string | null;
		sun: { sunrise: string; sunset: string } | null;
		weather: { temperatureC: number; code: number; text: string; isDay: boolean } | null;
		summary: string | null;
		summarySource: string | null;
	}

	let {
		slide,
		unitKey,
		settings,
		slug,
		places,
		faces = [],
		paused,
		imageUrl
	}: {
		slide: SlideAsset | null;
		unitKey: number;
		settings: MapSettings;
		slug: string;
		places: PhotoPlace[];
		/** Face boxes for the current photo, used to centre a filled split panel. */
		faces?: FaceInfo[];
		paused: boolean;
		imageUrl: (s: SlideAsset) => string;
	} = $props();

	const theme = $derived<MapTheme>(THEMES[settings.theme] ?? THEMES.midnight);
	const globe = $derived(settings.view === 'globe');
	const LADDER_LABELS: Record<LadderLevel, string> = {
		street: 'Street', neighbourhood: 'Neighbourhood', place: 'Place', municipality: 'Municipality',
		region: 'Region', island: 'Island', country: 'Country', continent: 'Continent'
	};

	type Phase = 'boot' | 'world' | 'fly-in' | 'photo' | 'fly-out';
	let phase = $state<Phase>('boot');
	let photoVisible = $state(false);
	let crispVisible = $state(false);
	let curtain = $state(false);
	let loadError = $state<string | null>(null);
	let shownSlide = $state<SlideAsset | null>(null);
	let shownFaces = $state<FaceInfo[]>([]);
	let photoKey = $state(0);
	let trivia = $state<Trivia | null>(null);
	let pin = $state<{ x: number; y: number } | null>(null);
	let cardSide = $state<'left' | 'right'>('right');
	let viewport = $state({ width: 1920, height: 1080 });
	let nightAmount = $state(0);
	let rendererName = $state<'shader' | 'three' | 'none'>('none');
	let layout = $state<{ card: { left: number; top: number; width: number; height: number; photoHeight: number }; leader: { x1: number; y1: number; x2: number; y2: number } | null } | null>(null);
	let photoRatio = $state(1.5);
	let triviaFitScale = $state(1);

	let glCanvas: HTMLCanvasElement;
	let crispCanvas: HTMLCanvasElement;
	let minimapCanvas: HTMLCanvasElement | undefined = $state();
	let triviaElement: HTMLElement | undefined = $state();
	// svelte-ignore non_reactive_update
	let renderer: MapRenderer | null = null;
	let world: WorldData | null = null;
	let detail: DetailData | null = null;
	let localPlaces: LocalPlace[] = [];
	let worldAtlas: HTMLCanvasElement | null = null;
	let detailAtlases: [HTMLCanvasElement | null, HTMLCanvasElement | null] = [null, null];
	let rasterImage: HTMLImageElement | null = null;
	let rasterStyle = '';
	let osm: OsmLayers | null = null;
	let osmPoll: ReturnType<typeof setTimeout> | undefined;
	let destroyed = false;
	let ready = false;
	let traveledKey = -1;
	let sequence = 0;
	let raf = 0;
	let spinning = false;
	let atlasSignature = '';
	let sunTimer: ReturnType<typeof setInterval> | undefined;
	let resourcePolicy: MapResourcePolicy = mapResourcePolicy(undefined, undefined);
	let preparedCrispToken = 0;

	/** Camera in CSS pixels: scale = px per projection unit, offsets from screen centre. */
	const camera = { lat: 20, lon: 10, scale: 1, blend: 0, offsetX: 0, offsetY: 0 };
	let currentPlace: { lat: number; lon: number } | null = null;

	const LOG = (message: string) => console.debug(`[map] ${message}`);

	// ---- data -------------------------------------------------------------
	let worldPromise: Promise<WorldData> | null = null;
	let detailPromise: Promise<DetailData | null> | null = null;
	const tileCache = new Map<string, Promise<HTMLImageElement | null>>();

	function loadWorld(): Promise<WorldData> {
		worldPromise ??= (async () => {
			const res = await fetch('/map/world.json', { signal: AbortSignal.timeout(60_000) });
			if (!res.ok) throw new Error('map data unavailable');
			return decodeWorld(await res.json());
		})();
		return worldPromise;
	}

	let localPlacesPromise: Promise<LocalPlace[]> | null = null;
	/** Bundled GeoNames settlements: every European place from 500 people up. */
	function loadLocalPlaces(): Promise<LocalPlace[]> {
		localPlacesPromise ??= (async () => {
			try {
				const res = await fetch('/map/places-local.json', { signal: AbortSignal.timeout(90_000) });
				return res.ok ? decodeLocalPlaces(await res.json()) : [];
			} catch {
				return [];
			}
		})();
		return localPlacesPromise;
	}

	function loadDetail(): Promise<DetailData | null> {
		detailPromise ??= (async () => {
			try {
				const res = await fetch('/map/detail.json', { signal: AbortSignal.timeout(90_000) });
				return res.ok ? decodeDetail(await res.json()) : null;
			} catch {
				return null;
			}
		})();
		return detailPromise;
	}

	function loadImage(url: string, timeoutMs = 30_000): Promise<HTMLImageElement | null> {
		return new Promise((resolve) => {
			const image = new Image();
			const timer = setTimeout(() => { image.src = ''; resolve(null); }, timeoutMs);
			image.onload = () => { clearTimeout(timer); resolve(image); };
			image.onerror = () => { clearTimeout(timer); resolve(null); };
			image.src = url;
		});
	}

	function textureStyle(): string | null {
		if (settings.earthTexture === 'none') return null;
		if (settings.earthTexture === 'relief') return 'relief';
		return settings.seasonalTexture ? `satellite-${String(new Date().getMonth() + 1).padStart(2, '0')}` : 'satellite';
	}

	async function loadRaster(): Promise<void> {
		const style = textureStyle();
		if (!style || !renderer) {
			renderer?.setRaster(null);
			rasterStyle = '';
			return;
		}
		if (style === rasterStyle && rasterImage) return;
		resourcePolicy = mapResourcePolicy(deviceCores(), deviceMemoryGb(), renderer.maxTextureSize);
		const size = resourcePolicy.earthTextureSize;
		let image = await loadImage(`/map/textures/${style}/earth-${size}.jpg`, 60_000);
		if (!image && style.startsWith('satellite-')) image = await loadImage(`/map/textures/satellite/earth-${size}.jpg`, 60_000);
		if (destroyed) return;
		rasterImage = image;
		rasterStyle = image ? style : '';
		renderer.setRaster(image);
		if (!image) LOG(`no earth texture at /map/textures/${style}; run scripts/build-map-textures.mjs`);
		buildWorldAtlas(true);
		renderGl();
	}

	async function loadNight(): Promise<void> {
		if (!renderer) return;
		if (settings.lighting !== 'sun' || !settings.nightLights) {
			renderer.setNight(null);
			return;
		}
		resourcePolicy = mapResourcePolicy(deviceCores(), deviceMemoryGb(), renderer.maxTextureSize);
		const size = resourcePolicy.earthTextureSize;
		let image = await loadImage(`/map/textures/night/earth-${size}.jpg`, 60_000);
		if (!image && size === '4k') image = await loadImage('/map/textures/night/earth-8k.jpg', 60_000);
		if (destroyed) return;
		renderer.setNight(image);
		renderGl();
	}

	/** Blue Marble (or relief) block: the wide backdrop under the Sentinel imagery. */
	function tile(ref: TileRef): Promise<HTMLImageElement | null> {
		const style = textureStyle();
		if (!style) return Promise.resolve(null);
		const pyramid = style === 'relief' ? 'relief' : 'detail';
		const key = `${pyramid}/${ref.level}/${ref.x}/${ref.y}`;
		let pending = tileCache.get(key);
		if (!pending) {
			pending = loadImage(`/api/map/blocks/${pyramid}/${ref.level}/${ref.x}/${ref.y}`, 30_000);
			tileCache.set(key, pending);
			while (tileCache.size > resourcePolicy.baseTileCacheEntries) tileCache.delete(tileCache.keys().next().value!);
		}
		return pending;
	}

	// A decoded 4096 block is about 64 MiB. The policy retains only enough for
	// one normal stop window on constrained players.
	const sentinelCache = new Map<string, Promise<HTMLImageElement | null>>();

	function sentinelBlock(ref: TileRef): Promise<HTMLImageElement | null> {
		const key = `${ref.level}/${ref.x}/${ref.y}`;
		let pending = sentinelCache.get(key);
		if (!pending) {
			pending = loadImage(`/api/map/blocks/sentinel/${ref.level}/${ref.x}/${ref.y}`, 120_000);
			sentinelCache.set(key, pending);
			while (sentinelCache.size > resourcePolicy.sentinelCacheEntries) {
				const oldest = sentinelCache.keys().next().value!;
				void sentinelCache.get(oldest)?.then((image) => image && (image.src = ''));
				sentinelCache.delete(oldest);
			}
		} else {
			// Touch: keep the blocks this stop uses at the young end of the map.
			sentinelCache.delete(key);
			sentinelCache.set(key, pending);
		}
		return pending;
	}

	const useSentinel = () => settings.earthTexture === 'satellite' && settings.imageryDetail === 'sentinel';

	/** Raster patches for a lon/lat window; `z` fixes the Sentinel level chosen for this stop. */
	async function rasterFor(
		bounds: { lon0: number; lat0: number; lon1: number; lat1: number },
		pixelsWide: number,
		z?: number,
		source: 'base' | 'preferred' = 'preferred'
	): Promise<RasterPatch[]> {
		if (!textureStyle()) return [];
		const widthDeg = Math.max(0.01, bounds.lon1 - bounds.lon0);
		// Close up, Sentinel-2 blocks (10 m) replace the 1.8 km Blue Marble; they share its grid.
		if (source === 'preferred' && useSentinel() && widthDeg <= 40 && z !== undefined) {
			const refs = tilesFor(z, bounds);
			if (refs.length <= resourcePolicy.sentinelCacheEntries) {
				const images = await Promise.all(refs.map(sentinelBlock));
				const patches: RasterPatch[] = [];
				refs.forEach((ref, index) => {
					const image = images[index];
					if (image) patches.push({ image, lon0: ref.lon0, lat0: ref.lat0, lon1: ref.lon1, lat1: ref.lat1 });
				});
				// Blue Marble underneath fills any block the server could not provide.
				if (images.some((image) => !image)) patches.unshift(...(await blueMarbleFor(bounds, pixelsWide)));
				return patches;
			}
		}
		return blueMarbleFor(bounds, pixelsWide);
	}

	async function blueMarbleFor(bounds: { lon0: number; lat0: number; lon1: number; lat1: number }, pixelsWide: number): Promise<RasterPatch[]> {
		let level = levelForDetail(pixelsWide / Math.max(0.01, bounds.lon1 - bounds.lon0), TEXTURE_MAX_LEVEL, TEXTURE_TILE_PX);
		let refs = tilesFor(level, bounds);
		while (level > 0 && refs.length > resourcePolicy.baseTileCacheEntries) refs = tilesFor(--level, bounds);
		if (refs.length > resourcePolicy.baseTileCacheEntries) return [];
		const images = await Promise.all(refs.map(tile));
		const patches: RasterPatch[] = [];
		refs.forEach((ref, index) => {
			const image = images[index];
			if (image) patches.push({ image, lon0: ref.lon0, lat0: ref.lat0, lon1: ref.lon1, lat1: ref.lat1 });
		});
		return patches;
	}

	/** OpenStreetMap detail for a stop; null while the server is still fetching it. */
	async function fetchOsm(lat: number, lon: number, waitMs: number): Promise<OsmLayers | null> {
		if (!settings.osmDetail) return null;
		try {
			const res = await fetch(`/api/displays/${slug}/osm?lat=${lat}&lon=${lon}${waitMs > 5000 ? '&wait=1' : ''}`, { signal: AbortSignal.timeout(waitMs) });
			if (res.status !== 200) return null;
			const data = (await res.json()) as OsmLayers;
			return Array.isArray(data.roads) ? data : null;
		} catch {
			return null;
		}
	}


	// ---- sizing -------------------------------------------------------------
	function deviceCores(): number | undefined {
		return typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency;
	}

	function deviceMemoryGb(): number | undefined {
		return typeof navigator === 'undefined'
			? undefined
			: (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
	}

	function measure(): void {
		viewport = { width: innerWidth, height: innerHeight };
		const dpr = Math.min(devicePixelRatio || 1, 2);
		// The animated raster never needs 4K: cap it so a Raspberry Pi keeps 60 fps.
		resourcePolicy = mapResourcePolicy(deviceCores(), deviceMemoryGb(), renderer?.maxTextureSize);
		const glCap = resourcePolicy.animationWidthPx;
		const glRatio = Math.min(dpr, glCap / viewport.width);
		renderer?.resize(Math.round(viewport.width * glRatio), Math.round(viewport.height * glRatio));
		const crispRatio = Math.min(dpr, 3840 / viewport.width);
		crispCanvas.width = Math.round(viewport.width * crispRatio);
		crispCanvas.height = Math.round(viewport.height * crispRatio);
	}

	function worldCamera(): { lat: number; lon: number; scale: number } {
		const { width, height } = viewport;
		if (globe) return { lat: 18, lon: camera.lon, scale: Math.min(width, height) * 0.43 };
		return { lat: worldMercatorCenterLat(), lon: 12, scale: worldMercatorScale(width * 0.94, height * 0.94) };
	}

	function safeArea(): { left: number; top: number; right: number; bottom: number } {
		const { width, height } = viewport;
		const vertical = settings.showOverlays ? height * 0.15 : height * 0.05;
		return { left: width * 0.04, top: vertical, right: width * 0.96, bottom: height - vertical };
	}

	function focusOffset(): { x: number; y: number } {
		const { width, height } = viewport;
		// Centre the map inside its own share of the width, not the screen.
		if (settings.photoStyle === 'split') return { x: width * (settings.splitMapPct / 200 - 0.5), y: 0 };
		if (settings.photoStyle === 'card') {
			if (settings.photoPlacement === 'near-pin') return { x: cardSide === 'right' ? -width * 0.1 : width * 0.1, y: height * 0.03 };
			return { x: cardSide === 'right' ? -width * 0.14 : width * 0.14, y: height * 0.04 };
		}
		return { x: 0, y: 0 };
	}

	/** How much of the screen the map itself occupies: split screen gives it a share. */
	function mapWidth(): number {
		return settings.photoStyle === 'split' ? viewport.width * (settings.splitMapPct / 100) : viewport.width;
	}

	function targetScale(lat: number): number {
		// The chosen ground width spans the map, not the screen, so a split view
		// and a full-screen view are zoomed the same.
		return scaleForWidth(globe ? 'stereographic' : 'mercator', settings.zoomKm, mapWidth(), lat);
	}

	// ---- rendering ------------------------------------------------------------
	function renderGl(): void {
		if (!renderer) return;
		const ratio = renderer.canvas.width / viewport.width;
		renderer.render({
			mode: globe ? 'globe' : 'flat',
			blend: globe ? camera.blend : 0,
			lat: camera.lat,
			lon: camera.lon,
			scale: camera.scale * ratio,
			offsetX: camera.offsetX * ratio,
			offsetY: camera.offsetY * ratio
		});
	}

	function updateSun(): void {
		if (!renderer) return;
		if (settings.lighting === 'sun') renderer.setSun({ mode: 'real', ...subsolarPoint(new Date()) });
		else renderer.setSun({ mode: 'studio', lat: 0, lon: 0 });
	}

	function buildWorldAtlas(force = false): void {
		if (!world || !renderer) return;
		const signature = `${settings.theme}:${settings.showMarkers}:${settings.showGraticule}:${places.length}:${rasterStyle}`;
		if (!force && signature === atlasSignature && worldAtlas) return;
		atlasSignature = signature;
		const width = Math.min(4096, renderer.maxTextureSize);
		const height = width / 2;
		worldAtlas ??= document.createElement('canvas');
		worldAtlas.width = width;
		worldAtlas.height = height;
		const ctx = worldAtlas.getContext('2d');
		if (!ctx) return;
		drawMap(ctx, world, {
			width,
			height,
			project: equirectangularProjection({ lon0: -180, lat0: -90, lon1: 180, lat1: 90 }, width, height),
			theme,
			pixelRatio: width / 2048,
			transparentWater: true,
			landAlpha: rasterImage ? theme.landOverRaster : 1,
			graticuleDeg: settings.showGraticule ? 15 : 0,
			markers: settings.showMarkers ? places : [],
			markerRadius: width / 520
		});
		renderer.setWorld(worldAtlas);
		renderer.setTheme(theme);
	}

	function detailBounds(lat: number, lon: number, factor: number): { lon0: number; lat0: number; lon1: number; lat1: number } {
		const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
		const halfLon = (settings.zoomKm * factor * 0.5) / 111 / cosLat;
		const halfLat = (settings.zoomKm * factor * 0.5 * (viewport.height / mapWidth())) / 111;
		return { lon0: lon - halfLon, lat0: Math.max(-89, lat - halfLat), lon1: lon + halfLon, lat1: Math.min(89, lat + halfLat) };
	}

	function stopPlan(lat: number, lon: number): RasterWindow[] {
		return sentinelPlan(lat, lon, settings.zoomKm, crispCanvas.width, viewport.height / mapWidth());
	}

	/** Composited (opaque) atlas for one window: raster tiles, vector detail, markers. */
	async function buildDetailAtlas(
		level: 0 | 1,
		lat: number,
		lon: number,
		location: string | null = null,
		token?: number,
		source: 'base' | 'preferred' = 'preferred'
	): Promise<void> {
		if (!world || !renderer) return;
		const window = stopPlan(lat, lon)[level];
		const size = Math.min(level === 0 ? 2048 : resourcePolicy.detailAtlasPx, renderer.maxTextureSize);
		const factor = level === 0 ? 3.2 : 1.3;
		const bounds = window.bounds;
		// The constrained Pi atlas is 2048px. Do not select a Sentinel level as
		// though it were the desktop's 4096px atlas; the final crisp canvas still
		// requests its independently planned finer level.
		const rasterLevel = source === 'preferred'
			? Math.min(window.z, levelForDetail((size * 0.75) / Math.max(0.01, bounds.lon1 - bounds.lon0), SENTINEL_MAX_LEVEL, SENTINEL_TILE_PX))
			: window.z;
		const rasterStarted = performance.now();
		const raster = await rasterFor(bounds, size, rasterLevel, source);
		if (destroyed || (token !== undefined && token !== sequence)) return;
		const drawStarted = performance.now();
		const canvas = (detailAtlases[level] ??= document.createElement('canvas'));
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		drawMap(ctx, world, {
			width: size,
			height: size,
			project: equirectangularProjection(bounds, size, size),
			theme,
			pixelRatio: size / 1400,
			widthKm: settings.zoomKm * factor,
			window: bounds,
			detail: settings.detailLayers ? detail : null,
			osm,
			raster,
			graticuleDeg: settings.showGraticule ? (settings.zoomKm > 1500 ? 5 : settings.zoomKm > 300 ? 2 : 1) : 0,
			markers: settings.showMarkers ? places : [],
			markerRadius: size / 260,
			localPlaces: settings.showLabels
				? localPlacesForView(localPlaces, { lat, lon }, settings.zoomKm * factor, { limit: Math.min(settings.labelMaxCount, 10), minPopulation: settings.labelMinPopulation })
				: [],
			primaryPlace: settings.showLabels ? { name: stopName(lat, lon, location), lat, lon } : null,
			labelFontPx: (size / 78) * (settings.labelScalePct / 100)
		});
		if (token !== undefined && token !== sequence) return;
		renderer.setDetail(level, canvas, bounds);
		LOG(`atlas ${level}: z${rasterLevel}, ${raster.length} tiles in ${Math.round(drawStarted - rasterStarted)} ms, drawn in ${Math.round(performance.now() - drawStarted)} ms`);
	}

	async function renderCrisp(lat: number, lon: number, location: string | null = null, token?: number): Promise<void> {
		if (!world) return;
		const ratio = crispCanvas.width / viewport.width;
		const offset = focusOffset();
		const view: View = {
			lat,
			lon,
			scale: targetScale(lat) * ratio,
			cx: crispCanvas.width / 2 + offset.x * ratio,
			cy: crispCanvas.height / 2 + offset.y * ratio
		};
		pin = { x: viewport.width / 2 + offset.x, y: viewport.height / 2 + offset.y };
		const ctx = crispCanvas.getContext('2d');
		if (!ctx) return;
		const window = stopPlan(lat, lon)[2];
		const raster = await rasterFor(window.bounds, window.pixelsWide, window.z);
		if (destroyed || (token !== undefined && token !== sequence)) return;
		drawMap(ctx, world, {
			width: crispCanvas.width,
			height: crispCanvas.height,
			project: globe ? stereographicProjection(view) : mercatorProjection(view),
			theme,
			pixelRatio: ratio,
			viewCenter: globe ? { lat, lon } : undefined,
			widthKm: settings.zoomKm,
			window: window.bounds,
			detail: settings.detailLayers ? detail : null,
			osm,
			raster,
			graticuleDeg: settings.showGraticule ? (settings.zoomKm > 1500 ? 10 : settings.zoomKm > 500 ? 5 : settings.zoomKm > 150 ? 2 : 1) : 0,
			markers: settings.showMarkers ? places : [],
			markerRadius: 4 * ratio,
			// One source of names, so every stop is labelled the same way.
			labels: [],
			// Read from across the room: big type, few names.
			labelFontPx: Math.max(20, Math.min(46, viewport.width / 62)) * (settings.labelScalePct / 100) * ratio,
			localPlaces: settings.showLabels
				? localPlacesForView(localPlaces, { lat, lon }, settings.zoomKm, { limit: settings.labelMaxCount, minPopulation: settings.labelMinPopulation })
				: [],
			primaryPlace: settings.showLabels ? { name: stopName(lat, lon, location), lat, lon } : null
		});
		// Night at the place darkens the crisp view a little, matching the globe.
		nightAmount = 0;
		if (settings.lighting === 'sun') {
			const sun = subsolarPoint(new Date());
			const rad = Math.PI / 180;
			const cosAngle = Math.sin(lat * rad) * Math.sin(sun.lat * rad) + Math.cos(lat * rad) * Math.cos(sun.lat * rad) * Math.cos((lon - sun.lon) * rad);
			nightAmount = Math.max(0, Math.min(1, (0.08 - cosAngle) / 0.22)) * 0.5;
		}
	}

	async function renderMinimap(lat: number, lon: number): Promise<void> {
		if (!world || !minimapCanvas) return;
		const ratio = Math.min(devicePixelRatio || 1, 2);
		const cssWidth = Math.round(viewport.width * 0.2);
		const cssHeight = Math.round(cssWidth * 0.62);
		minimapCanvas.width = cssWidth * ratio;
		minimapCanvas.height = cssHeight * ratio;
		minimapCanvas.style.width = `${cssWidth}px`;
		minimapCanvas.style.height = `${cssHeight}px`;
		const widthKm = Math.max(settings.zoomKm * 4, 1500);
		const view: View = {
			lat,
			lon,
			scale: scaleForWidth(globe ? 'stereographic' : 'mercator', widthKm, cssWidth, lat) * ratio,
			cx: minimapCanvas.width / 2,
			cy: minimapCanvas.height / 2
		};
		const ctx = minimapCanvas.getContext('2d');
		if (!ctx) return;
		const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
		const raster = await rasterFor({ lon0: lon - widthKm / 222 / cosLat, lat0: lat - widthKm / 300, lon1: lon + widthKm / 222 / cosLat, lat1: lat + widthKm / 300 }, minimapCanvas.width);
		if (destroyed) return;
		drawMap(ctx, world, {
			width: minimapCanvas.width,
			height: minimapCanvas.height,
			project: globe ? stereographicProjection(view) : mercatorProjection(view),
			theme,
			pixelRatio: ratio,
			viewCenter: globe ? { lat, lon } : undefined,
			widthKm,
			raster,
			markers: [{ key: 'here', name: '', lat, lon, count: 1 }],
			markerRadius: 5 * ratio
		});
	}

	/** The name to print at the pin: the photo's own place, else the nearest settlement. */
	function stopName(lat: number, lon: number, location: string | null = null): string {
		const label = location?.split(',')[0]?.trim();
		if (label) return label;
		let best = '';
		let bestKm = 25;
		for (const place of localPlaces) {
			const km = distanceKm(lat, lon, place.lat, place.lon);
			if (km < bestKm) {
				bestKm = km;
				best = place.name;
			}
		}
		return best;
	}

	// ---- card layout ------------------------------------------------------------------
	function layoutCards(): void {
		if (!pin || settings.photoStyle !== 'card') {
			layout = null;
			return;
		}
		const safe = safeArea();
		const { width, height } = viewport;
		const maxHeight = (height * settings.photoScalePct) / 100;
		const ratio = photoRatio || 1.5;
		let cardHeight = Math.min(maxHeight, safe.bottom - safe.top);
		let cardWidth = cardHeight * ratio;
		const maxWidth = width * 0.46;
		if (cardWidth > maxWidth) {
			cardWidth = maxWidth;
			cardHeight = cardWidth / ratio;
		}
		const frame = settings.photoFrame === 'instant' ? Math.max(12, settings.photoBorderPx) : settings.photoFrame === 'thin' ? settings.photoBorderPx : 0;
		const bottomFrame = settings.photoFrame === 'instant' ? frame * 4.2 : frame;
		const boxWidth = cardWidth + frame * 2;
		const boxHeight = cardHeight + frame + bottomFrame + (settings.showCaption && settings.photoFrame !== 'instant' ? Math.max(28, height * 0.036) : 0);
		const gap = width * 0.035;
		let left: number;
		let top: number;
		if (settings.photoPlacement === 'near-pin') {
			const fitsRight = pin.x + gap + boxWidth <= safe.right;
			const fitsLeft = pin.x - gap - boxWidth >= safe.left;
			const right = cardSide === 'right' ? fitsRight || !fitsLeft : !fitsLeft;
			left = right ? pin.x + gap : pin.x - gap - boxWidth;
			top = pin.y - boxHeight * 0.45;
		} else {
			left = cardSide === 'right' ? safe.right - boxWidth : safe.left;
			top = height / 2 - boxHeight / 2;
		}
		left = Math.max(safe.left, Math.min(safe.right - boxWidth, left));
		top = Math.max(safe.top, Math.min(safe.bottom - boxHeight, top));
		const card = { left, top, width: boxWidth, height: boxHeight, photoHeight: cardHeight };

		const cardCenterY = Math.max(top, Math.min(top + boxHeight, pin.y));
		const leader = settings.photoPlacement === 'near-pin'
			? { x1: pin.x, y1: pin.y, x2: left > pin.x ? left : left + boxWidth, y2: cardCenterY }
			: null;
		layout = { card, leader };
	}

	/** Shrink unusually rich place cards just enough to stay within their chosen box. */
	function fitTrivia(attempt = 0): void {
		const element = triviaElement;
		if (!element) return;
		if (attempt === 0) triviaFitScale = 1;
		requestAnimationFrame(() => {
			if (destroyed || triviaElement !== element) return;
			const available = element.clientHeight;
			const needed = element.scrollHeight;
			if (available <= 0 || needed <= available) return;
			const next = Math.max(0.4, Math.min(1, triviaFitScale * (available / needed) * 0.97));
			if (next >= triviaFitScale) return;
			triviaFitScale = next;
			// A smaller font can reflow onto fewer lines. Recheck after Svelte has
			// committed it, but keep the work strictly bounded.
			if (attempt < 2 && next > 0.4) requestAnimationFrame(() => fitTrivia(attempt + 1));
		});
	}

	// ---- animation ----------------------------------------------------------------
	const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
	const smooth = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
	let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
	let loopId = 0;

	function stopRaf(): void {
		cancelAnimationFrame(raf);
		clearTimeout(fallbackTimer);
		raf = 0;
		spinning = false;
		loopId++;
	}

	/**
	 * Run `tick` once per frame until it returns false. Animation frames are the
	 * fast path; a timer fallback keeps flights finishing even when the browser
	 * throttles frames (occluded kiosk window, HDMI sleep).
	 */
	function frameLoop(tick: () => boolean, timerFallback = true): void {
		stopRaf();
		const id = loopId;
		const run = () => {
			if (destroyed || id !== loopId) return;
			cancelAnimationFrame(raf);
			clearTimeout(fallbackTimer);
			if (!tick()) return;
			raf = requestAnimationFrame(run);
			if (timerFallback) fallbackTimer = setTimeout(run, 60);
		};
		run();
	}

	function animate(durationMs: number, step: (t: number) => void): Promise<void> {
		return new Promise((resolve) => {
			const start = performance.now();
			frameLoop(() => {
				const t = Math.min(1, (performance.now() - start) / durationMs);
				step(t);
				renderGl();
				if (t < 1) return true;
				resolve();
				return false;
			});
		});
	}

	function startSpin(): void {
		if (!globe || !settings.idleSpin || !renderer || paused) return;
		let last = performance.now();
		frameLoop(() => {
			const now = performance.now();
			camera.lon = ((camera.lon + ((now - last) / 1000) * 3.5 + 540) % 360) - 180;
			last = now;
			renderGl();
			return true;
		}, false);
		spinning = true;
	}

	function shortestLon(from: number, to: number): number {
		let delta = to - from;
		if (delta > 180) delta -= 360;
		if (delta < -180) delta += 360;
		return delta;
	}

	const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
	const easeIn = (t: number) => t * t * t;

	/**
	 * Fly in: first turn the world so the city sits under the camera (fast,
	 * easing out), then dive straight down on it (easing in). The two overlap a
	 * little, so it reads as one continuous approach rather than a zoom followed
	 * by a slide.
	 */
	async function flyTo(lat: number, lon: number, durationMs: number): Promise<void> {
		const from = { ...camera };
		const offset = focusOffset();
		const toScale = targetScale(lat);
		await animate(durationMs, (raw) => {
			const turn = easeOut(Math.min(1, raw / 0.55));
			const dive = easeIn(Math.max(0, (raw - 0.2) / 0.8));
			const zoom = dive * 0.35 + easeInOut(Math.max(0, (raw - 0.2) / 0.8)) * 0.65;
			if (globe) {
				const [la, lo] = slerp(from.lat, from.lon, lat, lon, turn);
				camera.lat = la;
				camera.lon = lo;
				camera.blend = smooth((raw - 0.55) / 0.45);
			} else {
				camera.lat = from.lat + (lat - from.lat) * turn;
				camera.lon = from.lon + shortestLon(from.lon, lon) * turn;
			}
			camera.scale = Math.exp(Math.log(from.scale) + (Math.log(toScale) - Math.log(from.scale)) * zoom);
			camera.offsetX = from.offsetX + (offset.x - from.offsetX) * zoom;
			camera.offsetY = from.offsetY + (offset.y - from.offsetY) * zoom;
		});
	}

	async function flyOut(durationMs: number): Promise<void> {
		const from = { ...camera };
		const to = worldCamera();
		await animate(durationMs, (raw) => {
			const t = easeInOut(raw);
			if (globe) {
				camera.blend = 1 - smooth(raw / 0.5);
				camera.lat = from.lat + (to.lat - from.lat) * t;
			} else {
				camera.lat = from.lat + (to.lat - from.lat) * t;
				camera.lon = from.lon + shortestLon(from.lon, to.lon) * t;
			}
			camera.scale = Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * t);
			camera.offsetX = from.offsetX * (1 - t);
			camera.offsetY = from.offsetY * (1 - t);
		});
	}

	function wait(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	// ---- the loop ----------------------------------------------------------------------
	async function fetchTrivia(target: SlideAsset): Promise<Trivia | null> {
		if (settings.trivia === 'off') return null;
		try {
			const params = new URLSearchParams({ lat: String(target.lat), lon: String(target.lon), slug });
			if (target.location) params.set('name', target.location);
			const here = places.find((place) => distanceKm(place.lat, place.lon, target.lat!, target.lon!) < 6);
			if (here) params.set('count', String(here.count));
			if (settings.trivia === 'online') params.set('online', '1');
			const res = await fetch(`/api/places/trivia?${params}`, { signal: AbortSignal.timeout(20_000) });
			if (!res.ok) return null;
			const data = (await res.json()) as Partial<Trivia>;
			if (typeof data.title !== 'string' || !Array.isArray(data.facts)) return null;
			return {
				title: data.title,
				subtitle: data.subtitle ?? null,
				ladder: Array.isArray(data.ladder) ? data.ladder : [],
				facts: data.facts,
				localTime: data.localTime ?? null,
				sun: data.sun ?? null,
				weather: data.weather ?? null,
				summary: data.summary ?? null,
				summarySource: data.summarySource ?? null
			};
		} catch {
			return null;
		}
	}

	interface StopPreparation {
		approach: Promise<void>;
		arrival: Promise<void>;
	}

	/** Blue Marble prepares the approach; optional Sentinel detail refines it asynchronously. */
	function prepareStop(target: SlideAsset & { lat: number; lon: number }, token: number): StopPreparation {
		const { lat, lon } = target;
		clearTimeout(osmPoll);
		const stale = () => destroyed || token !== sequence;
		const started = performance.now();
		preparedCrispToken = 0;

		const context = Promise.all([
			settings.detailLayers && !detail ? loadDetail() : Promise.resolve(detail),
			settings.showLabels && !localPlaces.length ? loadLocalPlaces() : Promise.resolve(localPlaces)
		]).then(([loadedDetail, loadedPlaces]) => {
			if (stale()) return;
			detail = loadedDetail;
			localPlaces = loadedPlaces;
		});

		const approach = (async () => {
			// A cache miss returns 202 immediately. OSM is enrichment, not a gate.
			const loadedOsm = await fetchOsm(lat, lon, 3000);
			if (stale()) return;
			osm = loadedOsm;
			// The flight uses the quick local/global layer even when Sentinel is selected.
			if (renderer) await buildDetailAtlas(0, lat, lon, target.location, token, 'base');
		})().catch((error) => LOG(`approach preparation failed: ${error instanceof Error ? error.message : String(error)}`));

		const arrival = (async () => {
			await Promise.all([approach, context]);
			if (stale()) return;
			const approachAt = performance.now();
			if (renderer) await buildDetailAtlas(1, lat, lon, target.location, token, 'preferred');
			if (stale()) return;
			const atlasAt = performance.now();
			await renderCrisp(lat, lon, target.location, token);
			if (stale()) return;
			preparedCrispToken = token;
			if (phase === 'photo' && currentPlace?.lat === lat && currentPlace.lon === lon) {
				crispVisible = true;
				layoutCards();
			}
			LOG(`prepared stop: approach ${Math.round(approachAt - started)} ms, detail ${Math.round(atlasAt - approachAt)} ms, crisp ${Math.round(performance.now() - atlasAt)} ms`);

			if (!osm && settings.osmDetail) {
				let attempts = 0;
				const poll = async () => {
					if (stale() || !currentPlace || currentPlace.lat !== lat || currentPlace.lon !== lon) return;
					const refreshedOsm = await fetchOsm(lat, lon, 8000);
					if (stale()) return;
					osm = refreshedOsm;
					if (osm) {
						await renderCrisp(lat, lon, target.location, token);
						layoutCards();
					} else if (++attempts < 4) osmPoll = setTimeout(poll, 12_000);
				};
				osmPoll = setTimeout(poll, 8000);
			}
		})().catch((error) => LOG(`fine stop preparation failed: ${error instanceof Error ? error.message : String(error)}`));

		return { approach, arrival };
	}

	async function travel(target: SlideAsset & { lat: number; lon: number }): Promise<void> {
		const token = ++sequence;
		const stale = () => destroyed || token !== sequence;
		const lat = target.lat!;
		const lon = target.lon!;
		const flightMs = settings.flightSec * 1000;
		const triviaPromise = fetchTrivia(target);
		photoRatio = target.ratio || 1.5;
		LOG(`travel #${token} → ${target.location ?? target.id} (phase ${phase})`);

		// Only skip camera movement for effectively identical GPS fixes. Nearby
		// beaches, villages and town centres must remain distinct map stops.
		if (phase === 'photo' && currentPlace && distanceKm(currentPlace.lat, currentPlace.lon, lat, lon) < 0.05) {
			photoVisible = false;
			await wait(350);
			if (stale()) return;
			shownSlide = target;
			shownFaces = faces;
			photoKey++;
			layoutCards();
			photoVisible = true;
			trivia = await triviaPromise;
			fitTrivia();
			return;
		}

		if (phase === 'photo' || phase === 'fly-in') {
			phase = 'fly-out';
			photoVisible = false;
			await wait(450);
			if (stale()) return;
			crispVisible = false;
			if (renderer) {
				await wait(250);
				if (stale()) return;
				await flyOut(flightMs * 0.85);
				renderer.setDetail(0, null);
				renderer.setDetail(1, null);
			} else {
				curtain = true;
				await wait(400);
			}
			if (stale()) return;
		}

		phase = 'world';
		currentPlace = null;
		cardSide = cardSide === 'right' ? 'left' : 'right';
		// Split owns an independent photo panel: populate it before any map detail
		// work so the right side never waits blank behind the spinning globe.
		const splitPrimed = settings.photoStyle === 'split';
		if (splitPrimed) {
			shownSlide = target;
			shownFaces = faces;
			photoKey++;
			photoVisible = true;
		}
		const preparation = prepareStop(target, token);
		if (renderer) {
			startSpin();
			// Never let tile decoding consume the slideshow's entire stop. The
			// world texture is already a valid flight surface; approach/arrival
			// atlases refine it progressively in the background.
			await wait(settings.worldDwellSec * 1000);
		} else {
			curtain = true;
			await Promise.all([wait(400), preparation.arrival]);
		}
		if (stale()) return;

		phase = 'fly-in';
		LOG(`travel #${token} fly-in`);
		if (!splitPrimed) {
			shownSlide = target;
			shownFaces = faces;
			photoKey++;
		}
		trivia = null;
		if (renderer) {
			stopRaf();
			await flyTo(lat, lon, flightMs);
		} else {
			crispVisible = true;
			curtain = false;
			await wait(400);
		}
		if (stale()) return;

		if (settings.photoStyle === 'fullscreen' && settings.showMinimap) void renderMinimap(lat, lon);
		crispVisible = preparedCrispToken === token;
		phase = 'photo';
		currentPlace = { lat, lon };
		LOG(`travel #${token} arrived`);
		await wait(renderer ? 350 : 0);
		if (stale()) return;
		layoutCards();
		photoVisible = true;
		trivia = await triviaPromise;
		if (stale()) return;
		await wait(50);
		layoutCards();
		fitTrivia();
		LOG(`travel #${token} photo shown`);
	}

	function located(target: SlideAsset | null): target is SlideAsset & { lat: number; lon: number } {
		return !!target && typeof target.lat === 'number' && typeof target.lon === 'number';
	}

	// New unit from the slideshow engine → travel there. `ready` and
	// `traveledKey` are deliberately plain variables: only the unit drives this.
	$effect(() => {
		const target = slide;
		const key = unitKey;
		if (!ready || key === traveledKey || !located(target)) return;
		traveledKey = key;
		void travel(target);
	});

	$effect(() => {
		void settings.theme;
		void settings.showMarkers;
		void settings.showGraticule;
		void places;
		if (!world) return;
		buildWorldAtlas();
		renderGl();
	});

	$effect(() => {
		const isPaused = paused;
		if (!ready || phase !== 'world' || !renderer) return;
		if (isPaused && spinning) stopRaf();
		else if (!isPaused && !spinning) startSpin();
	});

	$effect(() => {
		// Re-measure after either content or any visual constraint changes. Reading
		// the inputs explicitly keeps this independent from the fitted scale itself.
		void trivia;
		void settings.triviaDetail;
		void settings.triviaPosition;
		void settings.triviaWidthPct;
		void settings.triviaMaxHeightPct;
		void settings.cardScalePct;
		void settings.triviaPaddingPx;
		if (triviaElement) requestAnimationFrame(fitTrivia);
	});

	function releaseImageCache(cache: Map<string, Promise<HTMLImageElement | null>>): void {
		for (const pending of cache.values()) void pending.then((image) => {
			if (image) image.src = '';
		});
		cache.clear();
	}

	async function createRenderer(): Promise<MapRenderer | null> {
		if (globe && settings.renderer === 'three') {
			try {
				const { MapThree } = await import('$lib/map/map-three');
				return new MapThree(glCanvas);
			} catch (error) {
				LOG(`Three.js renderer unavailable, using the shader: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		try {
			return new MapGL(glCanvas);
		} catch (error) {
			LOG(`WebGL unavailable, using still views: ${error instanceof Error ? error.message : String(error)}`);
			return null;
		}
	}

	onMount(() => {
		measure();
		const onResize = () => {
			measure();
			if (phase === 'photo' && currentPlace) void renderCrisp(currentPlace.lat, currentPlace.lon, shownSlide?.location ?? null).then(layoutCards);
			if (phase === 'world') Object.assign(camera, worldCamera());
			renderGl();
			fitTrivia();
		};
		addEventListener('resize', onResize);
		void (async () => {
			try {
				renderer = await createRenderer();
				rendererName = renderer?.name ?? 'none';
				measure();
				world = await loadWorld();
				if (destroyed) return;
				if (settings.detailLayers) void loadDetail().then((loaded) => { detail = loaded; });
						if (renderer) {
					updateSun();
					buildWorldAtlas();
					Object.assign(camera, worldCamera(), { blend: 0, offsetX: 0, offsetY: 0 });
					renderGl();
					startSpin();
					void loadRaster();
					void loadNight();
					sunTimer = setInterval(() => {
						updateSun();
						if (phase === 'world' && !spinning) renderGl();
						if (settings.seasonalTexture && textureStyle() !== rasterStyle) void loadRaster();
					}, 60_000);
				} else curtain = false;
				phase = 'world';
				ready = true;
				if (located(slide) && unitKey !== traveledKey) {
					traveledKey = unitKey;
					void travel(slide);
				}
			} catch (error) {
				loadError = error instanceof Error ? error.message : String(error);
			}
		})();
		return () => {
			destroyed = true;
			stopRaf();
			clearInterval(sunTimer);
			clearTimeout(osmPoll);
			removeEventListener('resize', onResize);
			renderer?.destroy();
			releaseImageCache(tileCache);
			releaseImageCache(sentinelCache);
			if (rasterImage) rasterImage.src = '';
			rasterImage = null;
			if (worldAtlas) worldAtlas.width = worldAtlas.height = 0;
			for (const canvas of detailAtlases) if (canvas) canvas.width = canvas.height = 0;
			crispCanvas.width = crispCanvas.height = 0;
		};
	});

	const dateLabel = $derived(
		shownSlide?.takenAt
			? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(shownSlide.takenAt))
			: null
	);
	const placeTitle = $derived(trivia?.title ?? shownSlide?.location?.split(',')[0] ?? null);
	const showTrivia = $derived(settings.trivia !== 'off' && trivia !== null && (trivia.facts.length > 0 || trivia.summary || trivia.ladder.length > 0));
	const shortFacts = $derived(trivia ? (settings.triviaDetail === 'full' ? trivia.facts : trivia.facts.slice(0, 3)) : []);
	const frameStyle = $derived(
		settings.photoFrame === 'none'
			? `--frame-w: 0px; --frame-bottom: 0px; --frame-color: transparent; --photo-radius: ${settings.photoRadiusPx}px`
			: settings.photoFrame === 'instant'
				? `--frame-w: ${Math.max(12, settings.photoBorderPx)}px; --frame-bottom: ${Math.max(12, settings.photoBorderPx) * 4.2}px; --frame-color: ${settings.photoBorderColor}; --photo-radius: ${Math.min(6, settings.photoRadiusPx)}px`
				: `--frame-w: ${settings.photoBorderPx}px; --frame-bottom: ${settings.photoBorderPx}px; --frame-color: ${settings.photoBorderColor}; --photo-radius: ${settings.photoRadiusPx}px`
	);
	const instantTilt = $derived(settings.photoFrame === 'instant' ? (cardSide === 'right' ? -2 : 2) : 0);
	// Tilt the photo to face the map it belongs to: a card on the right turns left, and the reverse.
	const faceTilt = $derived(settings.photoDepth === 'tilt' ? (cardSide === 'right' ? 7 : -7) : 0);
	/** Split is always a true edge-to-edge photo panel, for every orientation. */
	const splitFills = $derived(settings.photoStyle === 'split');
	/** Centre of everyone's faces, so a cropped panel keeps the people in frame. */
	const faceCentre = $derived.by(() => {
		const boxes = shownFaces;
		if (!boxes.length) return { x: 50, y: 50 };
		const left = Math.min(...boxes.map((face) => face.centerX - face.width / 2));
		const right = Math.max(...boxes.map((face) => face.centerX + face.width / 2));
		const top = Math.min(...boxes.map((face) => face.centerY - face.height / 2));
		const bottom = Math.max(...boxes.map((face) => face.centerY + face.height / 2));
		return {
			x: Math.max(15, Math.min(85, ((left + right) / 2) * 100)),
			// Heads sit above centre: bias upward a little so foreheads are not cropped.
			y: Math.max(12, Math.min(88, ((top + bottom) / 2) * 100 - 4))
		};
	});
	/** Caption ink chosen against the frame colour, so white frames get dark text. */
	const frameInk = $derived.by(() => {
		const hex = settings.photoBorderColor.match(/^#([0-9a-f]{6})$/i)?.[1];
		if (!hex || settings.photoFrame === 'none') return theme.cardText;
		const n = parseInt(hex, 16);
		const luminance = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
		return luminance > 0.55 ? '#262320' : '#f4f2ee';
	});
	const triviaText = $derived(settings.triviaUseThemeColors ? theme.cardText : settings.triviaTextColor);
	const triviaBackground = $derived(settings.triviaUseThemeColors ? theme.card : settings.triviaBackgroundColor);
	const triviaAccent = $derived(settings.triviaUseThemeColors ? theme.marker : settings.triviaAccentColor);
</script>

<div
	class="map-stage"
	class:has-gl={rendererName !== 'none'}
	class:paused
	class:shadow={settings.photoShadow}
	class:feather={settings.photoEdge === 'feather'}
	class:lift={settings.photoDepth === 'lift'}
	class:tilt={settings.photoDepth === 'tilt'}
	style="--map-space: {theme.space}; --map-card: {theme.card}; --map-card-text: {theme.cardText}; --map-marker: {theme.marker}; --map-marker-glow: {theme.markerGlow}; --night: {nightAmount}; --frame-ink: {frameInk}; --card-scale: {settings.cardScalePct / 100}; --split-map: {settings.splitMapPct}%; --split-bg: {settings.splitBackground}; --split-fade: {settings.splitFade ? settings.splitFadePct : 0}vw; --split-blend: {settings.splitFade ? settings.splitFadePct * 2 : 0}vw; --face-tilt: {faceTilt}deg; --face-x: {faceCentre.x}%; --face-y: {faceCentre.y}%; --trivia-width: {settings.triviaWidthPct}vw; --trivia-max-height: {settings.triviaMaxHeightPct}vh; --trivia-fit: {triviaFitScale}; --trivia-text: {triviaText}; --trivia-bg: {triviaBackground}; --trivia-accent: {triviaAccent}; --trivia-opacity: {settings.triviaBackgroundOpacityPct}%; --trivia-border: {settings.triviaBorderColor}; --trivia-border-width: {settings.triviaBorderWidthPx}px; --trivia-radius: {settings.triviaRadiusPx}px; --trivia-padding: {settings.triviaPaddingPx}px; --trivia-blur: {settings.triviaBlurPx}px; {frameStyle}"
>
	<canvas class="gl" bind:this={glCanvas}></canvas>
	<canvas class="crisp" class:visible={crispVisible} bind:this={crispCanvas}></canvas>
	<div class="night" class:visible={crispVisible && nightAmount > 0}></div>
	<div class="curtain" class:visible={curtain}></div>

	{#if pin && phase === 'photo' && settings.photoStyle !== 'fullscreen'}
		<div class="pin" style="left: {pin.x}px; top: {pin.y}px">
			<span class="pulse"></span>
			<span class="dot"></span>
		</div>
	{/if}

	{#if layout?.leader && photoVisible}
		<svg class="leader" width={viewport.width} height={viewport.height} aria-hidden="true">
			<line x1={layout.leader.x1} y1={layout.leader.y1} x2={layout.leader.x2} y2={layout.leader.y2} />
		</svg>
	{/if}

	{#if shownSlide}
		{#key photoKey}
			<div
				class="photo {settings.photoStyle} frame-{settings.photoFrame}"
				class:visible={photoVisible}
				class:portrait={shownSlide.ratio < 1}
				class:fill={splitFills}
				class:faded={settings.splitFade}
				class:left={cardSide === 'left'}
				class:safe={settings.showOverlays}
				style={settings.photoStyle === 'card' && layout
					? `left: ${layout.card.left}px; top: ${layout.card.top}px; width: ${layout.card.width}px; --photo-h: ${layout.card.photoHeight}px; --tilt: ${instantTilt}deg`
					: ''}
			>
				<img src={imageUrl(shownSlide)} alt="" draggable="false" />
				{#if settings.photoStyle !== 'split' && settings.showCaption && (placeTitle || dateLabel)}
					<div class="caption">
						{#if placeTitle}<strong>{placeTitle}</strong>{/if}
						{#if dateLabel}<span>{dateLabel}</span>{/if}
					</div>
				{/if}
			</div>
		{/key}
	{/if}

	{#if settings.photoStyle === 'fullscreen' && settings.showMinimap}
		<div class="minimap" class:visible={photoVisible} class:safe={settings.showOverlays}>
			<canvas bind:this={minimapCanvas}></canvas>
			{#if placeTitle}<span>{placeTitle}</span>{/if}
		</div>
	{/if}

	{#if showTrivia && trivia}
		<aside
			class="trivia {settings.photoStyle} {settings.triviaPosition}"
			class:visible={photoVisible}
			class:safe={settings.showOverlays}
			class:no-shadow={!settings.triviaShadow}
			bind:this={triviaElement}
		>
			<strong>{trivia.title}</strong>
			{#if trivia.subtitle}<em>{trivia.subtitle}</em>{/if}
			{#if trivia.weather}
				<p class="weather">{trivia.weather.temperatureC}°C · {trivia.weather.text}{#if trivia.localTime} · {trivia.localTime} local{/if}</p>
			{/if}
			{#if settings.triviaDetail === 'full' && trivia.ladder.length}
				<dl class="ladder">
					{#each trivia.ladder as step}
						<dt>{LADDER_LABELS[step.level] ?? step.level}</dt>
						<dd>{step.name}</dd>
					{/each}
				</dl>
			{/if}
			{#if trivia.summary}<p>{trivia.summary}</p>{/if}
			{#if shortFacts.length}
				<ul>
					{#each shortFacts as fact}<li>{fact}</li>{/each}
				</ul>
			{/if}
			{#if trivia.summarySource}<small>{trivia.summarySource}</small>{/if}
		</aside>
	{/if}

	{#if loadError}
		<div class="status"><p>Map data could not be loaded</p><p class="detail">{loadError}</p></div>
	{/if}
</div>

<style>
	.map-stage {
		position: absolute;
		inset: 0;
		background: var(--map-space);
		overflow: hidden;
		font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
	}

	canvas.gl,
	canvas.crisp,
	.night {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.map-stage:not(.has-gl) canvas.gl {
		display: none;
	}

	canvas.crisp {
		opacity: 0;
		transition: opacity 0.35s ease;
	}

	canvas.crisp.visible {
		opacity: 1;
	}

	.night {
		background: #050a1e;
		opacity: 0;
		transition: opacity 0.35s ease;
		pointer-events: none;
	}

	.night.visible {
		opacity: var(--night);
	}

	.curtain {
		position: absolute;
		inset: 0;
		background: var(--map-space);
		opacity: 0;
		transition: opacity 0.4s ease;
		pointer-events: none;
	}

	.curtain.visible {
		opacity: 1;
	}

	.pin {
		position: absolute;
		width: 0;
		height: 0;
		z-index: 2;
	}

	.pin .dot {
		position: absolute;
		left: -0.45vw;
		top: -0.45vw;
		width: 0.9vw;
		height: 0.9vw;
		border-radius: 50%;
		background: var(--map-marker);
		box-shadow: 0 0 0 0.18vw rgba(255, 255, 255, 0.85), 0 0.2vw 0.8vw rgba(0, 0, 0, 0.45);
	}

	.pin .pulse {
		position: absolute;
		left: -1.4vw;
		top: -1.4vw;
		width: 2.8vw;
		height: 2.8vw;
		border-radius: 50%;
		border: 0.16vw solid var(--map-marker);
		opacity: 0;
		animation: pin-pulse 2.4s ease-out infinite;
	}

	.map-stage.paused .pin .pulse {
		animation-play-state: paused;
	}

	@keyframes pin-pulse {
		0% { transform: scale(0.35); opacity: 0.9; }
		70% { transform: scale(1.15); opacity: 0; }
		100% { transform: scale(1.15); opacity: 0; }
	}

	.leader {
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
		animation: fade-in 0.5s ease both;
	}

	.leader line {
		stroke: var(--map-marker);
		stroke-width: 0.15vw;
		stroke-dasharray: 0.6vw 0.4vw;
		opacity: 0.85;
	}

	/* ---- photo presentations ---- */
	.photo {
		position: absolute;
		z-index: 3;
		opacity: 0;
		transform: translate3d(0, 1.5vh, 0) scale(0.97);
		transition: opacity 0.5s ease, transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
		pointer-events: none;
	}

	.photo.visible {
		opacity: 1;
		transform: translate3d(0, 0, 0) scale(1);
	}

	.photo img {
		display: block;
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}

	.photo .caption {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2em 0.8em;
		align-items: baseline;
		color: var(--map-card-text);
		font-size: clamp(0.9rem, 1.15vw, 1.5rem);
	}

	.photo .caption strong { font-weight: 700; }
	.photo .caption span { opacity: 0.72; }

	.photo.card {
		box-sizing: border-box;
		padding: var(--frame-w) var(--frame-w) var(--frame-bottom);
		border-radius: calc(var(--photo-radius) + var(--frame-w) * 0.6);
		background: var(--frame-color);
		transform: translate3d(0, 1.5vh, 0) scale(0.97) rotate(var(--tilt, 0deg));
	}

	.photo.card.visible { transform: translate3d(0, 0, 0) scale(1) rotate(var(--tilt, 0deg)); }
	.map-stage.shadow .photo.card { box-shadow: 0 2vh 6vh rgba(0, 0, 0, 0.5); }

	/* Lift: the photo hovers above the map on a deep, soft shadow. */
	.map-stage.lift.shadow .photo.card { box-shadow: 0 4vh 9vh rgba(0, 0, 0, 0.62), 0 1vh 2vh rgba(0, 0, 0, 0.4); }
	.map-stage.lift .photo.card.visible { transform: translate3d(0, -0.8vh, 0) scale(1.012) rotate(var(--tilt, 0deg)); }

	/* Tilt: the photo turns to face the map, as if standing on it. */
	.map-stage.tilt .photo.card { perspective: 2200px; }
	.map-stage.tilt .photo.card.visible {
		transform: translate3d(0, -0.5vh, 0) rotateY(var(--face-tilt, 0deg)) rotate(var(--tilt, 0deg));
	}
	.map-stage.tilt.shadow .photo.card { box-shadow: 0 3.5vh 8vh rgba(0, 0, 0, 0.6); }

	/* Feather: the photo dissolves into the map instead of cutting hard. */
	.map-stage.feather .photo.card { background: none; box-shadow: none; padding: 0; }
	.map-stage.feather .photo.card img {
		-webkit-mask-image: radial-gradient(ellipse 96% 96% at 50% 50%, #000 62%, transparent 100%);
		mask-image: radial-gradient(ellipse 96% 96% at 50% 50%, #000 62%, transparent 100%);
	}
	.map-stage.feather .photo.card .caption { padding: 0.6em 0.9em; margin-top: 0.4vh; border-radius: 999px; background: var(--map-card); display: inline-flex; color: var(--map-card-text); }
	.map-stage.feather .photo.split img {
		-webkit-mask-image: linear-gradient(90deg, transparent, #000 16%);
		mask-image: linear-gradient(90deg, transparent, #000 16%);
	}
	.photo.card.frame-none { padding: 0; background: transparent; }
	.photo.card.frame-none img { border-radius: var(--photo-radius); }
	.photo.card.frame-none .caption { padding: 0.6em 0.9em; margin-top: 0.6vh; border-radius: 999px; background: var(--map-card); display: inline-flex; }
	.photo.card img { width: 100%; height: var(--photo-h, auto); object-fit: cover; border-radius: var(--photo-radius); }
	.photo.card.frame-thin .caption { padding: 0.5em 0.2em 0; color: var(--frame-ink); }
	.photo.card.frame-instant {
		background: linear-gradient(160deg, var(--frame-color), color-mix(in srgb, var(--frame-color) 88%, black 12%));
	}
	.photo.card.frame-instant .caption {
		position: absolute;
		left: var(--frame-w);
		right: var(--frame-w);
		bottom: calc(var(--frame-bottom) * 0.3);
		justify-content: center;
		font-family: 'Mantel Caveat', 'Caveat', 'Segoe Print', cursive;
		font-size: clamp(1.1rem, 1.7vw, 2.3rem);
		color: var(--frame-ink);
	}
	.photo.card.frame-instant .caption strong { font-weight: 700; }
	.photo.card.frame-instant .caption span { opacity: 0.6; }

	.photo.split {
		left: var(--split-map, 50%);
		top: 0;
		bottom: 0;
		right: 0;
		width: auto;
		display: grid;
		grid-template-rows: auto auto;
		align-content: start;
		justify-items: center;
		gap: 1.2vh;
		padding: 5vh 3vw 0 2.5vw;
		box-sizing: border-box;
		background: var(--split-bg);
	}

	.photo.split.faded {
		background: linear-gradient(90deg, transparent, var(--split-bg) 14%);
	}

	.photo.split.safe { padding-top: 15vh; }
	.photo.split img {
		max-width: 100%;
		max-height: 82vh;
		border: var(--frame-w) solid var(--frame-color);
		border-radius: var(--photo-radius);
	}
	.photo.split.safe img { max-height: 70vh; }

	/* Photo across the whole panel, face-aware crop, fading into the map at the seam. */
	.photo.split.fill { display: block; padding: 0; background: var(--split-bg); }
	.photo.split.fill.faded {
		left: calc(var(--split-map, 50%) - var(--split-fade, 10vw));
		background: transparent;
	}
	.photo.split.fill img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		max-height: none;
		object-fit: cover;
		object-position: var(--face-x) var(--face-y);
		border: 0;
		border-radius: 0;
	}
	.photo.split.fill.faded img {
		-webkit-mask-image: linear-gradient(90deg, transparent 0, #000 var(--split-blend, 20vw));
		mask-image: linear-gradient(90deg, transparent 0, #000 var(--split-blend, 20vw));
	}
	.map-stage.shadow .photo.split.fill img { box-shadow: none; }
	.photo.split.fill .caption {
		position: absolute;
		left: 10%;
		bottom: 4vh;
		padding: 0.6em 1em;
		border-radius: 999px;
		background: var(--map-card);
	}
	.photo.split.fill.safe .caption { bottom: 16vh; }
	.map-stage.shadow .photo.split img { box-shadow: 0 2vh 5vh rgba(0, 0, 0, 0.5); }
	.photo.split .caption { justify-content: center; }

	.photo.fullscreen {
		inset: 0;
		display: grid;
		place-items: center;
		background: var(--map-space);
	}

	.photo.fullscreen.safe { padding: 15vh 4vw; box-sizing: border-box; }
	.photo.fullscreen img { width: 100%; height: 100%; border-radius: var(--photo-radius); }
	.photo.fullscreen.safe img { border: var(--frame-w) solid var(--frame-color); box-sizing: border-box; }
	.photo.fullscreen .caption {
		position: absolute;
		left: 2.5vw;
		bottom: 3vh;
		padding: 0.6em 1em;
		border-radius: 999px;
		background: var(--map-card);
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
	}
	.photo.fullscreen.safe .caption { bottom: 16vh; }

	.minimap {
		position: absolute;
		z-index: 4;
		right: 2.5vw;
		bottom: 3vh;
		display: grid;
		gap: 0.4vh;
		justify-items: center;
		padding: 0.5vw;
		border-radius: 0.9vw;
		background: var(--map-card);
		color: var(--map-card-text);
		font-size: clamp(0.8rem, 1vw, 1.3rem);
		font-weight: 600;
		box-shadow: 0 1vh 3vh rgba(0, 0, 0, 0.45);
		opacity: 0;
		transition: opacity 0.5s ease 0.2s;
	}

	.minimap.safe { bottom: 16vh; }
	.minimap.visible { opacity: 1; }
	.minimap canvas { display: block; border-radius: 0.5vw; }

	/* ---- trivia card ---- */
	.trivia {
		--trivia-x-edge: 2.5vw;
		--trivia-y-edge: 4vh;
		--trivia-area-width: 100vw;
		--trivia-area-right: 2.5vw;
		--trivia-area-center: 50vw;
		position: absolute;
		z-index: 4;
		display: grid;
		gap: 0.35em;
		width: min(var(--trivia-width), calc(var(--trivia-area-width) - 5vw));
		max-width: calc(var(--trivia-area-width) - 5vw);
		max-height: min(var(--trivia-max-height), calc(100vh - var(--trivia-y-edge) - var(--trivia-y-edge)));
		box-sizing: border-box;
		padding: var(--trivia-padding);
		border: var(--trivia-border-width) solid var(--trivia-border);
		border-radius: var(--trivia-radius);
		background: color-mix(in srgb, var(--trivia-bg) var(--trivia-opacity), transparent);
		color: var(--trivia-text);
		font-size: calc(clamp(0.8rem, 0.95vw, 1.25rem) * var(--card-scale, 1) * var(--trivia-fit, 1));
		line-height: 1.32;
		box-shadow: 0 1.5vh 4vh rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(var(--trivia-blur));
		overflow: hidden;
		opacity: 0;
		transform: translate3d(0, 1.5vh, 0);
		transition: opacity 0.5s ease 0.35s, transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) 0.35s;
		pointer-events: none;
	}
	.trivia.safe { --trivia-y-edge: 16vh; }
	.trivia.no-shadow { box-shadow: none; }
	.trivia.top-left { top: var(--trivia-y-edge); left: var(--trivia-x-edge); }
	.trivia.top-center { top: var(--trivia-y-edge); left: var(--trivia-area-center); translate: -50% 0; }
	.trivia.top-right { top: var(--trivia-y-edge); right: var(--trivia-area-right); }
	.trivia.middle-left { top: 50%; left: var(--trivia-x-edge); translate: 0 -50%; }
	.trivia.center { top: 50%; left: var(--trivia-area-center); translate: -50% -50%; }
	.trivia.middle-right { top: 50%; right: var(--trivia-area-right); translate: 0 -50%; }
	.trivia.bottom-left { bottom: var(--trivia-y-edge); left: var(--trivia-x-edge); }
	.trivia.bottom-center { bottom: var(--trivia-y-edge); left: var(--trivia-area-center); translate: -50% 0; }
	.trivia.bottom-right { bottom: var(--trivia-y-edge); right: var(--trivia-area-right); }

	/* In split mode every anchor is constrained to the map pane, before the blend starts. */
	.trivia.split {
		--trivia-area-width: calc(var(--split-map) - var(--split-fade));
		--trivia-area-center: calc((var(--split-map) - var(--split-fade)) / 2);
		--trivia-area-right: calc(100% - var(--split-map) + var(--split-fade) + 2.5vw);
	}

	.trivia.visible { opacity: 1; transform: translate3d(0, 0, 0); }
	.trivia strong { font-size: 1.3em; font-weight: 800; letter-spacing: -0.01em; }
	.trivia em { font-style: normal; opacity: 0.7; margin-top: -0.3em; }
	.trivia p { margin: 0.2em 0 0; }
	.trivia .weather { font-weight: 700; color: var(--trivia-accent); margin: 0; }
	.trivia ul { margin: 0.2em 0 0; padding: 0; list-style: none; display: grid; gap: 0.15em; }
	.trivia li { display: flex; gap: 0.5em; align-items: baseline; opacity: 0.9; }
	.trivia li::before { content: ''; width: 0.4em; height: 0.4em; border-radius: 50%; background: var(--trivia-accent); flex: none; transform: translateY(-0.1em); }
	.trivia small { opacity: 0.5; font-size: 0.75em; }
	.trivia .ladder {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.1em 0.9em;
		margin: 0.35em 0 0.1em;
		padding: 0.5em 0;
		border-top: 1px solid color-mix(in srgb, var(--trivia-text) 18%, transparent);
		border-bottom: 1px solid color-mix(in srgb, var(--trivia-text) 18%, transparent);
	}
	.trivia dt { font-size: 0.7em; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.55; align-self: baseline; }
	.trivia dd { margin: 0; font-weight: 600; }

	.status {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		text-align: center;
		color: var(--text-dim);
	}

	.status .detail { font-size: 0.85rem; color: var(--text-faint); }

	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@media (prefers-reduced-motion: reduce) {
		.photo, .trivia, canvas.crisp { transition-duration: 0.15s; }
		.pin .pulse { animation: none; }
	}
</style>
