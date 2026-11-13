import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEG, stereographicProjection, type View } from './geo';

/**
 * The shader inverse-projects each pixel back to a coordinate; the Canvas 2D
 * renderer projects coordinates forward to pixels. If the two ever disagree,
 * the vector overlay slides off the imagery underneath it. This is the shader's
 * globe branch, transcribed from map-gl.ts, so the round trip can be checked
 * without a GPU.
 */
function shaderInverse(px: number, py: number, view: { lat: number; lon: number; scale: number }, blend: number): { lat: number; lon: number } | null {
	const x = px / view.scale;
	const y = py / view.scale;
	const r = Math.hypot(x, y);
	if (r > 1 && blend < 0.999) return null;
	const c = (1 - blend) * Math.asin(Math.min(r, 1)) + blend * (2 * Math.atan(r * 0.5));
	const sc = Math.sin(c);
	const cc = Math.cos(c);
	const rr = Math.max(r, 1e-6);
	const sinLat0 = Math.sin(view.lat * DEG);
	const cosLat0 = Math.cos(view.lat * DEG);
	const lat = Math.asin(Math.max(-1, Math.min(1, cc * sinLat0 + (y * sc * cosLat0) / rr)));
	const lon = view.lon * DEG + Math.atan2(x * sc, rr * cosLat0 * cc - y * sinLat0 * sc);
	return { lat: lat / DEG, lon: (((lon / DEG + 540) % 360) - 180) };
}

const PLACES = [
	{ name: 'Täby', lat: 59.44, lon: 18.07 },
	{ name: 'Iași', lat: 47.16, lon: 27.59 },
	{ name: 'Ponta Delgada', lat: 37.75, lon: -25.67 },
	{ name: 'Sydney', lat: -33.87, lon: 151.21 },
	{ name: 'Quito', lat: -0.18, lon: -78.47 }
];

describe('globe coordinates', () => {
	it('round-trips every coordinate between the shader and the vector renderer', () => {
		for (const place of PLACES) {
			const view: View = { lat: place.lat, lon: place.lon, scale: 900, cx: 0, cy: 0 };
			const project = stereographicProjection(view);
			for (const target of PLACES) {
				const screen = project(target.lon, target.lat);
				if (!screen) continue;
				// The canvas has y downwards, the shader upwards.
				const back = shaderInverse(screen[0], -screen[1], { lat: place.lat, lon: place.lon, scale: 900 }, 1);
				expect(back).not.toBeNull();
				expect(back!.lat).toBeCloseTo(target.lat, 4);
				expect(back!.lon).toBeCloseTo(target.lon, 4);
			}
		}
	});

	it('puts the centre of the view at the centre of the screen, north upwards and east to the right', () => {
		const view = { lat: 59.44, lon: 18.07, scale: 900 };
		expect(shaderInverse(0, 0, view, 0)).toEqual({ lat: expect.closeTo(59.44, 6), lon: expect.closeTo(18.07, 6) });
		// A pixel above the centre is further north; a pixel to the right is further east.
		expect(shaderInverse(0, 20, view, 0)!.lat).toBeGreaterThan(59.44);
		expect(shaderInverse(20, 0, view, 0)!.lon).toBeGreaterThan(18.07);
		// The world view is orthographic, so nothing outside the disc is land.
		expect(shaderInverse(1200, 0, view, 0)).toBeNull();
	});

	it('turns the Three.js globe so the chosen place faces the camera, north up', () => {
		// Same orientation as map-three.ts: rotate about Y by -lon, then X by +lat.
		for (const place of PLACES) {
			const globe = new THREE.Object3D();
			globe.rotation.set(place.lat * DEG, -place.lon * DEG, 0, 'XYZ');
			globe.updateMatrixWorld(true);
			const lat = place.lat * DEG;
			const lon = place.lon * DEG;
			// Sphere positions in map-three.ts: x = cos·sin(lon), y = sin(lat), z = cos·cos(lon).
			const point = new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
			const camera = point.clone().applyMatrix4(globe.matrixWorld);
			// The place ends up on the axis pointing at the camera.
			expect(camera.z).toBeCloseTo(1, 5);
			expect(camera.x).toBeCloseTo(0, 5);
			expect(camera.y).toBeCloseTo(0, 5);

			// A point due north of it sits higher on the screen, one due east to the right.
			const north = new THREE.Vector3(
				Math.cos(lat + 0.05) * Math.sin(lon),
				Math.sin(lat + 0.05),
				Math.cos(lat + 0.05) * Math.cos(lon)
			).applyMatrix4(globe.matrixWorld);
			const east = new THREE.Vector3(
				Math.cos(lat) * Math.sin(lon + 0.05),
				Math.sin(lat),
				Math.cos(lat) * Math.cos(lon + 0.05)
			).applyMatrix4(globe.matrixWorld);
			// East of the centre moves right by cos(latitude), so allow for meridians
			// converging towards the poles.
			expect(north.y).toBeGreaterThan(0.04);
			expect(east.x).toBeCloseTo(Math.cos(lat) * Math.sin(0.05), 3);
			expect(east.x).toBeGreaterThan(0.02);
		}
	});

	it('samples the equirectangular atlas at the same place both renderers read', () => {
		// Both shaders sample with u = lon/2π + 0.5 and v = 0.5 − lat/π, which is
		// how the atlas is drawn (equirectangularProjection over the whole globe).
		const uv = (lat: number, lon: number) => ({ u: ((lon * DEG) / (2 * Math.PI) + 0.5 + 1) % 1, v: 0.5 - (lat * DEG) / Math.PI });
		expect(uv(0, 0)).toEqual({ u: 0.5, v: 0.5 });
		expect(uv(90, -180).v).toBeCloseTo(0, 6);
		expect(uv(-90, 0).v).toBeCloseTo(1, 6);
		expect(uv(0, 90).u).toBeCloseTo(0.75, 6);
		expect(uv(0, -90).u).toBeCloseTo(0.25, 6);
	});
});
