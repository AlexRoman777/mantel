// Canvas 2D vector renderer for the map layout. Draws crisp views at rest and
// the texture atlases the GPU animates between. No per-frame work happens here.

import {
	antipode, mercatorLat, mercatorY, ringContains, type DetailData, type LocalPlace, type Place, type PhotoPlace, type Projection, type WorldData
} from './geo';

export type MapThemeName = 'midnight' | 'atlas' | 'ink';

export interface MapTheme {
	space: string;
	water: string;
	waterDeep: string;
	land: string;
	coast: string;
	border: string;
	region: string;
	urban: string;
	river: string;
	road: string;
	roadMinor: string;
	graticule: string;
	marker: string;
	markerGlow: string;
	label: string;
	labelHalo: string;
	regionLabel: string;
	terrainLabel: string;
	atmosphere: string;
	card: string;
	cardText: string;
	/** Land fill opacity when a raster earth texture sits underneath. */
	landOverRaster: number;
	forest: string;
	park: string;
	roadCasing: string;
	roadFill: string;
	rail: string;
}

export const THEMES: Record<MapThemeName, MapTheme> = {
	midnight: {
		space: '#05070d',
		water: '#10294a',
		waterDeep: '#0a1a33',
		land: '#2b3446',
		coast: 'rgba(160, 182, 210, 0.55)',
		border: 'rgba(200, 214, 235, 0.18)',
		region: 'rgba(200, 214, 235, 0.11)',
		urban: 'rgba(232, 200, 140, 0.16)',
		river: 'rgba(120, 170, 225, 0.55)',
		road: 'rgba(240, 210, 150, 0.45)',
		roadMinor: 'rgba(240, 210, 150, 0.22)',
		graticule: 'rgba(255, 255, 255, 0.05)',
		marker: '#e8a13c',
		markerGlow: 'rgba(232, 161, 60, 0.35)',
		label: '#e7edf6',
		labelHalo: 'rgba(5, 7, 13, 0.85)',
		regionLabel: 'rgba(200, 214, 235, 0.55)',
		terrainLabel: 'rgba(200, 214, 235, 0.5)',
		atmosphere: '#4f8fd8',
		card: 'rgba(8, 11, 18, 0.82)',
		cardText: '#f2f5fa',
		landOverRaster: 0.1,
		forest: 'rgba(70, 120, 80, 0.28)',
		park: 'rgba(110, 170, 100, 0.22)',
		roadCasing: 'rgba(20, 24, 34, 0.75)',
		roadFill: 'rgba(250, 225, 170, 0.9)',
		rail: 'rgba(210, 210, 220, 0.6)'
	},
	atlas: {
		space: '#e6dfcf',
		water: '#c5d8e3',
		waterDeep: '#aac5d5',
		land: '#f4eddc',
		coast: 'rgba(110, 92, 64, 0.7)',
		border: 'rgba(90, 70, 40, 0.34)',
		region: 'rgba(90, 70, 40, 0.18)',
		urban: 'rgba(200, 120, 90, 0.22)',
		river: 'rgba(70, 120, 170, 0.6)',
		road: 'rgba(170, 80, 60, 0.5)',
		roadMinor: 'rgba(170, 80, 60, 0.25)',
		graticule: 'rgba(90, 70, 40, 0.1)',
		marker: '#c0392b',
		markerGlow: 'rgba(192, 57, 43, 0.3)',
		label: '#3b2f21',
		labelHalo: 'rgba(244, 237, 220, 0.9)',
		regionLabel: 'rgba(90, 70, 40, 0.55)',
		terrainLabel: 'rgba(90, 70, 40, 0.5)',
		atmosphere: '#8fb8d6',
		card: 'rgba(250, 246, 236, 0.92)',
		cardText: '#2b241a',
		landOverRaster: 0.08,
		forest: 'rgba(120, 170, 110, 0.32)',
		park: 'rgba(150, 200, 130, 0.3)',
		roadCasing: 'rgba(90, 60, 40, 0.65)',
		roadFill: 'rgba(255, 240, 200, 0.95)',
		rail: 'rgba(70, 60, 50, 0.55)'
	},
	ink: {
		space: '#0b0b0b',
		water: '#0f0f0f',
		waterDeep: '#0b0b0b',
		land: '#1c1c1c',
		coast: 'rgba(235, 235, 235, 0.8)',
		border: 'rgba(235, 235, 235, 0.32)',
		region: 'rgba(235, 235, 235, 0.16)',
		urban: 'rgba(235, 235, 235, 0.12)',
		river: 'rgba(235, 235, 235, 0.45)',
		road: 'rgba(235, 235, 235, 0.4)',
		roadMinor: 'rgba(235, 235, 235, 0.2)',
		graticule: 'rgba(235, 235, 235, 0.07)',
		marker: '#ffffff',
		markerGlow: 'rgba(255, 255, 255, 0.3)',
		label: '#f0f0f0',
		labelHalo: 'rgba(11, 11, 11, 0.9)',
		regionLabel: 'rgba(235, 235, 235, 0.55)',
		terrainLabel: 'rgba(235, 235, 235, 0.5)',
		atmosphere: '#9a9a9a',
		card: 'rgba(12, 12, 12, 0.85)',
		cardText: '#f5f5f5',
		landOverRaster: 0.35,
		forest: 'rgba(235, 235, 235, 0.08)',
		park: 'rgba(235, 235, 235, 0.06)',
		roadCasing: 'rgba(11, 11, 11, 0.8)',
		roadFill: 'rgba(235, 235, 235, 0.85)',
		rail: 'rgba(235, 235, 235, 0.5)'
	}
};

