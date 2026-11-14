// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RemotePage from './+page.svelte';

vi.mock('$app/env/public', () => ({ PUBLIC_CONTROL_PORT: '3001', PUBLIC_PLAYER_PORT: '3000' }));

const displays = [
	{ slug: 'living-room', name: 'Living room' },
	{ slug: 'family', name: 'Family album' }
];

const client = () => ({
	clientId: 'client-12345678', name: 'OLED TV', device: 'Chromium',
	fingerprint: 'Linux aarch64 · 3840x2160 · remote/keyboard', slug: 'living-room',
	profileName: 'Living room', assignmentCount: 1, connectedAt: Date.now() - 5000,
	lastSeen: Date.now(), controlAvailable: true,
	state: {
		paused: false,
		slide: { id: 'photo-one', connectionId: 'camera', takenAt: '2025-01-01T12:00:00', location: 'Täby, Sweden' },
		slides: [
			{ id: 'photo-one', connectionId: 'camera', ratio: 0.75 },
			{ id: 'photo-two', connectionId: 'camera', ratio: 0.66 }
		],
		startedAt: Date.now(), endsAt: Date.now() + 10_000, durationMs: 10_000, remainingMs: 10_000
	}
});

describe('Live players controller', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === '/api/control/clients') return new Response(JSON.stringify([client()]), { status: 200 });
			if (url.startsWith('/api/control/clients/') && init?.method === 'POST') return new Response('{}', { status: 200 });
			if (url.startsWith('/api/control/clients/') && init?.method === 'PATCH') return new Response('{}', { status: 200 });
			if (url === '/api/displays' && init?.method === 'POST') return new Response(JSON.stringify({ slug: 'oled-tv-presentation' }), { status: 201 });
			return new Response('{}', { status: 404 });
		});
		vi.stubGlobal('fetch', fetchMock);
		vi.stubGlobal('prompt', vi.fn(() => 'Television'));
		vi.stubGlobal('confirm', vi.fn(() => true));
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it('shows the exact multi-photo output, countdown, identity and location', async () => {
		render(RemotePage, { data: { displays } });
		expect(await screen.findByText('OLED TV')).toBeTruthy();
		expect(screen.getByText(/Linux aarch64 · 3840x2160/)).toBeTruthy();
		expect(screen.getByText('Showing: Täby, Sweden')).toBeTruthy();
		const images = document.querySelectorAll('.thumb img');
		expect(images).toHaveLength(2);
		expect(images[0].getAttribute('src')).toBe('/api/image/photo-one?size=preview&connection=camera');
		expect(images[0].getAttribute('loading')).toBe('lazy');
		expect(document.querySelector('.countdown')?.textContent).toMatch(/^\d+s$/);
	});

	it('sends every immediate playback command to the selected client', async () => {
		render(RemotePage, { data: { displays } });
		await screen.findByText('OLED TV');
		for (const name of ['Previous', 'Pause', 'Next', 'Identify']) {
			await fireEvent.click(screen.getByRole('button', { name }));
		}
		const bodies = fetchMock.mock.calls
			.filter(([url, init]) => String(url).includes('/api/control/clients/client-12345678') && init?.method === 'POST')
			.map(([, init]) => JSON.parse(String(init?.body)).type);
		expect(bodies).toEqual(['prev', 'toggle', 'next', 'identify']);
	});

	it('switches presentations, renames, and creates an independent copy explicitly', async () => {
		render(RemotePage, { data: { displays } });
		await screen.findByText('OLED TV');
		const presentation = screen.getByLabelText('Assigned presentation') as HTMLSelectElement;
		presentation.value = 'family';
		await fireEvent.change(presentation);
		await fireEvent.click(screen.getByRole('button', { name: /OLED TV/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Make independent' }));

		await waitFor(() => {
			const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
			expect(posts.some(([, init]) => JSON.parse(String(init?.body)).type === 'switch')).toBe(true);
			expect(posts.some(([url]) => url === '/api/displays')).toBe(true);
			expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true);
		});
	});

	it('uses a clear empty state with a valid player link', async () => {
		fetchMock.mockImplementationOnce(async () => new Response('[]', { status: 200 }));
		render(RemotePage, { data: { displays } });
		expect(await screen.findByText('No screens connected right now.')).toBeTruthy();
		expect(screen.getByRole('link', { name: '/display/living-room' }).getAttribute('href')).toBe('/display/living-room');
	});
});
