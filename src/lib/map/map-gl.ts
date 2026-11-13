// WebGL renderer for the animated map. One full-screen fragment shader inverse-
// projects every pixel (globe or Mercator), samples the raster earth (or a flat
// water colour), lays the vector atlas on top and lights it either from a fixed
// studio lamp or from the real sun with night lights on the dark side. Between
// flights the Canvas 2D renderer draws the crisp view on top; this canvas only
// needs to look right in motion and at world scale.

import { DEG } from './geo';
import { colorToVec3, type MapTheme } from './render';
import type { DetailBounds, GlView, MapRenderer, SunState } from './renderer';

const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform vec2 u_center;
uniform float u_scale;
uniform vec2 u_offset;
uniform float u_mode;
uniform float u_blend;
uniform vec3 u_light;
uniform float u_sunMode;
uniform vec3 u_sunDir;
uniform sampler2D u_world;
uniform sampler2D u_raster;
uniform float u_hasRaster;
uniform sampler2D u_night;
uniform float u_hasNight;
uniform sampler2D u_detail0;
uniform float u_hasDetail0;
uniform vec4 u_detail0Bounds;
uniform sampler2D u_detail1;
uniform float u_hasDetail1;
uniform vec4 u_detail1Bounds;
uniform vec3 u_space;
uniform vec3 u_water;
uniform vec3 u_waterDeep;
uniform vec3 u_atmo;
const float PI = 3.141592653589793;

bool inside(vec4 b, float lon, float lat) {
	return lon > b.x && lon < b.z && lat > b.y && lat < b.w;
}

vec2 windowUv(vec4 b, float lon, float lat) {
	return vec2((lon - b.x) / (b.z - b.x), (b.w - lat) / (b.w - b.y));
}

void main() {
	vec2 p = (gl_FragCoord.xy - 0.5 * u_res - u_offset) / u_scale;
	float lon;
	float lat;
	float shade = 1.0;
	float spec = 0.0;
	vec3 rim = vec3(0.0);
	vec3 n = vec3(0.0, 0.0, 1.0);
	if (u_mode < 0.5) {
		if (abs(p.x) > PI) { gl_FragColor = vec4(u_space, 1.0); return; }
		lon = u_center.x + p.x;
		float y0 = log(tan(PI * 0.25 + u_center.y * 0.5));
		lat = 2.0 * atan(exp(p.y + y0)) - PI * 0.5;
		if (abs(lat) > 1.4835) { gl_FragColor = vec4(u_space, 1.0); return; }
	} else {
		float r = length(p);
		if (r > 1.0 && u_blend < 0.999) {
			float glow = smoothstep(1.14, 1.0, r) * (1.0 - u_blend);
			gl_FragColor = vec4(mix(u_space, u_atmo, glow * glow * 0.9), 1.0);
			return;
		}
		float c = mix(asin(min(r, 1.0)), 2.0 * atan(r * 0.5), u_blend);
		float sc = sin(c);
		float cc = cos(c);
		float rr = max(r, 1e-6);
		float sinLat0 = sin(u_center.y);
		float cosLat0 = cos(u_center.y);
		lat = asin(clamp(cc * sinLat0 + (p.y * sc * cosLat0) / rr, -1.0, 1.0));
		lon = u_center.x + atan(p.x * sc, rr * cosLat0 * cc - p.y * sinLat0 * sc);
		n = vec3(p.x / rr * sc, p.y / rr * sc, cc);
		float edge = pow(1.0 - cc, 2.6) * (1.0 - u_blend);
		rim = u_atmo * edge * 0.75;
	}

	// Lighting: studio lamp in view space, or the real sun in world space.
	float daylight = 1.0;
	if (u_sunMode > 0.5) {
		vec3 nWorld = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
		float sunDot = dot(nWorld, u_sunDir);
		daylight = smoothstep(-0.12, 0.10, sunDot);
		if (u_mode > 0.5) {
			shade = mix(0.38, 1.0, smoothstep(-0.08, 0.3, sunDot));
			vec3 h = normalize(u_light + vec3(0.0, 0.0, 1.0));
			spec = pow(max(dot(n, h), 0.0), 56.0) * 0.18 * daylight;
		} else {
			shade = 0.55 + 0.45 * daylight;
		}
	} else if (u_mode > 0.5) {
		float diff = max(dot(n, u_light), 0.0);
		shade = 0.52 + 0.55 * diff;
		vec3 h = normalize(u_light + vec3(0.0, 0.0, 1.0));
		spec = pow(max(dot(n, h), 0.0), 56.0) * 0.32;
	}

	vec2 uv = vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);
	vec4 land = texture2D(u_world, uv);
	float landMask = step(0.04, land.a);
	vec3 color;
	if (u_hasDetail1 > 0.5 && inside(u_detail1Bounds, lon, lat)) {
		color = texture2D(u_detail1, windowUv(u_detail1Bounds, lon, lat)).rgb;
	} else if (u_hasDetail0 > 0.5 && inside(u_detail0Bounds, lon, lat)) {
		color = texture2D(u_detail0, windowUv(u_detail0Bounds, lon, lat)).rgb;
	} else {
		vec3 base;
		if (u_hasRaster > 0.5) base = texture2D(u_raster, uv).rgb;
		else {
			float depth = 0.5 + 0.5 * sin(lat * 2.0 + 0.4) * cos(lon * 1.3);
			base = mix(u_waterDeep, u_water, 0.45 + 0.18 * depth);
		}
		color = mix(base, land.rgb, land.a);
	}
	color = color * shade + spec * (1.0 - landMask) + rim;
	if (u_hasNight > 0.5 && daylight < 0.999) {
		vec3 lights = texture2D(u_night, uv).rgb;
		color += lights * (1.0 - daylight) * 1.7;
	}
	gl_FragColor = vec4(color, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('shader allocation failed');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(`shader compile failed: ${log}`);
	}
	return shader;
}

