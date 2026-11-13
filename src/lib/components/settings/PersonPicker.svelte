<script lang="ts">
	import { onMount } from 'svelte';

	interface PersonOption {
		id: string;
		name: string;
		connectionId?: string;
	}

	let {
		selected,
		connectionId,
		ontoggle
	}: {
		selected: Map<string, string>;
		connectionId?: string;
		ontoggle: (person: { id: string; name: string; connectionId?: string }) => void;
	} = $props();

	let people = $state<PersonOption[] | null>(null);
	let loadError = $state(false);
	let query = $state('');

	const filtered = $derived(
		people?.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())) ?? []
	);

	onMount(async () => {
		try {
			const params = connectionId ? `?connection=${encodeURIComponent(connectionId)}` : '';
			const res = await fetch(`/api/immich/people${params}`);
			if (!res.ok) throw new Error();
			people = await res.json();
		} catch {
			loadError = true;
		}
	});
</script>

{#if loadError}
	<p class="hint">Couldn't load people from Immich — check the server connection.</p>
{:else if !people}
	<p class="hint">Loading people…</p>
{:else if people.length === 0}
	<p class="hint">No named people in your Immich library yet.</p>
{:else}
	{#if people.length > 8}
		<input class="search" type="search" placeholder="Search people…" bind:value={query} />
	{/if}
	<div class="grid">
		{#each filtered as person (person.id)}
			<button
				type="button"
				class="person"
				class:selected={selected.has(`${person.connectionId ?? 'default'}:${person.id}`)}
				onclick={() => ontoggle(person)}
			>
				<span class="avatar">
					<img src="/api/people/{person.id}/thumbnail{person.connectionId ? `?connection=${encodeURIComponent(person.connectionId)}` : ''}" alt="" loading="lazy" />
					<span class="check" aria-hidden="true">✓</span>
				</span>
				<span class="name">{person.name}</span>
			</button>
		{/each}
	</div>
{/if}

<style>
	.hint {
		color: var(--text-faint);
		font-size: 0.9rem;
	}

	.search {
		width: 100%;
		margin-bottom: 0.75rem;
		padding: 0.5rem 0.85rem;
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text);
	}

	.search:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-color: var(--accent);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(5.2rem, 1fr));
		gap: 0.9rem;
	}

	.person {
		display: grid;
		justify-items: center;
		gap: 0.4rem;
	}

	.avatar {
		position: relative;
		width: 4.2rem;
		height: 4.2rem;
	}

	.avatar img {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid transparent;
		transition: border-color 0.15s ease;
	}

	.person:hover .avatar img {
		border-color: var(--text-faint);
	}

	.person.selected .avatar img {
		border-color: var(--accent);
	}

	.check {
		position: absolute;
		bottom: 0;
		right: 0;
		width: 1.3rem;
		height: 1.3rem;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--accent);
		color: var(--on-accent);
		font-size: 0.75rem;
		font-weight: 700;
		opacity: 0;
		transform: scale(0.6);
		transition: opacity 0.12s ease, transform 0.12s ease;
	}

	.person.selected .check {
		opacity: 1;
		transform: scale(1);
	}

	.name {
		font-size: 0.8rem;
		color: var(--text-dim);
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.person.selected .name {
		color: var(--text);
	}
</style>
