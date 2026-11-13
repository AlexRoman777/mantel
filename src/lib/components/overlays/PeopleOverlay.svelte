<script lang="ts">
	import type { FaceInfo, SlideAsset } from '$lib/types';

	let { faces, slide, showAge, showCards }: { faces: FaceInfo[]; slide: SlideAsset; showAge: boolean; showCards: boolean } = $props();
	const named = $derived(faces.filter((face) => face.name));
	function portraitUrl(personId: string): string {
		const params = new URLSearchParams();
		if (slide.connectionId) params.set('connection', slide.connectionId);
		return `/api/people/${personId}/thumbnail${params.size ? `?${params}` : ''}`;
	}
</script>

{#if named.length}
	<div class="people" aria-label="People in this photo">
		{#each named as face (face.id)}
			<span class:card={showCards}>
				{#if showCards && face.personId}<img src={portraitUrl(face.personId)} alt="" />{/if}
				<strong>{face.name}</strong>{#if showAge && face.ageAtPhoto !== null}<small>{face.ageAtPhoto}</small>{/if}
			</span>
		{/each}
	</div>
{/if}

<style>
	.people {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		font-size: clamp(0.95rem, 1.3vw, 1.55rem);
		color: var(--overlay-text);
		text-shadow: var(--overlay-shadow);
	}

	.people span {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4rem;
		font-weight: 700;
	}

	.people span.card {
		gap: 0.55rem;
	}

	.people img {
		width: clamp(2.4rem, 3.2vw, 4.8rem);
		height: clamp(2.4rem, 3.2vw, 4.8rem);
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid rgba(255, 255, 255, 0.4);
	}

	small { color: #ff6347; font-size: 1em; font-weight: 850; opacity: 1; }
</style>