const UNIFORMS = [
	'u_res', 'u_center', 'u_scale', 'u_offset', 'u_mode', 'u_blend', 'u_light', 'u_sunMode', 'u_sunDir',
	'u_world', 'u_raster', 'u_hasRaster', 'u_night', 'u_hasNight',
	'u_detail0', 'u_hasDetail0', 'u_detail0Bounds', 'u_detail1', 'u_hasDetail1', 'u_detail1Bounds',
	'u_space', 'u_water', 'u_waterDeep', 'u_atmo'
];

export class MapGL implements MapRenderer {
	readonly name = 'shader' as const;
	private gl: WebGLRenderingContext;
	private program: WebGLProgram;
	private uniforms = new Map<string, WebGLUniformLocation | null>();
	private textures: Record<'world' | 'raster' | 'night' | 'detail0' | 'detail1', WebGLTexture>;
	private has = { raster: false, night: false, detail0: false, detail1: false };
	private detailBounds: [DetailBounds, DetailBounds] = [{ lon0: 0, lat0: 0, lon1: 0, lat1: 0 }, { lon0: 0, lat0: 0, lon1: 0, lat1: 0 }];
	private theme: MapTheme | null = null;
	private sun: SunState = { mode: 'studio', lat: 0, lon: 0 };
	readonly maxTextureSize: number;

	constructor(readonly canvas: HTMLCanvasElement) {
		const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
		if (!gl) throw new Error('WebGL unavailable');
		this.gl = gl;
		this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
		const program = gl.createProgram();
		if (!program) throw new Error('program allocation failed');
		gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
		gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
		this.program = program;
		gl.useProgram(program);

		const buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const position = gl.getAttribLocation(program, 'a_pos');
		gl.enableVertexAttribArray(position);
		gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

		for (const name of UNIFORMS) this.uniforms.set(name, gl.getUniformLocation(program, name));
		this.textures = {
			world: this.createTexture(),
			raster: this.createTexture(),
			night: this.createTexture(),
			detail0: this.createTexture(),
			detail1: this.createTexture()
		};
		gl.uniform1i(this.uniforms.get('u_world')!, 0);
		gl.uniform1i(this.uniforms.get('u_raster')!, 1);
		gl.uniform1i(this.uniforms.get('u_night')!, 2);
		gl.uniform1i(this.uniforms.get('u_detail0')!, 3);
		gl.uniform1i(this.uniforms.get('u_detail1')!, 4);
	}

	private createTexture(): WebGLTexture {
		const gl = this.gl;
		const texture = gl.createTexture();
		if (!texture) throw new Error('texture allocation failed');
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		return texture;
	}

