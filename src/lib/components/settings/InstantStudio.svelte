<script lang="ts">
	import { onMount } from 'svelte';
	import type { InstantSettings } from '#lib/types.js';
	import Toggle from './Toggle.svelte';

	let { settings = $bindable(), slug }: { settings: InstantSettings; slug: string } = $props();
	type BackgroundStatus = { state: 'missing' | 'building' | 'ready' | 'error'; createdAt?: string; photos?: number; bytes?: number; error?: string };
	type BackgroundPlan = { seed: number; available: number; willUse: number; cached: number; missing: number; estimatedAdditionalBytes: number };
	let savedStatus = $state<BackgroundStatus>({ state: 'missing' });
	let buildPlan = $state<BackgroundPlan | null>(null);
	let buildBusy = $state(false);
	let buildError = $state('');
	let pollTimer: ReturnType<typeof setTimeout> | undefined;

	const endpoint = $derived(`/api/displays/${encodeURIComponent(slug)}/instant-background`);
	const formatBytes = (bytes = 0) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

	async function refreshSavedStatus(schedule = false): Promise<void> {
		const response = await fetch(`${endpoint}?status=1`);
		if (response.ok) savedStatus = await response.json();
		if (schedule && savedStatus.state === 'building') pollTimer = setTimeout(() => void refreshSavedStatus(true), 2000);
		else buildBusy = false;
	}

	async function reviewBuild(): Promise<void> {
		buildBusy = true;
		buildError = '';
		buildPlan = null;
		const response = await fetch(`${endpoint}?plan=1`);
		const body = await response.json().catch(() => ({}));
		if (!response.ok) buildError = body.error ?? body.message ?? 'Could not inspect the selected albums.';
		else buildPlan = body;
		buildBusy = false;
	}

	async function buildBackground(): Promise<void> {
		if (!buildPlan) return;
		buildBusy = true;
		buildError = '';
		const response = await fetch(endpoint, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ confirmed: true, expectedAssets: buildPlan.available, seed: buildPlan.seed })
		});
		const body = await response.json().catch(() => ({}));
		if (!response.ok) {
			buildError = body.error ?? body.message ?? 'Could not start the 4K background build.';
			buildPlan = body.plan ?? null;
			buildBusy = false;
			return;
		}
		buildPlan = null;
		savedStatus = body.status ?? { state: 'building' };
		void refreshSavedStatus(true);
	}

	async function removeBackground(): Promise<void> {
		buildBusy = true;
		buildError = '';
		const response = await fetch(endpoint, { method: 'DELETE' });
		if (!response.ok) buildError = (await response.json().catch(() => ({}))).error ?? 'Could not remove the background.';
		else {
			savedStatus = { state: 'missing' };
			if (settings.background === 'collage-saved') settings.background = 'original';
		}
		buildBusy = false;
	}

	onMount(() => {
		void refreshSavedStatus(true);
		return () => clearTimeout(pollTimer);
	});

	const arrangements = [
		{ value: 'classic', label: 'Classic', hint: 'A calm row or pair' },
		{ value: 'hero-stack', label: 'Hero stack', hint: 'Two heroes with memories underneath' },
		{ value: 'scattered', label: 'Scattered', hint: 'A casual tabletop spread' },
		{ value: 'gallery', label: 'Gallery', hint: 'A tidy multi-card wall' }
	] as const;

	const materials = [
		{ value: 'original', label: 'No material · current', image: '' },
		{ value: 'leather', label: 'Black leather', image: '/textures/instant/black-leather-4k.jpg' },
		{ value: 'cork', label: 'Natural cork', image: '/textures/instant/natural-cork-4k.jpg' },
		{ value: 'walnut', label: 'Dark walnut', image: '/textures/instant/dark-walnut-4k.jpg' },
		{ value: 'linen', label: 'Charcoal linen', image: '/textures/instant/charcoal-linen-4k.jpg' },
		{ value: 'felt', label: 'Green felt', image: '/textures/instant/green-felt-4k.jpg' },
		{ value: 'slate', label: 'Graphite slate', image: '/textures/instant/graphite-slate-4k.jpg' },
		{ value: 'metal', label: 'Brushed metal', image: '/textures/instant/brushed-metal-4k.jpg' },
		{ value: 'red-velvet', label: 'Ruby red velvet', image: '/textures/instant/red-velvet-4k.jpg' },
		{ value: 'bronze', label: 'Patinated bronze', image: '/textures/instant/bronze-copper-4k.jpg' },
		{ value: 'travertine', label: 'Ivory travertine', image: '/textures/instant/travertine-4k.jpg' },
		{ value: 'marble', label: 'Calacatta marble', image: '/textures/instant/carrara-marble-4k.jpg' },
		{ value: 'onyx', label: 'Azuli blue onyx', image: '/textures/instant/blue-onyx-4k.jpg' },
		{ value: 'metal-mesh', label: 'Black metal mesh', image: '/textures/instant/metal-mesh-4k.jpg' },
		{ value: 'indigo-plaster', label: 'Midnight indigo', image: '/textures/instant/indigo-plaster-4k.jpg' },
		{ value: 'terrazzo', label: 'Dark terrazzo', image: '/textures/instant/dark-terrazzo-4k.jpg' },
		{ value: 'collage', label: 'Living memories · live', image: '' },
		{ value: 'collage-saved', label: 'Living memories · saved 4K', image: '' }
	] as const;

	function restoreAuthenticPaper(): void {
		Object.assign(settings, {
			paperRadiusPx: 6,
			photoRadiusPx: 3,
			paperSideBorderPct: 5.38,
			paperBottomBorderPct: 29.33,
			paperFinish: 'authentic'
		});
	}
