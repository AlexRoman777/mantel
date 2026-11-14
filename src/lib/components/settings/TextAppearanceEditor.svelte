<script lang="ts">
	import type { TextAppearance } from '#lib/types.js';
	import Segmented from './Segmented.svelte';

	let { appearance }: { appearance: TextAppearance } = $props();
</script>

<details class="text-appearance">
	<summary>
		<span>Text appearance</span>
		<small>{Math.round(appearance.scale * 100)}% · {appearance.colorMode === 'inverse' ? 'Opposite photo color' : appearance.colorMode}</small>
	</summary>
	<div class="controls">
		<label class="scale">
			<span>Text size <strong>{Math.round(appearance.scale * 100)}%</strong></span>
			<input type="range" min="0.5" max="3" step="0.1" bind:value={appearance.scale} />
		</label>
		<Segmented label="Color" bind:value={appearance.colorMode} options={[
			{ value: 'light', label: 'White' },
			{ value: 'dark', label: 'Black' },
			{ value: 'inverse', label: 'Opposite' },
			{ value: 'custom', label: 'Custom' }
		]} />
		{#if appearance.colorMode === 'custom'}
			<label class="picker">Custom text color <input type="color" bind:value={appearance.color} /></label>
		{/if}
		{#if appearance.colorMode === 'inverse'}
			<small class="hint">Inverts the photograph directly behind each letter. Background panels are disabled in this mode.</small>
		{/if}
	</div>
</details>

<style>
	.text-appearance { border-top: 1px solid var(--border); padding-top: 0.65rem; }
	summary { display: flex; justify-content: space-between; gap: 1rem; cursor: pointer; color: var(--text); font-weight: 620; }
	summary small { color: var(--text-dim); font-weight: 450; text-transform: capitalize; }
	.controls { display: grid; gap: 0.75rem; padding-top: 0.8rem; }
	.scale { display: grid; gap: 0.35rem; }
	.scale span { display: flex; justify-content: space-between; font-size: 0.9rem; }
	.scale input { width: 100%; }
	.picker { display: flex; align-items: center; justify-content: space-between; font-size: 0.9rem; }
	.picker input { width: 3.25rem; height: 2rem; padding: 0.1rem; }
	.hint { color: var(--text-dim); line-height: 1.4; }
</style>
