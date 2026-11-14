// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './+page.svelte';

const navigation = vi.hoisted(() => ({ refreshAll: vi.fn(async () => undefined) }));
vi.mock('$app/navigation', () => navigation);
vi.mock('$app/env/public', () => ({ PUBLIC_CONTROL_PORT: '3001', PUBLIC_PLAYER_PORT: '3000' }));

const data = {
	displays: [{ slug: 'living-room', name: 'Living room', sources: 1 }],
	immich: {
		configured: true,
		defaultId: 'camera',
		connections: [{
			id: 'camera', name: 'Camera', url: 'http://immich.local:2283',
			allowedAlbumIds: ['11111111-1111-4111-8111-111111111111'], apiKeyStored: true, source: 'stored' as const
		}]
	}
};

const liveClient = {
	clientId: 'tv-client', name: 'OLED TV', device: 'Chromium',
	fingerprint: 'Linux aarch64 · 3840x2160 · remote/keyboard', slug: 'living-room',
	profileName: 'Living room', assignmentCount: 1, lastSeen: Date.now(), controlAvailable: true,
	state: {
		paused: false, blackout: false,
		slide: { id: 'photo-one', connectionId: 'camera' },
		slides: [{ id: 'photo-one', connectionId: 'camera', ratio: 1.5 }],
		endsAt: Date.now() + 10_000, remainingMs: 10_000
	}
};

describe('Controller overview', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		navigation.refreshAll.mockClear();
		fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === '/api/cache' && !init?.method) return new Response(JSON.stringify({ files: 14, bytes: 6_291_456, queued: 3, active: 1 }), { status: 200 });
			if (url === '/api/cache' && init?.method === 'DELETE') return new Response(JSON.stringify({ files: 0, bytes: 0, queued: 0, active: 0 }), { status: 200 });
			if (url === '/api/control/clients') return new Response(JSON.stringify([liveClient]), { status: 200 });
			if (url.startsWith('/api/control/clients/') && init?.method === 'POST') return new Response('{}', { status: 200 });
			if (url === '/api/displays' && init?.method === 'POST') return new Response(JSON.stringify({ slug: 'new-frame' }), { status: 201 });
			if (url === '/api/immich/connection' && init?.method === 'PUT') return new Response(JSON.stringify({
				savedConnectionId: 'camera', albums: 1, albumNames: ['Family'],
				assetStatistics: { images: 1065, videos: 0 }, people: 42
			}), { status: 200 });
			return new Response('{}', { status: 404 });
		});
		vi.stubGlobal('fetch', fetchMock);
		vi.stubGlobal('confirm', vi.fn(() => true));
		vi.stubGlobal('prompt', vi.fn(() => 'OLED TV'));
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it('distinguishes controller and player ports and shows live storage/player state', async () => {
		render(SettingsPage, { data });
		expect(screen.getByText('Administration · port 3001')).toBeTruthy();
		expect(screen.getByText('Players', { exact: true })).toBeTruthy();
		expect(await screen.findByText('OLED TV')).toBeTruthy();
		expect(screen.getByText(/6.0 MB · 14 files/)).toBeTruthy();
		expect(screen.getByText(/warming 1 active \/ 3 queued/)).toBeTruthy();
		const image = document.querySelector('.player-thumb img');
		expect(image?.getAttribute('src')).toBe('/api/image/photo-one?size=preview&connection=camera');
	});

	it('sends immediate previous, pause, next, identify, reload and blackout commands', async () => {
		render(SettingsPage, { data });
		await screen.findByText('OLED TV');
		for (const name of ['Previous photograph', 'Pause slideshow', 'Next photograph', 'Identify', 'Reload', 'Black screen']) {
			await fireEvent.click(screen.getByRole('button', { name }));
		}
		const commands = fetchMock.mock.calls
			.filter(([url, init]) => String(url).includes('/api/control/clients/tv-client') && init?.method === 'POST')
			.map(([, init]) => JSON.parse(String(init?.body)).type);
		expect(commands).toEqual(['prev', 'toggle', 'next', 'identify', 'refresh', 'blackout']);
	});

	it('creates a presentation from a trimmed name', async () => {
		render(SettingsPage, { data });
		const name = screen.getByPlaceholderText('New presentation name (e.g. Living room family)');
		await fireEvent.input(name, { target: { value: '  Kitchen frame  ' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create presentation' }));
		await waitFor(() => expect(navigation.refreshAll).toHaveBeenCalled());
		const call = fetchMock.mock.calls.find(([url, init]) => url === '/api/displays' && init?.method === 'POST');
		expect(JSON.parse(String(call?.[1]?.body))).toEqual({ name: 'Kitchen frame' });
	});

	it('keeps a stored key secret while updating the album allowlist', async () => {
		render(SettingsPage, { data });
		const key = screen.getByLabelText('API key') as HTMLInputElement;
		expect(key.type).toBe('password');
		expect(key.value).toBe('');
		expect(key.placeholder).toContain('leave blank to keep it');
		await fireEvent.input(screen.getByLabelText(/Allowed Immich albums/), {
			target: { value: '22222222-2222-4222-8222-222222222222' }
		});
		await fireEvent.submit(screen.getByRole('button', { name: 'Test and save' }).closest('form')!);
		await waitFor(() => expect(screen.getByText(/1 allowed album: Family/)).toBeTruthy());
		const call = fetchMock.mock.calls.find(([url, init]) => url === '/api/immich/connection' && init?.method === 'PUT');
		expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
			id: 'camera', apiKey: '', allowedAlbums: '22222222-2222-4222-8222-222222222222'
		});
	});

	it('requires confirmation before clearing the persistent cache', async () => {
		render(SettingsPage, { data });
		await screen.findByText(/6.0 MB · 14 files/);
		await fireEvent.click(screen.getByRole('button', { name: 'Clear cache' }));
		await waitFor(() => expect(screen.getByText(/0 B · 0 files/)).toBeTruthy());
		expect(confirm).toHaveBeenCalledWith('Clear all locally cached slideshow images? Mantel will download them again.');
		expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/cache' && init?.method === 'DELETE')).toBe(true);
	});
});
