<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import ControllerHeader from '$lib/components/controller/ControllerHeader.svelte';
	import { playerPublicPort } from '$lib/public-ports';

	let { data } = $props();
	let newName = $state('');
	let busy = $state(false);
	let errorMsg = $state<string | null>(null);
	let cache = $state<{ files: number; bytes: number; maxBytes: number; queued: number; active: number; map?: { sentinel: { files: number; bytes: number }; osm: { places: number; bytes: number }; region: { name: string; maxZoom: number; total: number; done: number; running: boolean } | null } } | null>(null);
	let clearingCache = $state(false);
	let clients = $state<Array<{
		clientId: string;
		name: string | null;
		device: string;
		fingerprint: string;
		slug: string;
		profileName: string;
		assignmentCount: number;
		lastSeen: number;
		controlAvailable: boolean;
		state: {
			paused: boolean;
			blackout: boolean;
			slides: Array<{ id: string; connectionId?: string; ratio?: number }>;
			slide: { id: string; connectionId?: string } | null;
			endsAt: number | null;
			remainingMs: number;
		};
	}>>([]);
	let now = $state(Date.now());
	// svelte-ignore state_referenced_locally
	const initialConnection = data.immich.connections.find((connection: { id: string }) => connection.id === data.immich.defaultId) ?? data.immich.connections[0];
	// Intentional form working copy; refreshed explicitly after a successful save.
	// svelte-ignore state_referenced_locally
	let connectionId = $state<string | null>(initialConnection?.id ?? null);
	let connectionName = $state(initialConnection?.name ?? 'Family');
	let immichUrl = $state(initialConnection?.url ?? '');
	let immichKey = $state('');
	let allowedAlbums = $state((initialConnection?.allowedAlbumIds ?? []).join('\n'));
	// svelte-ignore state_referenced_locally
	let connectionState = $state<'idle' | 'testing' | 'connected' | 'error'>(
		data.immich.configured ? 'connected' : 'idle'
	);
	let connectionError = $state<string | null>(null);
	let connectionSummary = $state<string | null>(null);

	function editConnection(connection: { id: string; name: string; url: string; allowedAlbumIds: string[] }): void {
		connectionId = connection.id;
		connectionName = connection.name;
		immichUrl = connection.url;
		immichKey = '';
		allowedAlbums = connection.allowedAlbumIds.join('\n');
		connectionState = 'connected';
		connectionError = null;
	}

	function addConnection(): void {
		connectionId = null;
		connectionName = '';
		immichUrl = initialConnection?.url ?? '';
		immichKey = '';
		allowedAlbums = '';
		connectionState = 'idle';
		connectionError = null;
	}

	function formatBytes(bytes: number): string {
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let value = bytes;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit++;
		}
		return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
	}

	const cacheSize = $derived(cache ? formatBytes(cache.bytes) : 'Loading…');
	const cacheCeiling = $derived(cache?.maxBytes ? `ceiling ${formatBytes(cache.maxBytes)}, least-recently shown photos are removed first` : 'no ceiling set (IMAGE_CACHE_MAX_GB)');

	async function refreshCache() {
		const res = await fetch('/api/cache');
		if (res.ok) cache = await res.json();
	}

	async function refreshClients(): Promise<void> {
		const res = await fetch('/api/control/clients').catch(() => null);
		if (res?.ok) clients = await res.json();
	}

	async function clientCommand(
		clientId: string,
		type: 'toggle' | 'next' | 'prev' | 'identify' | 'refresh' | 'blackout' | 'wake'
	): Promise<void> {
		await fetch(`/api/control/clients/${clientId}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type })
		}).catch(() => null);
		setTimeout(() => void refreshClients(), 250);
	}

	async function switchClient(clientId: string, event: Event): Promise<void> {
		const slug = (event.currentTarget as HTMLSelectElement).value;
		await fetch(`/api/control/clients/${clientId}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'switch', slug })
		}).catch(() => null);
		setTimeout(() => void refreshClients(), 400);
	}

	async function renameClient(client: (typeof clients)[number]): Promise<void> {
		const name = prompt('Name this player (this does not rename its presentation)', client.name ?? '');
		if (name === null) return;
		await fetch(`/api/control/clients/${client.clientId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name })
		});
		void refreshClients();
	}

	async function makeIndependent(client: (typeof clients)[number], ask = true): Promise<string | null> {
		const playerName = client.name || client.fingerprint || client.device;
		const name = `${playerName} presentation`.slice(0, 60);
		if (ask && !confirm(`Create “${name}” as a copy of “${client.profileName}” and assign only this player to it?`)) return null;
		const created = await fetch('/api/displays', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, copyFrom: client.slug })
		});
		const profile = await created.json().catch(() => null);
		if (!created.ok || !profile?.slug) {
			errorMsg = profile?.error ?? `Could not create personal presentation (${created.status})`;
			return null;
		}
		await fetch(`/api/control/clients/${client.clientId}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'switch', slug: profile.slug })
		});
		await invalidateAll();
		setTimeout(() => void refreshClients(), 400);
		return profile.slug;
	}

	async function editPlayer(client: (typeof clients)[number]): Promise<void> {
		let slug = client.slug;
		if (client.assignmentCount > 1) {
			const isolated = await makeIndependent(client, false);
			if (!isolated) return;
			slug = isolated;
		}
		location.href = `/settings/${encodeURIComponent(slug)}?client=${encodeURIComponent(client.clientId)}`;
	}

	function playerLabel(client: (typeof clients)[number]): string {
		return client.name || `${client.device}${client.fingerprint ? ` · ${client.fingerprint}` : ''} · ${client.clientId.slice(0, 8)}`;
	}

	function clientThumbnail(image: { id: string; connectionId?: string } | null): string {
		if (!image) return '';
		// Reuse the exact preview already requested and cached by the player. A
		// separate thumbnail request can fail transiently and leave a stale blank.
		const params = new URLSearchParams({ size: 'preview' });
		if (image.connectionId) params.set('connection', image.connectionId);
		return `/api/image/${image.id}?${params}`;
	}

	function secondsLeft(client: (typeof clients)[number]): number {
		const remaining = client.state.paused
			? client.state.remainingMs
			: client.state.endsAt
				? Math.max(0, client.state.endsAt - now)
				: 0;
		return Math.ceil(remaining / 1000);
	}

	async function clearCache() {
		if (!confirm('Clear all locally cached slideshow images? Mantel will download them again.')) return;
		clearingCache = true;
		try {
			const res = await fetch('/api/cache', { method: 'DELETE' });
			if (res.ok) cache = await res.json();
		} finally {
			clearingCache = false;
		}
	}

	async function saveImmichConnection(event: SubmitEvent) {
		event.preventDefault();
		connectionState = 'testing';
		connectionError = null;
		connectionSummary = null;
		try {
			const res = await fetch('/api/immich/connection', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...(connectionId ? { id: connectionId } : {}),
					name: connectionName,
					url: immichUrl,
					apiKey: immichKey,
					allowedAlbums
				})
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				connectionState = 'error';
				connectionError = body?.error ?? `Connection failed (${res.status})`;
				return;
			}
			connectionId = body.savedConnectionId ?? connectionId;
			immichKey = '';
			connectionState = 'connected';
			connectionSummary = `${body.albums} allowed album${body.albums === 1 ? '' : 's'}: ${body.albumNames.join(', ')} · account has ${body.assetStatistics.images} photos and ${body.assetStatistics.videos} videos · ${body.people} people`;
			await invalidateAll();
		} catch {
			connectionState = 'error';
			connectionError = 'Could not reach Mantel';
		}
	}

	async function disconnectImmich() {
		if (!connectionId || !confirm(`Remove Immich account “${connectionName}” and clear cached photos and face data?`)) return;
		const res = await fetch(`/api/immich/connection?id=${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
		if (!res.ok) return;
		immichUrl = '';
		connectionId = null;
		connectionName = '';
		immichKey = '';
		allowedAlbums = '';
		connectionState = 'idle';
		connectionSummary = null;
		await invalidateAll();
		await refreshCache();
	}

	onMount(() => {
		void refreshCache();
		void refreshClients();
		const cacheTimer = setInterval(() => void refreshCache(), 5000);
		const clientTimer = setInterval(() => void refreshClients(), 2500);
		const clockTimer = setInterval(() => (now = Date.now()), 250);
		return () => {
			clearInterval(cacheTimer);
			clearInterval(clientTimer);
			clearInterval(clockTimer);
		};
	});

	async function createDisplay(event: SubmitEvent) {
		event.preventDefault();
		if (!newName.trim() || busy) return;
		busy = true;
		errorMsg = null;
		try {
			const res = await fetch('/api/displays', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newName.trim() })
			});
			if (!res.ok) {
				errorMsg = (await res.json().catch(() => null))?.error ?? `Error ${res.status}`;
				return;
			}
			newName = '';
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function removeDisplay(slug: string, name: string) {
		if (!confirm(`Delete display “${name}”?`)) return;
		const res = await fetch(`/api/displays/${slug}`, { method: 'DELETE' });
		if (res.ok) await invalidateAll();
	}
</script>

<svelte:head>
	<title>Mantel Controller — Overview</title>
</svelte:head>

<main>
	<ControllerHeader
		title="Household display control"
		description="See every connected player, connect photo libraries, and decide what each screen presents. Changes are sent to players live."
	/>

	<section class="players-card">
		<div class="players-heading">
			<div>
				<span class="section-label">Player network · port {playerPublicPort}</span>
				<h2>Connected players</h2>
				<p>{clients.length ? `${clients.length} online now` : 'No player is connected right now'}</p>
			</div>
			<a class="btn" href="/remote">Open live player control</a>
		</div>
		{#if clients.length}
			<div class="player-list">
				{#each clients as client (client.clientId)}
					<article class="player-card">
						<div class="player-thumb" class:multi={client.state.slides.length > 1}>
							{#if client.state.slides.length}
								{#each client.state.slides as image (image.id)}
									<img src={clientThumbnail(image)} alt="" loading="lazy" decoding="async" />
								{/each}
							{:else if client.state.slide}
								<img src={clientThumbnail(client.state.slide)} alt="Current photograph" loading="lazy" decoding="async" />
							{:else}
								<span>Waiting for a photograph</span>
							{/if}
							<span class="online"><i></i> {client.controlAvailable ? 'Live' : 'Online · embedded'}</span>
							{#if client.state.blackout}<span class="mode-badge">Screen off</span>{/if}
							<span class="countdown">{client.state.paused ? 'Paused' : `${secondsLeft(client)}s`}</span>
						</div>
						<div class="player-body">
							<div class="player-info">
								<button type="button" onclick={() => renameClient(client)}>{playerLabel(client)} <span>Rename player</span></button>
								<small>{client.device}{client.fingerprint ? ` · ${client.fingerprint}` : ''} · ID {client.clientId.slice(0, 8)}</small>
							</div>
							<label class="profile-select">
								<span>Assigned presentation</span>
								<select value={client.slug} onchange={(event) => switchClient(client.clientId, event)}>
									{#each data.displays as display (display.slug)}
										<option value={display.slug}>{display.name}</option>
									{/each}
								</select>
								<small>
									{client.assignmentCount > 1
										? `Shared by ${client.assignmentCount} known players. Editing this player creates its own copy automatically.`
										: 'Assigned only to this player.'}
								</small>
							</label>
							<div class="player-controls">
								<button class="round" disabled={!client.controlAvailable} aria-label="Previous photograph" title="Previous" onclick={() => clientCommand(client.clientId, 'prev')}>←</button>
								<button class="round play" disabled={!client.controlAvailable} aria-label={client.state.paused ? 'Resume slideshow' : 'Pause slideshow'} onclick={() => clientCommand(client.clientId, 'toggle')}>{client.state.paused ? '▶' : 'Ⅱ'}</button>
								<button class="round" disabled={!client.controlAvailable} aria-label="Next photograph" title="Next" onclick={() => clientCommand(client.clientId, 'next')}>→</button>
								<button class="compact" onclick={() => clientCommand(client.clientId, 'identify')}>Identify</button>
								<button class="compact" onclick={() => clientCommand(client.clientId, 'refresh')}>Reload</button>
								<button class="compact" onclick={() => clientCommand(client.clientId, client.state.blackout ? 'wake' : 'blackout')}>{client.state.blackout ? 'Wake screen' : 'Black screen'}</button>
							</div>
							<div class="player-links">
								<button class="btn primary" type="button" onclick={() => editPlayer(client)}>Edit this player live</button>
								<button class="btn" type="button" onclick={() => makeIndependent(client)}>Make independent copy</button>
								<a class="btn" href="/display/{client.slug}" target="_blank">Open player</a>
							</div>
						</div>
					</article>
					{/each}
			</div>
		{:else}
			<p class="players-empty">No players are online. Open <code>http://SERVER:{playerPublicPort}/display/default</code> on a TV, tablet, or browser; it will appear here automatically.</p>
		{/if}
	</section>

	<section class="connection-card" class:connected={connectionState === 'connected'}>
		<div class="connection-heading">
			<div>
				<span class="section-label">Photo library</span>
				<h2>Immich connections</h2>
				<p>
					{connectionState === 'connected' ? 'Connected' : 'Connect Mantel before selecting photos'}
					· {data.immich.connections.length} configured
				</p>
			</div>
			<span class="status-dot" aria-hidden="true"></span>
		</div>
		{#if data.immich.connections.length}
			<div class="connection-list">
				{#each data.immich.connections as connection (connection.id)}
					<button type="button" class:active={connection.id === connectionId} onclick={() => editConnection(connection)}>
						<strong>{connection.name}</strong><span>{connection.allowedAlbumIds.length} allowed album{connection.allowedAlbumIds.length === 1 ? '' : 's'} · {connection.url}</span>
					</button>
				{/each}
				<button type="button" class="add-account" onclick={addConnection}>+ Add account</button>
			</div>
		{/if}
		<form class="connection-form" onsubmit={saveImmichConnection}>
			<label>
				Account name
				<input type="text" placeholder="Family, Camera, Anna…" bind:value={connectionName} maxlength="60" required />
			</label>
			<label>
				Immich URL
				<input
					type="url"
					placeholder="http://immich.local:2283"
					bind:value={immichUrl}
					required
				/>
			</label>
			<label>
				API key
				<input
					type="password"
					placeholder={connectionId ? 'Stored — leave blank to keep it' : 'Paste Mantel read-only key'}
					bind:value={immichKey}
					autocomplete="new-password"
				/>
			</label>
			<label class="album-allowlist">
				Allowed Immich albums
				<textarea
					bind:value={allowedAlbums}
					rows="3"
					placeholder="Paste an album ID or full /albums/... URL — one per line"
					required
				></textarea>
				<small>Mantel will discover and query only these albums. Add another line when you intentionally allow another album.</small>
			</label>
			<div class="connection-actions">
				<button class="btn primary" type="submit" disabled={connectionState === 'testing'}>
					{connectionState === 'testing' ? 'Testing…' : 'Test and save'}
				</button>
				{#if connectionId}
					<button class="btn danger" type="button" onclick={disconnectImmich}>Remove account</button>
				{/if}
			</div>
		</form>
		<p class="secret-note">
			The key is written with owner-only permissions inside the persistent <code>/data</code>
			volume and is never returned to browsers. Keep this controller on your trusted network.
			Recommended read permissions: <code>album.read</code>, <code>album.statistics</code>,
			<code>asset.read</code>, <code>asset.statistics</code>, <code>asset.view</code>,
			<code>asset.download</code>, <code>face.read</code>, <code>memory.read</code>, and
			<code>person.read</code>.
		</p>
		{#if connectionSummary}<p class="success">{connectionSummary}</p>{/if}
		{#if connectionError}<p class="error">{connectionError}</p>{/if}
	</section>

	<section class="presentations-card" id="presentations">
		<div class="section-heading">
			<div><span class="section-label">What players show</span><h2>Presentations</h2></div>
			<p>A presentation combines albums, order, layouts, effects, and on-screen information.</p>
		</div>
		<ul class="displays">
			{#each data.displays as display (display.slug)}
				<li class="display">
					<div class="info">
						<span class="name">{display.name}</span>
						<span class="meta">
							Player path /display/{display.slug} · {display.sources === 0 ? 'No album selected' : `${display.sources} photo source${display.sources === 1 ? '' : 's'}`}
						</span>
					</div>
					<div class="actions">
						<a class="btn primary" href="/settings/{display.slug}">Customize</a>
						<a class="btn" href="/display/{display.slug}">Preview</a>
						<button class="btn danger" onclick={() => removeDisplay(display.slug, display.name)}>Delete</button>
					</div>
				</li>
			{/each}
		</ul>
		<form class="add-presentation" onsubmit={createDisplay}>
			<input type="text" placeholder="New presentation name (e.g. Living room family)" bind:value={newName} maxlength="60" />
			<button class="btn primary" type="submit" disabled={busy || !newName.trim()}>Create presentation</button>
		</form>
		{#if errorMsg}<p class="error">{errorMsg}</p>{/if}
	</section>

	<section class="cache-card">
		<div>
			<span class="section-label">Persistent NAS storage · mantel-data</span>
			<h2>Local photo storage</h2>
			<p>
				{cacheSize} · {cache?.files ?? 0} files · {cacheCeiling}
				{#if cache?.map}
					<br />Map cache: {cache.map.sentinel.files} Sentinel tiles ({formatBytes(cache.map.sentinel.bytes)}) · {cache.map.osm.places} places of OpenStreetMap detail ({formatBytes(cache.map.osm.bytes)})
					{#if cache.map.region}
						<br />{cache.map.region.name} imagery to zoom {cache.map.region.maxZoom}: {cache.map.region.done} / {cache.map.region.total} tiles{cache.map.region.running ? ' · downloading in the background' : ' · complete'}
					{/if}
				{/if}
				{#if cache && (cache.active || cache.queued)}
					· warming {cache.active} active / {cache.queued} queued
				{/if}
			</p>
		</div>
		<button class="btn danger" onclick={clearCache} disabled={clearingCache}>
			{clearingCache ? 'Clearing…' : 'Clear cache'}
		</button>
	</section>
</main>

<style>
	main {
		max-width: 72rem;
		margin: 4vh auto 0;
		padding: 0 1.5rem 4rem;
	}

	.displays {
		list-style: none;
		padding: 0;
		margin: 1rem 0 0;
		display: grid;
		gap: 0.75rem;
	}

	.players-card {
		margin: 2.5rem 0 1.25rem;
		padding: 1rem 1.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.players-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
	.players-heading h2 { margin: 0 0 0.15rem; font-size: 1rem; }
	.players-heading p, .players-empty { margin: 0; color: var(--text-faint); font-size: 0.82rem; }
	.player-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 30rem), 1fr)); gap: 1rem; margin-top: 1rem; }
	.player-card { min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: calc(var(--radius) + 0.2rem); background: var(--surface-raised); }
	.player-thumb { position: relative; display: grid; place-items: center; grid-auto-rows: 1fr; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; background: #000; color: var(--text-faint); font-size: 0.8rem; }
	.player-thumb.multi { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.player-thumb img { width: 100%; height: 100%; min-height: 0; object-fit: cover; }
	.online, .countdown, .mode-badge { position: absolute; padding: 0.25rem 0.5rem; border-radius: 999px; background: rgba(0, 0, 0, 0.72); color: white; font-size: 0.7rem; font-weight: 650; backdrop-filter: blur(0.5rem); }
	.online { top: 0.6rem; left: 0.6rem; display: flex; align-items: center; gap: 0.35rem; }
	.online i { width: 0.45rem; height: 0.45rem; border-radius: 50%; background: #60ce8c; box-shadow: 0 0 0 0.18rem rgba(96, 206, 140, 0.2); }
	.countdown { top: 0.6rem; right: 0.6rem; font-family: ui-monospace, monospace; }
	.mode-badge { bottom: 0.6rem; left: 0.6rem; background: rgba(166, 80, 80, 0.82); }
	.player-body { display: grid; gap: 0.8rem; padding: 1rem; }
	.player-info { display: grid; min-width: 0; }
	.player-info button { width: fit-content; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-size: 1rem; font-weight: 650; text-align: left; }
	.player-info button span { margin-left: 0.35rem; color: var(--text-faint); font-size: 0.68rem; font-weight: 500; opacity: 0; transition: opacity 0.15s ease; }
	.player-info button:hover span { opacity: 1; }
	.player-info small { color: var(--text-faint); }
	.profile-select { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 0.6rem; color: var(--text-dim); font-size: 0.78rem; }
	.profile-select select { min-width: 0; padding: 0.45rem 0.6rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
	.player-controls, .player-links { display: flex; align-items: center; flex-wrap: wrap; gap: 0.45rem; }
	.player-controls button { border: 1px solid var(--border); background: var(--surface); color: var(--text); }
	.player-controls button:hover { border-color: var(--accent); }
	.player-controls .round { display: grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: 50%; font-size: 1rem; }
	.player-controls .play { width: 2.65rem; height: 2.65rem; }
	.player-controls .compact { min-height: 2.1rem; padding: 0.35rem 0.65rem; border-radius: var(--radius-sm); font-size: 0.75rem; }
	.player-links { padding-top: 0.15rem; }
	.section-label { display: block; margin-bottom: 0.28rem; color: var(--accent); font: 700 0.62rem/1.2 ui-monospace, monospace; letter-spacing: 0.075em; text-transform: uppercase; }
	.presentations-card { scroll-margin-top: 1rem; padding: 1.25rem; margin: 1.25rem 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
	.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 1rem; }
	.section-heading h2 { margin: 0; font-size: 1rem; }
	.section-heading p { max-width: 32rem; margin: 0; color: var(--text-faint); font-size: 0.78rem; text-align: right; }
	.add-presentation { margin-top: 0.85rem; }

	.cache-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.25rem;
		margin: 1rem 0 1.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.connection-card {
		padding: 1.25rem;
		margin: 1.5rem 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.connection-list {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 0.5rem;
		margin: 1rem 0;
	}

	.connection-list button {
		display: grid;
		gap: 0.15rem;
		padding: 0.65rem 0.75rem;
		text-align: left;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-raised);
	}

	.connection-list button.active { border-color: var(--accent); }
	.connection-list span { overflow: hidden; text-overflow: ellipsis; color: var(--text-faint); font-size: 0.7rem; }
	.connection-list .add-account { place-content: center; color: var(--accent); }

	.connection-card.connected {
		border-color: color-mix(in srgb, #54b47a 50%, var(--border));
	}

	.connection-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.connection-heading h2 {
		font-size: 1rem;
		margin: 0 0 0.2rem;
	}

	.connection-heading p,
	.secret-note {
		margin: 0;
		font-size: 0.82rem;
		color: var(--text-faint);
	}

	.status-dot {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		background: var(--text-faint);
	}

	.connected .status-dot {
		background: #54b47a;
		box-shadow: 0 0 0 0.25rem color-mix(in srgb, #54b47a 18%, transparent);
	}

	.connection-form {
		display: grid;
		grid-template-columns: 1fr 1fr;
		align-items: end;
		margin: 1rem 0 0.75rem;
	}

	.connection-form label {
		display: grid;
		gap: 0.35rem;
		font-size: 0.8rem;
		color: var(--text-dim);
	}

	.album-allowlist {
		grid-column: 1 / -1;
	}

	.album-allowlist textarea {
		font: inherit;
		resize: vertical;
		min-height: 4.5rem;
	}

	.connection-actions {
		display: flex;
		gap: 0.5rem;
		grid-column: 1 / -1;
	}

	.success {
		color: #72c894;
		font-size: 0.85rem;
		margin-bottom: 0;
	}

	.cache-card h2 {
		font-size: 1rem;
		margin: 0 0 0.2rem;
	}

	.cache-card p {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-faint);
	}

	.display {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.25rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.info {
		display: grid;
	}

	.name {
		font-weight: 600;
	}

	.meta {
		color: var(--text-faint);
		font-size: 0.85rem;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
	}

	.btn {
		padding: 0.4rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-raised);
		color: var(--text);
		text-decoration: none;
		font-size: 0.9rem;
	}

	.btn:hover {
		border-color: var(--accent);
	}

	.btn.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
	}

	.btn.primary:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.btn.danger:hover {
		border-color: #d05252;
		color: #e08080;
	}

	form {
		display: flex;
		gap: 0.5rem;
	}

	input {
		flex: 1;
		padding: 0.55rem 0.9rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text);
	}

	@media (max-width: 42rem) {
		main { width: 100%; min-width: 0; margin-top: 2rem; padding-inline: 1rem; overflow: hidden; }
		.players-heading { align-items: flex-start; flex-direction: column; }
		.section-heading { align-items: flex-start; flex-direction: column; }
		.section-heading p { text-align: left; }
		.players-heading > .btn { width: 100%; text-align: center; }
		.players-card, .player-list, .player-card { width: 100%; min-width: 0; }
		.player-list { grid-template-columns: minmax(0, 1fr); }
		.profile-select { grid-template-columns: 1fr; gap: 0.3rem; }
		.player-controls .compact { flex: 1 1 auto; }
		.player-links { display: grid; grid-template-columns: 1fr; }
		.player-links .btn { width: 100%; text-align: center; }
		.cache-card, .display { align-items: stretch; flex-direction: column; }
		.cache-card .btn, .actions .btn { flex: 1; text-align: center; }
		.add-presentation { flex-wrap: wrap; }
		.add-presentation input { min-width: 100%; }
		.add-presentation .btn { width: 100%; }
		.connection-form {
			grid-template-columns: 1fr;
		}

		.connection-actions {
			grid-column: auto;
		}
	}

	input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-color: var(--accent);
	}

	.error {
		color: #e08080;
		font-size: 0.9rem;
	}
</style>
