<script lang="ts">
	import type { FaceInfo, InstantSettings, SlideAsset, VisualEffect } from '#lib/types.js';
	import { formatInstantDate, instantCardAspectRatio, instantImageStyle, instantTurn } from '#lib/instant.js';
	import ThumbhashCanvas from './ThumbhashCanvas.svelte';

	let {
		slide,
		pair = null,
		gallery = [],
		layout = 'single',
		mixedPortraitSide = 'left',
		photoGapPx = 3,
		visualEffect = 'natural',
		motionStyle = 'off',
		faces = [],
		facesBySlide = [],
		instantSeed = 0,
		instantSettings,
		instantTransition = 'develop',
		instantMemories = [],
		instantBackgroundUrl = '',
		suppressInstantBackground = false,
		imageSize,
		imageFit = 'contain',
		kenburns = false,
		kbFrom = 'scale(1)',
		kbTo = 'scale(1)',
		kbOrigin = '50% 50%',
		kbDurationMs = 0,
		paused = false,
		focus = null,
		cropFocus = null,
		faceZoom = 2.2
	}: {
		slide: SlideAsset;
		pair?: SlideAsset | null;
		gallery?: SlideAsset[];
		layout?: 'single' | 'adaptive' | 'portrait-stack' | 'mosaic' | 'filmstrip' | 'instant';
		mixedPortraitSide?: 'left' | 'right';
		photoGapPx?: number;
		visualEffect?: Exclude<VisualEffect, 'random'>;
		motionStyle?: 'off' | 'gentle' | 'cinematic' | 'dynamic' | 'drift' | 'push-in' | 'pull-out' | 'face-push-in' | 'face-pull-out' | 'face-journey';
		faces?: FaceInfo[];
		facesBySlide?: FaceInfo[][];
		instantSeed?: number;
		instantSettings: InstantSettings;
		instantTransition?: Exclude<InstantSettings['transition'], 'random'>;
		instantMemories?: SlideAsset[];
		instantBackgroundUrl?: string;
		suppressInstantBackground?: boolean;
		imageSize: 'preview' | 'fullsize';
		imageFit?: 'contain' | 'cover';
		kenburns?: boolean;
		kbFrom?: string;
		kbTo?: string;
		kbOrigin?: string;
		kbDurationMs?: number;
		paused?: boolean;
		focus?: FaceInfo | null;
		cropFocus?: FaceInfo | null;
		faceZoom?: number;
	} = $props();

	const url = (s: SlideAsset) => {
		const params = new URLSearchParams({ size: imageSize });
		if (s.connectionId) params.set('connection', s.connectionId);
		return `/api/image/${s.id}?${params}`;
	};
	const memoryUrl = (s: SlideAsset) => {
		const params = new URLSearchParams({ size: 'thumbnail' });
		if (s.connectionId) params.set('connection', s.connectionId);
		return `/api/image/${s.id}?${params}`;
	};
	let mainImage: HTMLImageElement | undefined = $state();
	let journeyAnimation = $state<Animation | null>(null);

	function normalizedZoom(face: FaceInfo): number {
		return Math.max(1, Math.min(6, (0.3 * faceZoom) / Math.max(face.width, face.height, 0.08)));
	}

	function instantCaption(image: SlideAsset, index: number): string {
		const details: string[] = [];
		if (instantSettings.showDateTime && image.takenAt) {
			const formattedDate = formatInstantDate(image.takenAt);
			if (formattedDate) details.push(formattedDate);
		}
		if (instantSettings.showLocation && image.location) details.push(image.location);
		if (instantSettings.showCamera && image.camera) details.push(image.camera);
		if (instantSettings.showRating && image.rating) details.push(`${'★'.repeat(image.rating)}`);
		if (instantSettings.showPeople) {
			const people = new Map<string, string>();
			for (const face of facesBySlide[index] ?? []) {
				if (!face.name) continue;
				people.set(face.personId ?? face.id, `${face.name}${instantSettings.showAge && face.ageAtPhoto !== null ? ` ${face.ageAtPhoto}` : ''}`);
			}
			if (people.size) details.push([...people.values()].join(', '));
		}
		return details.join(' · ');
	}

	function instantCaptionFont(): string {
		return instantSettings.captionFont === 'kalam' ? "'Mantel Kalam', cursive"
			: instantSettings.captionFont === 'serif' ? "'Mantel Libre Baskerville', serif"
				: instantSettings.captionFont === 'mono' ? "'Mantel IBM Plex Mono', monospace"
					: "'Mantel Caveat', cursive";
	}

	function memoryTurn(index: number): number {
		return ((Math.imul(index + 7, 37) % 11) - 5) * 0.7;
	}

	$effect(() => {
		if (!mainImage || motionStyle !== 'face-journey' || faces.length === 0 || kbDurationMs <= 0) return;
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const journey = faces.filter((face) => face.width > 0 && face.height > 0);
		if (!journey.length) return;
		const frames: Keyframe[] = [];
		journey.forEach((face, index) => {
			const start = index / journey.length;
			const end = Math.min(1, (index + 0.72) / journey.length);
			const frame = {
				transform: `scale(${normalizedZoom(face).toFixed(3)})`,
				transformOrigin: `${face.centerX * 100}% ${face.centerY * 100}%`
			};
			frames.push({ ...frame, offset: start }, { ...frame, offset: end });
		});
		frames.push({ ...frames[frames.length - 1], offset: 1 });
		journeyAnimation = mainImage.animate(frames, { duration: kbDurationMs, easing: 'ease-in-out', fill: 'both' });
		return () => {
			journeyAnimation?.cancel();
			journeyAnimation = null;
		};
	});

	$effect(() => {
		if (!journeyAnimation) return;
		if (paused) journeyAnimation.pause();
		else journeyAnimation.play();
	});
