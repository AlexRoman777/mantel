// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestProfile } from '$lib/test-profile.test-helper';
import PresentationPage from './+page.svelte';

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_CONTROL_PORT: '3001', PUBLIC_PLAYER_PORT: '3000' }
}));

const pageData = () => ({
	profile: makeTestProfile(),
	immich: {
		configured: true, defaultId: 'camera',
		connections: [{ id: 'camera', name: 'Camera', url: 'http://immich.local:2283', allowedAlbumIds: ['album-one', 'album-two'], apiKeyStored: true, source: 'stored' as const }]
	},
	homeAssistant: { configured: false, url: null },
	clientId: 'test-client'
});

const cachePlan = {
	assets: 1065, cached: 14, cachedBytes: 6_500_000, missing: 1051,
	estimatedAdditionalBytes: 490_000_000, estimatedTotalBytes: 496_500_000, size: 'preview',
	gallery: {
		uniqueAssets: 1065, estimatedCompositions: 850, estimatedCycleSeconds: 25_500,
		dateFrom: '2003-01-01T00:00:00Z', dateTo: '2026-08-31T00:00:00Z',
		orientations: { portrait: 300, landscape: 700, square: 65 }, originalBytes: 8_000_000_000,
		originalSizeAssets: 1065, favorites: 20, rated: 10, withLocation: 500, cameras: 12,
		recognizedFaces: 1500,
		recognizedPeople: [{ id: 'person-one', name: 'Person One', appearances: 200 }],
		contributors: [{ id: 'owner', name: 'Family member', role: 'owner' }]
	}
};

describe('Presentation editor', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === '/api/immich/albums?connection=camera') return new Response(JSON.stringify([
				{ id: 'album-one', name: 'Family', assetCount: 1065, thumbAssetId: 'cover-one', connectionId: 'camera' },
				{ id: 'album-two', name: 'Trips', assetCount: 88, thumbAssetId: 'cover-two', connectionId: 'camera' }
			]), { status: 200 });
			if (url === '/api/immich/people?connection=camera') return new Response(JSON.stringify([
				{ id: 'person-one', name: 'Person One', connectionId: 'camera' },
				{ id: 'person-two', name: 'Person Two', connectionId: 'camera' }
			]), { status: 200 });
			if (url === '/api/displays/living-room/instant-background?status=1') return new Response(JSON.stringify({ state: 'missing' }), { status: 200 });
			if (url === '/api/control/clients') return new Response('[]', { status: 200 });
			if (url === '/api/displays/living-room/cache' && !init?.method) return new Response(JSON.stringify(cachePlan), { status: 200 });
			if (url === '/api/displays/living-room' && init?.method === 'PUT') return new Response(String(init.body), { status: 200 });
			if (url.startsWith('/api/geocode?q=')) return new Response(JSON.stringify([
				{ name: 'Täby, Stockholm County, Sweden', shortName: 'Täby', lat: 59.4439, lon: 18.0687 }
			]), { status: 200 });
			return new Response('{}', { status: 404 });
		});
		vi.stubGlobal('fetch', fetchMock);
		vi.stubGlobal('confirm', vi.fn(() => true));
		Object.defineProperty(navigator, 'geolocation', {
			configurable: true,
			value: { getCurrentPosition: vi.fn() }
		});
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	function savedProfiles() {
		return fetchMock.mock.calls
			.filter(([url, init]) => url === '/api/displays/living-room' && init?.method === 'PUT')
			.map(([, init]) => JSON.parse(String(init?.body)));
	}

	it('renders every editor tab, major mode, and only the four supported CEC colour shortcuts', async () => {
		render(PresentationPage, { data: pageData() });
		for (const name of ['Photos', 'Playback', 'Instant', 'Frame', 'Information', 'Services']) {
			expect(screen.getByRole('link', { name })).toBeTruthy();
			expect(screen.getByRole('heading', { name, level: 2 })).toBeTruthy();
		}
		for (const option of ['Adaptive', 'Portrait + 2 wide', 'One photo', 'Mosaic', 'Moving wall', 'Instant table']) {
			expect(screen.getByRole('radio', { name: option })).toBeTruthy();
		}
		expect(screen.getByRole('heading', { name: 'Instant studio' })).toBeTruthy();
		expect(document.querySelectorAll('.remote-shortcuts.colors select')).toHaveLength(4);
		expect(screen.queryByText('Magic Remote number shortcuts')).toBeNull();
		expect(await screen.findByRole('button', { name: /Trips/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: /Person One/ })).toBeTruthy();
	});

	it('autosaves playback, frame, overlay, and color-shortcut changes', async () => {
		render(PresentationPage, { data: pageData() });
		await fireEvent.click(screen.getByRole('radio', { name: 'Instant table' }));
		await waitFor(() => expect(savedProfiles().at(-1)?.slideshow.layout).toBe('instant'), { timeout: 2000 });

		await fireEvent.input(screen.getByLabelText(/Edge margin/), { target: { value: '40' } });
		await waitFor(() => expect(savedProfiles().at(-1)?.slideshow.frameInsetPx).toBe(40), { timeout: 2000 });

		await fireEvent.click(screen.getByText('Weather'));
		await waitFor(() => expect(savedProfiles().at(-1)?.overlays.weather.enabled).toBe(true), { timeout: 2000 });

		const redShortcut = document.querySelector('.remote-shortcuts.colors select') as HTMLSelectElement;
		redShortcut.value = 'play-pause';
		await fireEvent.change(redShortcut);
		await waitFor(() => expect(savedProfiles().at(-1)?.colorShortcuts[0]).toBe('play-pause'), { timeout: 2000 });
	});

	it('adds an intentionally allowed album and preserves the existing one', async () => {
		render(PresentationPage, { data: pageData() });
		await fireEvent.click(await screen.findByRole('button', { name: /Trips/ }));
		await waitFor(() => {
			const sources = savedProfiles().at(-1)?.sources;
			expect(sources).toEqual([
				{ type: 'album', albumId: 'album-one', name: 'Family', connectionId: 'camera' },
				{ type: 'album', albumId: 'album-two', name: 'Trips', connectionId: 'camera' }
			]);
		}, { timeout: 2000 });
	});

	it('searches precise towns and saves the selected weather location', async () => {
		render(PresentationPage, { data: pageData() });
		await fireEvent.click(screen.getByText('Weather'));
		const search = screen.getByPlaceholderText(/Täby, Sweden/);
		await fireEvent.input(search, { target: { value: 'Täby, Sweden' } });
		await fireEvent.submit(search.closest('form')!);
		await fireEvent.click(await screen.findByRole('button', { name: /Täby, Stockholm County/ }));
		await waitFor(() => expect(savedProfiles().at(-1)?.overlays.weather.cities).toEqual([
			{ id: expect.any(String), name: 'Täby', lat: 59.4439, lon: 18.0687 }
		]), { timeout: 2000 });
	});

	it('adds every service widget type and autosaves each configuration', async () => {
		render(PresentationPage, { data: pageData() });
		for (const name of ['+ Message', '+ Quote', '+ Trivia', '+ School meals', '+ SL departures']) {
			await fireEvent.click(screen.getByRole('button', { name }));
		}
		await waitFor(() => expect(savedProfiles().at(-1)?.overlays.widgets.map((widget: { type: string }) => widget.type)).toEqual([
			'message', 'quote', 'trivia', 'school-meals', 'sl-departures'
		]), { timeout: 2000 });
		expect(screen.getByText('Skolmaten school slug')).toBeTruthy();
		expect(screen.getByText('SL site IDs')).toBeTruthy();
	});
});