	private upload(texture: WebGLTexture, unit: number, source: TexImageSource, wrapX: boolean): void {
		const gl = this.gl;
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapX ? gl.REPEAT : gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.generateMipmap(gl.TEXTURE_2D);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	}

	setWorld(source: TexImageSource): void {
		this.upload(this.textures.world, 0, source, true);
	}

	setRaster(source: TexImageSource | null): void {
		this.has.raster = !!source;
		if (source) this.upload(this.textures.raster, 1, source, true);
	}

	setNight(source: TexImageSource | null): void {
		this.has.night = !!source;
		if (source) this.upload(this.textures.night, 2, source, true);
	}

	setDetail(level: 0 | 1, source: TexImageSource | null, bounds?: DetailBounds): void {
		const key = level === 0 ? 'detail0' : 'detail1';
		if (!source || !bounds) {
			this.has[key] = false;
			return;
		}
		this.upload(this.textures[key], level === 0 ? 3 : 4, source, false);
		this.detailBounds[level] = bounds;
		this.has[key] = true;
	}

	setTheme(theme: MapTheme): void {
		this.theme = theme;
	}

	setSun(sun: SunState): void {
		this.sun = sun;
	}

	resize(width: number, height: number): void {
		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width;
			this.canvas.height = height;
		}
		this.gl.viewport(0, 0, width, height);
	}

	render(view: GlView): void {
		const gl = this.gl;
		const u = (name: string) => this.uniforms.get(name)!;
		const theme = this.theme;
		gl.useProgram(this.program);
		gl.uniform2f(u('u_res'), this.canvas.width, this.canvas.height);
		gl.uniform2f(u('u_center'), view.lon * DEG, view.lat * DEG);
		gl.uniform1f(u('u_scale'), view.scale);
		gl.uniform2f(u('u_offset'), view.offsetX, -view.offsetY);
		gl.uniform1f(u('u_mode'), view.mode === 'globe' ? 1 : 0);
		gl.uniform1f(u('u_blend'), view.blend);
		const light = [-0.45, 0.55, 0.7];
		const length = Math.hypot(...light);
		gl.uniform3f(u('u_light'), light[0] / length, light[1] / length, light[2] / length);
		gl.uniform1f(u('u_sunMode'), this.sun.mode === 'real' ? 1 : 0);
		const sLat = this.sun.lat * DEG;
		const sLon = this.sun.lon * DEG;
		gl.uniform3f(u('u_sunDir'), Math.cos(sLat) * Math.cos(sLon), Math.cos(sLat) * Math.sin(sLon), Math.sin(sLat));
		gl.uniform1f(u('u_hasRaster'), this.has.raster ? 1 : 0);
		gl.uniform1f(u('u_hasNight'), this.has.night ? 1 : 0);
		gl.uniform1f(u('u_hasDetail0'), this.has.detail0 ? 1 : 0);
		gl.uniform1f(u('u_hasDetail1'), this.has.detail1 ? 1 : 0);
		for (const level of [0, 1] as const) {
			const b = this.detailBounds[level];
			gl.uniform4f(u(`u_detail${level}Bounds`), b.lon0 * DEG, b.lat0 * DEG, b.lon1 * DEG, b.lat1 * DEG);
		}
		gl.uniform3f(u('u_space'), ...colorToVec3(theme?.space ?? '#000000'));
		gl.uniform3f(u('u_water'), ...colorToVec3(theme?.water ?? '#10294a'));
		gl.uniform3f(u('u_waterDeep'), ...colorToVec3(theme?.waterDeep ?? '#0a1a33'));
		gl.uniform3f(u('u_atmo'), ...colorToVec3(theme?.atmosphere ?? '#4f8fd8'));
		const bind = (unit: number, texture: WebGLTexture) => {
			gl.activeTexture(gl.TEXTURE0 + unit);
			gl.bindTexture(gl.TEXTURE_2D, texture);
		};
		bind(0, this.textures.world);
		bind(1, this.textures.raster);
		bind(2, this.textures.night);
		bind(3, this.textures.detail0);
		bind(4, this.textures.detail1);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	destroy(): void {
		const gl = this.gl;
		for (const texture of Object.values(this.textures)) gl.deleteTexture(texture);
		gl.deleteProgram(this.program);
		gl.getExtension('WEBGL_lose_context')?.loseContext();
	}
}
