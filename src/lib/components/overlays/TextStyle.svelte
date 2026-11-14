<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { TextAppearance } from '#lib/types.js';

	let { appearance, children }: { appearance: TextAppearance; children: Snippet } = $props();
	const resolvedColor = $derived(
		appearance.colorMode === 'dark' ? '#050505' : appearance.colorMode === 'custom' ? appearance.color : '#ffffff'
	);
</script>

<div
	class="text-style"
	class:inverse={appearance.colorMode === 'inverse'}
	style="--text-scale: {appearance.scale}; --overlay-text: {resolvedColor}; --overlay-color: {resolvedColor}"
>
	{@render children()}
</div>

<style>
	.text-style {
		zoom: var(--text-scale);
		color: var(--overlay-color);
	}
	.inverse {
		--overlay-text: #fff !important;
		--overlay-color: #fff !important;
		mix-blend-mode: difference;
		text-shadow: none !important;
	}
	.inverse :global(*) {
		color: #fff !important;
		text-shadow: none !important;
		filter: none !important;
	}
</style>
