<script lang="ts">
	import type { Corner, MapSettings } from '$lib/types';
	import Segmented from './Segmented.svelte';
	import Toggle from './Toggle.svelte';

	let { settings = $bindable() }: { settings: MapSettings } = $props();
	const positionOptions: Array<{ value: Corner; label: string }> = [
		{ value: 'top-left', label: '↖' }, { value: 'top-center', label: '↑' }, { value: 'top-right', label: '↗' },
		{ value: 'middle-left', label: '←' }, { value: 'center', label: '●' }, { value: 'middle-right', label: '→' },
		{ value: 'bottom-left', label: '↙' }, { value: 'bottom-center', label: '↓' }, { value: 'bottom-right', label: '↘' }
	];

	const zoomLabel = $derived(
		settings.zoomKm <= 80 ? 'city' : settings.zoomKm <= 250 ? 'city & surroundings' : settings.zoomKm <= 800 ? 'region' : settings.zoomKm <= 2000 ? 'country' : 'continent'
	);
	const closeDetail = $derived(settings.earthTexture === 'satellite' && settings.imageryDetail === 'sentinel');
	const stopSeconds = $derived(settings.holdSec + settings.flightSec * 2 + settings.worldDwellSec);
	const populationLabel = $derived(
		settings.labelMinPopulation === 0
			? 'any size'
			: settings.labelMinPopulation >= 1000
				? `${Math.round(settings.labelMinPopulation / 1000)},000 people`
				: `${settings.labelMinPopulation} people`
	);

	let homeQuery = $state('');
	let homeResults = $state<Array<{ name: string; lat: number; lon: number }>>([]);
	let homeSearching = $state(false);

	async function searchHome(): Promise<void> {
		const q = homeQuery.trim();
		if (!q) return;
		homeSearching = true;
		try {
			const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
			homeResults = res.ok ? ((await res.json()) as Array<{ name: string; lat: number; lon: number }>).slice(0, 5) : [];
		} catch {
			homeResults = [];
		} finally {
			homeSearching = false;
		}
	}

	function chooseHome(result: { name: string; lat: number; lon: number }): void {
		settings.home = { name: result.name, lat: result.lat, lon: result.lon };
		homeResults = [];
		homeQuery = '';
	}
</script>

