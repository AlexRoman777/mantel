<script lang="ts">
	import { onMount } from 'svelte';
	import type { DashboardWidget as Widget } from '$lib/types';

	let { widget, tickerIndex = 0 }: { widget: Widget; tickerIndex?: number } = $props();
	const quotes = [
		['The best thing about memories is making them.', 'Unknown'],
		['Life is what happens while you are busy making other plans.', 'John Lennon'],
		['No day is so bad it cannot be fixed with a nap.', 'Carrie Snow'],
		['Wherever you go, go with all your heart.', 'Confucius']
	] as const;
	const trivia = [
		'Octopuses have three hearts.',
		'A day on Venus is longer than a year on Venus.',
		'Honeybees communicate direction by dancing.',
		'The shortest scheduled flight in the world lasts about two minutes.'
	] as const;
	let rotationNow = $state(Date.now());
	const rotationMinutes = $derived(widget.type === 'quote' || widget.type === 'trivia' ? widget.refreshMinutes : 30);
	const rotation = $derived(Math.floor(rotationNow / (rotationMinutes * 60_000)));
	const quote = $derived(quotes[rotation % quotes.length]);
	const fact = $derived(trivia[rotation % trivia.length]);
	let meal = $state<{ school: string; days: Array<{ date: string; week: number; year: number; meals: string[] }> } | null>(null);
	let mealError = $state(false);
	let transit = $state<{ departures: Array<{ id: string; stop: string; line: string; destination: string; display: string; mode: 'train' | 'bus'; platform: string | null }>; attribution: string } | null>(null);
	let transitError = $state(false);
	const tickerText = $derived.by(() => {
		if (widget.type === 'message') return widget.text;
		if (widget.type === 'quote') return `“${quote[0]}” — ${quote[1]}`;
		if (widget.type === 'trivia') return `Did you know? ${fact}`;
		if (widget.type === 'school-meals') {
			if (!meal) return mealError ? 'School menu unavailable' : 'Loading school menu…';
			return `${widget.title || meal.school} · ${meal.days.map((day) => `${day.date}: ${day.meals.join(' / ')}`).join(' · ')}`;
		}
		if (!transit?.departures.length) return transitError ? 'SL traffic unavailable' : 'Loading departures…';
		return `${widget.title || 'Täby Park departures'} · ${transit.departures.map((departure) => `${departure.line} ${departure.destination} ${departure.display}`).join(' · ')} · ${transit.attribution}`;
	});

	async function refreshTransit(): Promise<void> {
		if (widget.type !== 'sl-departures') return;
		const params = new URLSearchParams({
			sites: widget.siteIds.join(','), max: String(widget.maxDepartures),
			trains: String(widget.showTrains), buses: String(widget.showBuses)
		});
		try {
			const response = await fetch(`/api/widgets/sl-departures?${params}`);
			if (!response.ok) throw new Error(String(response.status));
			transit = await response.json();
			transitError = false;
		} catch { transitError = true; }
	}

	onMount(() => {
		const rotationTimer = setInterval(() => (rotationNow = Date.now()), 60_000);
		let transitTimer: ReturnType<typeof setInterval> | undefined;
		if (widget.type === 'school-meals') {
			void fetch(`/api/widgets/school-meals?school=${encodeURIComponent(widget.schoolSlug)}`)
				.then(async (response) => {
					if (!response.ok) throw new Error(String(response.status));
					meal = await response.json();
				})
				.catch(() => (mealError = true));
		} else if (widget.type === 'sl-departures') {
			void refreshTransit();
			transitTimer = setInterval(refreshTransit, 60_000);
		}
		return () => { clearInterval(rotationTimer); clearInterval(transitTimer); };
	});
</script>

