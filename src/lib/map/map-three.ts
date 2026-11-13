// Three.js globe: a real textured sphere with a perspective camera, for
// comparison with the full-screen shader renderer. Same textures, same
// lighting model (studio lamp or real sun with night lights), same contract.
// Only the globe is drawn here; the flat map always uses the shader renderer.

import * as THREE from 'three';
import { DEG } from './geo';
import { colorToVec3, type MapTheme } from './render';
import type { DetailBounds, GlView, MapRenderer, SunState } from './renderer';

const GLOBE_VERTEX = `
varying vec3 vModel;
varying vec3 vViewNormal;
void main() {
	vModel = normalize(position);
	vViewNormal = normalize(normalMatrix * normal);
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLOBE_FRAGMENT = `
precision highp float;
varying vec3 vModel;
varying vec3 vViewNormal;
uniform sampler2D u_world;
uniform sampler2D u_raster;
uniform float u_hasRaster;
uniform sampler2D u_night;
uniform float u_hasNight;
uniform sampler2D u_detail;
uniform float u_hasDetail;
uniform vec4 u_detailBounds;
uniform float u_isPatch;
uniform vec3 u_light;
uniform float u_sunMode;
uniform vec3 u_sunDir;
uniform vec3 u_water;
uniform vec3 u_waterDeep;
const float PI = 3.141592653589793;

