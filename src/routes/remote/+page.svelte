<script lang="ts">
	import { onMount } from 'svelte';
	import ControllerHeader from '$lib/components/controller/ControllerHeader.svelte';
	import { playerPublicPort } from '$lib/public-ports';

	let { data } = $props();

	interface RemoteClient {
		clientId: string;
		name: string | null;
		device: string;
		fingerprint: string;
		slug: string;
		profileName: string;
		assignmentCount: number;
		connectedAt: number;
		lastSeen: number;
		controlAvailable: boolean;
		state: {
			paused: boolean;
			slide: { id: string; connectionId?: string; takenAt: string | null; location: string | null } | null;
			slides: Array<{ id: string; connectionId?: string; ratio: number }>;
			startedAt: number | null;
			endsAt: number | null;
			durationMs: number;
			remainingMs: number;
		};
	}

	let clients = $state<RemoteClient[] | null>(null);
	let now = $state(Date.now());

	function secondsLeft(client: RemoteClient): number {
		const ms = client.state.paused
			? client.state.remainingMs
			: client.state.endsAt
				? Math.max(0, client.state.endsAt - now)
				: 0;
		return Math.ceil(ms / 1000);
	}

	function thumbnailUrl(image: { id: string; connectionId?: string }): string {
		const params = new URLSearchParams({ size: 'preview' });
		if (image.connectionId) params.set('connection', image.connectionId);
		return `/api/image/${image.id}?${params}`;
	}

	async function refresh(): Promise<void> {
		try {
			const res = await fetch('/api/control/clients');
			if (res.ok) clients = await res.json();
		} catch {
			// Keep the last known list; next poll will retry.
		}
	}

	async function command(
		clientId: string,
		type: 'toggle' | 'next' | 'prev' | 'switch' | 'identify',
		slug?: string
	): Promise<void> {
		await fetch(`/api/control/clients/${clientId}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type, slug })
		}).catch(() => {});
		// Fast feedback while the next poll catches up.
		setTimeout(refresh, 300);
	}

	async function rename(client: RemoteClient): Promise<void> {
		const name = prompt('Name this player (this does not rename its presentation)', client.name ?? '');
		if (name === null) return;
		await fetch(`/api/control/clients/${client.clientId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name })
		});
		void refresh();
	}

	async function makeIndependent(client: RemoteClient, ask = true): Promise<string | null> {
		const name = `${client.name || client.fingerprint || client.device} presentation`.slice(0, 60);
		if (ask && !confirm(`Copy “${client.profileName}” to “${name}” for only this player?`)) return null;
		const created = await fetch('/api/displays', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, copyFrom: client.slug })
		});
		const profile = await created.json().catch(() => null);
		if (!created.ok || !profile?.slug) return null;
		await command(client.clientId, 'switch', profile.slug);
		return profile.slug;
	}

	async function editPlayer(client: RemoteClient): Promise<void> {
		let slug = client.slug;
		if (client.assignmentCount > 1) {
			const isolated = await makeIndependent(client, false);
			if (!isolated) return;
			slug = isolated;
		}
		location.href = `/settings/${encodeURIComponent(slug)}?client=${encodeURIComponent(client.clientId)}`;
	}

	function playerLabel(client: RemoteClient): string {
		return client.name || `${client.device}${client.fingerprint ? ` · ${client.fingerprint}` : ''} · ${client.clientId.slice(0, 8)}`;
	}

	function onSwitch(client: RemoteClient, event: Event): void {
		const slug = (event.currentTarget as HTMLSelectElement).value;
		if (slug && slug !== client.slug) void command(client.clientId, 'switch', slug);
	}

	onMount(() => {
		void refresh();
		const timer = setInterval(refresh, 2500);
		const clock = setInterval(() => (now = Date.now()), 250);
		return () => {
			clearInterval(timer);
			clearInterval(clock);
		};
	});
</script>

<svelte:head>
	<title>Mantel Controller — Live players</title>
</svelte:head>

