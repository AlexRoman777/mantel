<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Slideshow from '$lib/components/slideshow/Slideshow.svelte';
	import type { DisplayProfile } from '$lib/types';
	import { createClientId } from '$lib/client-id';

	let profile = $state<DisplayProfile | null>(null);
	let stopped = false;
	let cursorTimer: ReturnType<typeof setInterval> | undefined;

	function hideCursor() {
		document.documentElement.style.setProperty('cursor', 'none', 'important');
		document.body.style.setProperty('cursor', 'none', 'important');
	}

	async function loadProfile(clientId: string) {
		try {
			const direct = page.params.slug === 'auto' ? null : await fetch(`/api/displays/${page.params.slug}`);
			if (direct?.ok) {
				profile = await direct.json();
				return;
			}
			const params = new URLSearchParams({
				client: clientId,
				requested: page.params.slug ?? 'auto',
				embedded: String(window.top !== window.self),
				width: String(screen.width),
				height: String(screen.height)
			});
			const resolved = await fetch(`/api/displays/resolve?${params}`);
			if (resolved.ok) {
				profile = await resolved.json();
				return;
			}
		} catch {
			// A kiosk may start before the NAS. Stay black and reconnect quietly.
		}
		if (!stopped) setTimeout(() => void loadProfile(clientId), 5000);
	}

	onMount(() => {
		hideCursor();
		cursorTimer = setInterval(hideCursor, 2000);
		let clientId = localStorage.getItem('mantel-client-id');
		if (!clientId) {
			clientId = createClientId();
			localStorage.setItem('mantel-client-id', clientId);
		}
		void loadProfile(clientId);
		return () => {
			stopped = true;
			clearInterval(cursorTimer);
		};
	});
</script>

<svelte:head>
	<title>Mantel — {profile?.name ?? page.params.slug}</title>
</svelte:head>

{#if profile}
	<Slideshow {profile} />
{:else}
	<div class="loading" aria-label="Preparing player"></div>
{/if}

<style>
	:global(html),
	:global(body),
	:global(body *) {
		cursor: none !important;
	}

	.loading {
		position: fixed;
		inset: 0;
		display: grid;
		background: #000;
	}
</style>