{#if widget.presentation !== 'card'}
	<div
		class="widget-ticker"
		class:top={widget.presentation === 'ticker-top'}
		style={`--ticker-index: ${tickerIndex}; --ticker-speed: ${widget.tickerSpeedSec}s`}
	>
		<span>{tickerText}</span>
	</div>
{:else}
<div class="widget" class:message={widget.type === 'message'}>
	{#if widget.type === 'message'}
		<p>{widget.text}</p>
	{:else if widget.type === 'quote'}
		<p>“{quote[0]}”</p>
		<small>{quote[1]} · new quote every {widget.refreshMinutes} min</small>
	{:else if widget.type === 'trivia'}
		<small>Did you know?</small>
		<p>{fact}</p>
	{:else if widget.type === 'school-meals'}
		<small>{widget.title || 'School lunch'}</small>
		{#if meal}
			<p class="school">{meal.school}</p>
			<div class="meal-window">
				<div class="meal-track" style="--meal-distance: -{Math.max(0, (meal.days.length - 1) * 12)}rem; --meal-duration: {Math.max(16, meal.days.length * 9)}s">
					{#each meal.days as menuDay}
						<section class="meal-day">
							<strong>{new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(`${menuDay.date}T12:00:00`))}</strong>
							<small>Week {menuDay.week} · {menuDay.date}</small>
							{#each menuDay.meals as item}<span class="meal">{item}</span>{/each}
						</section>
					{/each}
				</div>
			</div>
		{:else if mealError}
			<p class="muted">Menu unavailable</p>
		{:else}
			<p class="muted">Loading menu…</p>
		{/if}
	{:else}
		<small>{widget.title || 'Täby Park departures'}</small>
		{#if transit?.departures.length}
			<div class="departures">
				{#each transit.departures as departure (`${departure.id}-${departure.stop}-${departure.line}`)}
					<div class="departure">
						<strong class:train={departure.mode === 'train'}>{departure.line}</strong>
						<span>{departure.destination}<small>{departure.stop}{departure.platform ? ` · läge ${departure.platform}` : ''}</small></span>
						<b>{departure.display}</b>
					</div>
				{/each}
			</div>
			<small class="attribution">{transit.attribution}</small>
		{:else if transitError}<p class="muted">SL traffic unavailable</p>
		{:else}<p class="muted">Loading departures…</p>{/if}
	{/if}
</div>
{/if}

<style>
	.widget {
		max-width: min(46rem, 44vw);
		color: var(--overlay-text);
		text-shadow: var(--overlay-shadow);
		font-weight: 600;
	}
	.widget-ticker {
		position: absolute;
		z-index: 3;
		left: 0;
		right: 0;
		bottom: calc(var(--ticker-index) * 4.25rem);
		overflow: hidden;
		padding: 0.7rem 0;
		background: rgba(0, 0, 0, 0.68);
		color: var(--overlay-text);
		font-size: clamp(1.1rem, 1.8vw, 2.2rem);
		font-weight: 750;
		line-height: 1.2;
		white-space: nowrap;
		text-shadow: var(--overlay-shadow);
	}
	.widget-ticker.top { top: calc(var(--ticker-index) * 4.25rem); bottom: auto; }
	.widget-ticker span { display: inline-block; min-width: 100%; padding-left: 100%; animation: service-scroll var(--ticker-speed) linear infinite; }
	@keyframes service-scroll { to { transform: translateX(-100%); } }

	p { margin: 0; font-size: clamp(1.05rem, 1.65vw, 2rem); line-height: 1.35; }
	small { display: block; margin-top: 0.3rem; opacity: 0.72; font-size: clamp(0.85rem, 1vw, 1.2rem); }
	.meal { display: block; margin-top: 0.4rem; font-size: clamp(0.95rem, 1.15vw, 1.4rem); line-height: 1.35; }
	.school { font-weight: 650; }
	.meal-window { height: 12rem; overflow: hidden; margin-top: 0.5rem; }
	.meal-track {
		display: grid;
		grid-auto-rows: 12rem;
		animation: meal-scroll var(--meal-duration) linear infinite;
	}
	.meal-day { overflow: hidden; padding-top: 0.15rem; }
	.meal-day strong { display: block; text-transform: capitalize; font-size: clamp(1rem, 1.25vw, 1.5rem); }
	.meal-day small { margin: 0 0 0.25rem; }
	@keyframes meal-scroll {
		0%, 8% { transform: translateY(0); }
		100% { transform: translateY(var(--meal-distance)); }
	}
	.muted { opacity: 0.65; }
	.message p { font-size: clamp(1.2rem, 2.2vw, 2.7rem); }
	.departures { display: grid; gap: 0.38rem; margin-top: 0.45rem; min-width: min(34rem, 40vw); }
	.departure { display: grid; grid-template-columns: minmax(2.4rem, auto) 1fr auto; align-items: center; gap: 0.75rem; }
	.departure > strong { min-width: 2.4rem; color: #fff; background: #1477c9; border-radius: 0.28rem; padding: 0.12rem 0.35rem; text-align: center; text-shadow: none; }
	.departure > strong.train { background: #9b2d92; }
	.departure > span { font-size: clamp(0.95rem, 1.15vw, 1.45rem); font-weight: 680; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.departure > span small { margin: 0; }
	.departure > b { font-size: clamp(1rem, 1.3vw, 1.65rem); font-variant-numeric: tabular-nums; }
	.attribution { margin-top: 0.6rem; font-size: clamp(0.62rem, 0.7vw, 0.85rem); }
	@media (max-width: 36rem) {
		.widget { max-width: min(22rem, 82vw); }
	}
	@media (prefers-reduced-motion: reduce) {
		.meal-track { animation: none; }
	}
</style>