<main>
	<ControllerHeader
		active="players"
		title="Live players"
		description={`These are browser players currently connected on port ${playerPublicPort}. See exactly what each screen shows and control it immediately.`}
	/>

	{#if clients === null}
		<p class="empty">Looking for connected screens…</p>
	{:else if clients.length === 0}
		<div class="empty">
			<p>No screens connected right now.</p>
			<p class="hint">
				Open a display URL on a device — for example
				{#if data.displays.length}
					<a href="/display/{data.displays[0].slug}" target="_blank">/display/{data.displays[0].slug}</a>
				{:else}
					<a href="/settings">create a display first</a>
				{/if}
				— and it will appear here.
			</p>
		</div>
	{:else}
		<div class="grid">
			{#each clients as client (client.clientId)}
				<article class="card">
					<div class="thumb" class:multi={client.state.slides.length > 1}>
						{#if client.state.slides.length}
							{#each client.state.slides as image (image.id)}
								<img src={thumbnailUrl(image)} alt="" loading="lazy" decoding="async" />
							{/each}
						{:else if client.state.slide}
							<img src={thumbnailUrl(client.state.slide)} alt="" loading="lazy" decoding="async" />
						{:else}
							<div class="no-thumb">—</div>
						{/if}
						{#if client.state.paused}
							<span class="badge">Paused</span>
						{/if}
						{#if client.state.slide}
							<span class="countdown">{secondsLeft(client)}s</span>
						{/if}
					</div>

					<div class="body">
						<div class="who">
							<button class="device" onclick={() => rename(client)} title="Rename device">
								{playerLabel(client)}
								<svg viewBox="0 0 24 24" class="pencil"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17Z M13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
							</button>
							<span class="ua">{client.device}{client.fingerprint ? ` · ${client.fingerprint}` : ''} · ID {client.clientId.slice(0, 8)}</span>
							{#if !client.controlAvailable}<span class="ua">Online embedded player · live preview available · remote commands unavailable until its live channel reconnects</span>{/if}
							{#if client.state.slide?.location}
								<span class="ua">Showing: {client.state.slide.location}</span>
							{/if}
						</div>

						<label class="playing">
							<span>Assigned presentation</span>
							<select value={client.slug} onchange={(e) => onSwitch(client, e)}>
								{#each data.displays as d (d.slug)}
									<option value={d.slug}>{d.name}</option>
								{/each}
							</select>
						</label>

						<div class="buttons">
							<button disabled={!client.controlAvailable} aria-label="Previous" onclick={() => command(client.clientId, 'prev')}>
								<svg viewBox="0 0 24 24"><path d="M15.5 5 8 12l7.5 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
							</button>
							<button
								aria-label={client.state.paused ? 'Play' : 'Pause'}
								class="play"
								disabled={!client.controlAvailable}
								onclick={() => command(client.clientId, 'toggle')}
							>
								{#if client.state.paused}
									<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>
								{:else}
									<svg viewBox="0 0 24 24"><path d="M7.5 5h3v14h-3zm6 0h3v14h-3z" fill="currentColor"/></svg>
								{/if}
							</button>
							<button disabled={!client.controlAvailable} aria-label="Next" onclick={() => command(client.clientId, 'next')}>
								<svg viewBox="0 0 24 24"><path d="m8.5 5 7.5 7-7.5 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
							</button>
							<span class="spacer"></span>
							<button class="text-btn" onclick={() => command(client.clientId, 'identify')}>
								Identify
							</button>
							<button class="text-btn" onclick={() => editPlayer(client)}>Edit this player live</button>
							<button class="text-btn independent" onclick={() => makeIndependent(client)}>Make independent</button>
						</div>
					</div>
				</article>
			{/each}
		</div>
	{/if}
</main>

<style>
	main {
		max-width: 60rem;
		margin: 4vh auto 0;
		padding: 0 1.5rem 4rem;
	}

	.empty {
		margin-top: 3rem;
		text-align: center;
		color: var(--text-dim);
	}

	.hint {
		font-size: 0.9rem;
		color: var(--text-faint);
	}

	.hint a {
		color: var(--accent);
	}

	.grid {
		margin-top: 2.5rem;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
		gap: 1.25rem;
	}

	.card {
		display: grid;
		grid-template-columns: 7.5rem 1fr;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.thumb {
		position: relative;
		background: #000;
		display: grid;
		grid-template-columns: 1fr;
		grid-auto-rows: 1fr;
		overflow: hidden;
	}

	.thumb.multi { grid-template-columns: repeat(2, 1fr); }

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		min-height: 0;
	}

	.no-thumb {
		display: grid;
		place-content: center;
		height: 100%;
		color: var(--text-faint);
	}

	.badge {
		position: absolute;
		bottom: 0.5rem;
		left: 0.5rem;
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--accent);
		color: var(--on-accent);
	}

	.countdown {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		min-width: 2.4rem;
		padding: 0.2rem 0.45rem;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.7);
		color: #fff;
		font: 700 0.75rem/1.2 ui-monospace, monospace;
		text-align: center;
	}

	.body {
		padding: 0.9rem 1rem;
		display: grid;
		gap: 0.7rem;
		align-content: start;
	}

	.who {
		display: grid;
		gap: 0.1rem;
	}

	.device {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-weight: 600;
		font-size: 1rem;
		text-align: left;
	}

	.pencil {
		width: 0.85rem;
		height: 0.85rem;
		opacity: 0;
		transition: opacity 0.15s ease;
	}

	.device:hover .pencil {
		opacity: 0.7;
	}

	.ua {
		font-size: 0.78rem;
		color: var(--text-faint);
	}

	.playing {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.85rem;
		color: var(--text-dim);
	}

	.playing select {
		flex: 1;
		padding: 0.35rem 0.6rem;
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text);
	}

	.buttons {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.buttons button {
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		border-radius: 50%;
		background: var(--surface-raised);
		border: 1px solid var(--border);
		color: var(--text);
	}

	.buttons button:hover {
		border-color: var(--accent);
	}

	.buttons .play {
		width: 2.8rem;
		height: 2.8rem;
	}

	.buttons svg {
		width: 55%;
		height: 55%;
	}

	.spacer {
		flex: 1;
	}

	.text-btn {
		width: auto !important;
		height: auto !important;
		border-radius: var(--radius-sm) !important;
		padding: 0.4rem 0.8rem;
		font-size: 0.85rem;
	}

	@media (max-width: 36rem) {
		main {
			margin-top: 2rem;
			padding-inline: 1rem;
		}

		.grid {
			grid-template-columns: minmax(0, 1fr);
		}

		.card {
			grid-template-columns: 1fr;
		}

		.thumb {
			aspect-ratio: 16 / 9;
		}

		.buttons {
			flex-wrap: wrap;
		}

		.spacer {
			display: none;
		}

	}
</style>
