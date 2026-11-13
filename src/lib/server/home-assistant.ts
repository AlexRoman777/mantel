import { env } from '$env/dynamic/private';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
	url: z.string().url().refine((value) => /^https?:\/\//.test(value), 'HTTP(S) URL required'),
	token: z.string().min(16)
});

type HomeAssistantConnection = z.infer<typeof schema>;
let cached: HomeAssistantConnection | null | undefined;
const filePath = () => path.join(env.DATA_DIR || './data', 'home-assistant.json');

async function load(): Promise<HomeAssistantConnection | null> {
	if (cached !== undefined) return cached;
	try { cached = schema.parse(JSON.parse(await fs.readFile(filePath(), 'utf8'))); }
	catch { cached = null; }
	return cached;
}

async function request(connection: HomeAssistantConnection, endpoint: string): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 8_000);
	try {
		return await fetch(`${connection.url.replace(/\/$/, '')}${endpoint}`, {
			headers: { Authorization: `Bearer ${connection.token}` },
			signal: controller.signal
		});
	} finally { clearTimeout(timer); }
}

export async function testHomeAssistant(input: unknown): Promise<HomeAssistantConnection> {
	const connection = schema.parse(input);
	const response = await request(connection, '/api/');
	if (!response.ok) throw new Error(`Home Assistant returned ${response.status}`);
	return { ...connection, url: connection.url.replace(/\/$/, '') };
}

export async function saveHomeAssistant(connection: HomeAssistantConnection): Promise<void> {
	await fs.mkdir(path.dirname(filePath()), { recursive: true });
	const temp = `${filePath()}.tmp`;
	await fs.writeFile(temp, JSON.stringify(connection, null, '\t'), { mode: 0o600 });
	await fs.rename(temp, filePath());
	await fs.chmod(filePath(), 0o600);
	cached = connection;
}

export async function clearHomeAssistant(): Promise<void> {
	await fs.unlink(filePath()).catch(() => {});
	cached = null;
}

export async function getHomeAssistantStatus(): Promise<{ configured: boolean; url: string | null }> {
	const connection = await load();
	return { configured: Boolean(connection), url: connection?.url ?? null };
}

export interface HomeAssistantWeatherEntity {
	entityId: string;
	name: string;
	condition: string;
	temperature: number | null;
}

export async function getHomeAssistantWeatherEntities(): Promise<HomeAssistantWeatherEntity[]> {
	const connection = await load();
	if (!connection) return [];
	const response = await request(connection, '/api/states');
	if (!response.ok) throw new Error(`Home Assistant returned ${response.status}`);
	const states = await response.json() as Array<{ entity_id?: string; state?: string; attributes?: Record<string, unknown> }>;
	if (!Array.isArray(states)) throw new Error('Home Assistant returned an invalid entity list');
	return states
		.filter((state) => typeof state.entity_id === 'string' && state.entity_id.startsWith('weather.'))
		.map((state) => ({
			entityId: state.entity_id!,
			name: typeof state.attributes?.friendly_name === 'string' ? state.attributes.friendly_name : state.entity_id!,
			condition: state.state ?? 'unknown',
			temperature: Number.isFinite(Number(state.attributes?.temperature)) ? Number(state.attributes?.temperature) : null
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

const conditionCodes: Record<string, number> = {
	clear: 0, 'clear-night': 0, sunny: 0, partlycloudy: 2, cloudy: 3, fog: 45,
	rainy: 63, pouring: 65, snowy: 73, 'snowy-rainy': 68, hail: 77,
	lightning: 95, 'lightning-rainy': 96, windy: 2, 'windy-variant': 3, exceptional: 3
};

export async function getHomeAssistantWeather(entityId: string, units: 'celsius' | 'fahrenheit') {
	if (!/^weather\.[a-z0-9_]+$/.test(entityId)) throw new Error('A weather.* entity is required');
	const connection = await load();
	if (!connection) throw new Error('Home Assistant is not configured');
	const response = await request(connection, `/api/states/${encodeURIComponent(entityId)}`);
	if (!response.ok) throw new Error(`Home Assistant returned ${response.status}`);
	const state = (await response.json()) as { state?: string; attributes?: Record<string, unknown> };
	const attributes = state.attributes ?? {};
	let temperature = Number(attributes.temperature);
	if (!Number.isFinite(temperature)) throw new Error('Weather entity has no temperature');
	const sourceUnit = String(attributes.temperature_unit ?? '°C').toUpperCase();
	if (units === 'fahrenheit' && sourceUnit.includes('C')) temperature = temperature * 9 / 5 + 32;
	if (units === 'celsius' && sourceUnit.includes('F')) temperature = (temperature - 32) * 5 / 9;
	const condition = state.state ?? 'cloudy';
	return {
		temperature,
		weatherCode: conditionCodes[condition] ?? 3,
		isDay: condition !== 'clear-night',
		locationName: typeof attributes.friendly_name === 'string' ? attributes.friendly_name : undefined,
		condition,
		humidity: typeof attributes.humidity === 'number' ? attributes.humidity : null
	};
}