void main() {
	vec3 m = normalize(vModel);
	float lat = asin(clamp(m.y, -1.0, 1.0));
	float lon = atan(m.x, m.z);
	vec2 uv = vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);
	vec3 nWorld = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));

	float daylight = 1.0;
	float shade;
	float spec;
	vec3 viewLight = normalize(u_light);
	if (u_sunMode > 0.5) {
		float sunDot = dot(nWorld, u_sunDir);
		daylight = smoothstep(-0.12, 0.10, sunDot);
		shade = mix(0.38, 1.0, smoothstep(-0.08, 0.3, sunDot));
		vec3 h = normalize(viewLight + vec3(0.0, 0.0, 1.0));
		spec = pow(max(dot(vViewNormal, h), 0.0), 56.0) * 0.18 * daylight;
	} else {
		float diff = max(dot(vViewNormal, viewLight), 0.0);
		shade = 0.52 + 0.55 * diff;
		vec3 h = normalize(viewLight + vec3(0.0, 0.0, 1.0));
		spec = pow(max(dot(vViewNormal, h), 0.0), 56.0) * 0.32;
	}

	vec3 color;
	float landMask;
	if (u_isPatch > 0.5) {
		vec2 duv = vec2((lon - u_detailBounds.x) / (u_detailBounds.z - u_detailBounds.x), (u_detailBounds.w - lat) / (u_detailBounds.w - u_detailBounds.y));
		color = texture2D(u_detail, duv).rgb;
		landMask = 1.0;
	} else {
		vec4 land = texture2D(u_world, uv);
		landMask = step(0.04, land.a);
		vec3 base;
		if (u_hasRaster > 0.5) base = texture2D(u_raster, uv).rgb;
		else {
			float depth = 0.5 + 0.5 * sin(lat * 2.0 + 0.4) * cos(lon * 1.3);
			base = mix(u_waterDeep, u_water, 0.45 + 0.18 * depth);
		}
		color = mix(base, land.rgb, land.a);
	}
	color = color * shade + spec * (1.0 - landMask);
	if (u_hasNight > 0.5 && daylight < 0.999 && u_isPatch < 0.5) {
		color += texture2D(u_night, uv).rgb * (1.0 - daylight) * 1.7;
	}
	gl_FragColor = vec4(color, 1.0);
}
`;

const ATMOSPHERE_VERTEX = `
varying vec3 vViewNormal;
void main() {
	vViewNormal = normalize(normalMatrix * normal);
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ATMOSPHERE_FRAGMENT = `
precision highp float;
varying vec3 vViewNormal;
uniform vec3 u_color;
void main() {
	float intensity = pow(0.72 - dot(vViewNormal, vec3(0.0, 0.0, 1.0)), 2.0);
	gl_FragColor = vec4(u_color, 1.0) * intensity * 1.4;
}
`;

/** Lat/lon grid sphere (or a window of it) with model positions x = cos·sin(lon), y = sin(lat), z = cos·cos(lon). */
function sphereGeometry(radius: number, lat0: number, lat1: number, lon0: number, lon1: number, rows: number, columns: number): THREE.BufferGeometry {
	const positions = new Float32Array((rows + 1) * (columns + 1) * 3);
	const normals = new Float32Array(positions.length);
	const indices: number[] = [];
	let k = 0;
	for (let r = 0; r <= rows; r++) {
		const lat = (lat0 + ((lat1 - lat0) * r) / rows) * DEG;
		for (let c = 0; c <= columns; c++) {
			const lon = (lon0 + ((lon1 - lon0) * c) / columns) * DEG;
			const x = Math.cos(lat) * Math.sin(lon);
			const y = Math.sin(lat);
			const z = Math.cos(lat) * Math.cos(lon);
			positions[k] = x * radius;
			positions[k + 1] = y * radius;
			positions[k + 2] = z * radius;
			normals[k] = x;
			normals[k + 1] = y;
			normals[k + 2] = z;
			k += 3;
		}
	}
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < columns; c++) {
			const a = r * (columns + 1) + c;
			const b = a + columns + 1;
			// Counter-clockwise seen from outside, so the near hemisphere is the front face.
			indices.push(a, a + 1, b, a + 1, b + 1, b);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
	geometry.setIndex(indices);
	return geometry;
}

function textureFrom(source: TexImageSource, wrapX: boolean): THREE.Texture {
	const texture = new THREE.Texture(source as HTMLCanvasElement);
	// Same convention as the raw WebGL renderer: v = 0 is the first (northern) row.
	texture.flipY = false;
	texture.wrapS = wrapX ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = true;
	texture.anisotropy = 4;
	texture.colorSpace = THREE.NoColorSpace;
	texture.needsUpdate = true;
	return texture;
}

export class MapThree implements MapRenderer {
	readonly name = 'three' as const;
	readonly maxTextureSize: number;
	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera: THREE.PerspectiveCamera;
	private globe: THREE.Mesh;
	private material: THREE.ShaderMaterial;
	private atmosphere: THREE.Mesh;
	private atmosphereMaterial: THREE.ShaderMaterial;
	private patches: [THREE.Mesh | null, THREE.Mesh | null] = [null, null];
	private patchMaterials: [THREE.ShaderMaterial | null, THREE.ShaderMaterial | null] = [null, null];
	private sun: SunState = { mode: 'studio', lat: 0, lon: 0 };
	private readonly fov = 22;
	private empty = new THREE.Texture();

	private disposeOwnedTexture(texture: unknown): void {
		if (texture instanceof THREE.Texture && texture !== this.empty) texture.dispose();
	}

	constructor(readonly canvas: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
		this.renderer.setPixelRatio(1);
		this.maxTextureSize = this.renderer.capabilities.maxTextureSize;
		this.camera = new THREE.PerspectiveCamera(this.fov, 1, 0.01, 50);
		this.camera.position.set(0, 0, 6);
		this.material = new THREE.ShaderMaterial({
			vertexShader: GLOBE_VERTEX,
			fragmentShader: GLOBE_FRAGMENT,
			uniforms: {
				u_world: { value: this.empty },
				u_raster: { value: this.empty },
				u_hasRaster: { value: 0 },
				u_night: { value: this.empty },
				u_hasNight: { value: 0 },
				u_detail: { value: this.empty },
				u_hasDetail: { value: 0 },
				u_detailBounds: { value: new THREE.Vector4() },
				u_isPatch: { value: 0 },
				u_light: { value: new THREE.Vector3(-0.45, 0.55, 0.7).normalize() },
				u_sunMode: { value: 0 },
				u_sunDir: { value: new THREE.Vector3(1, 0, 0) },
				u_water: { value: new THREE.Vector3(0.06, 0.16, 0.29) },
				u_waterDeep: { value: new THREE.Vector3(0.04, 0.1, 0.2) }
			}
		});
		this.globe = new THREE.Mesh(sphereGeometry(1, -90, 90, -180, 180, 96, 192), this.material);
		this.scene.add(this.globe);
		this.atmosphereMaterial = new THREE.ShaderMaterial({
			vertexShader: ATMOSPHERE_VERTEX,
			fragmentShader: ATMOSPHERE_FRAGMENT,
			uniforms: { u_color: { value: new THREE.Vector3(0.31, 0.56, 0.85) } },
			side: THREE.BackSide,
			blending: THREE.AdditiveBlending,
			transparent: true,
			depthWrite: false
		});
		this.atmosphere = new THREE.Mesh(sphereGeometry(1.06, -90, 90, -180, 180, 48, 96), this.atmosphereMaterial);
		this.scene.add(this.atmosphere);
	}

	resize(width: number, height: number): void {
		this.renderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	}

	setTheme(theme: MapTheme): void {
		this.material.uniforms.u_water.value.set(...colorToVec3(theme.water));
		this.material.uniforms.u_waterDeep.value.set(...colorToVec3(theme.waterDeep));
		this.atmosphereMaterial.uniforms.u_color.value.set(...colorToVec3(theme.atmosphere));
		this.renderer.setClearColor(new THREE.Color(theme.space));
	}

	setWorld(source: TexImageSource): void {
		this.disposeOwnedTexture(this.material.uniforms.u_world.value);
		this.material.uniforms.u_world.value = textureFrom(source, true);
	}

	setRaster(source: TexImageSource | null): void {
		this.disposeOwnedTexture(this.material.uniforms.u_raster.value);
		this.material.uniforms.u_raster.value = source ? textureFrom(source, true) : this.empty;
		this.material.uniforms.u_hasRaster.value = source ? 1 : 0;
	}

	setNight(source: TexImageSource | null): void {
		this.disposeOwnedTexture(this.material.uniforms.u_night.value);
		this.material.uniforms.u_night.value = source ? textureFrom(source, true) : this.empty;
		this.material.uniforms.u_hasNight.value = source ? 1 : 0;
	}

	setDetail(level: 0 | 1, source: TexImageSource | null, bounds?: DetailBounds): void {
		const existing = this.patches[level];
		if (existing) {
			this.globe.remove(existing);
			existing.geometry.dispose();
			(this.patchMaterials[level]?.uniforms.u_detail.value as THREE.Texture)?.dispose?.();
			this.patchMaterials[level]?.dispose();
			this.patches[level] = null;
			this.patchMaterials[level] = null;
		}
		if (!source || !bounds) return;
		const material = this.material.clone();
		material.uniforms = THREE.UniformsUtils.clone(this.material.uniforms);
		material.uniforms.u_world.value = this.material.uniforms.u_world.value;
		material.uniforms.u_raster.value = this.material.uniforms.u_raster.value;
		material.uniforms.u_night.value = this.material.uniforms.u_night.value;
		material.uniforms.u_detail.value = textureFrom(source, false);
		material.uniforms.u_hasDetail.value = 1;
		material.uniforms.u_isPatch.value = 1;
		material.uniforms.u_detailBounds.value = new THREE.Vector4(bounds.lon0 * DEG, bounds.lat0 * DEG, bounds.lon1 * DEG, bounds.lat1 * DEG);
		material.polygonOffset = true;
		material.polygonOffsetFactor = -(level + 1);
		const mesh = new THREE.Mesh(sphereGeometry(1.0005 + level * 0.0005, bounds.lat0, bounds.lat1, bounds.lon0, bounds.lon1, 24, 32), material);
		this.globe.add(mesh);
		this.patches[level] = mesh;
		this.patchMaterials[level] = material;
	}

	setSun(sun: SunState): void {
		this.sun = sun;
	}

	render(view: GlView): void {
		const width = this.canvas.width;
		const height = this.canvas.height;
		// Orientation: bring (lat, lon) to the front (+Z): rotate about Y by -lon, then about X by +lat.
		this.globe.rotation.set(view.lat * DEG, -view.lon * DEG, 0, 'XYZ');
		this.atmosphere.rotation.copy(this.globe.rotation);

		// Camera distance so the globe's apparent radius equals view.scale pixels.
		const halfFov = (this.fov / 2) * DEG;
		const tanAlpha = Math.max(1e-4, (view.scale / (height / 2)) * Math.tan(halfFov));
		const alpha = Math.atan(tanAlpha);
		const distance = Math.max(1.02, 1 / Math.sin(Math.min(alpha, Math.PI / 2 - 1e-3)));
		// Lateral shift of camera and target keeps the direction and moves the globe on screen.
		const worldPerPixel = (distance * Math.tan(halfFov)) / (height / 2);
		const shiftX = -view.offsetX * worldPerPixel;
		const shiftY = view.offsetY * worldPerPixel;
		this.camera.position.set(shiftX, shiftY, distance);
		this.camera.lookAt(shiftX, shiftY, 0);
		this.camera.near = Math.max(0.005, distance - 1.2);
		this.camera.far = distance + 3;
		this.camera.updateProjectionMatrix();

		const sunUniforms = [this.material, ...this.patchMaterials].filter((m): m is THREE.ShaderMaterial => !!m);
		const sLat = this.sun.lat * DEG;
		const sLon = this.sun.lon * DEG;
		for (const material of sunUniforms) {
			material.uniforms.u_sunMode.value = this.sun.mode === 'real' ? 1 : 0;
			(material.uniforms.u_sunDir.value as THREE.Vector3).set(Math.cos(sLat) * Math.cos(sLon), Math.cos(sLat) * Math.sin(sLon), Math.sin(sLat));
			material.uniforms.u_hasRaster.value = this.material.uniforms.u_hasRaster.value;
			material.uniforms.u_hasNight.value = this.material.uniforms.u_hasNight.value;
		}
		this.renderer.setViewport(0, 0, width, height);
		this.renderer.render(this.scene, this.camera);
	}

	destroy(): void {
		for (const level of [0, 1] as const) this.setDetail(level, null);
		const textures = new Set<unknown>([
			this.material.uniforms.u_world.value,
			this.material.uniforms.u_raster.value,
			this.material.uniforms.u_night.value
		]);
		for (const texture of textures) this.disposeOwnedTexture(texture);
		this.empty.dispose();
		this.globe.geometry.dispose();
		this.atmosphere.geometry.dispose();
		this.material.dispose();
		this.atmosphereMaterial.dispose();
		this.renderer.dispose();
		this.renderer.forceContextLoss();
	}
}