</script>

<div
	class="inner"
	class:kb={kenburns}
	class:paused
	class:monochrome={visualEffect === 'monochrome'}
	class:warm={visualEffect === 'warm'}
	class:vivid={visualEffect === 'vivid'}
	class:negative={visualEffect === 'negative'}
	class:kodak={visualEffect === 'kodak'}
	class:fuji={visualEffect === 'fuji'}
	class:instant-tone={visualEffect === 'instant'}
	class:art={visualEffect === 'art'}
	class:noir={visualEffect === 'noir'}
	class:instant-layout={layout === 'instant'}
	style="--kb-from: {kbFrom}; --kb-to: {kbTo}; --kb-origin: {kbOrigin}; --kb-dur: {kbDurationMs}ms; --photo-gap: {photoGapPx}px"
>
	{#if layout === 'instant'}
		<div
			class="instant-table arrangement-{instantSettings.arrangement} background-{instantSettings.background} count-{gallery.length}"
			class:transition-none={instantTransition === 'none'}
			class:transition-fade={instantTransition === 'fade'}
			class:transition-deal={instantTransition === 'deal'}
			class:transition-develop={instantTransition === 'develop'}
			class:transition-drop={instantTransition === 'drop'}
			class:background-rest={suppressInstantBackground}
			class:single={gallery.length === 1}
			style="--instant-card-scale: {instantSettings.cardScalePct / 100}; --instant-card-ratio: {instantCardAspectRatio(instantSettings)}; --instant-overlap: {instantSettings.overlapPct}; --instant-card-gap: {instantSettings.cardGapPx}px; --instant-paper-radius: {instantSettings.paperRadiusPx}px; --instant-photo-radius: {instantSettings.photoRadiusPx}px; --instant-side-border: {instantSettings.paperSideBorderPct}%; --instant-bottom-border: {instantSettings.paperBottomBorderPct}%; --instant-caption-scale: {instantSettings.captionScalePct / 100}; --instant-caption-font: {instantCaptionFont()}; --instant-transition-duration: {instantSettings.transitionDurationMs}ms; --saved-instant-background: {instantBackgroundUrl ? `url('${instantBackgroundUrl}')` : 'none'}"
		>
			{#if instantSettings.background === 'collage' && instantMemories.length && !suppressInstantBackground}
				<div class="memory-backdrop" aria-hidden="true">
					{#each instantMemories.slice(0, 96) as memory, index (`memory-${memory.connectionId ?? 'default'}-${memory.id}`)}
						<figure style="--memory-turn: {memoryTurn(index)}deg">
							<img src={memoryUrl(memory)} alt="" draggable="false" />
						</figure>
					{/each}
				</div>
			{/if}
			{#each gallery.slice(0, instantSettings.cardCount) as image, index (`${image.id}-${index}`)}
				<article class="instant-card finish-{instantSettings.paperFinish}" style="--card-turn: {instantTurn(instantSettings, instantSeed, index, gallery.length)}deg; --deal-delay: {index * 90}ms">
					<div class="instant-print">
						<div class="instant-photo">
							{#if image.thumbhash}<ThumbhashCanvas hash={image.thumbhash} class="bg" />{/if}
							<img src={url(image)} alt="" draggable="false" style={instantImageStyle(image, facesBySlide[index] ?? [])} />
						</div>
						<p class="instant-caption">{instantCaption(image, index)}</p>
					</div>
				</article>
			{/each}
		</div>
	{:else if gallery.length === 3 && layout === 'portrait-stack'}
		<div class="portrait-stack" class:right={mixedPortraitSide === 'right'}>
			<div class="mixed-portrait">
				{#if gallery[0].thumbhash}<ThumbhashCanvas hash={gallery[0].thumbhash} class="bg" />{/if}
				<img class="cover" src={url(gallery[0])} alt="" draggable="false" />
			</div>
			<div class="mixed-landscapes">
				{#each gallery.slice(1) as image, index (`${image.id}-${index}`)}
					<div class="mixed-landscape">
						{#if image.thumbhash}<ThumbhashCanvas hash={image.thumbhash} class="bg" />{/if}
						<img class="cover" src={url(image)} alt="" draggable="false" />
					</div>
				{/each}
			</div>
		</div>
	{:else if gallery.length > 1 && layout === 'mosaic'}
		<div class="mosaic">
			{#each gallery as image, index (`${image.id}-${index}`)}
				<div class="tile" class:portrait={image.ratio < 0.95} class:panorama={image.ratio > 2}>
					{#if image.thumbhash}<ThumbhashCanvas hash={image.thumbhash} class="bg" />{/if}
					<img class="cover" src={url(image)} alt="" draggable="false" />
				</div>
			{/each}
		</div>
	{:else if gallery.length > 1 && layout === 'filmstrip'}
		<div class="filmstrip">
			{#each gallery as image, index (`${image.id}-${index}`)}
				<div class="film-frame">
					{#if image.thumbhash}<ThumbhashCanvas hash={image.thumbhash} class="bg" />{/if}
					<img class="cover" src={url(image)} alt="" draggable="false" />
				</div>
			{/each}
		</div>
	{:else if pair}
		<div class="pair">
			<div class="half">
				{#if slide.thumbhash}<ThumbhashCanvas hash={slide.thumbhash} class="bg" />{/if}
				<img class="cover" src={url(slide)} alt="" draggable="false" />
			</div>
			<div class="half">
				{#if pair.thumbhash}<ThumbhashCanvas hash={pair.thumbhash} class="bg" />{/if}
				<img class="cover" src={url(pair)} alt="" draggable="false" />
			</div>
		</div>
	{:else}
		{#if slide.thumbhash}<ThumbhashCanvas hash={slide.thumbhash} class="bg" />{/if}
		<img
			bind:this={mainImage}
			class="main"
			class:cover-fit={imageFit === 'cover'}
			class:face-focus={focus !== null}
			class:face-safe-cover={focus === null && cropFocus !== null}
			class:face-journey={motionStyle === 'face-journey' && faces.length > 0}
			style="--face-x: {(focus?.centerX ?? cropFocus?.centerX ?? 0.5) * 100}%; --face-y: {(focus?.centerY ?? cropFocus?.centerY ?? 0.5) * 100}%; --face-zoom: {focus ? normalizedZoom(focus) : faceZoom}"
			src={url(slide)}
			alt=""
			draggable="false"
		/>
	{/if}
</div>

<style>
	.inner {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}

	/* Ken Burns: compositor-only transform on the whole slide content. */
	.inner.kb {
		animation: kenburns var(--kb-dur) linear both;
		transform-origin: var(--kb-origin);
		will-change: transform;
	}

	.inner.paused {
		animation-play-state: paused;
	}

	.inner.monochrome img { filter: grayscale(1); }
	.inner.warm img { filter: sepia(0.11) saturate(1.12) brightness(1.025); }
	.inner.vivid img { filter: saturate(1.34) contrast(1.055); }
	.inner.negative img { filter: invert(1); }
	.inner.kodak img { filter: sepia(0.09) saturate(1.2) contrast(1.045) brightness(1.02); }
	.inner.fuji img { filter: saturate(1.12) contrast(1.075) brightness(1.01) hue-rotate(-4deg); }
	.inner.instant-tone img { filter: sepia(0.2) saturate(0.86) contrast(0.94) brightness(1.06); }
	.inner.art img { filter: saturate(0.82) contrast(1.08) sepia(0.08); }
	.inner.noir img { filter: grayscale(1) contrast(1.32) brightness(0.78); }
	.inner.noir:not(.instant-layout)::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(circle at 50% 42%, transparent 30%, rgba(0, 0, 0, 0.82) 115%);
	}

	@keyframes kenburns {
		from {
			transform: var(--kb-from);
		}
		to {
			transform: var(--kb-to);
		}
	}

	.inner :global(.bg) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.main {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		user-select: none;
	}

	.main.cover-fit {
		object-fit: cover;
	}

	.main.face-safe-cover {
		object-position: var(--face-x) var(--face-y);
	}

	.main.face-focus {
		object-fit: cover;
		object-position: var(--face-x) var(--face-y);
		transform: scale(var(--face-zoom));
		transform-origin: var(--face-x) var(--face-y);
	}

	.main.face-journey { object-fit: cover; will-change: transform; backface-visibility: hidden; }

	.pair {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--photo-gap);
	}

	.portrait-stack {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.55fr);
		gap: var(--photo-gap);
	}

	.portrait-stack.right { grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); }
	.portrait-stack.right .mixed-portrait { order: 2; }
	.mixed-portrait, .mixed-landscape { position: relative; min-width: 0; min-height: 0; overflow: hidden; }
	.mixed-landscapes { display: grid; grid-template-rows: 1fr 1fr; min-width: 0; min-height: 0; gap: var(--photo-gap); }

	@media (orientation: portrait) {
		.pair {
			grid-template-columns: 1fr;
			grid-template-rows: 1fr 1fr;
		}
	}

	.half {
		position: relative;
		overflow: hidden;
		border-radius: var(--frame-radius);
	}

	.cover {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		user-select: none;
	}

	.instant-table {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--instant-card-gap);
		padding: clamp(0.5rem, 1vw, 2rem);
		overflow: hidden;
		isolation: isolate;
		background: #101112 center / cover no-repeat;
	}

	.instant-table.background-original { background: #101112; }
	.instant-table.background-black { background: #030303; }
	.instant-table.background-leather { background-image: url('/textures/instant/black-leather-4k.jpg'); }
	.instant-table.background-cork { background-image: url('/textures/instant/natural-cork-4k.jpg'); }
	.instant-table.background-walnut { background-image: url('/textures/instant/dark-walnut-4k.jpg'); }
	.instant-table.background-linen { background-image: url('/textures/instant/charcoal-linen-4k.jpg'); }
	.instant-table.background-felt { background-image: url('/textures/instant/green-felt-4k.jpg'); }
	.instant-table.background-slate { background-image: url('/textures/instant/graphite-slate-4k.jpg'); }
	.instant-table.background-metal { background-image: url('/textures/instant/brushed-metal-4k.jpg'); }
	.instant-table.background-red-velvet { background-image: url('/textures/instant/red-velvet-4k.jpg'); }
	.instant-table.background-bronze { background-image: url('/textures/instant/bronze-copper-4k.jpg'); }
	.instant-table.background-travertine { background-image: url('/textures/instant/travertine-4k.jpg'); }
	.instant-table.background-marble { background-image: url('/textures/instant/carrara-marble-4k.jpg'); }
	.instant-table.background-onyx { background-image: url('/textures/instant/blue-onyx-4k.jpg'); }
	.instant-table.background-metal-mesh { background-image: url('/textures/instant/metal-mesh-4k.jpg'); }
	.instant-table.background-indigo-plaster { background-image: url('/textures/instant/indigo-plaster-4k.jpg'); }
	.instant-table.background-terrazzo { background-image: url('/textures/instant/dark-terrazzo-4k.jpg'); }
	.instant-table.background-collage { background-color: #101112; }
	.instant-table.background-collage-saved { background-color: #101112; background-image: var(--saved-instant-background); }
	.instant-table.background-collage-saved::before {
		position: absolute;
		inset: 0;
		z-index: 0;
		background: rgba(0, 0, 0, 0.22);
		content: '';
	}
	.instant-table.background-rest { background: #101112 !important; }

	.memory-backdrop {
		position: absolute;
		inset: -3%;
		z-index: 0;
		display: grid;
		grid-template-columns: repeat(12, minmax(0, 1fr));
		grid-template-rows: repeat(8, minmax(0, 1fr));
		gap: clamp(2px, 0.24vw, 9px);
		padding: clamp(4px, 0.6vw, 24px);
		overflow: hidden;
		background: #101112;
	}
	.memory-backdrop::after {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.32);
		content: '';
	}
	.memory-backdrop figure {
		min-width: 0;
		min-height: 0;
		margin: 0;
		padding: clamp(1px, 0.12vw, 5px);
		padding-bottom: clamp(3px, 0.35vw, 14px);
		background: #f5f3ed;
		box-shadow: 0 0.2rem 0.7rem rgba(0,0,0,.38);
		transform: rotate(var(--memory-turn));
	}
	.memory-backdrop img { width: 100%; height: 100%; object-fit: cover; }

	.instant-card {
		--card-position: translate(0, 0);
		position: relative;
		box-sizing: border-box;
		--instant-base-width: min(38vw, 58vh);
		width: calc(var(--instant-base-width) * var(--instant-card-scale));
		aspect-ratio: var(--instant-card-ratio);
		margin: 0;
		padding: 0;
		color: #151515;
		background-color: #f7f6f1;
		background-image: linear-gradient(115deg, rgba(255,255,255,.58), rgba(241,239,232,.2) 48%, rgba(217,214,205,.14));
		border-radius: var(--instant-paper-radius);
		box-shadow: inset 0 0 0 1px rgba(255,255,255,.6), 0 1.4rem 4rem rgba(0, 0, 0, 0.42), 0 0.18rem 0.55rem rgba(0, 0, 0, 0.25);
		transform: var(--card-position) rotate(var(--card-turn));
		transform-origin: 50% 55%;
		z-index: 1;
	}
	.instant-card.finish-matte { background-color: #f4f2eb; background-image: radial-gradient(circle at 18% 12%, rgba(255,255,255,.42), transparent 44%), linear-gradient(125deg, rgba(225,222,213,.22), transparent 55%); box-shadow: inset 0 0 0 1px rgba(255,255,255,.45), 0 1.1rem 3.2rem rgba(0,0,0,.39); }
	.instant-card.finish-glossy { background-color: #fff; background-image: linear-gradient(112deg, rgba(255,255,255,.94) 0 18%, rgba(238,239,238,.35) 38%, rgba(255,255,255,.92) 58% 100%); box-shadow: inset 0 0 0 1px rgba(255,255,255,.9), 0 1.5rem 4.2rem rgba(0,0,0,.45), 0 .2rem .5rem rgba(0,0,0,.25); }
	.instant-card.finish-warm { background-color: #f3ead7; background-image: linear-gradient(130deg, rgba(255,250,235,.65), rgba(220,204,174,.2)); box-shadow: inset 0 0 0 1px rgba(255,252,240,.5), 0 1.35rem 3.8rem rgba(0,0,0,.42); }

	.instant-table.transition-fade .instant-card,
	.instant-table.transition-develop .instant-card { animation: instant-fade var(--instant-transition-duration) ease var(--deal-delay) both; }
	.instant-table.transition-deal .instant-card { animation: instant-deal var(--instant-transition-duration) cubic-bezier(.2,.75,.2,1) var(--deal-delay) both; }
	.instant-table.transition-drop .instant-card { animation: instant-drop var(--instant-transition-duration) cubic-bezier(.16,.78,.28,1) var(--deal-delay) both; }
	.instant-table.transition-develop .instant-photo { animation: instant-develop var(--instant-transition-duration) cubic-bezier(.22,.72,.2,1) var(--deal-delay) both; will-change: filter, opacity; }

	.instant-table.single .instant-card { --instant-base-width: min(68vw, 68vh); }
	.instant-table.arrangement-classic .instant-card + .instant-card { margin-left: calc(var(--instant-overlap) * -0.11vw); }
	.instant-table.arrangement-classic.count-3 .instant-card { --instant-base-width: min(27vw, 45vh); }
	.instant-table.arrangement-classic.count-4 .instant-card,
	.instant-table.arrangement-classic.count-5 .instant-card { --instant-base-width: min(20vw, 34vh); }

	.instant-table.arrangement-hero-stack,
	.instant-table.arrangement-scattered { display: block; }
	.instant-table.arrangement-hero-stack .instant-card,
	.instant-table.arrangement-scattered .instant-card {
		--card-position: translate(-50%, -50%);
		position: absolute;
		--instant-base-width: min(26vw, 46vh);
	}
	.instant-table.arrangement-hero-stack .instant-card:nth-of-type(1) { left: 37%; top: 35%; --instant-base-width: min(32vw, 58vh); z-index: 5; }
	.instant-table.arrangement-hero-stack .instant-card:nth-of-type(2) { left: 63%; top: 36%; --instant-base-width: min(32vw, 58vh); z-index: 4; }
	.instant-table.arrangement-hero-stack .instant-card:nth-of-type(3) { left: 18%; top: 69%; z-index: 2; }
	.instant-table.arrangement-hero-stack .instant-card:nth-of-type(4) { left: 50%; top: 72%; z-index: 3; }
	.instant-table.arrangement-hero-stack .instant-card:nth-of-type(5) { left: 82%; top: 68%; z-index: 2; }
	.instant-table.arrangement-scattered .instant-card:nth-of-type(1) { left: 24%; top: 32%; z-index: 4; }
	.instant-table.arrangement-scattered .instant-card:nth-of-type(2) { left: 55%; top: 27%; z-index: 2; }
	.instant-table.arrangement-scattered .instant-card:nth-of-type(3) { left: 78%; top: 42%; z-index: 3; }
	.instant-table.arrangement-scattered .instant-card:nth-of-type(4) { left: 35%; top: 70%; z-index: 5; }
	.instant-table.arrangement-scattered .instant-card:nth-of-type(5) { left: 68%; top: 73%; z-index: 4; }

	.instant-table.arrangement-gallery {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		place-items: center;
		align-content: center;
		gap: var(--instant-card-gap);
		padding: clamp(1rem, 3vw, 6rem);
	}
	.instant-table.arrangement-gallery .instant-card { --instant-base-width: min(20vw, 36vh); }
	.instant-table.arrangement-gallery.count-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.instant-table.arrangement-gallery.count-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
	.instant-table.arrangement-gallery.count-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
	.instant-table.single { display: flex; }
	.instant-table.single .instant-card {
		--card-position: translate(0, 0);
		position: relative;
		inset: auto;
		z-index: 1;
	}

	.instant-print {
		position: absolute;
		left: var(--instant-side-border);
		right: var(--instant-side-border);
		top: var(--instant-side-border);
	}

	.instant-photo {
		position: relative;
		width: 100%;
		aspect-ratio: 3.108 / 3.024;
		overflow: hidden;
		background: #e8e8e6;
		border-radius: var(--instant-photo-radius);
	}

	.instant-photo img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		user-select: none;
	}

	.instant-caption {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(100% + clamp(0.3rem, 0.55vw, 1rem));
		display: -webkit-box;
		max-height: 31%;
		margin: 0;
		overflow: hidden;
		font-family: var(--instant-caption-font);
		font-size: calc(clamp(1.1rem, 1.75vw, 3.8rem) * var(--instant-caption-scale));
		font-weight: 500;
		line-height: 1.15;
		letter-spacing: 0.01em;
		text-align: center;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
	}

	@keyframes instant-fade { from { opacity: 0; } to { opacity: 1; } }
	@keyframes instant-deal {
		from { opacity: 0; transform: var(--card-position) translate3d(-5vw, -3vh, 0) rotate(calc(var(--card-turn) - 4deg)) scale(.94); }
		to { opacity: 1; transform: var(--card-position) translate3d(0, 0, 0) rotate(var(--card-turn)) scale(1); }
	}
	@keyframes instant-drop {
		from { opacity: 0; transform: var(--card-position) translate3d(0, -8vh, 0) rotate(var(--card-turn)) scale(.97); }
		to { opacity: 1; transform: var(--card-position) translate3d(0, 0, 0) rotate(var(--card-turn)) scale(1); }
	}
	@keyframes instant-develop {
		0% { opacity: .42; filter: blur(18px) saturate(.28) contrast(.72) brightness(1.34); }
		38% { opacity: .76; filter: blur(9px) saturate(.52) contrast(.82) brightness(1.2); }
		100% { opacity: 1; filter: blur(0) saturate(1) contrast(1) brightness(1); }
	}

	.mosaic {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		grid-template-rows: repeat(3, 1fr);
		gap: var(--photo-gap);
		padding: var(--photo-gap);
		background: #050505;
	}

	.tile { position: relative; overflow: hidden; grid-column: span 2; }
	.tile:first-child { grid-row: span 2; }
	.tile.portrait { grid-column: span 1; }
	.tile.panorama { grid-column: span 3; }
	.tile:nth-child(5n) { grid-column: span 2; }

	.filmstrip {
		position: absolute;
		inset: -10% 0;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: var(--photo-gap);
		padding: clamp(8px, 1vw, 26px);
		background: #050505;
		animation: wall-rise var(--kb-dur) linear both;
	}

	.film-frame {
		position: relative;
		overflow: hidden;
		border-radius: clamp(4px, 0.45vw, 14px);
	}

	.film-frame:nth-child(even) { transform: translateY(8%); }

	@keyframes wall-rise {
		from { transform: translateY(4%); }
		to { transform: translateY(-4%); }
	}

	@media (prefers-reduced-motion: reduce) {
		.inner.kb,
		.filmstrip,
		.instant-card { animation: none; }
	}

	@media (orientation: portrait) {
		.instant-table { padding: clamp(1rem, 3vw, 2.5rem); }
		.instant-table.single .instant-card { --instant-base-width: min(94vw, 69.6vh); }
		.instant-table.arrangement-classic:not(.single),
		.instant-table.arrangement-gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); place-items: center; align-content: center; }
		.instant-table.arrangement-classic.count-2 .instant-card,
		.instant-table.arrangement-gallery.count-2 .instant-card { --instant-base-width: min(44vw, 38vh); }
		.instant-table.arrangement-classic.count-3 .instant-card,
		.instant-table.arrangement-classic.count-4 .instant-card,
		.instant-table.arrangement-classic.count-5 .instant-card,
		.instant-table.arrangement-gallery.count-3 .instant-card,
		.instant-table.arrangement-gallery.count-4 .instant-card,
		.instant-table.arrangement-gallery.count-5 .instant-card { --instant-base-width: min(39vw, 26vh); }
		.instant-table.arrangement-hero-stack .instant-card,
		.instant-table.arrangement-scattered .instant-card { --instant-base-width: min(42vw, 31vh); }
		.instant-table.arrangement-hero-stack .instant-card:nth-of-type(1),
		.instant-table.arrangement-hero-stack .instant-card:nth-of-type(2) { --instant-base-width: min(48vw, 36vh); }
		.memory-backdrop { grid-template-columns: repeat(7, minmax(0, 1fr)); grid-template-rows: repeat(14, minmax(0, 1fr)); }
	}
</style>
