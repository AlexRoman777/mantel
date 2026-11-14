<script lang="ts">
	import type { TextAppearance } from '#lib/types.js';
	let {
		text,
		speedSec,
		position,
		background,
		appearance
	}: {
		text: string;
		speedSec: number;
		position: 'top' | 'bottom';
		background: boolean;
		appearance: TextAppearance;
	} = $props();
	const color = $derived(appearance.colorMode === 'dark' ? '#050505' : appearance.colorMode === 'custom' ? appearance.color : '#ffffff');
</script>

{#if text.trim()}
	<div class="ticker" class:top={position === 'top'} class:backdrop={background && appearance.colorMode !== 'inverse'} class:inverse={appearance.colorMode === 'inverse'} style="--overlay-text: {color}">
		<div class="track" style={`--ticker-seconds: ${speedSec}s; --text-scale: ${appearance.scale}`}>
			<span>{text}</span><i aria-hidden="true">•</i><span aria-hidden="true">{text}</span>
		</div>
	</div>
{/if}

<style>
	.ticker {
		position: absolute;
		z-index: 3;
		left: 0;
		right: 0;
		bottom: clamp(0.6rem, 1.25vw, 2rem);
		overflow: hidden;
		padding: clamp(0.55rem, 0.75vw, 1rem) 0;
		color: var(--overlay-text);
		font-size: clamp(1.15rem, 1.65vw, 2.5rem);
		font-weight: 600;
		letter-spacing: 0.015em;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
		white-space: nowrap;
	}
	.ticker.top { top: clamp(0.6rem, 1.25vw, 2rem); bottom: auto; }
	.ticker.backdrop { background: rgba(4, 6, 9, 0.6); backdrop-filter: blur(18px) saturate(120%); }
	.ticker.inverse { color: #fff; mix-blend-mode: difference; text-shadow: none; }
	.track { display: inline-flex; min-width: max-content; align-items: center; gap: 3rem; padding-left: 100%; animation: ticker var(--ticker-seconds) linear infinite; zoom: var(--text-scale); }
	.track i { opacity: 0.55; font-style: normal; }
	@keyframes ticker { to { transform: translateX(-50%); } }
	@media (prefers-reduced-motion: reduce) { .track { animation-duration: calc(var(--ticker-seconds) * 2); } }
</style>
