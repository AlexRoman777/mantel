// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MessagesPage from './+page.svelte';

vi.mock('$app/env/public', () => ({ PUBLIC_CONTROL_PORT: '3001', PUBLIC_PLAYER_PORT: '3000' }));

const clients = [
	{
		clientId: 'tv-client', name: 'Living room TV', device: 'Chromium',
		fingerprint: 'Linux aarch64 · 3840x2160 · remote/keyboard', controlAvailable: true,
		diagnostics: { viewport: '3840x2160', refreshHz: 60, hardwareConcurrency: 4, deviceMemoryGb: 8, usedHeapBytes: 42_000_000 }
	},
	{
		clientId: 'embedded-client', name: null, device: 'Home Assistant',
		fingerprint: 'Embedded · 1920x1080', controlAvailable: false,
		diagnostics: { viewport: '1920x1080', refreshHz: null, hardwareConcurrency: null, deviceMemoryGb: null, usedHeapBytes: null }
	}
];

describe('Messages controller', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === '/api/control/clients') return new Response(JSON.stringify(clients), { status: 200 });
			if (url === '/api/control/messages' && init?.method === 'POST') {
				return new Response(JSON.stringify({ delivered: 1 }), { status: 200 });
			}
			return new Response('{}', { status: 404 });
		});
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it('shows live diagnostics and disables players without a control channel', async () => {
		render(MessagesPage);
		expect(await screen.findByText('Living room TV')).toBeTruthy();
		expect(screen.getByText('3840x2160')).toBeTruthy();
		expect(screen.getByText('≈ 60 Hz')).toBeTruthy();
		expect(screen.getByText('4 CPU threads')).toBeTruthy();
		expect(screen.getByText('8 GB device memory')).toBeTruthy();
		const embedded = screen.getByRole('button', { name: /Home Assistant/ }) as HTMLButtonElement;
		expect(embedded.disabled).toBe(true);
	});

	it('sends a popup to all players with the exact defaults', async () => {
		render(MessagesPage);
		await screen.findByText('Living room TV');
		const input = screen.getByLabelText('Message') as HTMLTextAreaElement;
		await fireEvent.input(input, { target: { value: 'Dinner is ready' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Send to all online players' }));
		await waitFor(() => expect(screen.getByText('Sent live to 1 player.')).toBeTruthy());
		const call = fetchMock.mock.calls.find(([url]) => url === '/api/control/messages');
		expect(JSON.parse(String(call?.[1]?.body))).toEqual({
			text: 'Dinner is ready', mode: 'popup', position: 'bottom', durationSec: 7, speedSec: 8
		});
	});

	it('sends a top ticker only to selected controllable players', async () => {
		render(MessagesPage);
		await screen.findByText('Living room TV');
		await fireEvent.click(screen.getByRole('button', { name: /Living room TV/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Scrolling ticker' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Top' }));
		await fireEvent.input(screen.getByLabelText('Message'), { target: { value: 'Train delayed' } });
		await fireEvent.input(screen.getByLabelText(/One pass in/), { target: { value: '5' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Send to 1 selected' }));
		await waitFor(() => expect(screen.getByText('Sent live to 1 player.')).toBeTruthy());
		const call = fetchMock.mock.calls.find(([url]) => url === '/api/control/messages');
		expect(JSON.parse(String(call?.[1]?.body))).toEqual({
			text: 'Train delayed', mode: 'ticker', position: 'top', durationSec: 7,
			speedSec: 5, clientIds: ['tv-client']
		});
	});
});
