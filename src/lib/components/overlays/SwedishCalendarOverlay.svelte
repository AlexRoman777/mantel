<script lang="ts">
	import { onMount } from 'svelte';

	let { slug, showHolidays, showNameDays, showWeekNumber, region }: {
		slug: string;
		showHolidays: boolean;
		showNameDays: boolean;
		showWeekNumber: boolean;
		region: 'SE' | 'RO' | 'US' | 'GLOBAL';
	} = $props();

	interface CalendarDay {
		week: number | null;
		nameDays: string[];
		holiday: string | null;
		flagDay: string | null;
		isRedDay: boolean;
	}

	let day = $state<CalendarDay | null>(null);
	async function refresh(): Promise<void> {
		try {
			const response = await fetch(`/api/widgets/swedish-calendar?slug=${encodeURIComponent(slug)}`);
			day = response.ok ? await response.json() : null;
		} catch { day = null; }
	}

	onMount(() => {
		void refresh();
		const timer = setInterval(refresh, 6 * 60 * 60_000);
		return () => clearInterval(timer);
	});
</script>

{#if day && ((showNameDays && day.nameDays.length) || (showHolidays && (day.holiday || day.flagDay || day.isRedDay)) || (showWeekNumber && day.week))}
	<div class="calendar" aria-label={`${region} calendar`}>
		{#if showHolidays && (day.holiday || day.flagDay)}
			<strong class="holiday">{day.holiday || day.flagDay}</strong>
		{:else if showHolidays && day.isRedDay}
			<strong class="holiday">{region === 'SE' ? 'Röd dag' : 'Public holiday'}</strong>
		{/if}
		{#if showNameDays && day.nameDays.length}
			<span>{region === 'SE' ? 'Namnsdag' : 'Name day'} <strong>{day.nameDays.join(' · ')}</strong></span>
		{/if}
		{#if showWeekNumber && day.week}<span>{region === 'SE' ? 'Vecka' : region === 'RO' ? 'Săptămâna' : 'Week'} <strong>{day.week}</strong></span>{/if}
	</div>
{/if}

<style>
	.calendar {
		display: grid;
		gap: 0.2rem;
		color: var(--overlay-text);
		font-size: clamp(1rem, 1.45vw, 1.8rem);
		font-weight: 560;
		line-height: 1.25;
		text-shadow: var(--overlay-shadow);
	}
	.calendar strong { font-weight: 780; }
	.holiday { color: #ff6347; }
</style>