</script>

<div class="studio-card">
	<div class="studio-heading">
		<div>
			<h3>Instant studio</h3>
			<p>These controls belong only to Instant mode and update connected players automatically.</p>
		</div>
		<span>{settings.cardCount} card{settings.cardCount === 1 ? '' : 's'}</span>
	</div>

	<div class="authentic-preset">
		<div><strong>Classic instant-film paper</strong><span>Restore only the real paper, image opening and restrained corners. Card count, size, angle, colour and transition stay exactly as you set them.</span></div>
		<button type="button" onclick={restoreAuthenticPaper}>Restore authentic paper</button>
	</div>

	<fieldset>
		<legend>Arrangement</legend>
		<div class="arrangements">
			{#each arrangements as option (option.value)}
				<button
					type="button"
					class:active={settings.arrangement === option.value}
					onclick={() => (settings.arrangement = option.value)}
				>
					<i class="arrangement-icon {option.value}" aria-hidden="true"><b></b><b></b><b></b></i>
					<strong>{option.label}</strong>
					<small>{option.hint}</small>
				</button>
			{/each}
		</div>
	</fieldset>

	<div class="range-grid">
		<label><span>Cards shown <strong>{settings.cardCount}</strong></span><input type="range" min="1" max="5" step="1" bind:value={settings.cardCount} /></label>
		<label><span>Card size <strong>{settings.cardScalePct}%</strong></span><input type="range" min="35" max="140" step="5" bind:value={settings.cardScalePct} /></label>
		<label><span>Overlap <strong>{settings.overlapPct}%</strong></span><input type="range" min="0" max="60" step="2" bind:value={settings.overlapPct} /></label>
		<label><span>Space between cards <strong>{settings.cardGapPx}px</strong></span><input type="range" min="0" max="240" step="4" bind:value={settings.cardGapPx} /></label>
		<label><span>Maximum angle <strong>{settings.maxAngleDeg}°</strong></span><input type="range" min="0" max="18" step="1" bind:value={settings.maxAngleDeg} /></label>
		<label class="select-field"><span>Angle pattern</span><select value={settings.anglePattern} onchange={(event) => (settings.anglePattern = event.currentTarget.value as InstantSettings['anglePattern'])}><option value="outward-v">Outward fan · wider at top</option><option value="inward-v">Inward tent · wider at bottom</option><option value="random">Fully random</option></select></label>
		<label><span>Paper rounding <strong>{settings.paperRadiusPx}px</strong></span><input type="range" min="0" max="48" step="2" bind:value={settings.paperRadiusPx} /></label>
		<label><span>Photo rounding <strong>{settings.photoRadiusPx}px</strong></span><input type="range" min="0" max="36" step="2" bind:value={settings.photoRadiusPx} /></label>
		<label><span>White side border <strong>{settings.paperSideBorderPct.toFixed(1)}%</strong></span><input type="range" min="1" max="15" step="0.1" bind:value={settings.paperSideBorderPct} /></label>
		<label><span>White bottom border <strong>{settings.paperBottomBorderPct.toFixed(1)}%</strong></span><input type="range" min="10" max="45" step="0.1" bind:value={settings.paperBottomBorderPct} /></label>
		<label class="select-field"><span>Paper finish</span><select value={settings.paperFinish} onchange={(event) => (settings.paperFinish = event.currentTarget.value as InstantSettings['paperFinish'])}><option value="authentic">Authentic instant film</option><option value="matte">Soft matte</option><option value="glossy">Glossy</option><option value="warm">Warm paper</option></select></label>
	</div>
	<p class="dimension-note">Defaults follow classic SX-70 / 600 / i-Type proportions: 3.483 × 4.233 inch paper around a 3.108 × 3.024 inch image area.</p>

	<fieldset>
		<legend>Instant colour and transition</legend>
		<div class="range-grid">
			<label class="select-field"><span>Colour treatment</span><select value={settings.visualEffect} onchange={(event) => (settings.visualEffect = event.currentTarget.value as InstantSettings['visualEffect'])}><option value="natural">Original · no treatment</option><option value="instant">Instant colour</option><option value="warm">Warm</option><option value="vivid">Colourful</option><option value="kodak">Kodak-inspired</option><option value="fuji">Fuji-inspired</option><option value="monochrome">Black and white</option><option value="noir">Noir</option><option value="negative">Film negative</option><option value="art">Art</option><option value="random">Random treatment</option></select></label>
			<label class="select-field"><span>Card transition</span><select value={settings.transition} onchange={(event) => (settings.transition = event.currentTarget.value as InstantSettings['transition'])}><option value="develop">Develop from blur</option><option value="deal">Deal onto table</option><option value="drop">Drop gently</option><option value="fade">Simple fade</option><option value="none">None</option><option value="random">Random Instant transition</option></select></label>
			<label><span>Transition time <strong>{(settings.transitionDurationMs / 1000).toFixed(1)}s</strong></span><input type="range" min="300" max="5000" step="100" bind:value={settings.transitionDurationMs} /></label>
		</div>
		<p class="transition-note">Develop starts soft, pale and blurred, then resolves to the selected colour in up to five seconds.</p>
	</fieldset>

	<fieldset>
		<legend>Background material</legend>
		<div class="materials">
			{#each materials as material (material.value)}
				<button
					type="button"
					class:active={settings.background === material.value}
					onclick={() => (settings.background = material.value)}
				>
					<i class:original-swatch={material.value === 'original'} class:memory-swatch={material.value === 'collage' || material.value === 'collage-saved'} class:saved-swatch={material.value === 'collage-saved'} style={material.image ? `background-image:url(${material.image})` : ''}></i>
					<span>{material.label}</span>
				</button>
			{/each}
		</div>
	</fieldset>

	<div class="saved-builder">
		<div>
			<strong>Saved 4K Living memories</strong>
			{#if savedStatus.state === 'ready'}
				<span>Ready · {savedStatus.photos} thumbnails · {formatBytes(savedStatus.bytes)}</span>
			{:else if savedStatus.state === 'building'}
				<span>Building on the Mantel server…</span>
			{:else if savedStatus.state === 'error'}
				<span class="error">Build failed · {savedStatus.error}</span>
			{:else}
				<span>Not built. Mantel will continue using the plain dark background.</span>
			{/if}
		</div>
		<div class="builder-actions">
			<button type="button" disabled={buildBusy || savedStatus.state === 'building'} onclick={reviewBuild}>Review build</button>
			{#if savedStatus.state === 'ready'}<button type="button" disabled={buildBusy} onclick={removeBackground}>Remove saved background</button>{/if}
		</div>
		{#if buildPlan}
			<div class="build-confirm">
				<p><strong>{buildPlan.willUse}</strong> random thumbnails from <strong>{buildPlan.available.toLocaleString()}</strong> eligible album photos. {buildPlan.cached} are already cached; {buildPlan.missing} need downloading. Up to {formatBytes(buildPlan.estimatedAdditionalBytes)} additional cache space. Mantel fills a clean 6K mosaic with large features, landscape strips, portrait tiles and smaller cells—without paper borders, rotations or overlaps—then saves its central 4K crop.</p>
				<button type="button" disabled={buildBusy || buildPlan.willUse === 0} onclick={buildBackground}>Build clean 4K photo mosaic</button>
			</div>
		{/if}
		{#if buildError}<p class="error">{buildError}</p>{/if}
	</div>

	<div class="oled-rest">
		<Toggle label="OLED background rest" bind:checked={settings.backgroundRestEnabled} />
		{#if settings.backgroundRestEnabled}
			<div class="range-grid compact">
				<label><span>Every <strong>{settings.backgroundRestMinutes} min</strong></span><input type="range" min="1" max="5" step="1" bind:value={settings.backgroundRestMinutes} /></label>
				<label><span>Rest for <strong>{settings.backgroundRestSeconds}s</strong></span><input type="range" min="3" max="30" step="1" bind:value={settings.backgroundRestSeconds} /></label>
			</div>
		{/if}
		<p>The cards stay visible while textured and Living memories backgrounds briefly return to Mantel's plain dark surface.</p>
	</div>

	<div class="caption-controls">
		<label class="select-field">
			<span>Caption font</span>
			<select value={settings.captionFont} onchange={(event) => (settings.captionFont = event.currentTarget.value as InstantSettings['captionFont'])}>
				<option value="caveat">Caveat</option>
				<option value="kalam">Kalam</option>
				<option value="serif">Classic serif</option>
				<option value="mono">Typewriter</option>
			</select>
		</label>
		<label class="caption-size"><span>Caption size <strong>{settings.captionScalePct}%</strong></span><input type="range" min="60" max="300" step="5" bind:value={settings.captionScalePct} /></label>
	</div>

	<fieldset>
		<legend>Information written on the paper</legend>
		<div class="toggles">
			<Toggle label="Captured date and time" bind:checked={settings.showDateTime} />
			<Toggle label="Location" bind:checked={settings.showLocation} />
			<Toggle label="Camera" bind:checked={settings.showCamera} />
			<Toggle label="Star rating" bind:checked={settings.showRating} />
			<Toggle label="People" bind:checked={settings.showPeople} />
			<Toggle label="Ages" bind:checked={settings.showAge} />
		</div>
	</fieldset>
</div>

<style>
	.studio-card { display: grid; gap: 1.2rem; padding: 1.2rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
	.studio-heading { display: flex; align-items: start; justify-content: space-between; gap: 1rem; }
	h3 { margin: 0 0 0.25rem; color: var(--text); font-size: 1rem; }
	p { margin: 0; color: var(--text-faint); font-size: 0.82rem; line-height: 1.45; }
	.studio-heading > span { flex: 0 0 auto; padding: 0.3rem 0.5rem; border-radius: var(--radius-sm); background: var(--surface-raised); color: var(--accent); font: 700 0.72rem/1.2 ui-monospace, monospace; }
	.authentic-preset { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.9rem; border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border)); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--accent) 5%, var(--surface-raised)); }
	.authentic-preset > div { display: grid; gap: 0.2rem; }
	.authentic-preset strong { color: var(--text); font-size: 0.84rem; }
	.authentic-preset span { color: var(--text-faint); font-size: 0.74rem; line-height: 1.4; }
	.authentic-preset button { flex: 0 0 auto; padding: 0.58rem 0.75rem; border: 1px solid var(--accent); border-radius: var(--radius-sm); background: var(--accent); color: #14110a; font: inherit; font-size: 0.75rem; font-weight: 750; }
	fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
	legend { margin-bottom: 0.55rem; color: var(--text-dim); font-size: 0.82rem; font-weight: 700; }
	.arrangements { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.45rem; }
	.arrangements button { display: grid; justify-items: start; gap: 0.2rem; min-width: 0; padding: 0.7rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-raised); text-align: left; }
	.arrangements button.active, .materials button.active { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
	.arrangements strong { font-size: 0.78rem; }
	.arrangements small { color: var(--text-faint); font-size: 0.68rem; line-height: 1.3; }
	.arrangement-icon { position: relative; display: block; width: 2.4rem; height: 1.65rem; margin-bottom: 0.2rem; }
	.arrangement-icon b { position: absolute; width: 1.15rem; height: 1.35rem; border: 1px solid currentColor; background: var(--surface); }
	.arrangement-icon b:nth-child(1) { left: 0.25rem; transform: rotate(-7deg); }
	.arrangement-icon b:nth-child(2) { left: 1rem; transform: rotate(6deg); }
	.arrangement-icon b:nth-child(3) { display: none; }
	.arrangement-icon.hero-stack b:nth-child(3), .arrangement-icon.scattered b:nth-child(3), .arrangement-icon.gallery b:nth-child(3) { display: block; left: 0.7rem; top: 0.25rem; }
	.arrangement-icon.gallery b { transform: none; width: 0.85rem; height: 1rem; }
	.arrangement-icon.gallery b:nth-child(1) { left: 0; top: 0; } .arrangement-icon.gallery b:nth-child(2) { left: 1rem; top: 0; } .arrangement-icon.gallery b:nth-child(3) { left: 0.5rem; top: 0.55rem; }
	button.active .arrangement-icon { color: var(--accent); }
	.range-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.85rem 1.2rem; }
	.range-grid label, .caption-size { display: grid; gap: 0.38rem; min-width: 0; }
	.range-grid span, .caption-size span, .select-field > span { display: flex; justify-content: space-between; color: var(--text-dim); font-size: 0.82rem; }
	.range-grid strong, .caption-size strong { color: var(--text); }
	input[type='range'] { width: 100%; accent-color: var(--accent); }
	.materials { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0.45rem; }
	.materials button { display: grid; gap: 0.35rem; min-width: 0; padding: 0.35rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-raised); }
	.materials i { position: relative; display: block; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 4px; background: #090909 center / cover; }
	.materials i.original-swatch { background: #101112; }
	.materials i.memory-swatch::before,
	.materials i.memory-swatch::after { position: absolute; width: 38%; height: 55%; background: #eee; border: 1px solid #bbb; content: ''; }
	.materials i.memory-swatch::before { left: 18%; top: 20%; transform: rotate(-12deg); }
	.materials i.memory-swatch::after { right: 18%; top: 18%; transform: rotate(9deg); }
	.materials i.saved-swatch::after { box-shadow: 0 0 0 2px var(--accent); }
	.materials span { overflow: hidden; color: var(--text-dim); font-size: 0.68rem; text-overflow: ellipsis; white-space: nowrap; }
	.caption-controls { display: grid; grid-template-columns: minmax(11rem, 0.8fr) minmax(0, 1.2fr); gap: 1rem; align-items: end; }
	.oled-rest { display: grid; gap: 0.65rem; padding: 0.8rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-raised); }
	.dimension-note { margin-top: -0.45rem; }
	.transition-note { margin-top: 0.55rem; }
	.saved-builder { display: grid; gap: 0.75rem; padding: 0.9rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-raised); }
	.saved-builder > div:first-child { display: grid; gap: 0.2rem; }
	.saved-builder > div:first-child strong { color: var(--text); font-size: 0.82rem; }
	.saved-builder > div:first-child span { color: var(--text-faint); font-size: 0.74rem; }
	.builder-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.builder-actions button, .build-confirm button { padding: 0.55rem 0.75rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font: inherit; font-size: 0.76rem; font-weight: 700; }
	.builder-actions button:disabled, .build-confirm button:disabled { opacity: 0.5; }
	.build-confirm { display: grid; gap: 0.65rem; padding: 0.75rem; border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: var(--radius-sm); }
	.build-confirm p { color: var(--text-dim); }
	.build-confirm button { justify-self: start; border-color: var(--accent); background: var(--accent); color: #14110a; }
	.error { color: #ff8d86 !important; }
	.range-grid.compact { margin-top: 0.15rem; }
	.select-field { display: grid; gap: 0.38rem; }
	select { width: 100%; padding: 0.55rem 0.65rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-raised); color: var(--text); font: inherit; }
	.toggles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem 1.4rem; }
	@media (max-width: 52rem) { .arrangements { grid-template-columns: repeat(2, minmax(0, 1fr)); } .materials { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
	@media (max-width: 36rem) { .studio-card { padding: 1rem; } .range-grid, .caption-controls, .toggles { grid-template-columns: 1fr; } .materials { grid-template-columns: repeat(2, minmax(0, 1fr)); } .authentic-preset { align-items: stretch; flex-direction: column; } .authentic-preset button { align-self: start; } }
</style>