export interface RasterPatch {
	image: CanvasImageSource;
	lon0: number;
	lat0: number;
	lon1: number;
	lat1: number;
	/** Web-mercator patch: rows are spaced in Mercator y, not latitude. */
	mercator?: boolean;
}

/** OpenStreetMap detail around one stop (see src/lib/server/osm.ts for the shape). */
export interface OsmLayers {
	bounds: { lon0: number; lat0: number; lon1: number; lat1: number };
	roads: Array<{ c: number; g: number[] }>;
	rails: number[][];
	rivers: Array<{ major: boolean; g: number[] }>;
	water: number[][];
	forest: number[][];
	parks: number[][];
	places: Array<{ n: string; t: string; lat: number; lon: number; pop: number }>;
	peaks: Array<{ n: string; lat: number; lon: number; ele: number | null }>;
	airports: Array<{ n: string; lat: number; lon: number }>;
}

export interface DrawOptions {
	width: number;
	height: number;
	project: Projection;
	theme: MapTheme;
	/** Device pixel ratio for line widths and fonts. */
	pixelRatio?: number;
	/** Leave water transparent (texture atlases let the shader colour it). */
	transparentWater?: boolean;
	/** Only for stereographic views: rings enclosing this point must be skipped. */
	viewCenter?: { lat: number; lon: number };
	graticuleDeg?: number;
	markers?: readonly PhotoPlace[];
	markerRadius?: number;
	labels?: readonly Place[];
	labelFontPx?: number;
	/** Ground width of the view in kilometres; selects which detail layers and names to draw. */
	widthKm?: number;
	detail?: DetailData | null;
	/** Raster earth imagery drawn under the vector layers. */
	raster?: readonly RasterPatch[];
	rasterOpacity?: number;
	/** Land fill opacity (defaults to 1, or theme.landOverRaster when raster is present). */
	landAlpha?: number;
	/** OpenStreetMap layers for the arrived place; drawn on top of the Natural Earth detail. */
	osm?: OsmLayers | null;
	/** Lon/lat window the canvas shows: lets bulky layers skip features outside it. */
	window?: { lon0: number; lat0: number; lon1: number; lat1: number };
	/** Settlements from the bundled GeoNames extract, already filtered for this view. */
	localPlaces?: readonly LocalPlace[];
	/** The place this stop is about: named first, larger, in the marker colour. */
	primaryPlace?: { name: string; lat: number; lon: number } | null;
}

// Feature bounding boxes, computed once per OSM payload.
const bboxCache = new WeakMap<number[], [number, number, number, number]>();
function bboxOf(g: number[]): [number, number, number, number] {
	let box = bboxCache.get(g);
	if (box) return box;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (let i = 0; i < g.length; i += 2) {
		if (g[i] < minX) minX = g[i];
		if (g[i] > maxX) maxX = g[i];
		if (g[i + 1] < minY) minY = g[i + 1];
		if (g[i + 1] > maxY) maxY = g[i + 1];
	}
	box = [minX, minY, maxX, maxY];
	bboxCache.set(g, box);
	return box;
}

