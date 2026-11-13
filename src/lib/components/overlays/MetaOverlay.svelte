<script lang="ts">
	import type { SlideAsset } from '$lib/types';

	let {
		slide,
		showDate,
		showLocation,
		showCamera,
		showRating
	}: {
		slide: SlideAsset;
		showDate: boolean;
		showLocation: boolean;
		showCamera: boolean;
		showRating: boolean;
	} = $props();

	const takenAt = $derived.by(() => {
		if (!showDate || !slide.takenAt) return null;
		const d = new Date(slide.takenAt);
		if (isNaN(d.getTime())) return null;
		return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
	});
</script>

<div class="meta">
	{#if slide.memoryYearsAgo}
		<span class="memory">
			{slide.memoryYearsAgo === 1 ? 'One year ago' : `${slide.memoryYearsAgo} years ago`}
		</span>
	{/if}
	{#if takenAt}
		<span class="line date">{takenAt}</span>
	{/if}
	{#if showLocation && slide.location}
		<span class="line place">{slide.location}</span>
	{/if}
	{#if showCamera && slide.camera}
		<span class="line camera">{slide.camera}</span>
	{/if}
	{#if showRating && slide.rating}
		<span class="line rating" aria-label={`${slide.rating} out of 5 stars`}>
			{'★'.repeat(slide.rating)}{'☆'.repeat(5 - slide.rating)}
		</span>
	{/if}
</div>

<style>
	.meta {
		display: grid;
		gap: 0.15rem;
		color: var(--overlay-text);
		text-shadow: var(--overlay-shadow);
	}

	.memory {
		justify-self: start;
		font-size: clamp(0.85rem, 1.2vw, 1.35rem);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #ff6347;
		text-shadow: var(--overlay-shadow);
		margin-bottom: 0.35rem;
	}

	.line {
		line-height: 1.3;
	}

	.date {
		font-size: clamp(1.2rem, 2vw, 2.4rem);
		font-weight: 720;
	}

	.place {
		font-size: clamp(1rem, 1.55vw, 1.8rem);
		opacity: 0.9;
		font-weight: 650;
	}

	.camera {
		font-size: clamp(0.9rem, 1.3vw, 1.5rem);
		opacity: 0.7;
		font-weight: 580;
	}

	.rating {
		font-size: clamp(1rem, 1.45vw, 1.7rem);
		letter-spacing: 0.08em;
		color: #ffd36a;
	}
</style>
