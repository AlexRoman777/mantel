// Contract shared by the shader globe and the Three.js globe so the stage can
// swap renderers without knowing how either draws.

import type { MapTheme } from './render';

export interface GlView {
	mode: 'flat' | 'globe';
	/** Globe only: 0 = orthographic, 1 = stereographic (matches the crisp canvas at zoom). */
	blend: number;
	lat: number;
	lon: number;
	/** Pixels per projection unit, in this canvas's device pixels. */
	scale: number;
	/** Pixel offset of the projection centre from the canvas centre (device px, y down). */
	offsetX: number;
	offsetY: number;
}

export interface DetailBounds {
	lon0: number;
	lat0: number;
	lon1: number;
	lat1: number;
}

export interface SunState {
	/** 'studio': light fixed to the camera. 'real': sun position for the current time. */
	mode: 'studio' | 'real';
	/** Subsolar point in degrees (real mode). */
	lat: number;
	lon: number;
}

export interface MapRenderer {
	readonly canvas: HTMLCanvasElement;
	readonly maxTextureSize: number;
	readonly name: 'shader' | 'three';
	resize(width: number, height: number): void;
	setTheme(theme: MapTheme): void;
	/** Vector atlas: equirectangular, transparent water, alpha marks land. */
	setWorld(source: TexImageSource): void;
	/** Raster earth imagery (equirectangular RGB) or null for vector-only. */
	setRaster(source: TexImageSource | null): void;
	/** Night lights (equirectangular) or null. */
	setNight(source: TexImageSource | null): void;
	/** Higher-resolution composited atlases for a lon/lat window; level 1 is tighter than level 0. */
	setDetail(level: 0 | 1, source: TexImageSource | null, bounds?: DetailBounds): void;
	setSun(sun: SunState): void;
	render(view: GlView): void;
	destroy(): void;
}

export interface MapResourcePolicy {
	constrained: boolean;
	animationWidthPx: number;
	earthTextureSize: '4k' | '8k';
	detailAtlasPx: 2048 | 4096;
	sentinelCacheEntries: number;
	baseTileCacheEntries: number;
}

/**
 * Keep decoded imagery and GPU textures inside a predictable envelope. A Pi 5
 * normally reports four logical cores even when `deviceMemory` is unavailable,
 * so either signal is enough to select the conservative policy.
 */
export function mapResourcePolicy(
	cores: number | undefined,
	memoryGb: number | undefined,
	maxTextureSize = 4096
): MapResourcePolicy {
	const constrained = (typeof cores === 'number' && cores > 0 && cores <= 4)
		|| (typeof memoryGb === 'number' && memoryGb > 0 && memoryGb <= 8);
	const use8k = !constrained && maxTextureSize >= 8192;
	return {
		constrained,
		animationWidthPx: constrained ? 1920 : 2560,
		earthTextureSize: use8k ? '8k' : '4k',
		detailAtlasPx: use8k ? 4096 : 2048,
		// One 4096px decoded block is about 64 MiB. Six cover the largest
		// normal 4K stop window; uploaded atlases no longer need their inputs.
		sentinelCacheEntries: constrained ? 6 : 12,
		// The 2048px Blue Marble blocks are about 16 MiB decoded each.
		baseTileCacheEntries: constrained ? 12 : 24
	};
}

/** Subsolar point for a moment in time (degrees). Good to a fraction of a degree. */
export function subsolarPoint(date: Date): { lat: number; lon: number } {
	const dayOfYear = (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000;
	const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
	const γ = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24);
	const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(γ) - 0.032077 * Math.sin(γ) - 0.014615 * Math.cos(2 * γ) - 0.040849 * Math.sin(2 * γ));
	const decl = 0.006918 - 0.399912 * Math.cos(γ) + 0.070257 * Math.sin(γ) - 0.006758 * Math.cos(2 * γ) + 0.000907 * Math.sin(2 * γ) - 0.002697 * Math.cos(3 * γ) + 0.00148 * Math.sin(3 * γ);
	const lon = -((hours * 60 + eqTime - 720) / 4);
	return { lat: (decl * 180) / Math.PI, lon: ((lon + 540) % 360) - 180 };
}
