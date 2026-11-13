<script lang="ts">
	let {
		name,
		paused,
		visible,
		onprev,
		onnext,
		ontoggle
	}: {
		name: string;
		paused: boolean;
		visible: boolean;
		onprev: () => void;
		onnext: () => void;
		ontoggle: () => void;
	} = $props();
</script>

<div class="controls" class:visible>
	<span class="name">{name}</span>
	<div class="buttons">
		<button aria-label="Previous photo" onclick={onprev}>
			<svg viewBox="0 0 24 24"><path d="M15.5 5 8 12l7.5 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
		</button>
		<button aria-label={paused ? 'Play' : 'Pause'} class="play" onclick={ontoggle}>
			{#if paused}
				<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>
			{:else}
				<svg viewBox="0 0 24 24"><path d="M7.5 5h3v14h-3zm6 0h3v14h-3z" fill="currentColor"/></svg>
			{/if}
		</button>
		<button aria-label="Next photo" onclick={onnext}>
			<svg viewBox="0 0 24 24"><path d="m8.5 5 7.5 7-7.5 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
		</button>
	</div>
	<a class="gear" href="/settings" aria-label="Settings">
		<svg viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-2.1.1-1.4-.1-1.4 2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.4-1.4L14.2 2H9.8l-.4 2.6c-.9.3-1.7.8-2.4 1.4l-2.4-1-2 3.4 2 1.6-.1 1.4.1 1.4-2 1.6 2 3.4 2.4-1c.7.6 1.5 1.1 2.4 1.4l.4 2.6h4.4l.4-2.6c.9-.3 1.7-.8 2.4-1.4l2.4 1 2-3.4-2-1.6Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
	</a>
</div>

<style>
	.controls {
		position: absolute;
		inset: auto 0 0 0;
		z-index: 3;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 1.75rem 1.5rem;
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.65));
		color: #fff;
		opacity: 0;
		transition: opacity 0.3s ease;
		pointer-events: none;
	}

	.controls.visible {
		opacity: 1;
		pointer-events: auto;
	}

	.name {
		font-size: 0.95rem;
		font-weight: 600;
		text-shadow: var(--overlay-shadow);
		min-width: 6rem;
	}

	.buttons {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	button,
	.gear {
		display: grid;
		place-items: center;
		width: 3rem;
		height: 3rem;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.12);
		backdrop-filter: none; /* deliberately no blur: cheap on low-power GPUs */
		transition: background 0.15s ease;
		color: #fff;
	}

	button:hover,
	.gear:hover {
		background: rgba(255, 255, 255, 0.25);
	}

	.play {
		width: 3.5rem;
		height: 3.5rem;
	}

	svg {
		width: 55%;
		height: 55%;
	}

	.gear {
		width: 2.6rem;
		height: 2.6rem;
		min-width: 2.6rem;
	}
</style>
