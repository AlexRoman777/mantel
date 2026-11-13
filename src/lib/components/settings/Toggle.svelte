<script lang="ts">
	let {
		checked = $bindable(),
		label,
		onchange
	}: {
		checked: boolean;
		label: string;
		onchange?: (checked: boolean) => void;
	} = $props();

	function handleChange(e: Event): void {
		const value = (e.currentTarget as HTMLInputElement).checked;
		checked = value;
		onchange?.(value);
	}
</script>

<label class="toggle">
	<span class="text">{label}</span>
	<input type="checkbox" {checked} onchange={handleChange} />
	<span class="track"><span class="knob"></span></span>
</label>

<style>
	.toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		cursor: pointer;
		user-select: none;
	}

	.text {
		font-size: 0.95rem;
	}

	input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.track {
		flex-shrink: 0;
		width: 2.6rem;
		height: 1.5rem;
		border-radius: 999px;
		background: var(--surface-raised);
		border: 1px solid var(--border);
		position: relative;
		transition: background 0.15s ease, border-color 0.15s ease;
	}

	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: calc(1.5rem - 6px);
		height: calc(1.5rem - 6px);
		border-radius: 50%;
		background: var(--text-dim);
		transition: transform 0.15s ease, background 0.15s ease;
	}

	input:checked + .track {
		background: var(--accent);
		border-color: var(--accent);
	}

	input:checked + .track .knob {
		transform: translateX(1.1rem);
		background: var(--on-accent);
	}

	input:focus-visible + .track {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>
