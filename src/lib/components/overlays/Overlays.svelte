<script lang="ts">
	import { onMount } from 'svelte';
	import type { Corner, DisplayProfile, FaceInfo, SlideAsset } from '$lib/types';
	import DashboardWidget from './DashboardWidget.svelte';
	import PeopleOverlay from './PeopleOverlay.svelte';
	import ClockOverlay from './ClockOverlay.svelte';
	import MetaOverlay from './MetaOverlay.svelte';
	import WeatherOverlay from './WeatherOverlay.svelte';
	import TickerOverlay from './TickerOverlay.svelte';
	import SwedishCalendarOverlay from './SwedishCalendarOverlay.svelte';
	import TextStyle from './TextStyle.svelte';

	let {
		profile,
		currentSlide,
		faces = [],
		slides = [],
		facesBySlide = [],
		hidePhotoMetadata = false,
		hiddenOverlays = new Set()
	}: {
		profile: DisplayProfile;
		currentSlide: SlideAsset | null;
		faces?: FaceInfo[];
		slides?: SlideAsset[];
		facesBySlide?: FaceInfo[][];
		hidePhotoMetadata?: boolean;
		hiddenOverlays?: Set<'clock' | 'calendar' | 'weather'>;
	} = $props();

	const corners: Corner[] = [
		'top-left', 'top-center', 'top-right',
		'middle-left', 'center', 'middle-right',
		'bottom-left', 'bottom-center', 'bottom-right'
	];
	const o = $derived(profile.overlays);
	const pairedInfo = $derived(!hidePhotoMetadata && slides.length === 2 && (o.metadata.enabled || o.metadata.showPeople));

	// Burn-in mitigation: fade overlays completely, then return them at a new
	// safe offset. A "Never hide" choice still gets a slower position drift.
	let shift = $state({ x: 0, y: 0 });
	let hidden = $state(false);

	onMount(() => {
		let phaseTimer: ReturnType<typeof setTimeout> | undefined;
		let driftTimer: ReturnType<typeof setInterval> | undefined;
		const move = () => {
			const xRange = Math.max(8, Math.round(innerWidth * 0.012));
			const yRange = Math.max(6, Math.round(innerHeight * 0.012));
			shift = {
				x: Math.round(Math.random() * xRange * 2 - xRange),
				y: Math.round(Math.random() * yRange * 2 - yRange)
			};
		};
		const showPhase = () => {
			hidden = false;
			move();
			phaseTimer = setTimeout(hidePhase, Math.max(10, o.autoHideSec) * 1000);
		};
		const hidePhase = () => {
			hidden = true;
			phaseTimer = setTimeout(showPhase, 8_000);
		};
		if (o.autoHideSec > 0) phaseTimer = setTimeout(hidePhase, o.autoHideSec * 1000);
		else driftTimer = setInterval(move, 2 * 60_000);
		return () => {
			clearTimeout(phaseTimer);
			clearInterval(driftTimer);
		};
	});
</script>

<div
	class="overlays"
	class:hidden
	style="--burn-x: {shift.x}px; --burn-y: {shift.y}px"
