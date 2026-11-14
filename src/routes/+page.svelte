<svelte:head><title>Mantel Player</title></svelte:head>

<!-- The server redirects this route to /display/default. This is only a
     no-script/error fallback and must never become a presentation launcher. -->
<script lang="ts">
	import { playerPublicPort } from '#lib/public-ports.js';
</script>

<main>
	<span>Mantel Player · port {playerPublicPort}</span>
	<p>Opening the Default presentation…</p>
</main>

<style>
	main { min-height: 100vh; display: grid; place-content: center; justify-items: center; gap: 0.5rem; color: var(--text-dim); }
	span { color: var(--accent); font: 700 0.7rem ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; }
	p { margin: 0; }
</style>