function inWindow(g: number[], w: { lon0: number; lat0: number; lon1: number; lat1: number } | undefined): boolean {
	if (!w) return true;
	const [minX, minY, maxX, maxY] = bboxOf(g);
	return maxX >= w.lon0 && minX <= w.lon1 && maxY >= w.lat0 && minY <= w.lat1;
}

/** Project a ring into screen coordinates; returns null when nothing is visible. */
function projectRing(ring: Float64Array, options: DrawOptions, antipodeLonLat: [number, number] | null, closed = true): Float64Array | null {
	if (closed && antipodeLonLat && ringContains(ring, antipodeLonLat[0], antipodeLonLat[1])) return null;
	const out = new Float64Array(ring.length);
	let n = 0;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	const wrap = options.project.wrapWidth ?? 0;
	let shift = 0;
	let previousX = NaN;
	for (let i = 0; i < ring.length; i += 2) {
		const p = options.project(ring[i], ring[i + 1]);
		if (!p) continue;
		if (wrap) {
			// Keep the ring contiguous: a jump of more than half a turn means the
			// seam fell inside this ring (Alaska when the view is centred on Europe).
			let x = p[0] + shift;
			if (!Number.isNaN(previousX)) {
				if (x - previousX > wrap / 2) { shift -= wrap; x -= wrap; }
				else if (previousX - x > wrap / 2) { shift += wrap; x += wrap; }
			}
			previousX = x;
			p[0] = x;
		}
		out[n++] = p[0];
		out[n++] = p[1];
		if (p[0] < minX) minX = p[0];
		if (p[0] > maxX) maxX = p[0];
		if (p[1] < minY) minY = p[1];
		if (p[1] > maxY) maxY = p[1];
	}
	if (n < (closed ? 6 : 4)) return null;
	const margin = 4;
	if (maxX < -margin || maxY < -margin || minX > options.width + margin || minY > options.height + margin) return null;
	if (maxX - minX < 0.75 && maxY - minY < 0.75) return null;
	return n === out.length ? out : out.subarray(0, n);
}

function tracePath(ctx: CanvasRenderingContext2D, rings: Float64Array[], close = true): void {
	for (const ring of rings) {
		ctx.moveTo(ring[0], ring[1]);
		for (let i = 2; i < ring.length; i += 2) ctx.lineTo(ring[i], ring[i + 1]);
		if (close) ctx.closePath();
	}
}

function drawGraticule(ctx: CanvasRenderingContext2D, options: DrawOptions, step: number, lineWidth: number): void {
	ctx.beginPath();
	for (let lon = -180; lon <= 180; lon += step) {
		let started = false;
		for (let lat = -85; lat <= 85; lat += 2) {
			const p = options.project(lon, lat);
			if (!p) { started = false; continue; }
			if (started) ctx.lineTo(p[0], p[1]);
			else ctx.moveTo(p[0], p[1]);
			started = true;
		}
	}
	for (let lat = -80; lat <= 80; lat += step) {
		let started = false;
		let previous: [number, number] | null = null;
		for (let lon = -180; lon <= 180; lon += 2) {
			const p = options.project(lon, lat);
			if (!p) { started = false; previous = null; continue; }
			if (started && previous && Math.abs(p[0] - previous[0]) > options.width) started = false;
			if (started) ctx.lineTo(p[0], p[1]);
			else ctx.moveTo(p[0], p[1]);
			started = true;
			previous = p;
		}
	}
	ctx.strokeStyle = options.theme.graticule;
	ctx.lineWidth = lineWidth;
	ctx.stroke();
}

/**
 * Raster patches are equirectangular; the view usually is not. Each patch is
 * drawn as a grid of small affine cells, which follows the projection closely
 * enough that seams stay under a pixel.
 */
