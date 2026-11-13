// Open-Meteo current conditions (no API key). Cached 15 minutes per rounded
// location so a wall of frames doesn't hammer the free API.

export interface WeatherNow {
	temperature: number;
	weatherCode: number;
	isDay: boolean;
}

const CACHE_TTL_MS = 15 * 60_000;
const cache = new Map<string, { at: number; data: WeatherNow }>();

export async function getWeather(
	lat: number,
	lon: number,
	units: 'celsius' | 'fahrenheit'
): Promise<WeatherNow> {
	const key = `${lat.toFixed(1)}:${lon.toFixed(1)}:${units}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

	const url = new URL('https://api.open-meteo.com/v1/forecast');
	url.searchParams.set('latitude', String(lat));
	url.searchParams.set('longitude', String(lon));
	url.searchParams.set('current', 'temperature_2m,weather_code,is_day');
	url.searchParams.set('temperature_unit', units);

	const res = await fetch(url);
	if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
	const body = (await res.json()) as {
		current: { temperature_2m: number; weather_code: number; is_day: number };
	};

	const data: WeatherNow = {
		temperature: body.current.temperature_2m,
		weatherCode: body.current.weather_code,
		isDay: body.current.is_day === 1
	};
	cache.set(key, { at: Date.now(), data });
	return data;
}
