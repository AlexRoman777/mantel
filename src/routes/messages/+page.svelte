<script lang="ts">
	import { onMount } from 'svelte';
	import ControllerHeader from '$lib/components/controller/ControllerHeader.svelte';

	type Client = {
		clientId: string; name: string | null; device: string; fingerprint: string; controlAvailable: boolean;
		diagnostics: { viewport?: string; refreshHz?: number | null; hardwareConcurrency?: number | null; deviceMemoryGb?: number | null; usedHeapBytes?: number | null };
	};
	let clients = $state<Client[]>([]);
	let selected = $state<string[]>([]);
	let text = $state('');
	let mode = $state<'popup' | 'ticker'>('popup');
	let position = $state<'top' | 'bottom'>('bottom');
	let durationSec = $state(7);
	let speedSec = $state(8);
	let sending = $state(false);
	let result = $state<string | null>(null);

	async function refreshClients() {
		const response = await fetch('/api/control/clients').catch(() => null);
		if (response?.ok) clients = await response.json();
	}
	function toggleClient(id: string) { selected = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]; }
	function heap(value?: number | null) { return value ? `${Math.round(value / 1024 / 1024)} MB JS heap` : 'Memory unavailable'; }
	async function sendMessage(event: SubmitEvent) {
		event.preventDefault();
		if (!text.trim()) return;
		sending = true; result = null;
		try {
			const response = await fetch('/api/control/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, mode, position, durationSec, speedSec, ...(selected.length ? { clientIds: selected } : {}) }) });
			const body = await response.json().catch(() => null);
			result = response.ok ? `Sent live to ${body.delivered} player${body.delivered === 1 ? '' : 's'}.` : body?.error ?? 'Could not send message';
		} finally { sending = false; }
	}
	onMount(() => { void refreshClients(); const timer = setInterval(() => void refreshClients(), 2500); return () => clearInterval(timer); });
</script>

<svelte:head><title>Mantel Controller — Messages</title></svelte:head>
<main>
	<ControllerHeader active="messages" title="Send something to the screens" description="Show a short family message immediately as a centered popup or a fast top/bottom ticker. Nothing is written to Immich." />
	<div class="layout">
		<form onsubmit={sendMessage}>
			<label class="message-field"><span>Message</span><textarea bind:value={text} maxlength="1000" rows="5" placeholder="Dinner is ready · Remember your sports bag…"></textarea></label>
			<fieldset><legend>Presentation</legend><div class="choices"><button type="button" class:active={mode === 'popup'} onclick={() => mode = 'popup'}>Centered popup</button><button type="button" class:active={mode === 'ticker'} onclick={() => mode = 'ticker'}>Scrolling ticker</button></div></fieldset>
			<label class="range"><span>Visible for <strong>{durationSec} seconds</strong></span><input type="range" min="5" max="60" step="1" bind:value={durationSec} /></label>
			{#if mode === 'ticker'}
				<fieldset><legend>Edge</legend><div class="choices"><button type="button" class:active={position === 'top'} onclick={() => position = 'top'}>Top</button><button type="button" class:active={position === 'bottom'} onclick={() => position = 'bottom'}>Bottom</button></div></fieldset>
				<label class="range"><span>One pass in <strong>{speedSec} seconds</strong></span><input type="range" min="3" max="30" step="1" bind:value={speedSec} /></label>
				<p class="hint">The browser compositor synchronizes the animation to each screen's real refresh cycle.</p>
			{/if}
			<button class="send" disabled={sending || !text.trim()}>{sending ? 'Sending…' : selected.length ? `Send to ${selected.length} selected` : 'Send to all online players'}</button>
			{#if result}<p class="result">{result}</p>{/if}
		</form>
		<section>
			<div class="section-heading"><div><h2>Recipients</h2><p>{selected.length ? `${selected.length} selected` : 'None selected means all online players'}</p></div><button type="button" onclick={() => selected = []}>All players</button></div>
			<div class="clients">
				{#each clients as client (client.clientId)}
					<button type="button" class="client" class:selected={selected.includes(client.clientId)} onclick={() => toggleClient(client.clientId)} disabled={!client.controlAvailable}>
						<span class="check">{selected.includes(client.clientId) ? '✓' : ''}</span>
						<span class="client-copy"><strong>{client.name || client.device}</strong><small>{client.fingerprint || client.clientId.slice(0, 8)}</small></span>
						<span class="metrics"><b>{client.diagnostics.viewport ?? 'Viewport unknown'}</b><b>{client.diagnostics.refreshHz ? `≈ ${client.diagnostics.refreshHz} Hz` : 'Hz unavailable'}</b><b>{client.diagnostics.hardwareConcurrency ? `${client.diagnostics.hardwareConcurrency} CPU threads` : 'CPU unavailable'}</b><b>{client.diagnostics.deviceMemoryGb ? `${client.diagnostics.deviceMemoryGb} GB device memory` : heap(client.diagnostics.usedHeapBytes)}</b></span>
					</button>
				{/each}
				{#if !clients.length}<div class="empty">No online players. Messages are live-only and are not queued.</div>{/if}
			</div>
			<p class="note">Refresh rate is measured from animation frames and shown as an estimate. Browser-restricted memory data is marked unavailable rather than guessed.</p>
		</section>
	</div>
</main>

<style>
	main { max-width: 88rem; margin: 0 auto; padding: 2.5rem 2rem 6rem; }
	.layout { display: grid; grid-template-columns: minmax(18rem,.85fr) minmax(24rem,1.15fr); gap: 2rem; margin-top: 2.5rem; align-items: start; min-width: 0; }
	form, section { min-width: 0; padding: 1.25rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
	form { display: grid; gap: 1.25rem; position: sticky; top: 1rem; }
	.message-field, .range { display: grid; gap: .5rem; } .message-field { font-weight: 700; }
	textarea { resize: vertical; width: 100%; padding: .9rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-raised); color: var(--text); font: inherit; font-size: 1.05rem; }
	fieldset { margin: 0; padding: 0; border: 0; } legend, .range > span { margin-bottom: .5rem; color: var(--text-dim); font-size: .82rem; }
	.choices { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: .4rem; padding: .3rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-raised); }
	.choices button { min-width: 0; padding: .65rem; border-radius: .45rem; color: var(--text-dim); white-space: normal; } .choices button.active { background: var(--accent); color: var(--on-accent); font-weight: 700; }
	.range input { width: 100%; accent-color: var(--accent); } .hint,.note { margin: 0; color: var(--text-faint); font-size: .76rem; line-height: 1.45; }
	.send { padding: .85rem 1rem; border-radius: var(--radius-sm); background: var(--accent); color: var(--on-accent); font-weight: 800; } .send:disabled { opacity: .45; } .result { margin: 0; color: var(--text-dim); font-size: .85rem; }
	.section-heading { display: flex; align-items: start; justify-content: space-between; gap: 1rem; } h2 { margin: 0 0 .25rem; font-size: 1.1rem; } .section-heading p { margin: 0; color: var(--text-faint); font-size: .8rem; } .section-heading button { color: var(--accent); font-size: .78rem; }
	.clients { display: grid; gap: .6rem; margin-top: 1rem; } .client { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: .8rem; width: 100%; padding: .85rem; border: 1px solid var(--border); border-radius: var(--radius-sm); text-align: left; }
	.client:hover,.client.selected { border-color: var(--accent); background: color-mix(in srgb,var(--accent) 7%,var(--surface-raised)); } .client:disabled { opacity: .5; }
	.check { display: grid; place-items: center; width: 1.3rem; height: 1.3rem; border: 1px solid var(--border); border-radius: .35rem; color: var(--on-accent); background: var(--surface-raised); } .selected .check { border-color: var(--accent); background: var(--accent); }
	.client-copy { display: grid; min-width: 0; } .client-copy strong,.client-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .client-copy small { color: var(--text-faint); font-size: .7rem; }
	.metrics { display: grid; grid-template-columns: repeat(2,auto); gap: .25rem .5rem; } .metrics b { padding: .22rem .4rem; border-radius: 999px; background: var(--surface-raised); color: var(--text-faint); font: 600 .62rem ui-monospace,monospace; white-space: nowrap; }
	.empty { padding: 2rem; color: var(--text-faint); text-align: center; } .note { margin-top: 1rem; }
	@media(max-width:58rem){.layout{grid-template-columns:1fr}form{position:static}} @media(max-width:38rem){main{padding:1.2rem 1rem 4rem}.client{grid-template-columns:auto minmax(0,1fr)}.metrics{grid-column:2;grid-template-columns:repeat(2,minmax(0,1fr))}.metrics b{white-space:normal}}
</style>