function drawRaster(ctx: CanvasRenderingContext2D, options: DrawOptions): void {
	const patches = options.raster ?? [];
	if (!patches.length) return;
	ctx.save();
	ctx.globalAlpha = options.rasterOpacity ?? 1;
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	for (const patch of patches) {
		const source = patch.image as { width?: number; height?: number };
		const sw = source.width ?? 256;
		const sh = source.height ?? 256;
		const cells = 6;
		const dLon = (patch.lon1 - patch.lon0) / cells;
		const dLat = (patch.lat1 - patch.lat0) / cells;
		const yTop = mercatorY(patch.lat1);
		const dY = (yTop - mercatorY(patch.lat0)) / cells;
		const rowLat = (j: number) => (patch.mercator ? mercatorLat(yTop - j * dY) : patch.lat1 - j * dLat);
		for (let i = 0; i < cells; i++) {
			for (let j = 0; j < cells; j++) {
				const lon0 = patch.lon0 + i * dLon;
				const lat1 = rowLat(j);
				const p00 = options.project(lon0, lat1);
				const p10 = options.project(lon0 + dLon, lat1);
				const p01 = options.project(lon0, rowLat(j + 1));
				if (!p00 || !p10 || !p01) continue;
				// Cull cells clearly outside the canvas.
				const xs = [p00[0], p10[0], p01[0]];
				const ys = [p00[1], p10[1], p01[1]];
				if (Math.max(...xs) < -50 || Math.min(...xs) > options.width + 50 || Math.max(...ys) < -50 || Math.min(...ys) > options.height + 50) continue;
				const sx = (i * sw) / cells;
				const sy = (j * sh) / cells;
				const cw = sw / cells;
				const ch = sh / cells;
				// Affine map: source cell (0,0)-(cw,ch) → destination triangle basis.
				const a = (p10[0] - p00[0]) / cw;
				const b = (p10[1] - p00[1]) / cw;
				const c = (p01[0] - p00[0]) / ch;
				const d = (p01[1] - p00[1]) / ch;
				ctx.setTransform(a, b, c, d, p00[0], p00[1]);
				// Overlap neighbours by a pixel: adjacent cells and blocks must not leave a seam.
				const scale = Math.hypot(a, b) || 1;
				const bleed = Math.max(0.75, 1.2 / scale);
				ctx.drawImage(patch.image, sx, sy, cw, ch, -bleed, -bleed, cw + 2 * bleed, ch + 2 * bleed);
			}
		}
	}
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.restore();
}

