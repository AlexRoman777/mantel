<script lang="ts">
	import type { InstantSettings } from '#lib/types.js';
	import InstantStudio from './InstantStudio.svelte';

	let {
		initial,
		slug,
		onsettings
	}: {
		initial: InstantSettings;
		slug: string;
		onsettings: (settings: InstantSettings) => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let settings = $state(structuredClone(initial));

	$effect(() => {
		onsettings($state.snapshot(settings));
	});
</script>

<InstantStudio bind:settings {slug} />
