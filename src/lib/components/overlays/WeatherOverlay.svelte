<script lang="ts">
	import { onMount } from 'svelte';

	let {
		slug,
		units,
		locationName
	}: {
		slug: string;
		units: 'celsius' | 'fahrenheit';
		locationName?: string;
	} = $props();

	interface WeatherNow {
		temperature: number;
		weatherCode: number;
		isDay: boolean;
		locationName?: string;
	}

	let weather = $state<WeatherNow[]>([]);

	async function refresh(): Promise<void> {
		try {
			const res = await fetch(`/api/weather?slug=${encodeURIComponent(slug)}`);
			const body = res.ok ? await res.json() as { locations?: WeatherNow[] } : null;
			weather = body?.locations ?? [];
		} catch {
			weather = []; // hide gracefully; the slideshow is unaffected
		}
	}

	onMount(() => {
		void refresh();
		const timer = setInterval(refresh, 15 * 60_000);
		return () => clearInterval(timer);
	});

	/** WMO weather code groups → icon name. */
	function icon(code: number, isDay: boolean): string {
		if (code === 0) return isDay ? 'sun' : 'moon';
		if (code <= 2) return isDay ? 'partly' : 'cloud-moon';
		if (code === 3) return 'cloud';
		if (code === 45 || code === 48) return 'fog';
		if (code <= 57) return 'drizzle';
		if (code <= 67) return 'rain';
		if (code <= 77) return 'snow';
		if (code <= 82) return 'rain';
		if (code <= 86) return 'snow';
		return 'thunder';
	}

</script>

{#if weather.length}
	<div class="weather-list">
	{#each weather as item (item.locationName)}
		{@const name = icon(item.weatherCode, item.isDay)}
	<div class="weather">
		<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
			{#if name === 'sun'}
				<circle cx="12" cy="12" r="4.5" />
				<path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
			{:else if name === 'moon'}
				<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
			{:else if name === 'partly'}
				<circle cx="8.5" cy="8.5" r="3.5" />
				<path d="M8.5 2.5v1.5M2.5 8.5H4M4.3 4.3l1 1M13 8.5h1.5" />
				<path d="M9 20h8.5a3.5 3.5 0 0 0 .5-7 5 5 0 0 0-9.6 1.2A3 3 0 0 0 9 20Z" />
			{:else if name === 'cloud-moon'}
				<path d="M17.5 8.5A5 5 0 0 1 12 3.5 5 5 0 1 0 17.5 8.5Z" />
				<path d="M7 20h8.5a3.5 3.5 0 0 0 .5-7 5 5 0 0 0-9.6 1.2A3 3 0 0 0 7 20Z" />
			{:else if name === 'cloud' || name === 'fog'}
				<path d="M7 17h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 17Z" />
				{#if name === 'fog'}<path d="M5 20h14M7 22.5h10" />{/if}
			{:else if name === 'drizzle' || name === 'rain'}
				<path d="M7 14h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 14Z" />
				{#if name === 'drizzle'}
					<path d="M9 17v1.5M13 17v1.5M17 17v1.5" />
				{:else}
					<path d="M9 17v3M13 17.5v3M17 17v3" />
				{/if}
			{:else if name === 'snow'}
				<path d="M7 14h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 14Z" />
				<path d="M9 17.5h.01M13 19h.01M17 17.5h.01M11 20.5h.01M15 21h.01" stroke-width="2.4" />
			{:else if name === 'thunder'}
				<path d="M7 13h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 13Z" />
				<path d="m12.5 15-2 3.5h3l-2 4" />
			{/if}
		</svg>
		<span class="temp">{Math.round(item.temperature)}°{units === 'celsius' ? '' : 'F'}</span>
		{#if item.locationName || locationName}
			<span class="place">{item.locationName || locationName}</span>
		{/if}
	</div>
	{/each}
	</div>
{/if}

<style>
	.weather-list { display: grid; gap: clamp(0.35rem, 0.7vw, 0.8rem); }
	.weather {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		color: var(--overlay-text);
		text-shadow: var(--overlay-shadow);
	}

	.icon {
		width: clamp(2.2rem, 3.4vw, 4.6rem);
		height: clamp(2.2rem, 3.4vw, 4.6rem);
		filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
	}

	.temp {
		font-size: clamp(1.8rem, 3vw, 4rem);
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}

	.place {
		font-size: clamp(1rem, 1.45vw, 1.7rem);
		opacity: 0.85;
		font-weight: 620;
		align-self: flex-end;
		margin-bottom: 0.3em;
	}
</style>