export function drawMap(ctx: CanvasRenderingContext2D, world: WorldData, options: DrawOptions): void {
	const { width, height, theme } = options;
	const dpr = options.pixelRatio ?? 1;
	const widthKm = options.widthKm ?? 40_000;
	const antipodeLonLat: [number, number] | null = options.viewCenter
		? (([lat, lon]) => [lon, lat])(antipode(options.viewCenter.lat, options.viewCenter.lon))
		: null;
	const hasRaster = !!options.raster?.length;
	const landAlpha = options.landAlpha ?? (hasRaster ? theme.landOverRaster : 1);

	ctx.save();
	ctx.clearRect(0, 0, width, height);
	if (!options.transparentWater) {
		const gradient = ctx.createLinearGradient(0, 0, 0, height);
		gradient.addColorStop(0, theme.water);
		gradient.addColorStop(1, theme.waterDeep);
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, width, height);
	}
	drawRaster(ctx, options);

	if (options.graticuleDeg) drawGraticule(ctx, options, options.graticuleDeg, Math.max(0.5, 0.7 * dpr));

	// Land: one path per country so holes (lakes, enclaves) resolve with even-odd.
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	const coastWidth = Math.max(0.6, 0.9 * dpr);
	const projected: Array<{ rings: Float64Array[] }> = [];
	for (const country of world.countries) {
		const rings: Float64Array[] = [];
		for (const ring of country.rings) {
			const screen = projectRing(ring, options, antipodeLonLat);
			if (screen) rings.push(screen);
		}
		if (rings.length) projected.push({ rings });
	}
	if (landAlpha > 0) {
		ctx.save();
		ctx.globalAlpha = landAlpha;
		ctx.fillStyle = theme.land;
		for (const country of projected) {
			ctx.beginPath();
			tracePath(ctx, country.rings);
			ctx.fill('evenodd');
		}
		ctx.restore();
	}

	// Detail layers under the coastlines: urban areas, then regions, rivers, roads.
	const detail = options.detail;
	const showRegions = !!detail && widthKm <= 6000;
	const showRivers = !!detail && widthKm <= 3000;
	const showUrban = !!detail && widthKm <= 1500;
	const showRoads = !!detail && widthKm <= 900;
	if (detail && showUrban) {
		const rings: Float64Array[] = [];
		for (const ring of detail.urban) {
			const screen = projectRing(ring, options, antipodeLonLat);
			if (screen) rings.push(screen);
		}
		if (rings.length) {
			ctx.beginPath();
			tracePath(ctx, rings);
			ctx.fillStyle = theme.urban;
			ctx.fill();
		}
	}
	if (detail && showRegions) {
		const rings: Float64Array[] = [];
		for (const region of detail.regions) {
			for (const ring of region.rings) {
				const screen = projectRing(ring, options, antipodeLonLat);
				if (screen) rings.push(screen);
			}
		}
		if (rings.length) {
			ctx.beginPath();
			tracePath(ctx, rings);
			ctx.strokeStyle = theme.region;
			ctx.lineWidth = Math.max(0.5, 0.7 * dpr);
			ctx.setLineDash([4 * dpr, 3 * dpr]);
			ctx.stroke();
			ctx.setLineDash([]);
		}
	}
	if (detail && showRivers) {
		const maxRank = widthKm > 1500 ? 4 : widthKm > 600 ? 6 : 8;
		ctx.strokeStyle = theme.river;
		for (const weightClass of [0, 1]) {
			ctx.beginPath();
			for (const river of detail.rivers) {
				if (river.rank > maxRank) continue;
				const major = river.rank <= 3;
				if ((weightClass === 0) !== major) continue;
				const screen = projectRing(river.line, options, antipodeLonLat, false);
				if (screen) tracePath(ctx, [screen], false);
			}
			ctx.lineWidth = Math.max(0.5, (weightClass === 0 ? 1.3 : 0.7) * dpr);
			ctx.stroke();
		}
	}
	if (detail && showRoads) {
		const minWeight = widthKm > 400 ? 3 : widthKm > 150 ? 2 : 1;
		for (const weight of [1, 2, 3]) {
			if (weight < minWeight) continue;
			ctx.beginPath();
			for (const road of detail.roads) {
				if (road.weight !== weight) continue;
				const screen = projectRing(road.line, options, antipodeLonLat, false);
				if (screen) tracePath(ctx, [screen], false);
			}
			ctx.strokeStyle = weight >= 2 ? theme.road : theme.roadMinor;
			ctx.lineWidth = Math.max(0.5, (weight === 3 ? 1.4 : weight === 2 ? 0.9 : 0.6) * dpr);
			ctx.stroke();
		}
	}

	// OpenStreetMap detail for the arrived place: areas, then water, rails, roads.
	const osm = options.osm;
	if (osm && widthKm <= 2500) drawOsm(ctx, osm, options, dpr, widthKm, antipodeLonLat);

	ctx.beginPath();
	for (const country of projected) tracePath(ctx, country.rings);
	ctx.strokeStyle = theme.coast;
	ctx.lineWidth = coastWidth;
	ctx.stroke();

	// Lakes sit on top of land.
	const lakeRings: Float64Array[] = [];
	for (const lake of world.lakes) {
		const screen = projectRing(lake, options, antipodeLonLat);
		if (screen) lakeRings.push(screen);
	}
	if (lakeRings.length) {
		ctx.beginPath();
		tracePath(ctx, lakeRings);
		if (options.transparentWater) {
			ctx.save();
			ctx.globalCompositeOperation = 'destination-out';
			ctx.fill();
			ctx.restore();
		} else if (!hasRaster) {
			ctx.fillStyle = theme.water;
			ctx.fill();
		}
		ctx.strokeStyle = theme.coast;
		ctx.lineWidth = coastWidth * 0.7;
		ctx.stroke();
	}

	if (options.markers?.length) {
		const radius = options.markerRadius ?? 3 * dpr;
		for (const marker of options.markers) {
			const p = options.project(marker.lon, marker.lat);
			if (!p || p[0] < -radius || p[1] < -radius || p[0] > width + radius || p[1] > height + radius) continue;
			ctx.beginPath();
			ctx.arc(p[0], p[1], radius * 2.2, 0, Math.PI * 2);
			ctx.fillStyle = theme.markerGlow;
			ctx.fill();
			ctx.beginPath();
			ctx.arc(p[0], p[1], radius, 0, Math.PI * 2);
			ctx.fillStyle = theme.marker;
			ctx.fill();
		}
	}

	if (options.labels?.length || options.osm || options.localPlaces?.length || (detail && widthKm <= 6000)) drawLabels(ctx, options, dpr, widthKm);
	ctx.restore();
}