>
	{#each corners as corner (corner)}
		<div class="corner {corner}" class:paired-reserved={pairedInfo && corner.startsWith('bottom-')}>
			{#if o.clock.enabled && !hiddenOverlays.has('clock') && o.clock.position === corner}
				<TextStyle appearance={o.clock.appearance}><ClockOverlay style={o.clock.style} showDate={o.clock.showDate} showSeconds={o.clock.showSeconds} format24h={o.clock.format24h} locale={o.clock.locale} /></TextStyle>
			{/if}
			{#if o.weather.enabled && !hiddenOverlays.has('weather') && o.weather.position === corner}
				<TextStyle appearance={o.weather.appearance}><WeatherOverlay
					slug={profile.slug}
					units={o.weather.units}
					locationName={o.weather.locationName}
				/></TextStyle>
			{/if}
			{#if o.calendar.enabled && !hiddenOverlays.has('calendar') && o.calendar.position === corner}
				<TextStyle appearance={o.calendar.appearance}><SwedishCalendarOverlay
					slug={profile.slug}
					showHolidays={o.calendar.showHolidays}
					showNameDays={o.calendar.showNameDays}
					showWeekNumber={o.calendar.showWeekNumber}
					region={o.calendar.region}
				/></TextStyle>
			{/if}
			{#if !hidePhotoMetadata && !pairedInfo && o.metadata.enabled && o.metadata.position === corner && currentSlide}
				<TextStyle appearance={o.metadata.appearance}><MetaOverlay
					slide={currentSlide}
					showDate={o.metadata.showDate}
					showLocation={o.metadata.showLocation}
					showCamera={o.metadata.showCamera}
					showRating={o.metadata.showRating}
				/></TextStyle>
			{/if}
			{#if !hidePhotoMetadata && !pairedInfo && o.metadata.showPeople && o.metadata.position === corner && currentSlide}
				<TextStyle appearance={o.metadata.appearance}><PeopleOverlay {faces} slide={currentSlide} showAge={o.metadata.showAge} showCards={o.metadata.showFaceCards} /></TextStyle>
			{/if}
			{#each o.widgets.filter((widget) => widget.enabled && widget.presentation === 'card' && widget.position === corner) as widget (widget.id)}
				<TextStyle appearance={widget.appearance}><DashboardWidget {widget} /></TextStyle>
			{/each}
		</div>
	{/each}
	{#each o.widgets.filter((widget) => widget.enabled && widget.presentation !== 'card') as widget, index (widget.id)}
		<TextStyle appearance={widget.appearance}><DashboardWidget {widget} tickerIndex={index} /></TextStyle>
	{/each}
	{#if pairedInfo}
		<div class="paired-info">
			{#each slides as image, index (image.id)}
				<div class="photo-info" class:right={index === 1}>
					<TextStyle appearance={o.metadata.appearance}>{#if o.metadata.enabled}
						<MetaOverlay slide={image} showDate={o.metadata.showDate} showLocation={o.metadata.showLocation} showCamera={o.metadata.showCamera} showRating={o.metadata.showRating} />
					{/if}
					{#if o.metadata.showPeople}
						<PeopleOverlay faces={facesBySlide[index] ?? []} slide={image} showAge={o.metadata.showAge} showCards={o.metadata.showFaceCards} />
					{/if}
					</TextStyle>
				</div>
			{/each}
		</div>
	{/if}
	{#if o.ticker.enabled}
		<TickerOverlay text={o.ticker.text} speedSec={o.ticker.speedSec} position={o.ticker.position} background={o.ticker.background} appearance={o.ticker.appearance} />
	{/if}
</div>

<style>
	.overlays {
		position: absolute;
		inset: 0;
		pointer-events: none;
		transition: opacity 1.5s ease, visibility 1.5s;
		z-index: 2;
	}

	.overlays.hidden {
		opacity: 0;
		visibility: hidden;
	}

	.corner {
		position: absolute;
		display: grid;
		gap: clamp(1rem, 1.5vw, 2rem);
		max-width: min(48%, 58rem);
	}

	.paired-info {
		position: absolute;
		top: var(--burn-y);
		right: calc(0px - var(--burn-x));
		bottom: calc(0px - var(--burn-y));
		left: var(--burn-x);
		display: grid;
		grid-template-columns: 1fr 1fr;
		pointer-events: none;
	}

	.photo-info {
		align-self: end;
		justify-self: start;
		display: grid;
		gap: 0.5rem;
		max-width: 88%;
		margin: clamp(1.5rem, 3vw, 5rem);
		text-align: left;
	}

	.photo-info.right { justify-self: end; justify-items: end; text-align: right; }
	.photo-info.right :global(.memory) { justify-self: end; }

	@media (orientation: portrait) {
		.paired-info { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
	}

	.top-left {
		top: calc(clamp(1.5rem, 3vw, 5rem) + var(--burn-y));
		left: calc(clamp(1.5rem, 3vw, 5rem) + var(--burn-x));
		justify-items: start;
		text-align: left;
	}

	.top-right {
		top: calc(clamp(1.5rem, 3vw, 5rem) + var(--burn-y));
		right: calc(clamp(1.5rem, 3vw, 5rem) - var(--burn-x));
		justify-items: end;
		text-align: right;
	}

	.top-center { top: calc(clamp(1.5rem, 3vw, 5rem) + var(--burn-y)); right: calc(0px - var(--burn-x)); left: var(--burn-x); width: max-content; margin-inline: auto; justify-items: center; text-align: center; }
	.middle-left { top: var(--burn-y); bottom: calc(0px - var(--burn-y)); left: calc(clamp(1.5rem, 3vw, 5rem) + var(--burn-x)); height: max-content; margin-block: auto; justify-items: start; text-align: left; }
	.center { inset: var(--burn-y) calc(0px - var(--burn-x)) calc(0px - var(--burn-y)) var(--burn-x); width: max-content; height: max-content; margin: auto; justify-items: center; text-align: center; }
	.middle-right { top: var(--burn-y); right: calc(clamp(1.5rem, 3vw, 5rem) - var(--burn-x)); bottom: calc(0px - var(--burn-y)); height: max-content; margin-block: auto; justify-items: end; text-align: right; }

	.bottom-left {
		bottom: calc(clamp(1.5rem, 3vw, 5rem) - var(--burn-y));
		left: calc(clamp(1.5rem, 3vw, 5rem) + var(--burn-x));
		justify-items: start;
		text-align: left;
	}

	.bottom-right {
		bottom: calc(clamp(1.5rem, 3vw, 5rem) - var(--burn-y));
		right: calc(clamp(1.5rem, 3vw, 5rem) - var(--burn-x));
		justify-items: end;
		text-align: right;
	}

	.bottom-center { right: calc(0px - var(--burn-x)); bottom: calc(clamp(1.5rem, 3vw, 5rem) - var(--burn-y)); left: var(--burn-x); width: max-content; margin-inline: auto; justify-items: center; text-align: center; }

	.bottom-left.paired-reserved,
	.bottom-center.paired-reserved,
	.bottom-right.paired-reserved {
		bottom: clamp(11rem, 22vh, 20rem);
	}

	/* Right-corner memory badges and meta blocks align to the right edge. */
	.top-right :global(.memory),
	.bottom-right :global(.memory) {
		justify-self: end;
	}
</style>
