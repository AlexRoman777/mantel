<script lang="ts">
	import { controllerPublicPort, playerPublicPort } from '#lib/public-ports.js';
	let {
		active = 'overview',
		title,
		description
	}: {
		active?: 'overview' | 'players' | 'messages' | 'presentations';
		title: string;
		description: string;
	} = $props();
</script>

<header class="controller-header">
	<div class="identity">
		<a class="brand" href="/settings" aria-label="Mantel Controller overview">
			<span class="mark" aria-hidden="true"><i></i><i></i></span>
			<span><strong>Mantel Controller</strong><small>Administration · port {controllerPublicPort}</small></span>
		</a>
		<div class="role-map" aria-label="Mantel network roles">
			<span class="role active"><i></i>Controller <b>{controllerPublicPort}</b></span>
			<span class="line" aria-hidden="true"></span>
			<span class="role"><i></i>Players <b>{playerPublicPort}</b></span>
		</div>
	</div>

	<nav aria-label="Controller navigation">
		<a class:active={active === 'overview'} href="/settings">Overview</a>
		<a class:active={active === 'players'} href="/remote">Live players</a>
		<a class:active={active === 'messages'} href="/messages">Messages</a>
		<a class:active={active === 'presentations'} href="/settings#presentations">Presentations</a>
	</nav>

	<div class="heading">
		<span class="eyebrow">Controller workspace</span>
		<h1>{title}</h1>
		<p>{description}</p>
	</div>
</header>

<style>
	.controller-header { display: grid; gap: 1.5rem; }
	.identity { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
	.brand { display: inline-flex; align-items: center; gap: 0.7rem; color: var(--text); text-decoration: none; }
	.brand > span:last-child { display: grid; }
	.brand strong { font-size: 0.9rem; letter-spacing: 0.01em; }
	.brand small { color: var(--text-faint); font-size: 0.66rem; }
	.mark { position: relative; width: 2.1rem; aspect-ratio: 1; border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border)); border-radius: 0.55rem; background: #111318; }
	.mark::after { content: ''; position: absolute; inset: 0.42rem; border: 1px solid var(--accent); border-radius: 0.22rem; }
	.mark i { position: absolute; z-index: 1; width: 0.3rem; height: 0.3rem; border-radius: 50%; background: var(--accent); }
	.mark i:first-child { top: 0.62rem; right: 0.62rem; }
	.mark i:last-child { left: 0.58rem; bottom: 0.58rem; width: 0.85rem; border-radius: 0.1rem 0.45rem 0.1rem 0.1rem; transform: rotate(-18deg); }
	.role-map { display: flex; align-items: center; gap: 0.45rem; padding: 0.35rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; color: var(--text-faint); background: var(--surface); font-size: 0.66rem; }
	.role { display: flex; align-items: center; gap: 0.3rem; white-space: nowrap; }
	.role i { width: 0.4rem; height: 0.4rem; border-radius: 50%; background: var(--text-faint); }
	.role.active { color: var(--text); }
	.role.active i { background: #60ce8c; box-shadow: 0 0 0 0.15rem rgba(96, 206, 140, 0.15); }
	.role b { color: var(--text-dim); font: 600 0.62rem ui-monospace, monospace; }
	.line { width: 1rem; height: 1px; background: var(--border); }
	nav { display: flex; gap: 0.25rem; padding: 0.25rem; width: fit-content; max-width: 100%; border: 1px solid var(--border); border-radius: 0.65rem; background: var(--surface); }
	nav a { padding: 0.45rem 0.8rem; border-radius: 0.42rem; color: var(--text-dim); font-size: 0.78rem; text-decoration: none; white-space: nowrap; }
	nav a:hover { color: var(--text); }
	nav a.active { color: var(--on-accent); background: var(--accent); font-weight: 650; }
	.heading { max-width: 44rem; }
	.eyebrow { color: var(--accent); font: 700 0.66rem/1 ui-monospace, monospace; letter-spacing: 0.1em; text-transform: uppercase; }
	h1 { margin: 0.45rem 0 0.35rem; font-size: clamp(1.8rem, 4vw, 2.7rem); line-height: 1; letter-spacing: -0.045em; }
	p { margin: 0; color: var(--text-dim); line-height: 1.5; }
	@media (max-width: 42rem) {
		.identity { align-items: flex-start; flex-direction: column; }
		.role-map { width: 100%; justify-content: center; }
		nav { width: 100%; overflow-x: auto; }
		nav a { flex: 1; text-align: center; }
	}
</style>