/** Roads by class, with a dark casing under the major ones so they read on imagery. */
function drawOsm(ctx: CanvasRenderingContext2D, osm: OsmLayers, options: DrawOptions, dpr: number, widthKm: number, antipodeLonLat: [number, number] | null): void {
	const { theme } = options;
	const w = options.window;
	const toScreen = (g: number[], closed: boolean) => (inWindow(g, w) ? projectRing(Float64Array.from(g), options, antipodeLonLat, closed) : null);
	const fillRings = (rings: number[][], style: string) => {
		const screens: Float64Array[] = [];
		for (const ring of rings) {
			const screen = toScreen(ring, true);
			if (screen) screens.push(screen);
		}
		if (!screens.length) return;
		ctx.beginPath();
		tracePath(ctx, screens);
		ctx.fillStyle = style;
		ctx.fill('evenodd');
	};
	// Only lakes worth a pixel at this scale; tiny ponds just add noise.
	const minSpan = (widthKm / 3000) * 0.5;
	fillRings(osm.water.filter((ring) => { const [x0, y0, x1, y1] = bboxOf(ring); return Math.max(x1 - x0, y1 - y0) >= minSpan; }), theme.water);
	if (osm.water.length) {
		ctx.strokeStyle = theme.coast;
		ctx.lineWidth = Math.max(0.4, 0.5 * dpr);
		ctx.stroke();
	}

	// Rivers: major always, canals and minor when close.
	for (const major of [false, true]) {
		if (!major && widthKm > 300) continue;
		ctx.beginPath();
		let any = false;
		for (const river of osm.rivers) {
			if (river.major !== major) continue;
			const screen = toScreen(river.g, false);
			if (screen) { tracePath(ctx, [screen], false); any = true; }
		}
		if (!any) continue;
		ctx.strokeStyle = theme.river;
		ctx.lineWidth = Math.max(0.5, (major ? 1.5 : 0.8) * dpr);
		ctx.stroke();
	}

	if (osm.rails.length && widthKm <= 600) {
		ctx.beginPath();
		for (const rail of osm.rails) {
			const screen = toScreen(rail, false);
			if (screen) tracePath(ctx, [screen], false);
		}
		ctx.strokeStyle = theme.rail;
		ctx.lineWidth = Math.max(0.5, 0.9 * dpr);
		ctx.setLineDash([5 * dpr, 3 * dpr]);
		ctx.stroke();
		ctx.setLineDash([]);
	}

	// Roads: motorways always, primary within a region, secondary only close up. Never streets.
	const maxClass = widthKm <= 250 ? 3 : 2;
	const widths = [2.4, 2.0, 1.6, 1.2, 0.85, 0.6];
	const paths: Float64Array[][] = [[], [], [], [], [], []];
	for (const road of osm.roads) {
		if (road.c > maxClass) continue;
		const screen = toScreen(road.g, false);
		if (screen) paths[road.c].push(screen);
	}
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	for (let c = maxClass; c >= 0; c--) {
		if (!paths[c].length) continue;
		if (c <= 2) {
			ctx.beginPath();
			tracePath(ctx, paths[c], false);
			ctx.strokeStyle = theme.roadCasing;
			ctx.lineWidth = Math.max(0.8, (widths[c] + 1.4) * dpr);
			ctx.stroke();
		}
		ctx.beginPath();
		tracePath(ctx, paths[c], false);
		ctx.strokeStyle = c <= 2 ? theme.roadFill : c === 3 ? theme.road : theme.roadMinor;
		ctx.lineWidth = Math.max(0.5, widths[c] * dpr);
		ctx.stroke();
	}
}

interface LabelJob {
	text: string;
	x: number;
	y: number;
	kind: 'primary' | 'city' | 'capital' | 'village' | 'region' | 'terrain' | 'water';
	priority: number;
}

