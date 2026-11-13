<script lang="ts">
	import { onMount } from 'svelte';

	interface AlbumOption {
		id: string;
		name: string;
		assetCount: number;
		thumbAssetId: string | null;
		connectionId?: string;
	}

	let {
		selected,
		connectionId,
		ontoggle
	}: {
		selected: Map<string, string>; // connectionId:albumId -> name
		connectionId?: string;
		ontoggle: (album: { id: string; name: string; connectionId?: string }) => void;
	} = $props();

	let albums = $state<AlbumOption[] | null>(null);
	let loadError = $state(false);

	onMount(async () => {
		try {
			const params = connectionId ? `?connection=${encodeURIComponent(connectionId)}` : '';
			const res = await fetch(`/api/immich/albums${params}`);
			if (!res.ok) throw new Error();
			albums = await res.json();
		} catch {
			loadError = true;
		}
	});
</script>

{#if loadError}
	<p class="hint">Couldn't load albums from Immich — check the server connection.</p>
{:else if !albums}
	<p class="hint">Loading albums…</p>
{:else if albums.length === 0}
	<p class="hint">No allowed albums are configured for this Immich connection.</p>
{:else}
	<div class="grid">
		{#each albums as album (album.id)}
			<button
				type="button"
				class="card"
				class:selected={selected.has(`${album.connectionId ?? 'default'}:${album.id}`)}
				onclick={() => ontoggle({ id: album.id, name: album.name, connectionId: album.connectionId })}
			>
				{#if album.thumbAssetId}
					<img src="/api/image/{album.thumbAssetId}?size=thumbnail{album.connectionId ? `&connection=${encodeURIComponent(album.connectionId)}` : ''}" alt="" loading="lazy" />
				{:else}
					<div class="placeholder"></div>
				{/if}
				<span class="check" aria-hidden="true">✓</span>
				<span class="caption">
					<span class="name">{album.name}</span>
					<span class="count">{album.assetCount}</span>
				</span>
			</button>
		{/each}
	</div>
{/if}

<style>
	.hint {
		color: var(--text-faint);
		font-size: 0.9rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
		gap: 0.75rem;
	}

	.card {
		position: relative;
		aspect-ratio: 4 / 3;
		border-radius: var(--radius-sm);
		overflow: hidden;
		border: 2px solid transparent;
		background: var(--surface-raised);
		transition: border-color 0.15s ease;
		text-align: left;
	}

	.card:hover {
		border-color: var(--text-faint);
	}

	.card.selected {
		border-color: var(--accent);
	}

	img,
	.placeholder {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.check {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		width: 1.4rem;
		height: 1.4rem;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--accent);
		color: var(--on-accent);
		font-size: 0.8rem;
		font-weight: 700;
		opacity: 0;
		transform: scale(0.6);
		transition: opacity 0.12s ease, transform 0.12s ease;
	}

	.card.selected .check {
		opacity: 1;
		transform: scale(1);
	}

	.caption {
		position: absolute;
		inset: auto 0 0 0;
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		padding: 1rem 0.6rem 0.45rem;
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
		color: #fff;
		font-size: 0.8rem;
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}

	.count {
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.72rem;
	}
</style>
