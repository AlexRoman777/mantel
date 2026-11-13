<script lang="ts">
	import { onMount } from 'svelte';

	let {
		style = 'digital',
		showDate,
		showSeconds,
		format24h,
		locale
	}: {
		style?: 'digital' | 'analog';
		showDate: boolean;
		showSeconds: boolean;
		format24h: boolean;
		locale: 'en-GB' | 'sv-SE' | 'ro-RO' | 'en-US';
	} = $props();

	let now = $state(new Date());

	onMount(() => {
		const tick = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(tick);
	});

	const time = $derived(
		now.toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
			second: showSeconds ? '2-digit' : undefined,
			hour12: !format24h
		})
	);

	const date = $derived(locale === 'en-GB'
		? `${new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(now)} ${now.getDate()}${ordinal(now.getDate())} of ${new Intl.DateTimeFormat(locale, { month: 'long' }).format(now)}, ${now.getFullYear()}`
		: new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(now));
	const hourDegrees = $derived((now.getHours() % 12 + now.getMinutes() / 60) * 30);
	const minuteDegrees = $derived((now.getMinutes() + now.getSeconds() / 60) * 6);
	const secondDegrees = $derived(now.getSeconds() * 6);

	function ordinal(day: number): string {
		if (day >= 11 && day <= 13) return 'th';
		return day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
	}
</script>

<div class="clock" class:analog={style === 'analog'}>
	{#if style === 'analog'}
		<div class="dial" aria-label={time}>
			{#each Array(12) as _, index}
				<i class="tick" style={`--tick: ${index * 30}deg`}></i>
			{/each}
			<span class="hand hour" style={`--angle: ${hourDegrees}deg`}></span>
			<span class="hand minute" style={`--angle: ${minuteDegrees}deg`}></span>
			{#if showSeconds}<span class="hand second" style={`--angle: ${secondDegrees}deg`}></span>{/if}
			<b class="pin"></b>
		</div>
	{:else}
		<div class="time">{time}</div>
	{/if}
	{#if showDate}
		<div class="date">{date}</div>
	{/if}
</div>

<style>
	.clock {
		color: var(--overlay-text);
		text-shadow: var(--overlay-shadow);
		line-height: 1.1;
	}

	.clock.analog { display: grid; justify-items: center; gap: 0.5rem; }
	.dial {
		position: relative;
		width: clamp(8rem, 13vw, 17rem);
		aspect-ratio: 1;
		border: clamp(2px, 0.12vw, 4px) solid currentColor;
		border-radius: 50%;
		box-shadow: 0 0.4rem 1.5rem rgba(0, 0, 0, 0.32);
	}
	.tick {
		position: absolute;
		inset: 5%;
		transform: rotate(var(--tick));
		transform-origin: 50% 50%;
	}
	.tick::before {
		content: '';
		display: block;
		width: 2px;
		height: 7%;
		margin: 0 auto;
		background: currentColor;
		border-radius: 2px;
		opacity: 0.78;
	}
	.hand {
		position: absolute;
		left: calc(50% - 1.5px);
		bottom: 50%;
		width: 3px;
		border-radius: 3px;
		background: currentColor;
		transform: rotate(var(--angle));
		transform-origin: 50% 100%;
	}
	.hand.hour { height: 26%; }
	.hand.minute { height: 36%; width: 2px; left: calc(50% - 1px); }
	.hand.second { height: 39%; width: 1px; left: calc(50% - 0.5px); color: #ff6347; background: currentColor; }
	.pin { position: absolute; width: 5%; aspect-ratio: 1; border-radius: 50%; background: #ff6347; left: 47.5%; top: 47.5%; }

	.time {
		font-size: clamp(3rem, 6vw, 8rem);
		font-weight: 520;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
	}

	.date {
		font-size: clamp(1.15rem, 2vw, 2.4rem);
		font-weight: 650;
		opacity: 0.9;
		margin-top: 0.2rem;
	}
</style>