function drawLabels(ctx: CanvasRenderingContext2D, options: DrawOptions, dpr: number, widthKm: number): void {
	const fontPx = options.labelFontPx ?? 13 * dpr;
	const jobs: LabelJob[] = [];
	// Every name once: the sources overlap, and a repeated name reads as an error.
	const used = new Set<string>();
	const inView = (p: [number, number] | null): p is [number, number] =>
		!!p && p[0] >= 0 && p[1] >= 0 && p[0] <= options.width && p[1] <= options.height;

	for (const place of options.labels ?? []) {
		const p = options.project(place.lon, place.lat);
		if (!inView(p)) continue;
		jobs.push({ text: place.name, x: p[0], y: p[1], kind: place.capital === 2 ? 'capital' : 'city', priority: 100 + place.capital * 10 + Math.min(9, Math.log10(place.population + 1)) });
	}
	const detail = options.detail;
	if (detail) {
		if (widthKm <= 4000) {
			for (const region of detail.regions) {
				if (!region.center) continue;
				const p = options.project(region.center[1], region.center[0]);
				if (!inView(p)) continue;
				jobs.push({ text: region.name.toUpperCase(), x: p[0], y: p[1], kind: 'region', priority: 40 });
			}
		}
		for (const name of detail.names) {
			const maxRank = widthKm > 4000 ? 1 : widthKm > 1500 ? 3 : widthKm > 500 ? 5 : 7;
			if (name.rank > maxRank) continue;
			const p = options.project(name.lon, name.lat);
			if (!inView(p)) continue;
			jobs.push({ text: name.name, x: p[0], y: p[1], kind: name.kind === 'lake' || name.kind === 'river' ? 'water' : 'terrain', priority: 30 - name.rank });
		}
	}
	const primary = options.primaryPlace;
	if (primary) {
		const p = options.project(primary.lon, primary.lat);
		if (inView(p)) {
			jobs.push({ text: primary.name, x: p[0], y: p[1], kind: 'primary', priority: 1000 });
			used.add(primary.name);
		}
	}
	for (const place of options.localPlaces ?? []) {
		if (used.has(place.name)) continue;
		const p = options.project(place.lon, place.lat);
		if (!inView(p)) continue;
		used.add(place.name);
		const big = place.rank >= 3 || place.population >= 40_000;
		jobs.push({
			text: place.name,
			x: p[0],
			y: p[1],
			kind: place.rank === 4 ? 'capital' : big ? 'city' : 'village',
			priority: 70 + place.rank * 8 + Math.min(9, Math.log10(place.population + 1))
		});
	}
	// OSM settlements only fill gaps the bundled list does not cover.
	const named = used;
	const osm = options.osm;
	if (osm && widthKm <= 2500 && !options.localPlaces?.length) {
		const rank: Record<string, number> = { city: 5, town: 4, village: 3, suburb: 2, hamlet: 1, neighbourhood: 0 };
		const minRank = widthKm <= 40 ? 0 : widthKm <= 120 ? 1 : widthKm <= 300 ? 2 : widthKm <= 800 ? 3 : 4;
		for (const place of osm.places) {
			const r = rank[place.t] ?? 0;
			if (r < minRank || named.has(place.n)) continue;
			named.add(place.n);
			const p = options.project(place.lon, place.lat);
			if (!inView(p)) continue;
			jobs.push({ text: place.n, x: p[0], y: p[1], kind: r >= 4 ? 'city' : 'village', priority: 60 + r * 10 + Math.min(9, Math.log10(place.pop + 1)) });
		}
		if (widthKm <= 300) {
			// Real mountains only: the ten highest in view, and nothing under 300 m.
			const peaks = osm.peaks
				.filter((peak) => (peak.ele ?? 0) >= 300)
				.map((peak) => ({ peak, p: options.project(peak.lon, peak.lat) }))
				.filter((entry): entry is { peak: typeof osm.peaks[number]; p: [number, number] } => inView(entry.p))
				.sort((a, b) => (b.peak.ele ?? 0) - (a.peak.ele ?? 0))
				.slice(0, 10);
			for (const { peak, p } of peaks) {
				jobs.push({ text: `▲ ${peak.n} ${peak.ele} m`, x: p[0], y: p[1], kind: 'terrain', priority: 25 });
			}
			for (const airport of osm.airports) {
				const p = options.project(airport.lon, airport.lat);
				if (!inView(p)) continue;
				jobs.push({ text: `✈ ${airport.n}`, x: p[0], y: p[1], kind: 'terrain', priority: 28 });
			}
		}
	}
	jobs.sort((a, b) => b.priority - a.priority);

	const placed: Array<[number, number, number, number]> = [];
	const overlaps = (box: [number, number, number, number]) =>
		placed.some((other) => box[0] < other[0] + other[2] && box[0] + box[2] > other[0] && box[1] < other[1] + other[3] && box[1] + box[3] > other[1]);
	ctx.textBaseline = 'middle';
	ctx.lineJoin = 'round';
	let cityCount = 0;
	// The caller has already chosen how many places to name; this only bounds
	// the fallback sources so nothing floods the screen.
	const cityLimit = widthKm > 4000 ? 8 : widthKm > 1500 ? 10 : 14;
	for (const job of jobs) {
		let font: string;
		let color: string;
		let align: CanvasTextAlign = 'left';
		let dx = 0;
		if (job.kind === 'primary') {
			font = `800 ${fontPx * 1.25}px system-ui, -apple-system, "Segoe UI", sans-serif`;
			color = options.theme.marker;
			dx = 4.5 * dpr + 7 * dpr;
		} else if (job.kind === 'city' || job.kind === 'capital') {
			if (cityCount >= cityLimit) continue;
			font = `${job.kind === 'capital' ? 700 : 600} ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
			color = options.theme.label;
			dx = (job.kind === 'capital' ? 3.2 : 2.2) * dpr + 5 * dpr;
		} else if (job.kind === 'village') {
			font = `500 ${fontPx * 0.8}px system-ui, -apple-system, "Segoe UI", sans-serif`;
			color = options.theme.label;
			dx = 1.6 * dpr + 4 * dpr;
		} else if (job.kind === 'region') {
			font = `600 ${fontPx * 0.78}px system-ui, -apple-system, "Segoe UI", sans-serif`;
			color = options.theme.regionLabel;
			align = 'center';
		} else {
			font = `italic 500 ${fontPx * 0.85}px Georgia, "Times New Roman", serif`;
			color = job.kind === 'water' ? options.theme.river : options.theme.terrainLabel;
			align = 'center';
		}
		ctx.font = font;
		ctx.textAlign = align;
		if (job.kind === 'region') ctx.letterSpacing = `${0.12 * fontPx * 0.78}px`;
		else ctx.letterSpacing = '0px';
		const textWidth = ctx.measureText(job.text).width;
		const size = job.kind === 'primary' ? fontPx * 1.25 : job.kind === 'region' ? fontPx * 0.78 : job.kind === 'city' || job.kind === 'capital' ? fontPx : job.kind === 'village' ? fontPx * 0.8 : fontPx * 0.85;
		const left = align === 'center' ? job.x - textWidth / 2 : job.x + dx;
		const box: [number, number, number, number] = [left - 3 * dpr, job.y - size * 0.7, textWidth + 6 * dpr, size * 1.4];
		if (overlaps(box)) continue;
		placed.push(box);
		if (job.kind === 'primary' || job.kind === 'city' || job.kind === 'capital' || job.kind === 'village') {
			if (job.kind === 'city' || job.kind === 'capital') cityCount++;
			const dot = job.kind === 'primary' ? 4.5 * dpr : job.kind === 'capital' ? 3.2 * dpr : job.kind === 'village' ? 1.6 * dpr : 2.2 * dpr;
			ctx.beginPath();
			if (job.kind === 'capital') ctx.rect(job.x - dot, job.y - dot, dot * 2, dot * 2);
			else ctx.arc(job.x, job.y, dot, 0, Math.PI * 2);
			ctx.fillStyle = job.kind === 'primary' ? options.theme.marker : options.theme.label;
			ctx.fill();
		}
		ctx.lineWidth = Math.max(3 * dpr, size * 0.28);
		ctx.strokeStyle = options.theme.labelHalo;
		ctx.strokeText(job.text, align === 'center' ? job.x : job.x + dx, job.y);
		ctx.fillStyle = color;
		ctx.fillText(job.text, align === 'center' ? job.x : job.x + dx, job.y);
	}
	ctx.letterSpacing = '0px';
}

/** Pick which populated places deserve a label for a view of the given ground width. */
export function labelsForView(places: readonly Place[], view: { lat: number; lon: number }, widthKm: number, limit = 40): Place[] {
	const spanDeg = widthKm / 111 / 2 + 1;
	const maxRank = widthKm > 4000 ? 2 : widthKm > 1500 ? 4 : widthKm > 500 ? 7 : widthKm > 150 ? 9 : 10;
	const cosLat = Math.max(0.2, Math.cos((view.lat * Math.PI) / 180));
	const out: Place[] = [];
	for (const place of places) {
		if (place.rank > maxRank) continue;
		if (Math.abs(place.lat - view.lat) > spanDeg || Math.abs(place.lon - view.lon) > spanDeg / cosLat) continue;
		out.push(place);
		if (out.length >= limit * 3) break;
	}
	return out
		.sort((a, b) => b.capital - a.capital || b.population - a.population)
		.slice(0, limit);
}

/** Convert a CSS colour to normalised RGB for the shader. */
export function colorToVec3(color: string): [number, number, number] {
	const hex = color.match(/^#([0-9a-f]{6})$/i);
	if (hex) {
		const n = parseInt(hex[1], 16);
		return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
	}
	const rgb = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
	if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
	return [0, 0, 0];
}