<div class="studio">
	<div class="card">
		<h3>World</h3>
		<Segmented
			label="View"
			bind:value={settings.view}
			options={[
				{ value: 'globe', label: 'Globe' },
				{ value: 'flat', label: 'Flat map' }
			]}
		/>
		{#if settings.view === 'globe'}
			<Segmented
				label="Globe engine"
				bind:value={settings.renderer}
				options={[
					{ value: 'shader', label: 'Shader' },
					{ value: 'three', label: 'Three.js' }
				]}
			/>
			<p class="field-hint">Two ways to draw the same globe. Shader inverse-projects every pixel and blends smoothly into the crisp close-up; Three.js draws a real textured sphere with a perspective camera. Compare them on the television and keep the smoother one.</p>
		{/if}
		<Segmented
			label="Style"
			bind:value={settings.theme}
			options={[
				{ value: 'midnight', label: 'Midnight' },
				{ value: 'atlas', label: 'Atlas' },
				{ value: 'ink', label: 'Ink' }
			]}
		/>
		<Segmented
			label="Earth imagery"
			bind:value={settings.earthTexture}
			options={[
				{ value: 'satellite', label: 'Satellite' },
				{ value: 'relief', label: 'Relief' },
				{ value: 'none', label: 'Vector only' }
			]}
		/>
		{#if settings.earthTexture === 'satellite'}
			<Toggle label="Follow the season (Blue Marble month by month)" bind:checked={settings.seasonalTexture} />
			<Segmented
				label="Close-up imagery"
				bind:value={settings.imageryDetail}
				options={[
					{ value: 'sentinel', label: 'Sentinel-2 (10 m)' },
					{ value: 'blue-marble', label: 'Blue Marble only' }
				]}
			/>
			<p class="field-hint">Sentinel-2 cloudless tiles (Copernicus data via EOX, free for personal use) are fetched once only for places this presentation can visit and then kept on the NAS. Prebuilding a region is optional and must be started explicitly. Blue Marble alone is 1.8 km per pixel and looks blocky when zoomed in.</p>
		{/if}
		<Toggle label="OpenStreetMap detail around each place: roads, rail, rivers, lakes, forests, every town and village" bind:checked={settings.osmDetail} />
		<p class="field-hint">Fetched once per place from OpenStreetMap (© OpenStreetMap contributors) and stored locally. The first pass runs in the background; until a place is ready the bundled Natural Earth detail is drawn.</p>
		<Segmented
			label="Lighting"
			bind:value={settings.lighting}
			options={[
				{ value: 'sun', label: 'Real sun' },
				{ value: 'studio', label: 'Studio lamp' }
			]}
		/>
		{#if settings.lighting === 'sun'}
			<Toggle label="City lights on the night side" bind:checked={settings.nightLights} />
		{/if}
		<Toggle label="Regions, rivers, urban areas and roads when zoomed in" bind:checked={settings.detailLayers} />
		<Toggle label="Markers for every place with photos" bind:checked={settings.showMarkers} />
		<Toggle label="City, region and terrain names when zoomed in" bind:checked={settings.showLabels} />
		{#if settings.showLabels}
			<label class="range-field">
				<span>Name size <strong>{settings.labelScalePct}%</strong></span>
				<input type="range" min="60" max="220" step="5" bind:value={settings.labelScalePct} />
			</label>
			<label class="range-field">
				<span>Name places over <strong>{populationLabel}</strong></span>
				<input type="range" min="0" max="200000" step="1000" bind:value={settings.labelMinPopulation} />
			</label>
			<label class="range-field">
				<span>At most <strong>{settings.labelMaxCount === 0 ? 'no other names' : `${settings.labelMaxCount} names`}</strong> on screen</span>
				<input type="range" min="0" max="40" step="1" bind:value={settings.labelMaxCount} />
			</label>
			<p class="field-hint">The photo's own place is always named at the pin in the marker colour; these limits apply to everything else. Only places near the photo are named, and height raises the floor by itself: from 350 km up only cities over 100,000, from 700 km only over 200,000. Names never repeat.</p>
		{/if}
		<Toggle label="Latitude and longitude grid" bind:checked={settings.showGraticule} />
		{#if settings.view === 'globe'}
			<Toggle label="Globe turns slowly between stops" bind:checked={settings.idleSpin} />
		{/if}
	</div>

	<div class="card">
		<h3>Journey</h3>
		<label class="range-field">
			<span>Show each photo for <strong>{settings.holdSec}s</strong></span>
			<input type="range" min="5" max="60" step="1" bind:value={settings.holdSec} />
		</label>
		<label class="range-field">
			<span>Flight time <strong>{settings.flightSec.toFixed(1)}s</strong> each way</span>
			<input type="range" min="1" max="8" step="0.5" bind:value={settings.flightSec} />
		</label>
		<label class="range-field">
			<span>Rest on the world view for <strong>{settings.worldDwellSec.toFixed(1)}s</strong></span>
			<input type="range" min="0" max="15" step="0.5" bind:value={settings.worldDwellSec} />
		</label>
		<label class="range-field">
			<span>Closest view <strong>{settings.zoomKm} km</strong> across · {zoomLabel}</span>
			<input type="range" min="50" max="4000" step="10" bind:value={settings.zoomKm} />
		</label>
		<p class="field-hint">
			{#if closeDetail}
				50 km is supported with Sentinel detail. Europe levels 4–7 provide the regional approach; the finer level-8 blocks are fetched and cached only around photo locations that Mantel actually visits.
			{:else}
				Below about 100 km the global imagery may look soft. Select Sentinel close-up imagery for a detailed 50 km arrival.
			{/if}
		</p>
		<p class="field-hint">One stop takes about {Math.round(stopSeconds)} seconds. Only photos with GPS coordinates take part; every place is visited in turn with one photo per visit, so no place monopolises the screen.</p>
	</div>

	<div class="card">
		<h3>Photo</h3>
		<Segmented
			label="Presentation"
			bind:value={settings.photoStyle}
			options={[
				{ value: 'card', label: 'Floating card' },
				{ value: 'split', label: 'Split screen' },
				{ value: 'fullscreen', label: 'Full screen' }
			]}
		/>
		{#if settings.photoStyle === 'card'}
			<label class="range-field">
				<span>Photo height <strong>{settings.photoScalePct}%</strong> of the screen</span>
				<input type="range" min="20" max="90" step="2" bind:value={settings.photoScalePct} />
			</label>
			<Segmented
				label="Placement"
				bind:value={settings.photoPlacement}
				options={[
					{ value: 'near-pin', label: 'Next to the place' },
					{ value: 'side', label: 'Fixed side' }
				]}
			/>
		{/if}
		<Segmented
			label="Frame"
			bind:value={settings.photoFrame}
			options={[
				{ value: 'thin', label: 'Border' },
				{ value: 'instant', label: 'Instant' },
				{ value: 'none', label: 'None' }
			]}
		/>
		{#if settings.photoStyle === 'split'}
			<label class="range-field">
				<span>Map keeps <strong>{settings.splitMapPct}%</strong> of the width · photo {100 - settings.splitMapPct}%</span>
				<input type="range" min="30" max="70" step="1" bind:value={settings.splitMapPct} />
			</label>
			<label class="color-field">
				<span>Panel colour</span>
				<input type="color" bind:value={settings.splitBackground} />
				<code>{settings.splitBackground}</code>
			</label>
			<Toggle label="Fade the panel into the map" bind:checked={settings.splitFade} />
			{#if settings.splitFade}
				<label class="range-field">
					<span>Blend <strong>{settings.splitFadePct}%</strong> into each side · {settings.splitFadePct * 2}% total</span>
					<input type="range" min="2" max="20" step="1" bind:value={settings.splitFadePct} />
				</label>
			{/if}
			<p class="field-hint">The photo always fills its entire panel. Frame crops around detected people, using the same face focus as Instant mode but matching the panel instead of making a square. Place information stays on the map side and is never placed beneath the image.</p>
		{/if}
		{#if settings.photoFrame !== 'none'}
			<label class="range-field">
				<span>Border width <strong>{settings.photoBorderPx}px</strong></span>
				<input type="range" min="0" max="40" step="1" bind:value={settings.photoBorderPx} />
			</label>
			<label class="color-field">
				<span>Border colour</span>
				<input type="color" bind:value={settings.photoBorderColor} />
				<code>{settings.photoBorderColor}</code>
			</label>
		{/if}
		<label class="range-field">
			<span>Corner radius <strong>{settings.photoRadiusPx}px</strong></span>
			<input type="range" min="0" max="80" step="1" bind:value={settings.photoRadiusPx} />
		</label>
		<Toggle label="Drop shadow" bind:checked={settings.photoShadow} />
		<Segmented
			label="Edge"
			bind:value={settings.photoEdge}
			options={[
				{ value: 'sharp', label: 'Clean' },
				{ value: 'feather', label: 'Blend into the map' }
			]}
		/>
		<Segmented
			label="Depth"
			bind:value={settings.photoDepth}
			options={[
				{ value: 'lift', label: 'Hovering' },
				{ value: 'tilt', label: 'Turned to the map' },
				{ value: 'flat', label: 'Flat' }
			]}
		/>
		<p class="field-hint">Hovering raises the photo off the map on a deep shadow. Turned tilts it in three dimensions to face the place it belongs to. Blending replaces the frame with a soft edge that dissolves into the map.</p>
		{#if settings.photoStyle === 'fullscreen'}
			<Toggle label="Small map with the pin in a corner" bind:checked={settings.showMinimap} />
		{/if}
		{#if settings.photoStyle !== 'split'}
			<Toggle label="Place and date caption" bind:checked={settings.showCaption} />
		{/if}
		<Toggle label="Keep the corner overlays (clock, weather, …) visible" bind:checked={settings.showOverlays} />
		<p class="field-hint">With the overlays on, photo and cards stay out of the top and bottom bands so nothing sits on top of the corner information.</p>
	</div>

	<div class="card">
		<h3>Place card</h3>
		<Segmented
			label="Information"
			bind:value={settings.trivia}
			options={[
				{ value: 'off', label: 'Off' },
				{ value: 'facts', label: 'Offline facts' },
				{ value: 'online', label: 'Facts + online' }
			]}
		/>
		{#if settings.trivia !== 'off'}
			<Segmented
				label="Card content"
				bind:value={settings.triviaDetail}
				options={[
					{ value: 'short', label: 'Small' },
					{ value: 'full', label: 'Large' }
				]}
			/>
			<Segmented label="Position" bind:value={settings.triviaPosition} options={positionOptions} />
			<label class="range-field">
				<span>Text size <strong>{settings.cardScalePct}%</strong></span>
				<input type="range" min="60" max="220" step="5" bind:value={settings.cardScalePct} />
			</label>
			<label class="range-field">
				<span>Card width <strong>{settings.triviaWidthPct}%</strong> of the screen</span>
				<input type="range" min="16" max="60" step="1" bind:value={settings.triviaWidthPct} />
			</label>
			<label class="range-field">
				<span>Maximum height <strong>{settings.triviaMaxHeightPct}%</strong></span>
				<input type="range" min="20" max="90" step="2" bind:value={settings.triviaMaxHeightPct} />
			</label>
			<Toggle label="Use the selected map theme colours" bind:checked={settings.triviaUseThemeColors} />
			{#if !settings.triviaUseThemeColors}
				<div class="color-grid">
					<label class="color-field"><span>Text</span><input type="color" bind:value={settings.triviaTextColor} /><code>{settings.triviaTextColor}</code></label>
					<label class="color-field"><span>Box</span><input type="color" bind:value={settings.triviaBackgroundColor} /><code>{settings.triviaBackgroundColor}</code></label>
					<label class="color-field"><span>Accent</span><input type="color" bind:value={settings.triviaAccentColor} /><code>{settings.triviaAccentColor}</code></label>
					<label class="color-field"><span>Border</span><input type="color" bind:value={settings.triviaBorderColor} /><code>{settings.triviaBorderColor}</code></label>
				</div>
			{/if}
			<label class="range-field"><span>Box opacity <strong>{settings.triviaBackgroundOpacityPct}%</strong></span><input type="range" min="20" max="100" step="2" bind:value={settings.triviaBackgroundOpacityPct} /></label>
			<label class="range-field"><span>Inside spacing <strong>{settings.triviaPaddingPx}px</strong></span><input type="range" min="8" max="64" step="2" bind:value={settings.triviaPaddingPx} /></label>
			<label class="range-field"><span>Rounded corners <strong>{settings.triviaRadiusPx}px</strong></span><input type="range" min="0" max="80" step="2" bind:value={settings.triviaRadiusPx} /></label>
			<label class="range-field"><span>Border width <strong>{settings.triviaBorderWidthPx}px</strong></span><input type="range" min="0" max="12" step="1" bind:value={settings.triviaBorderWidthPx} /></label>
			<label class="range-field"><span>Background blur <strong>{settings.triviaBlurPx}px</strong></span><input type="range" min="0" max="40" step="2" bind:value={settings.triviaBlurPx} /></label>
			<Toggle label="Card shadow" bind:checked={settings.triviaShadow} />
			<p class="field-hint">The card stays inside the safe screen area. In split mode, its nine positions belong to the map pane so information never covers the photograph. Oversized content automatically scales down to fit the selected height.</p>
		{/if}
		<p class="field-hint">Offline facts come from the bundled atlas: region, island, country and continent, local time, sunrise and sunset, population, capital status, how far from home, how many photos you have there. Online adds the street, neighbourhood and town from OpenStreetMap, one Wikipedia sentence and the weather right now; all of it is fetched once in the background and kept on the server.</p>
		<div class="home">
			<span>Home base: <strong>{settings.home?.name ?? 'weather location'}</strong></span>
			<div class="home-search">
				<input type="search" placeholder="Search a place for “km from home”" bind:value={homeQuery} onkeydown={(e) => e.key === 'Enter' && searchHome()} />
				<button type="button" class="btn" onclick={searchHome} disabled={homeSearching}>Search</button>
				{#if settings.home}<button type="button" class="btn subtle" onclick={() => (settings.home = null)}>Use weather location</button>{/if}
			</div>
			{#if homeResults.length}
				<ul class="results">
					{#each homeResults as result}
						<li><button type="button" onclick={() => chooseHome(result)}>{result.name}</button></li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
	<div class="card">
		<h3>Map data</h3>
		<p class="field-hint">Map data is stored on this server. Missing Sentinel or OpenStreetMap detail may be fetched once while a presentation initializes; subsequent playback uses the local cache. Sources: Natural Earth (public domain), NASA Blue Marble and Black Marble (public domain), GeoNames settlements (CC BY 4.0), Sentinel-2 cloudless by EOX with modified Copernicus Sentinel data (CC BY-NC-SA 4.0, personal use), and OpenStreetMap contributors (ODbL). Attribution is kept in Mantel rather than overlaid on family photos.</p>
	</div>
</div>

<style>
	.studio {
		display: grid;
		gap: 1rem;
	}

	.card {
		display: grid;
		gap: 0.9rem;
		padding: 1.1rem 1.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	h3 {
		margin: 0;
		font-size: 0.8rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-dim);
	}

	.range-field {
		display: grid;
		gap: 0.4rem;
		font-size: 0.95rem;
	}

	.range-field strong {
		color: var(--accent);
	}

	.color-field {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		font-size: 0.95rem;
	}

	.color-field input {
		width: 2.6rem;
		height: 1.8rem;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: none;
	}

	.color-field code {
		font-size: 0.8rem;
		color: var(--text-dim);
	}

	.color-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.7rem 1rem;
	}

	.field-hint {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-dim);
	}

	.home {
		display: grid;
		gap: 0.5rem;
		font-size: 0.95rem;
	}

	.home strong {
		color: var(--accent);
	}

	.home-search {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.home-search input {
		flex: 1 1 14rem;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: var(--surface-2, transparent);
		color: inherit;
	}

	.btn {
		padding: 0.5rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: var(--accent);
		color: #111;
		font-weight: 600;
	}

	.btn.subtle {
		background: transparent;
		color: inherit;
		font-weight: 500;
	}

	.results {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.3rem;
	}

	.results button {
		width: 100%;
		text-align: left;
		padding: 0.45rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: transparent;
		color: inherit;
	}

	.results button:hover {
		border-color: var(--accent);
	}
</style>
