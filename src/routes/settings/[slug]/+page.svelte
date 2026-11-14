<script lang="ts">
	import { onMount } from 'svelte';
	import type { Corner, DisplayProfile } from '#lib/types.js';
	import AlbumPicker from '#lib/components/settings/AlbumPicker.svelte';
	import PersonPicker from '#lib/components/settings/PersonPicker.svelte';
	import InstantStudio from '#lib/components/settings/InstantStudio.svelte';
	import MapStudio from '#lib/components/settings/MapStudio.svelte';
	import Segmented from '#lib/components/settings/Segmented.svelte';
	import TextAppearanceEditor from '#lib/components/settings/TextAppearanceEditor.svelte';
	import Toggle from '#lib/components/settings/Toggle.svelte';
	import ControllerHeader from '#lib/components/controller/ControllerHeader.svelte';
	import { createClientId } from '#lib/client-id.js';
	import { playerPublicPort } from '#lib/public-ports.js';

	let { data } = $props();

	// Intentional one-time clone: the editor owns its working copy and syncs it
	// back via the autosave PUT, so it must not track later `data` changes.
	// svelte-ignore state_referenced_locally
	const initialProfile = structuredClone(data.profile) as DisplayProfile;
	// svelte-ignore state_referenced_locally
	for (const source of initialProfile.sources) source.connectionId ??= data.immich.defaultId ?? undefined;
	// svelte-ignore state_referenced_locally
	let profile = $state<DisplayProfile>(initialProfile);
	let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveError = $state<string | null>(null);
	let previewVersion = $state(0);
	let liveNow = $state(Date.now());
	let liveClient = $state<{
		clientId: string;
		name: string | null;
		device: string;
		fingerprint: string;
		slug: string;
		profileName: string;
		state: {
			paused: boolean;
			blackout: boolean;
			slide: { id: string; connectionId?: string } | null;
			slides: Array<{ id: string; connectionId?: string; ratio: number }>;
			endsAt: number | null;
			remainingMs: number;
		};
	} | null>(null);
	// svelte-ignore state_referenced_locally
	let sourceConnectionId = $state<string>(data.immich.defaultId ?? data.immich.connections[0]?.id ?? '');

	// --- autosave (debounced deep-watch) ---
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let ready = false;

	$effect(() => {
		const snapshot = JSON.stringify(profile);
		if (!ready) {
			ready = true;
			return;
		}
		saveState = 'saving';
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void save(snapshot), 700);
	});

	async function save(snapshot: string): Promise<void> {
		try {
			const res = await fetch(`/api/displays/${profile.slug}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: snapshot
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				saveError = body?.issues?.[0]?.message ?? body?.error ?? `Error ${res.status}`;
				saveState = 'error';
				return;
			}
			saveState = 'saved';
			saveError = null;
			previewVersion++; // reload the live preview with the new settings
		} catch {
			saveState = 'error';
			saveError = 'Network error';
		}
	}

	// --- sources ---
	const selectedAlbums = $derived(
		new Map<string, string>(
			profile.sources.flatMap((s) => (s.type === 'album' ? [[`${s.connectionId ?? 'default'}:${s.albumId}`, s.name] as const] : []))
		)
	);
	const selectedPeople = $derived(
		new Map<string, string>(
			profile.sources.flatMap((s) => (s.type === 'person' ? [[`${s.connectionId ?? 'default'}:${s.personId}`, s.name] as const] : []))
		)
	);
	const selectedPeopleCount = $derived(selectedPeople.size);
	const albumOnly = $derived(
		selectedAlbums.size > 0 && profile.sources.every((source) => source.type === 'album')
	);
	const hasSource = (type: 'random' | 'memories') =>
		profile.sources.some((s) => s.type === type);

	function toggleAlbum(album: { id: string; name: string; connectionId?: string }): void {
		const key = `${album.connectionId ?? 'default'}:${album.id}`;
		if (selectedAlbums.has(key)) {
			profile.sources = profile.sources.filter(
				(s) => !(s.type === 'album' && s.albumId === album.id && s.connectionId === album.connectionId)
			);
		} else {
			profile.sources = [...profile.sources, { type: 'album', albumId: album.id, name: album.name, connectionId: album.connectionId }];
		}
	}

	function togglePerson(person: { id: string; name: string; connectionId?: string }): void {
		const key = `${person.connectionId ?? 'default'}:${person.id}`;
		if (selectedPeople.has(key)) {
			profile.sources = profile.sources.filter(
				(s) => !(s.type === 'person' && s.personId === person.id && s.connectionId === person.connectionId)
			);
		} else {
			profile.sources = [
				...profile.sources,
				{ type: 'person', personId: person.id, name: person.name, connectionId: person.connectionId }
			];
		}
	}

	function toggleSimpleSource(type: 'random' | 'memories', on: boolean): void {
		if (on && !hasSource(type)) profile.sources = [...profile.sources, { type, ...(sourceConnectionId ? { connectionId: sourceConnectionId } : {}) }];
		if (!on) profile.sources = profile.sources.filter((s) => s.type !== type);
	}

	function useAlbumsOnly(): void {
		profile.sources = profile.sources.filter((source) => source.type === 'album');
	}

	type CachePlan = {
		assets: number;
		cached: number;
		cachedBytes: number;
		missing: number;
		estimatedAdditionalBytes: number;
		estimatedTotalBytes: number;
		size: 'preview' | 'fullsize';
		gallery?: {
			uniqueAssets: number;
			estimatedCompositions: number;
			estimatedCycleSeconds: number;
			dateFrom: string | null;
			dateTo: string | null;
			orientations: { portrait: number; landscape: number; square: number };
			originalBytes: number;
			originalSizeAssets: number;
			favorites: number;
			rated: number;
			withLocation: number;
			cameras: number;
			recognizedFaces: number;
			recognizedPeople: Array<{ id: string; name: string; appearances: number }>;
			contributors: Array<{ id: string; name: string; role: string }>;
		};
	};
	let cachePlan = $state<CachePlan | null>(null);
	let cacheState = $state<'idle' | 'planning' | 'starting' | 'started' | 'error'>('idle');
	let cacheError = $state<string | null>(null);
	let resetState = $state<'idle' | 'resetting' | 'done'>('idle');
	let cachePoll: ReturnType<typeof setInterval> | undefined;

	function formatBytes(bytes: number): string {
		if (bytes < 1024 ** 2) return `${Math.ceil(bytes / 1024)} KB`;
		if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
		return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
	}

	function formatDuration(seconds: number): string {
		const minutes = Math.ceil(seconds / 60);
		if (minutes < 60) return `${minutes} min`;
		const hours = Math.floor(minutes / 60);
		const rest = minutes % 60;
		if (hours < 24) return `${hours}h${rest ? ` ${rest}m` : ''}`;
		const days = Math.floor(hours / 24);
		const restHours = hours % 24;
		return `${days}d${restHours ? ` ${restHours}h` : ''}`;
	}

	function formatGalleryDate(value: string | null): string {
		if (!value) return 'Unknown';
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
	}

	async function refreshLiveClient(): Promise<void> {
		if (!data.clientId) return;
		const response = await fetch('/api/control/clients').catch(() => null);
		if (!response?.ok) return;
		const clients = (await response.json()) as Array<typeof liveClient>;
		liveClient = clients.find((client) => client?.clientId === data.clientId) ?? null;
	}

	function liveImageUrl(image: { id: string; connectionId?: string }): string {
		const params = new URLSearchParams({ size: 'preview' });
		if (image.connectionId) params.set('connection', image.connectionId);
		return `/api/image/${image.id}?${params}`;
	}

	function liveSecondsLeft(): number {
		if (!liveClient) return 0;
		const remaining = liveClient.state.paused
			? liveClient.state.remainingMs
			: liveClient.state.endsAt
				? Math.max(0, liveClient.state.endsAt - liveNow)
				: 0;
		return Math.ceil(remaining / 1000);
	}

	async function reviewAlbumCache(saveFirst = true): Promise<void> {
		cacheState = 'planning';
		cacheError = null;
		if (saveFirst) await save(JSON.stringify(profile));
		try {
			const res = await fetch(`/api/displays/${profile.slug}/cache`);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.message ?? body.error ?? `Error ${res.status}`);
			cachePlan = body;
			cacheState = 'idle';
		} catch (error) {
			cacheState = 'error';
			cacheError = error instanceof Error ? error.message : String(error);
		}
	}

	async function refreshCacheProgress(): Promise<void> {
		if (!cachePlan) return;
		try {
			const res = await fetch(`/api/displays/${profile.slug}/cache?progress=1`);
			if (!res.ok) return;
			const progress = (await res.json()) as CachePlan;
			cachePlan = { ...cachePlan, ...progress, gallery: cachePlan.gallery };
			if (progress.missing === 0) {
				cacheState = 'idle';
				clearInterval(cachePoll);
			}
		} catch {
			// Keep the last useful figures; the next bounded poll can recover.
		}
	}

	async function startAlbumCache(): Promise<void> {
		if (!cachePlan) return;
		const question = `Cache ${cachePlan.assets.toLocaleString()} photos from the selected album${selectedAlbums.size === 1 ? '' : 's'}?\n\nEstimated additional storage: ${formatBytes(cachePlan.estimatedAdditionalBytes)}.\nAlready cached: ${cachePlan.cached.toLocaleString()} photos (${formatBytes(cachePlan.cachedBytes)}).\n\nNo whole-library photos will be added.`;
		if (!confirm(question)) return;
		cacheState = 'starting';
		const res = await fetch(`/api/displays/${profile.slug}/cache`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ confirmed: true, expectedAssets: cachePlan.assets })
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			cacheState = 'error';
			cacheError = body.error ?? body.message ?? `Error ${res.status}`;
			if (body.plan) cachePlan = body.plan;
			return;
		}
		cacheState = 'started';
		clearInterval(cachePoll);
		cachePoll = setInterval(() => void refreshCacheProgress(), 3000);
		void refreshCacheProgress();
	}

	async function resetPlayers(clearImages: boolean): Promise<void> {
		const message = clearImages
			? 'Delete every cached image, clear the playlist, and reload all players on this display? Photos will be downloaded again only from the saved sources.'
			: 'Clear the saved playlist and reload all players with the selected albums now?';
		if (!confirm(message)) return;
		resetState = 'resetting';
		await save(JSON.stringify(profile));
		const res = await fetch(`/api/displays/${profile.slug}/reset`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clearImages })
		});
		resetState = res.ok ? 'done' : 'idle';
		setTimeout(() => (resetState = 'idle'), 2500);
	}

	// --- weather location ---
	let locationQuery = $state('');
	let locationResults = $state<{ name: string; shortName: string; lat: number; lon: number }[]>([]);
	let locating = $state(false);
	// Intentional editable connection form seeded once from server state.
	// svelte-ignore state_referenced_locally
	let haUrl = $state(data.homeAssistant.url ?? 'http://homeassistant.local:8123');
	let haToken = $state('');
	// svelte-ignore state_referenced_locally
	let haState = $state<'idle' | 'saving' | 'connected' | 'error'>(data.homeAssistant.configured ? 'connected' : 'idle');
	let haError = $state<string | null>(null);
	let haWeatherEntities = $state<Array<{ entityId: string; name: string; condition: string; temperature: number | null }>>([]);

	function acceptWeatherEntities(entities: typeof haWeatherEntities): void {
		haWeatherEntities = entities;
		if (entities.length && !entities.some((entity) => entity.entityId === profile.overlays.weather.haEntityId)) {
			profile.overlays.weather.haEntityId = entities[0].entityId;
		}
	}

	async function loadHomeAssistantEntities(): Promise<void> {
		if (!data.homeAssistant.configured) return;
		const response = await fetch('/api/home-assistant').catch(() => null);
		const body = await response?.json().catch(() => null);
		if (response?.ok) acceptWeatherEntities(body.weatherEntities ?? []);
		if (body?.entityError) haError = body.entityError;
	}

	async function connectHomeAssistant(): Promise<void> {
		haState = 'saving';
		haError = null;
		const response = await fetch('/api/home-assistant', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: haUrl, token: haToken })
		}).catch(() => null);
		const body = await response?.json().catch(() => null);
		if (!response?.ok) {
			haState = 'error';
			haError = body?.error ?? 'Could not connect';
			return;
		}
		haState = 'connected';
		haToken = '';
		haUrl = body.url;
		acceptWeatherEntities(body.weatherEntities ?? []);
	}

	async function searchLocation(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!locationQuery.trim()) return;
		const res = await fetch(`/api/geocode?q=${encodeURIComponent(locationQuery.trim())}`);
		locationResults = res.ok ? await res.json() : [];
	}

	function pickLocation(r: { name: string; shortName: string; lat: number; lon: number }): void {
		if (!profile.overlays.weather.cities.some((city) => Math.abs(city.lat - r.lat) < 0.001 && Math.abs(city.lon - r.lon) < 0.001)) {
			profile.overlays.weather.cities = [
				...profile.overlays.weather.cities,
				{ id: createClientId(), name: r.shortName, lat: r.lat, lon: r.lon }
			].slice(0, 8);
		}
		const first = profile.overlays.weather.cities[0];
		if (first) {
			profile.overlays.weather.lat = first.lat;
			profile.overlays.weather.lon = first.lon;
			profile.overlays.weather.locationName = first.name;
		}
		locationResults = [];
		locationQuery = '';
	}

	function removeWeatherCity(id: string): void {
		profile.overlays.weather.cities = profile.overlays.weather.cities.filter((city) => city.id !== id);
		const first = profile.overlays.weather.cities[0];
		profile.overlays.weather.lat = first?.lat ?? 0;
		profile.overlays.weather.lon = first?.lon ?? 0;
		profile.overlays.weather.locationName = first?.name;
	}

	function useBrowserLocation(): void {
		locating = true;
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				const lat = Math.round(pos.coords.latitude * 1000) / 1000;
				const lon = Math.round(pos.coords.longitude * 1000) / 1000;
				pickLocation({ name: 'Current location', shortName: 'Current location', lat, lon });
				locating = false;
			},
			() => (locating = false),
			{ timeout: 10_000 }
		);
	}

	// --- off hours ---
	const offHoursEnabled = $derived(profile.offHours !== undefined);

	function toggleOffHours(on: boolean): void {
		profile.offHours = on ? { start: '23:00', end: '07:00' } : undefined;
	}

	function addWidget(type: 'message' | 'quote' | 'trivia' | 'school-meals' | 'sl-departures'): void {
		const base = { id: createClientId(), enabled: true, position: 'bottom-right' as Corner, appearance: { scale: 1, colorMode: 'light' as const, color: '#ffffff' }, presentation: 'card' as const, tickerSpeedSec: 12 };
		profile.overlays.widgets = [
			...profile.overlays.widgets,
			type === 'message'
				? { ...base, type, text: 'Dinner is at 18:00' }
				: type === 'school-meals'
					? { ...base, type, schoolSlug: 'nasbyparksskolan', title: 'School lunch' }
					: type === 'sl-departures'
						? { ...base, type, title: 'Täby Park departures', siteIds: [9668, 2207], maxDepartures: 6, showTrains: true, showBuses: true }
						: { ...base, type, refreshMinutes: 30 }
		];
	}

	function removeWidget(id: string): void {
		profile.overlays.widgets = profile.overlays.widgets.filter((widget) => widget.id !== id);
	}

	function widgetLabel(type: DisplayProfile['overlays']['widgets'][number]['type']): string {
		return type === 'message' ? 'Custom message'
			: type === 'quote' ? 'Rotating quotes'
				: type === 'trivia' ? 'Rotating trivia'
					: type === 'school-meals' ? 'School meals'
						: 'SL departures';
	}

	const cornerOptions: { value: Corner; label: string }[] = [
		{ value: 'top-left', label: '↖' },
		{ value: 'top-center', label: '↑' },
		{ value: 'top-right', label: '↗' },
		{ value: 'middle-left', label: '←' },
		{ value: 'center', label: '•' },
		{ value: 'middle-right', label: '→' },
		{ value: 'bottom-left', label: '↙' },
		{ value: 'bottom-center', label: '↓' },
		{ value: 'bottom-right', label: '↘' }
	];
	const shortcutOptions = [
		{ value: 'none', label: 'No action' },
		{ value: 'next', label: 'Next photo' },
		{ value: 'previous', label: 'Previous photo' },
		{ value: 'play-pause', label: 'Play / pause' },
		{ value: 'toggle-clock', label: 'Show / hide clock' },
		{ value: 'toggle-calendar', label: 'Show / hide calendar' },
		{ value: 'toggle-weather', label: 'Show / hide weather' },
		{ value: 'toggle-text', label: 'Show / hide all text' },
		{ value: 'photo-info', label: 'Photo information' },
		{ value: 'cycle-layout', label: 'Next screen layout' },
		{ value: 'cycle-motion', label: 'Next motion style' },
		{ value: 'cycle-color', label: 'Next color treatment' },
		{ value: 'random-everything', label: 'Random everything' },
		{ value: 'toggle-random', label: 'Random / saved setup' },
		{ value: 'restore', label: 'Restore saved setup' }
	] as const;

	onMount(() => {
		if (albumOnly) void reviewAlbumCache(false);
		void loadHomeAssistantEntities();
		void refreshLiveClient();
		const liveTimer = data.clientId
			? setInterval(() => {
				liveNow = Date.now();
				void refreshLiveClient();
			}, 1000)
			: undefined;
		return () => {
			clearTimeout(saveTimer);
			clearInterval(cachePoll);
			clearInterval(liveTimer);
		};
	});
</script>

<svelte:head>
	<title>Mantel Controller — {profile.name}</title>
</svelte:head>

<div class="page">
	<div class="controller-shell">
		<ControllerHeader
			active="presentations"
			title="Customize presentation"
			description="Edit the photos, pacing, composition, effects, and information shown by every player assigned to this presentation."
		/>
	</div>
	<main>
		<div class="profile-heading">
			<span class="profile-label">Presentation name</span>
			<div class="title-row">
				<input class="title" bind:value={profile.name} maxlength="60" aria-label="Display name" />
				<span class="save-state" class:error={saveState === 'error'}>
					{#if saveState === 'saving'}Saving…{/if}
					{#if saveState === 'saved'}Saved{/if}
					{#if saveState === 'error'}{saveError ?? 'Save failed'}{/if}
				</span>
			</div>
			<p class="url">Player URL · port {playerPublicPort} · /display/{profile.slug}</p>
		</div>
		<nav class="editor-nav" aria-label="Presentation settings">
			<a href="#photos">Photos</a>
			<a href="#playback">Playback</a>
			<a href="#instant">Instant</a>
			<a href="#map">World map</a>
			<a href="#frame">Frame</a>
			<a href="#information">Information</a>
			<a href="#services">Services</a>
		</nav>

		<section id="photos">
			<h2>Photos</h2>
			<p class="section-hint">
				Nothing is selected or shared by default. Mantel never creates a public share and never writes
				to Immich. Choose one or more existing albums visible to the selected API-key account.
			</p>
			{#if profile.sources.length === 0}
				<div class="no-source">
					<strong>No photo source selected</strong>
					<span>“{profile.name}” is only this screen's profile name. Select an album below before it can show photos.</span>
				</div>
			{/if}
			{#if data.immich.connections.length > 1}
				<label class="account-source">
					Browse Immich account
					<select bind:value={sourceConnectionId}>
						{#each data.immich.connections as connection (connection.id)}
							<option value={connection.id}>{connection.name}</option>
						{/each}
					</select>
				</label>
			{/if}
			<div class="card">
				<Toggle
					label="Random from whole library"
					checked={hasSource('random')}
					onchange={(v: boolean) => toggleSimpleSource('random', v)}
				/>
				<Toggle
					label="Memories — photos from this day in past years"
					checked={hasSource('memories')}
					onchange={(v: boolean) => toggleSimpleSource('memories', v)}
				/>
			</div>

			<h3>Albums</h3>
			{#key sourceConnectionId}<AlbumPicker selected={selectedAlbums} connectionId={sourceConnectionId || undefined} ontoggle={toggleAlbum} />{/key}
			{#if selectedAlbums.size > 0}
				<div class="album-actions">
					{#if !albumOnly}
						<button class="btn primary" type="button" onclick={useAlbumsOnly}>Use selected albums only</button>
						<span>Removes whole-library, memories, and people sources from this display.</span>
					{:else}
						<button class="btn primary" type="button" onclick={() => resetPlayers(false)} disabled={resetState === 'resetting'}>
							{resetState === 'resetting' ? 'Applying…' : resetState === 'done' ? 'Applied' : 'Apply selected albums now'}
						</button>
						<button class="btn" type="button" onclick={() => reviewAlbumCache()} disabled={cacheState === 'planning'}>
							{cacheState === 'planning' ? 'Calculating…' : 'Review offline cache'}
						</button>
						<button class="btn danger" type="button" onclick={() => resetPlayers(true)}>Delete cached images</button>
						<span>Apply clears player queues. Delete cache also removes old image files.</span>
					{/if}
				</div>
				{#if cachePlan && albumOnly}
					<div class="cache-plan">
						<div class="cache-summary">
							<strong>{cachePlan.assets.toLocaleString()} selected photos</strong>
							<span>{cachePlan.cached.toLocaleString()} cached ({formatBytes(cachePlan.cachedBytes)}) · {cachePlan.missing.toLocaleString()} remaining</span>
							<span>Estimated cache when complete: {formatBytes(cachePlan.estimatedTotalBytes)}</span>
						</div>
						<div class="cache-meter" aria-label={`${cachePlan.cached} of ${cachePlan.assets} photos cached`}>
							<span style={`width: ${cachePlan.assets ? (cachePlan.cached / cachePlan.assets) * 100 : 0}%`}></span>
						</div>
						{#if cachePlan.gallery}
							{@const gallery = cachePlan.gallery}
							<div class="gallery-stats">
								<div><strong>{gallery.uniqueAssets.toLocaleString()}</strong><span>unique photos</span></div>
								<div><strong>{formatDuration(gallery.estimatedCompositions * profile.slideshow.intervalSec)}</strong><span>one full cycle now</span></div>
								<div><strong>{gallery.estimatedCompositions.toLocaleString()}</strong><span>screen compositions</span></div>
								<div><strong>{formatBytes(gallery.originalBytes)}</strong><span>original size ({gallery.originalSizeAssets.toLocaleString()} measured)</span></div>
								<div><strong>{gallery.orientations.landscape.toLocaleString()}</strong><span>landscape</span></div>
								<div><strong>{gallery.orientations.portrait.toLocaleString()}</strong><span>portrait</span></div>
								<div><strong>{gallery.orientations.square.toLocaleString()}</strong><span>square</span></div>
								<div><strong>{gallery.recognizedFaces.toLocaleString()}</strong><span>recognized face appearances</span></div>
								<div><strong>{gallery.recognizedPeople.length.toLocaleString()}</strong><span>recognized people</span></div>
								<div><strong>{gallery.withLocation.toLocaleString()}</strong><span>with location</span></div>
								<div><strong>{gallery.favorites.toLocaleString()}</strong><span>favorites</span></div>
								<div><strong>{gallery.rated.toLocaleString()}</strong><span>star rated</span></div>
							</div>
							<div class="gallery-detail">
								<span><strong>Time span</strong> {formatGalleryDate(gallery.dateFrom)} – {formatGalleryDate(gallery.dateTo)}</span>
								<span><strong>Cameras</strong> {gallery.cameras.toLocaleString()}</span>
								{#if gallery.contributors.length}
									<span><strong>Album members</strong> {gallery.contributors.map((person) => `${person.name} (${person.role})`).join(', ')}</span>
								{/if}
								{#if gallery.recognizedPeople.length}
									<span><strong>Most seen people</strong> {gallery.recognizedPeople.slice(0, 8).map((person) => `${person.name} ${person.appearances}`).join(' · ')}</span>
								{/if}
							</div>
						{/if}
						<button class="btn primary" type="button" onclick={startAlbumCache} disabled={cacheState === 'starting'}>
							{cacheState === 'starting' ? 'Starting…' : cacheState === 'started' ? `Caching · ${cachePlan.missing.toLocaleString()} left` : cachePlan.missing === 0 ? 'Album cache complete' : 'Confirm and cache albums'}
						</button>
					</div>
				{/if}
				{#if cacheError}<p class="cache-error">{cacheError}</p>{/if}
			{/if}

			<h3>People</h3>
			{#key sourceConnectionId}<PersonPicker selected={selectedPeople} connectionId={sourceConnectionId || undefined} ontoggle={togglePerson} />{/key}
		</section>

		<section id="playback">
			<h2>Playback</h2>
			<p class="section-hint">Choose the pace, ordering, composition, motion, and image quality for this presentation.</p>
			<div class="card">
				<label class="range-field">
					<span>Show each photo for <strong>{profile.slideshow.intervalSec}s</strong></span>
					<input type="range" min="5" max="120" step="5" bind:value={profile.slideshow.intervalSec} />
				</label>
				<label class="range-field">
					<span>After a pause, resume by itself <strong>{profile.slideshow.pauseResumeMin === 0 ? 'never' : `after ${profile.slideshow.pauseResumeMin} min`}</strong></span>
					<input type="range" min="0" max="60" step="1" bind:value={profile.slideshow.pauseResumeMin} />
				</label>
				<Segmented
					label="Transition"
					bind:value={profile.slideshow.transition}
					options={[
						{ value: 'random', label: 'Surprise me' },
						{ value: 'kenburns', label: 'Ken Burns' },
						{ value: 'crossfade', label: 'Crossfade' },
						{ value: 'slide', label: 'Glide' },
						{ value: 'zoom', label: 'Zoom' },
						{ value: 'wipe', label: 'Wipe' },
						{ value: 'card', label: '3D card' },
						{ value: 'reveal', label: 'Depth reveal' },
						{ value: 'none', label: 'None' }
					]}
				/>
				<Segmented
					label="Screen layout"
					bind:value={profile.slideshow.layout}
					options={[
						{ value: 'random', label: 'Random each time' },
						{ value: 'adaptive', label: 'Adaptive' },
						{ value: 'portrait-stack', label: 'Portrait + 2 wide' },
						{ value: 'single', label: 'One photo' },
						{ value: 'mosaic', label: 'Mosaic' },
						{ value: 'filmstrip', label: 'Moving wall' },
						{ value: 'instant', label: 'Instant table' },
						{ value: 'map', label: 'World map' }
					]}
				/>
				{#if profile.slideshow.layout === 'map'}
					<p class="field-hint">Flies across a self-hosted globe or flat map to each photo's location. Configure the journey under <a href="#map">World map</a>.</p>
				{/if}
				{#if profile.slideshow.layout === 'instant'}
					<p class="field-hint">Alternates one and two instant-photo cards. Face data guides each square crop; if all faces cannot fit safely, the whole photo is letterboxed inside the card. Enabled photo details are written on the white border.</p>
				{/if}
				{#if profile.slideshow.layout === 'portrait-stack'}
					<Segmented
						label="Portrait position"
						bind:value={profile.slideshow.mixedPortraitSide}
						options={[
							{ value: 'alternate', label: 'Alternate sides' },
							{ value: 'left', label: 'Left' },
							{ value: 'right', label: 'Right' }
						]}
					/>
					<p class="field-hint">Uses one unused portrait plus two unused landscape photos. If that combination is unavailable, Mantel shows the next photo normally without consuming unseen partners.</p>
				{/if}
				<Segmented
					label="Photo motion"
					bind:value={profile.slideshow.motionStyle}
					options={[
						{ value: 'random', label: 'Random each time' },
						{ value: 'off', label: 'Still' },
						{ value: 'gentle', label: 'Gentle' },
						{ value: 'cinematic', label: 'Cinematic' },
						{ value: 'dynamic', label: 'Dynamic' },
						{ value: 'drift', label: 'Pan across' },
						{ value: 'push-in', label: 'Push in' },
						{ value: 'pull-out', label: 'Pull out' },
						{ value: 'face-push-in', label: 'Push toward faces' },
						{ value: 'face-pull-out', label: 'Faces to full photo' },
						{ value: 'face-journey', label: 'Visit faces' }
					]}
				/>
				<Segmented
					label="Composition"
					bind:value={profile.slideshow.focusMode}
					options={[
						{ value: 'photo', label: 'Whole photo' },
						{ value: 'person', label: 'Face timeline' }
					]}
				/>
				{#if profile.slideshow.focusMode === 'person'}
					<div class="sub focus-note">
						<p>
							Centers the first selected person using cached Immich face data. Choose one person
							above and use “Oldest first” for a chronological selfie timelapse.
						</p>
						<label class="range-field">
							<span>Face zoom <strong>{profile.slideshow.faceZoom.toFixed(1)}×</strong></span>
							<input type="range" min="1" max="5" step="0.1" bind:value={profile.slideshow.faceZoom} />
						</label>
					</div>
				{/if}
				<label class="range-field">
					<span>Fade duration <strong>{(profile.slideshow.transitionDurationMs / 1000).toFixed(1)}s</strong></span>
					<input
						type="range"
						min="500"
						max="4000"
						step="100"
						bind:value={profile.slideshow.transitionDurationMs}
					/>
				</label>
				<Segmented
					label="Photo order"
					bind:value={profile.slideshow.order}
					options={[
						{ value: 'random', label: 'Random' },
						{ value: 'newest', label: 'Newest first' },
						{ value: 'oldest', label: 'Oldest first' }
					]}
				/>
				{#if profile.slideshow.layout === 'adaptive'}
					<Segmented
						label="Portrait photos on a landscape TV"
						bind:value={profile.slideshow.portraitMode}
						options={[
							{ value: 'blur-fill', label: 'Soft background' },
							{ value: 'pair', label: 'Side by side' }
						]}
					/>
					<p class="field-hint">Choose “Side by side” to automatically find a second unused portrait photo. On phones, Mantel instead pairs landscape photos vertically.</p>
				{/if}
				<Segmented
					label="Color treatment"
					bind:value={profile.slideshow.visualEffect}
					options={[
						{ value: 'random', label: 'Random each time' },
						{ value: 'natural', label: 'Original' },
						{ value: 'warm', label: 'Warm' },
						{ value: 'vivid', label: 'Colorful' },
						{ value: 'monochrome', label: 'B&W' },
						{ value: 'negative', label: 'Film negative' },
						{ value: 'kodak', label: 'Kodak-inspired' },
						{ value: 'fuji', label: 'Fuji-inspired' },
						{ value: 'instant', label: 'Aged Instant' },
						{ value: 'noir', label: 'Noir' },
						{ value: 'art', label: 'Gallery print' }
					]}
				/>
				<p class="field-hint">Original applies no color filter. The optional film looks are fast GPU treatments, not calibrated manufacturer LUTs.</p>
				<Segmented
					label="Image fit"
					bind:value={profile.slideshow.imageFit}
					options={[
						{ value: 'contain', label: 'Show whole image' },
						{ value: 'cover', label: 'Fill screen' }
					]}
				/>
				<Segmented
					label="Image quality"
					bind:value={profile.slideshow.imageSize}
					options={[
						{ value: 'preview', label: 'Preview' },
						{ value: 'fullsize', label: 'Full size' }
					]}
				/>
				<Segmented
					label="Progress bar"
					bind:value={profile.slideshow.progressBar}
					options={[
						{ value: 'off', label: 'Off' },
						{ value: 'top', label: 'Top' },
						{ value: 'bottom', label: 'Bottom' }
					]}
				/>
			</div>

			<div class="card">
				<h3 class="card-title">Magic Remote colored buttons</h3>
				<p class="field-hint">These choices apply to normal slideshow modes. Instant mode automatically uses the colors for arrangement, background, card count, and captions. The player briefly shows the active mapping whenever you use the remote.</p>
				<div class="remote-shortcuts colors">
					{#each profile.colorShortcuts as action, index (index)}
						<label><strong class="remote-color color-{index}" aria-label={['Red', 'Green', 'Yellow', 'Blue'][index]}></strong><select value={profile.colorShortcuts[index]} onchange={(event) => {
							const updated = [...profile.colorShortcuts];
							updated[index] = event.currentTarget.value as DisplayProfile['colorShortcuts'][number];
							profile.colorShortcuts = updated;
						}}>{#each shortcutOptions as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
					{/each}
				</div>
				<div class="instant-remote-map" aria-label="Instant color button actions">
					<span><i class="remote-color color-0"></i>Arrangement</span>
					<span><i class="remote-color color-1"></i>Background</span>
					<span><i class="remote-color color-2"></i>Card count</span>
					<span><i class="remote-color color-3"></i>Captions</span>
				</div>
			</div>

		</section>

		<section id="instant">
			<h2>Instant</h2>
			<p class="section-hint">A separate presentation studio for instant-photo compositions. Choose Instant under Playback to use it exclusively, or let Random mode include it occasionally.</p>
			{#if profile.slideshow.layout !== 'instant' && profile.slideshow.layout !== 'random'}
				<div class="instant-mode-note">
					<span>Instant is configured but not currently selected.</span>
					<button type="button" onclick={() => (profile.slideshow.layout = 'instant')}>Use Instant mode</button>
				</div>
			{/if}
			<InstantStudio bind:settings={profile.slideshow.instant} slug={profile.slug} />
		</section>

		<section id="map">
			<h2>World map</h2>
			<p class="section-hint">A journey across your photos' places: the camera leaves the world view, flies to a location, shows one photo there, and returns. Vector map data ships with Mantel, so nothing is fetched from outside your network unless Wikipedia trivia is enabled.</p>
			{#if profile.slideshow.layout !== 'map'}
				<div class="instant-mode-note">
					<span>The world map is configured but not currently selected.</span>
					<button type="button" onclick={() => (profile.slideshow.layout = 'map')}>Use World map</button>
				</div>
			{/if}
			<MapStudio bind:settings={profile.slideshow.map} />
		</section>

		<section id="frame">
			<h2>Frame</h2>
			<p class="section-hint">Control the physical spacing and optional picture-frame treatment around every photograph.</p>
			<div class="card">
				<label class="range-field">
					<span>Edge margin <strong>{profile.slideshow.frameInsetPx}px</strong></span>
					<input type="range" min="0" max="200" step="2" bind:value={profile.slideshow.frameInsetPx} />
				</label>
				<label class="range-field">
					<span>Space between photos <strong>{profile.slideshow.photoGapPx}px</strong></span>
					<input type="range" min="0" max="80" step="1" bind:value={profile.slideshow.photoGapPx} />
				</label>
				<label class="range-field">
					<span>Rounded corners <strong>{profile.slideshow.cornerRadiusPx}px</strong></span>
					<input type="range" min="0" max="120" step="2" bind:value={profile.slideshow.cornerRadiusPx} />
				</label>
				<label class="range-field">
					<span>Border width <strong>{profile.slideshow.borderWidthPx}px</strong></span>
					<input type="range" min="0" max="24" step="1" bind:value={profile.slideshow.borderWidthPx} />
				</label>
				<Segmented
					label="Picture frame"
					bind:value={profile.slideshow.frameStyle}
					options={[
						{ value: 'none', label: 'None' },
						{ value: 'white', label: 'White' },
						{ value: 'black', label: 'Black' },
						{ value: 'walnut', label: 'Walnut' },
						{ value: 'aluminium', label: 'Aluminium' }
					]}
				/>
				{#if profile.slideshow.frameStyle !== 'none'}
					<label class="range-field">
						<span>Frame width <strong>{profile.slideshow.frameWidthPx}px</strong></span>
						<input type="range" min="4" max="160" step="2" bind:value={profile.slideshow.frameWidthPx} />
					</label>
				{/if}
				<label class="range-field">
					<span>Passpartout / mat <strong>{profile.slideshow.matWidthPx}px</strong></span>
					<input type="range" min="0" max="240" step="2" bind:value={profile.slideshow.matWidthPx} />
				</label>
				<div class="color-fields">
					<label>Border <input type="color" bind:value={profile.slideshow.borderColor} /></label>
					<label>Mat <input type="color" bind:value={profile.slideshow.matColor} /></label>
					<label>Background <input type="color" bind:value={profile.slideshow.backgroundColor} /></label>
				</div>
			</div>
		</section>

		<section>
			<h2>Photo filters</h2>
			<div class="card">
				<Segmented
					label="Orientation"
					bind:value={profile.filters.orientation}
					options={[
						{ value: 'all', label: 'All' },
						{ value: 'landscape', label: 'Landscape' },
						{ value: 'portrait', label: 'Portrait' }
					]}
				/>
				{#if selectedPeopleCount > 1}
					<Segmented
						label="Selected people"
						bind:value={profile.filters.peopleMatch}
						options={[
							{ value: 'any', label: 'Any person' },
							{ value: 'all', label: 'All together' }
						]}
					/>
				{/if}
				<Toggle label="Favorites only" bind:checked={profile.filters.favoritesOnly} />
				<label class="range-field">
					<span>Minimum rating <strong>{profile.filters.minRating || 'Any'}</strong></span>
					<input type="range" min="0" max="5" step="1" bind:value={profile.filters.minRating} />
				</label>
				<div class="date-fields">
					<label>
						Taken from
						<input
							type="date"
							value={profile.filters.dateFrom ?? ''}
							onchange={(event) =>
								(profile.filters.dateFrom = event.currentTarget.value || null)}
						/>
					</label>
					<label>
						Taken until
						<input
							type="date"
							value={profile.filters.dateTo ?? ''}
							onchange={(event) =>
								(profile.filters.dateTo = event.currentTarget.value || null)}
						/>
					</label>
				</div>
				<label class="number-field">
					<span>Keep only newest</span>
					<input type="number" min="0" max="100000" step="1" bind:value={profile.filters.newestLimit} />
					<small>0 means no limit</small>
				</label>
			</div>
		</section>

		<section id="information">
			<h2>Information</h2>
			<p class="section-hint">Place and style the clock, weather, calendar, ticker, and photo details independently.</p>

			<div class="card">
				<label class="range-field">
					<span>OLED text cycle <strong>{profile.overlays.autoHideSec === 0 ? 'Position shift only' : `${profile.overlays.autoHideSec}s visible · 8s hidden`}</strong></span>
					<input type="range" min="0" max="60" step="5" bind:value={profile.overlays.autoHideSec} />
				</label>
			</div>

			<div class="card">
				<Toggle label="Clock" bind:checked={profile.overlays.clock.enabled} />
				{#if profile.overlays.clock.enabled}
					<div class="sub">
						<Segmented label="Clock style" bind:value={profile.overlays.clock.style} options={[{ value: 'digital', label: 'Digital' }, { value: 'analog', label: 'Analog' }]} />
						<Toggle label="Show date" bind:checked={profile.overlays.clock.showDate} />
						<Toggle label="Show seconds" bind:checked={profile.overlays.clock.showSeconds} />
						<Toggle label="24-hour time" bind:checked={profile.overlays.clock.format24h} />
						<Segmented label="Language and date" bind:value={profile.overlays.clock.locale} options={[{ value: 'en-GB', label: 'English (UK)' }, { value: 'sv-SE', label: 'Svenska' }, { value: 'ro-RO', label: 'Română' }, { value: 'en-US', label: 'English (US)' }]} />
						<Segmented label="Corner" bind:value={profile.overlays.clock.position} options={cornerOptions} />
						<TextAppearanceEditor appearance={profile.overlays.clock.appearance} />
					</div>
				{/if}
			</div>

			<div class="card">
				<Toggle label="Weather" bind:checked={profile.overlays.weather.enabled} />
				{#if profile.overlays.weather.enabled}
					<div class="sub">
						<Segmented
							label="Weather source"
							bind:value={profile.overlays.weather.provider}
							options={[
								{ value: 'location', label: 'Location weather' },
								{ value: 'home-assistant', label: 'Home Assistant' }
							]}
						/>
						{#if profile.overlays.weather.provider === 'location'}
						<div class="location">
							{#if profile.overlays.weather.cities.length}
								<div class="weather-cities">
									{#each profile.overlays.weather.cities as city (city.id)}
										<div><span><strong>{city.name}</strong><small>{city.lat.toFixed(3)}, {city.lon.toFixed(3)}</small></span><button type="button" class="btn danger" onclick={() => removeWeatherCity(city.id)}>Remove</button></div>
									{/each}
								</div>
							{:else}
								<span class="current">No weather cities yet</span>
							{/if}
							<form onsubmit={searchLocation}>
								<input type="search" placeholder="Täby, Sweden · Tomești, Iași, Romania · Bangkok…" bind:value={locationQuery} />
								<button type="submit" class="btn">Find city</button>
								<button type="button" class="btn" onclick={useBrowserLocation} disabled={locating}>
									{locating ? 'Locating…' : 'Use my location'}
								</button>
							</form>
							{#if locationResults.length}
								<ul class="results">
									{#each locationResults as r (r.name)}
										<li><button type="button" onclick={() => pickLocation(r)}>{r.name}</button></li>
									{/each}
								</ul>
							{/if}
						</div>
						{:else}
							<div class="text-fields ha-fields">
								<small>Home Assistant uses an existing <code>weather.*</code> entity; town search belongs to Location weather.</small>
								<label>Home Assistant URL <input type="url" bind:value={haUrl} placeholder="http://homeassistant.local:8123" /></label>
								<label>Long-lived access token <input type="password" bind:value={haToken} placeholder={haState === 'connected' ? 'Saved — enter only to replace' : 'Paste token'} /></label>
								<button class="btn" type="button" onclick={connectHomeAssistant} disabled={haState === 'saving' || !haToken}>{haState === 'saving' ? 'Testing…' : haState === 'connected' ? 'Replace connection' : 'Test and save'}</button>
								{#if haError}<small class="cache-error">{haError}</small>{/if}
								{#if haWeatherEntities.length}
									<label>Weather entity
										<select bind:value={profile.overlays.weather.haEntityId}>
											{#each haWeatherEntities as entity (entity.entityId)}
												<option value={entity.entityId}>{entity.name} · {entity.entityId}{entity.temperature !== null ? ` · ${entity.temperature}°` : ''}</option>
											{/each}
										</select>
									</label>
								{:else}
									<label>Weather entity <input bind:value={profile.overlays.weather.haEntityId} placeholder="weather.home" pattern="weather\.[a-z0-9_]+" /></label>
									<small>No <code>weather.*</code> entities were discovered. Check the connection or enter an entity ID manually.</small>
								{/if}
								<small>The token is stored only on the Mantel server in <code>/data/home-assistant.json</code> with mode 0600.</small>
							</div>
						{/if}
						<Segmented
							label="Units"
							bind:value={profile.overlays.weather.units}
							options={[
								{ value: 'celsius', label: '°C' },
								{ value: 'fahrenheit', label: '°F' }
							]}
						/>
						<Segmented label="Corner" bind:value={profile.overlays.weather.position} options={cornerOptions} />
						<TextAppearanceEditor appearance={profile.overlays.weather.appearance} />
					</div>
				{/if}
			</div>

			<div class="card">
				<Toggle label="Calendar and celebrations" bind:checked={profile.overlays.calendar.enabled} />
				{#if profile.overlays.calendar.enabled}
					<div class="sub">
						<Segmented label="Calendar region" bind:value={profile.overlays.calendar.region} options={[{ value: 'SE', label: 'Sweden' }, { value: 'RO', label: 'Romania' }, { value: 'US', label: 'United States' }, { value: 'GLOBAL', label: 'Global celebrations' }]} />
						<Toggle label="Holidays and celebrations" bind:checked={profile.overlays.calendar.showHolidays} />
						{#if profile.overlays.calendar.region === 'SE'}<Toggle label="Name days (namnsdag)" bind:checked={profile.overlays.calendar.showNameDays} />{/if}
						<Toggle label="Week number" bind:checked={profile.overlays.calendar.showWeekNumber} />
						<Segmented label="Corner" bind:value={profile.overlays.calendar.position} options={cornerOptions} />
						<TextAppearanceEditor appearance={profile.overlays.calendar.appearance} />
					</div>
				{/if}
			</div>

			<div class="card">
				<Toggle label="Scrolling ticker" bind:checked={profile.overlays.ticker.enabled} />
				{#if profile.overlays.ticker.enabled}
					<div class="sub text-fields">
						<label>Message, reminder, or news text <textarea bind:value={profile.overlays.ticker.text} maxlength="2000" rows="3" placeholder="Remember: school bags by the door · Family news…"></textarea></label>
						<label class="range-field">
							<span>One pass <strong>{profile.overlays.ticker.speedSec}s</strong></span>
							<input type="range" min="3" max="180" step="1" bind:value={profile.overlays.ticker.speedSec} />
						</label>
						<Segmented label="Position" bind:value={profile.overlays.ticker.position} options={[{ value: 'bottom', label: 'Bottom' }, { value: 'top', label: 'Top' }]} />
						<Toggle label="Blurred dark background" bind:checked={profile.overlays.ticker.background} />
						<TextAppearanceEditor appearance={profile.overlays.ticker.appearance} />
					</div>
				{/if}
			</div>

			<div class="card">
				<Toggle label="Photo info" bind:checked={profile.overlays.metadata.enabled} />
				{#if profile.overlays.metadata.enabled}
					<div class="sub">
						<Toggle label="Date taken" bind:checked={profile.overlays.metadata.showDate} />
						<Toggle label="Location" bind:checked={profile.overlays.metadata.showLocation} />
						<Toggle label="Camera" bind:checked={profile.overlays.metadata.showCamera} />
						<Toggle label="Rating" bind:checked={profile.overlays.metadata.showRating} />
						<Toggle label="People in the photo" bind:checked={profile.overlays.metadata.showPeople} />
						{#if profile.overlays.metadata.showPeople}
							<Toggle label="Round face cards" bind:checked={profile.overlays.metadata.showFaceCards} />
							<Toggle label="Age when photo was taken" bind:checked={profile.overlays.metadata.showAge} />
						{/if}
						<Segmented label="Corner" bind:value={profile.overlays.metadata.position} options={cornerOptions} />
						<TextAppearanceEditor appearance={profile.overlays.metadata.appearance} />
					</div>
				{/if}
			</div>

			<div class="card">
				<Toggle
					label="Turn screen off at night"
					checked={offHoursEnabled}
					onchange={toggleOffHours}
				/>
				{#if profile.offHours}
					<div class="sub times">
						<label>From <input type="time" bind:value={profile.offHours.start} /></label>
						<label>Until <input type="time" bind:value={profile.offHours.end} /></label>
					</div>
				{/if}
			</div>
		</section>

		<section id="services">
			<div class="widget-heading">
				<div>
					<h2>Services</h2>
					<p>Optional live information and family messages. Changes appear on connected screens after autosave.</p>
				</div>
				<div class="widget-add">
					<button class="btn" type="button" onclick={() => addWidget('message')}>+ Message</button>
					<button class="btn" type="button" onclick={() => addWidget('quote')}>+ Quote</button>
					<button class="btn" type="button" onclick={() => addWidget('trivia')}>+ Trivia</button>
					<button class="btn" type="button" onclick={() => addWidget('school-meals')}>+ School meals</button>
					<button class="btn" type="button" onclick={() => addWidget('sl-departures')}>+ SL departures</button>
				</div>
			</div>
			{#each profile.overlays.widgets as widget (widget.id)}
				<div class="card widget-editor">
					<div class="widget-row">
						<Toggle label={widgetLabel(widget.type)} bind:checked={widget.enabled} />
						<button class="remove" type="button" onclick={() => removeWidget(widget.id)}>Remove</button>
					</div>
					{#if widget.type === 'message'}
						<textarea bind:value={widget.text} maxlength="500" rows="3" aria-label="Message text"></textarea>
					{:else if widget.type === 'school-meals'}
						<div class="text-fields">
							<label>Heading <input bind:value={widget.title} maxlength="80" /></label>
							<label>Skolmaten school slug <input bind:value={widget.schoolSlug} pattern="[a-z0-9-]+" /></label>
							<small>From skolmaten.se/<strong>{widget.schoolSlug || 'school-name'}</strong> · today and next week</small>
						</div>
					{:else if widget.type === 'quote' || widget.type === 'trivia'}
						<label class="range-field">
							<span>Change content every <strong>{widget.refreshMinutes} minutes</strong></span>
							<input type="range" min="15" max="60" step="5" bind:value={widget.refreshMinutes} />
						</label>
					{:else if widget.type === 'sl-departures'}
						<div class="text-fields">
							<label>Heading <input bind:value={widget.title} maxlength="80" /></label>
							<label>SL site IDs
								<input
									value={widget.siteIds.join(', ')}
									onchange={(event) => {
										const ids = (event.currentTarget as HTMLInputElement).value.split(',').map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 6);
										if (ids.length) widget.siteIds = ids;
									}}
								/>
							</label>
							<small>Defaults: Galoppfältet/Täby Park railway 9668 · nearby Kemistvägen buses 2207.</small>
							<Toggle label="Roslagsbanan trains" bind:checked={widget.showTrains} />
							<Toggle label="Buses" bind:checked={widget.showBuses} />
							<label class="range-field"><span>Departures shown <strong>{widget.maxDepartures}</strong></span><input type="range" min="2" max="12" step="1" bind:value={widget.maxDepartures} /></label>
						</div>
					{/if}
					<Segmented label="Show as" bind:value={widget.presentation} options={[{ value: 'card', label: 'Information card' }, { value: 'ticker-top', label: 'Top ticker' }, { value: 'ticker-bottom', label: 'Bottom ticker' }]} />
					{#if widget.presentation === 'card'}
						<Segmented label="Position" bind:value={widget.position} options={cornerOptions} />
					{:else}
						<label class="range-field"><span>One ticker pass <strong>{widget.tickerSpeedSec}s</strong></span><input type="range" min="3" max="60" step="1" bind:value={widget.tickerSpeedSec} /></label>
					{/if}
					<TextAppearanceEditor appearance={widget.appearance} />
				</div>
			{/each}
		</section>
	</main>

	<aside>
		{#if data.clientId}
			<div class="live-preview-heading">
				<strong>{liveClient?.name || (liveClient ? `${liveClient.device}${liveClient.fingerprint ? ` · ${liveClient.fingerprint}` : ''}` : 'Selected player')}</strong>
				<span>Exact live output · {data.clientId.slice(0, 8)}</span>
			</div>
			<div class="preview-box live" class:multi={(liveClient?.state.slides.length ?? 0) > 1}>
				{#if liveClient?.state.slides.length}
					{#each liveClient.state.slides as image (`${image.connectionId ?? 'default'}:${image.id}`)}
						<img src={liveImageUrl(image)} alt="" />
					{/each}
				{:else if liveClient?.state.slide}
					<img src={liveImageUrl(liveClient.state.slide)} alt="Current player photograph" />
				{:else}
					<span class="live-empty">{liveClient ? 'Waiting for the player photograph' : 'Player is offline'}</span>
				{/if}
				{#if liveClient}
					<span class="live-status">{liveClient.state.blackout ? 'Screen black' : liveClient.state.paused ? 'Paused' : `${liveSecondsLeft()}s`}</span>
				{/if}
			</div>
			<p class="preview-hint">Reported by this player. Images and countdown stay synchronized with its screen.</p>
		{:else}
			<div class="preview-box">
				<iframe
					src="/display/{profile.slug}?preview=1&v={previewVersion}"
					title="Presentation preview"
				></iframe>
			</div>
			<p class="preview-hint">Presentation preview — open this editor from a player card to follow that exact screen.</p>
		{/if}
		<a class="open" href="/display/{profile.slug}" target="_blank">Open presentation in a new player ↗</a>
	</aside>
</div>

<style>
	.page {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(20rem, 34rem);
		gap: 2.5rem;
		max-width: 90rem;
		margin: 0 auto;
		padding: 2.5rem 2rem 6rem;
		width: 100%;
		min-width: 0;
	}

	.controller-shell { grid-column: 1 / -1; }
	main, aside { min-width: 0; }

	@media (max-width: 60rem) {
		.page {
		grid-template-columns: 1fr;
		}
	}

	@media (max-width: 36rem) {
		.page {
			padding: 1.25rem 1rem 4rem;
			gap: 1.25rem;
		}

		.account-source {
			align-items: stretch;
			flex-direction: column;
		}

		.account-source select {
			width: 100%;
		}

		.album-actions {
			align-items: stretch;
			flex-direction: column;
		}

		.album-actions .btn {
			text-align: center;
		}

		.card { padding: 1rem; }
		.sub { padding-left: 0; }
		.section-hint, .card p { overflow-wrap: anywhere; }
	}

	.profile-heading { margin-top: 0.5rem; padding: 1rem 1.15rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
	.profile-label { color: var(--accent); font: 700 0.62rem/1 ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; }

	.title-row {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		margin-top: 0.5rem;
	}

	.title {
		font-size: 1.6rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		background: none;
		border: none;
		border-bottom: 1px solid transparent;
		color: var(--text);
		padding: 0;
		min-width: 0;
		flex: 1;
	}

	.title:hover {
		border-bottom-color: var(--border);
	}

	.title:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
		border-bottom-color: var(--accent);
	}

	.save-state {
		font-size: 0.8rem;
		color: var(--text-faint);
		white-space: nowrap;
	}

	.save-state.error {
		color: #e08080;
	}

	.url {
		color: var(--text-faint);
		font-size: 0.85rem;
		margin: 0.25rem 0 0;
	}

	.editor-nav {
		position: sticky;
		top: 0.75rem;
		z-index: 20;
		display: flex;
		gap: 0.35rem;
		overflow-x: auto;
		margin-top: 0.75rem;
		padding: 0.4rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--surface) 92%, transparent);
		backdrop-filter: blur(18px);
	}

	.editor-nav a {
		flex: 1 0 auto;
		padding: 0.5rem 0.7rem;
		border-radius: var(--radius-sm);
		color: var(--text-dim);
		font-size: 0.78rem;
		font-weight: 700;
		text-align: center;
		text-decoration: none;
	}

	.editor-nav a:hover,
	.editor-nav a:focus-visible {
		background: var(--surface-raised);
		color: var(--text);
	}

	section {
		margin-top: 2.5rem;
		scroll-margin-top: 5rem;
	}

	h2 {
		font-size: 1.1rem;
		margin: 0 0 0.75rem;
	}

	.section-hint {
		margin: -0.35rem 0 1rem;
		color: var(--text-faint);
		font-size: 0.85rem;
		line-height: 1.45;
	}

	.no-source {
		display: grid;
		gap: 0.25rem;
		margin-bottom: 1rem;
		padding: 0.85rem 1rem;
		border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--accent) 7%, var(--surface));
	}

	.no-source span { color: var(--text-dim); font-size: 0.84rem; line-height: 1.45; }

	.account-source {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.75rem;
		padding: 0.7rem 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-dim);
		font-size: 0.85rem;
	}

	.account-source select {
		padding: 0.35rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-raised);
		color: var(--text);
	}

	h3 {
		font-size: 0.9rem;
		color: var(--text-dim);
		margin: 1.5rem 0 0.6rem;
	}

	.card {
		display: grid;
		gap: 0.9rem;
		padding: 1.1rem 1.25rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.card + .card {
		margin-top: 0.75rem;
	}
	.instant-mode-note { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.75rem; padding: 0.7rem 0.85rem; border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--accent) 6%, var(--surface)); color: var(--text-dim); font-size: 0.82rem; }
	.instant-mode-note button { flex: 0 0 auto; padding: 0.45rem 0.65rem; border: 1px solid var(--accent); border-radius: var(--radius-sm); color: var(--accent); font-size: 0.78rem; font-weight: 700; }
	.card-title { margin: 0; color: var(--text); }
	.weather-cities { display: grid; gap: 0.45rem; margin-bottom: 0.65rem; }
	.weather-cities > div { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.65rem 0.75rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-raised); }
	.weather-cities span { display: grid; gap: 0.1rem; }
	.weather-cities small { color: var(--text-faint); }
	.remote-shortcuts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.55rem; }
	.remote-shortcuts label { display: grid; grid-template-columns: 2rem minmax(0, 1fr); align-items: center; gap: 0.5rem; }
	.remote-shortcuts strong { display: grid; place-items: center; width: 2rem; height: 2rem; border: 1px solid var(--border); border-radius: 50%; color: var(--accent); }
	.remote-shortcuts.colors { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.remote-shortcuts strong.remote-color { border-color: rgba(255,255,255,.22); box-shadow: inset 0 0 0 2px rgba(0,0,0,.18), 0 1px 4px rgba(0,0,0,.2); }
	.remote-color.color-0 { background: #db3a34; }
	.remote-color.color-1 { background: #2da44e; }
	.remote-color.color-2 { background: #e8b923; }
	.remote-color.color-3 { background: #2878d0; }
	.remote-shortcuts select { min-width: 0; width: 100%; }
	.instant-remote-map { display: flex; flex-wrap: wrap; gap: 0.55rem 1rem; margin-top: 0.85rem; color: var(--text-dim); font-size: 0.78rem; }
	.instant-remote-map span { display: inline-flex; align-items: center; gap: 0.4rem; }
	.instant-remote-map i.remote-color { display: inline-block; width: 0.85rem; height: 0.85rem; border-radius: 50%; }
	@media (max-width: 720px) { .remote-shortcuts { grid-template-columns: 1fr; } }

	.album-actions,
	.cache-plan {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.75rem;
		padding: 0.85rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
	}

	.album-actions span,
	.cache-plan span {
		font-size: 0.8rem;
		color: var(--text-faint);
	}

	.cache-plan {
		align-items: flex-start;
		flex-direction: column;
	}

	.cache-summary { display: grid; gap: 0.2rem; }
	.cache-meter { width: 100%; height: 0.4rem; overflow: hidden; border-radius: 999px; background: var(--surface-raised); }
	.cache-meter span { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width 0.3s ease; }
	.gallery-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.55rem; width: 100%; }
	.gallery-stats div { display: grid; gap: 0.1rem; min-width: 0; padding: 0.7rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-raised); }
	.gallery-stats strong { font-size: 1.05rem; color: var(--text); }
	.gallery-stats span { line-height: 1.3; }
	.gallery-detail { display: grid; gap: 0.35rem; width: 100%; padding-top: 0.2rem; }
	.gallery-detail span { line-height: 1.45; overflow-wrap: anywhere; }
	.gallery-detail strong { color: var(--text-dim); }

	.cache-error {
		color: #e08080;
		font-size: 0.82rem;
	}

	.btn.primary {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--on-accent);
	}

	.sub {
		display: grid;
		gap: 0.9rem;
		padding: 0.9rem 0 0.1rem 1rem;
		border-top: 1px solid var(--border);
	}

	.focus-note p,
	.widget-heading p {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.45;
		color: var(--text-faint);
	}

	.color-fields {
		display: flex;
		gap: 1rem;
	}

	.color-fields label {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		font-size: 0.9rem;
		color: var(--text-dim);
	}

	.color-fields input {
		width: 2.8rem;
		height: 2rem;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: transparent;
	}

	.widget-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
		margin: 1.5rem 0 0.7rem;
	}

	.widget-heading h2 { margin: 0 0 0.25rem; }
	.widget-add { display: flex; gap: 0.4rem; flex-wrap: wrap; justify-content: flex-end; }
	.widget-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
	.remove { color: #db8f8f; font-size: 0.8rem; }

	.widget-editor textarea {
		width: 100%;
		resize: vertical;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-raised);
		color: var(--text);
		font: inherit;
	}

	.text-fields { display: grid; gap: 0.7rem; }
	.text-fields label { display: grid; gap: 0.35rem; font-size: 0.82rem; color: var(--text-dim); }
	.text-fields input {
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-raised);
		color: var(--text);
	}
	.text-fields small { color: var(--text-faint); }

	.range-field {
		display: grid;
		gap: 0.5rem;
		font-size: 0.95rem;
	}

	.range-field input[type='range'] {
		width: 100%;
		accent-color: var(--accent);
	}

	.date-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.date-fields label,
	.number-field {
		display: grid;
		gap: 0.4rem;
		font-size: 0.9rem;
		color: var(--text-dim);
	}

	.date-fields input,
	.number-field input {
		min-width: 0;
		padding: 0.45rem 0.65rem;
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text);
	}

	.number-field {
		grid-template-columns: 1fr 7rem;
		align-items: center;
	}

	.number-field small {
		grid-column: 1 / -1;
		color: var(--text-faint);
	}

	.location {
		display: grid;
		gap: 0.5rem;
	}

	.current {
		font-size: 0.9rem;
		color: var(--text-dim);
	}

	.location form {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.location input[type='search'] {
		flex: 1;
		min-width: 8rem;
		padding: 0.45rem 0.75rem;
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text);
	}

	.btn {
		padding: 0.45rem 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-raised);
		font-size: 0.85rem;
	}

	.btn:hover {
		border-color: var(--accent);
	}

	.results {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}

	.results button {
		width: 100%;
		text-align: left;
		padding: 0.45rem 0.75rem;
		border-radius: var(--radius-sm);
		background: var(--surface-raised);
		font-size: 0.9rem;
	}

	.results button:hover {
		background: var(--border);
	}

	.times {
		display: flex;
		gap: 1.5rem;
	}

	.times label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--text-dim);
	}

	.times input {
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text);
		padding: 0.35rem 0.5rem;
	}

	aside {
		position: sticky;
		top: 2.5rem;
		align-self: start;
	}

	.preview-box {
		aspect-ratio: 16 / 9;
		border-radius: var(--radius);
		overflow: hidden;
		border: 1px solid var(--border);
		background: #000;
	}

	.preview-box.live { position: relative; display: grid; place-items: center; grid-auto-rows: 1fr; color: var(--text-faint); }
	.preview-box.live.multi { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.preview-box.live img { width: 100%; height: 100%; min-height: 0; object-fit: cover; }
	.live-preview-heading { display: flex; align-items: end; justify-content: space-between; gap: 1rem; margin-bottom: 0.6rem; }
	.live-preview-heading strong { font-size: 0.95rem; }
	.live-preview-heading span { color: var(--text-faint); font: 0.68rem/1.2 ui-monospace, monospace; }
	.live-empty { font-size: 0.82rem; }
	.live-status { position: absolute; top: 0.6rem; right: 0.6rem; padding: 0.25rem 0.5rem; border-radius: 999px; background: rgba(0, 0, 0, 0.72); color: #fff; font: 700 0.72rem/1.2 ui-monospace, monospace; }

	iframe {
		width: 100%;
		height: 100%;
		border: 0;
	}

	.preview-hint {
		color: var(--text-faint);
		font-size: 0.8rem;
		margin: 0.6rem 0 0.2rem;
	}

	.open {
		font-size: 0.85rem;
		color: var(--accent);
		text-decoration: none;
	}

	@media (max-width: 48rem) {
		.gallery-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.album-actions { align-items: stretch; flex-direction: column; }
	}
</style>
