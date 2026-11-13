<script lang="ts">
	let {
		value = $bindable(),
		options,
		label
	}: {
		value: string;
		options: { value: string; label: string }[];
		label: string;
	} = $props();
</script>

<div class="field">
	<span class="label">{label}</span>
	<div class="segments" role="radiogroup" aria-label={label}>
		{#each options as opt (opt.value)}
			<button
				type="button"
				role="radio"
				aria-checked={value === opt.value}
				class:active={value === opt.value}
				onclick={() => (value = opt.value)}
			>
				{opt.label}
			</button>
		{/each}
	</div>
</div>

<style>
	.field {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-width: 0;
	}

	.label {
		font-size: 0.95rem;
	}

	.segments {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 2px;
		gap: 2px;
		min-width: 0;
	}

	button {
		padding: 0.35rem 0.8rem;
		border-radius: calc(var(--radius-sm) - 2px);
		font-size: 0.85rem;
		color: var(--text-dim);
		transition: background 0.15s ease, color 0.15s ease;
		white-space: nowrap;
	}

	button:hover {
		color: var(--text);
	}

	button.active {
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
	}

	@media (max-width: 36rem) {
		.field { display: grid; gap: 0.5rem; }
		.segments { width: 100%; justify-content: flex-start; }
		button { flex: 1 1 auto; }
	}
</style>
