// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DisplayProfile, SlideAsset } from '#lib/types.js';
import { makeTestProfile } from '#lib/test-profile.test-helper.js';
import Slideshow from './Slideshow.svelte';

vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/display/living-room?preview=1') }
}));

const slides: SlideAsset[] = [
	{
		id: 'portrait-one', connectionId: 'camera', ratio: 0.66, thumbhash: null,
		takenAt: '2029-01-27T14:30:00', location: 'Täby, Sweden', camera: 'Fujifilm X-T5',
		isFavorite: true, rating: 5, pairWithNext: true
	},
	{
		id: 'portrait-two', connectionId: 'camera', ratio: 0.72, thumbhash: null,
		takenAt: '2028-08-12T09:15:00', location: 'Iași, Romania', camera: 'Sony A7 IV',
		isFavorite: false, rating: 4
	},
	{
		id: 'landscape-one', connectionId: 'camera', ratio: 1.5, thumbhash: null,
		takenAt: '2027-03-04T18:05:00', location: 'Long Beach, USA', camera: null,
		isFavorite: false, rating: null
	},
	{
		id: 'landscape-two', connectionId: 'camera', ratio: 1.78, thumbhash: null,
		takenAt: null, location: null, camera: null, isFavorite: false, rating: null
	}
];
let playlistSlides = slides;

const response = (body: unknown) => new Response(JSON.stringify(body), {
	status: 200,
	headers: { 'content-type': 'application/json' }
});

async function renderPlayer(profile: DisplayProfile) {
	const view = render(Slideshow, { profile });
	await waitFor(() => expect(document.querySelector('.layer')).toBeTruthy());
	return view;
}

function currentMainImage(): string | null {
	const layers = document.querySelectorAll('.layer');
	return layers.item(layers.length - 1).querySelector('img.main')?.getAttribute('src') ?? null;
}

describe('Slideshow player rendering and TV remote controls', () => {
	beforeEach(() => {
		playlistSlides = slides;
		Object.defineProperty(window, 'innerWidth', { configurable: true, value: 3840 });
		Object.defineProperty(window, 'innerHeight', { configurable: true, value: 2160 });
		Object.defineProperty(window.screen, 'width', { configurable: true, value: 3840 });
		Object.defineProperty(window.screen, 'height', { configurable: true, value: 2160 });
		Object.defineProperty(HTMLImageElement.prototype, 'decode', {
			configurable: true,
			value: vi.fn(async () => undefined)
		});
		vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
		vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/playlist?')) return response({ slides: playlistSlides, cursor: null, total: playlistSlides.length });
			if (url.includes('/api/faces/')) return response([]);
			return response({});
		}));
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it('pairs two portrait photographs and keeps each image independently rounded', async () => {
		const profile = makeTestProfile();
		profile.slideshow.cornerRadiusPx = 24;
		await renderPlayer(profile);

		const pair = document.querySelector('.pair');
		expect(pair).toBeTruthy();
		const images = pair?.querySelectorAll('img') ?? [];
		expect(images).toHaveLength(2);
		expect(images[0].getAttribute('src')).toContain('/api/image/portrait-one?');
		expect(images[1].getAttribute('src')).toContain('/api/image/portrait-two?');
		expect(document.querySelectorAll('.pair .half')).toHaveLength(2);
	});

	it('stacks two landscape photographs on a portrait mobile player', async () => {
		Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
		Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
		playlistSlides = [slides[2], slides[3], slides[0], slides[1]];
		const profile = makeTestProfile();
		await renderPlayer(profile);

		const pair = document.querySelector('.pair');
		expect(pair).toBeTruthy();
		const images = pair?.querySelectorAll('img') ?? [];
		expect(images).toHaveLength(2);
		expect(images[0].getAttribute('src')).toContain('/api/image/landscape-one?');
		expect(images[1].getAttribute('src')).toContain('/api/image/landscape-two?');
	});

	it('renders authentic two-card Instants at 4K with local handwriting and no corner overlays', async () => {
		const profile = makeTestProfile();
		profile.slideshow.layout = 'instant';
		profile.slideshow.instant.cardCount = 2;
		profile.slideshow.instant.cardScalePct = 100;
		await renderPlayer(profile);

		const table = document.querySelector('.instant-table') as HTMLElement;
		expect(table).toBeTruthy();
		expect(table.style.getPropertyValue('--instant-card-ratio')).toMatch(/^0\.82/);
		expect(table.style.getPropertyValue('--instant-caption-font')).toContain('Mantel Caveat');
		expect(document.querySelectorAll('.instant-card')).toHaveLength(2);
		expect(screen.getByText(/Saturday 27th of January, 2029 at 14:30/)).toBeTruthy();
		expect(screen.getByText(/Täby, Sweden/)).toBeTruthy();
		expect(document.querySelector('.overlays')).toBeNull();
	});

	it('opens a readable Magic Remote menu and never renders object placeholders', async () => {
		const profile = makeTestProfile();
		profile.slideshow.layout = 'instant';
		await renderPlayer(profile);

		await fireEvent.keyDown(window, { key: 'ArrowDown' });
		const menu = screen.getByLabelText('TV remote commands');
		expect(menu.textContent).toContain('Previous');
		expect(menu.textContent).toContain('Restore saved setup');
		expect(menu.textContent).not.toContain('[object Object]');
		const guide = screen.getByLabelText('Magic Remote color button shortcuts');
		expect(guide.textContent).toContain('Instant controls');
		expect(guide.textContent).toContain('Cards · 2');

		await fireEvent.keyDown(window, { key: 'ArrowRight' });
		expect(menu.querySelector('.active')?.textContent).toBe('Next');
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByLabelText('TV remote commands')).toBeNull();
	});

	it('keeps red on mode switching and gives green, yellow and blue to Instant controls', async () => {
		const profile = makeTestProfile();
		profile.slideshow.layout = 'instant';
		await renderPlayer(profile);
		await fireEvent.keyDown(window, { key: 'ArrowDown' });
		const legend = () => screen.getByLabelText('Magic Remote color button shortcuts').textContent ?? '';

		// Red is the universal mode switch, so no mode can trap the remote. The map is
		// skipped here because this library has no located photos.
		expect(legend()).toContain('Mode · One photo');
		await fireEvent.keyDown(window, { key: 'F14' });
		await waitFor(() => expect(legend()).toContain('Background · leather'));
		await fireEvent.keyDown(window, { key: 'F15' });
		expect(legend()).toContain('Cards · 3');
		await fireEvent.keyDown(window, { key: 'F16' });
		expect(legend()).toContain('Show captions');

		// The newest layer leaves Instant behind (the outgoing one lingers for the crossfade).
		await fireEvent.keyDown(window, { key: 'F13' });
		await waitFor(() => {
			const layers = document.querySelectorAll('.layer');
			expect(layers.item(layers.length - 1).querySelector('.instant-table')).toBeNull();
		});
	});

	it('uses OK for play/pause, left/right for history, and keeps Up harmless', async () => {
		const profile = makeTestProfile();
		profile.slideshow.layout = 'single';
		await renderPlayer(profile);
		const first = currentMainImage();

		await fireEvent.keyDown(window, { key: 'ArrowRight' });
		await waitFor(() => expect(currentMainImage()).not.toBe(first));
		const second = currentMainImage();
		await fireEvent.keyDown(window, { key: 'ArrowLeft' });
		await waitFor(() => expect(currentMainImage()).toBe(first));
		await fireEvent.keyDown(window, { key: 'ArrowRight' });
		await waitFor(() => expect(currentMainImage()).toBe(second));
		await fireEvent.keyDown(window, { key: 'ArrowUp' });
		expect(document.querySelector('.inner.paused')).toBeNull();
		expect(document.querySelector('.controls.visible')).toBeTruthy();
		await fireEvent.keyDown(window, { key: 'Enter' });
		expect(document.querySelector('.inner.paused')).toBeTruthy();
	});

	it('shows a small paused badge once the controls hide and resumes by itself after the configured minutes', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
		try {
			const profile = makeTestProfile();
			profile.slideshow.layout = 'single';
			profile.slideshow.pauseResumeMin = 5;
			render(Slideshow, { profile });
			await vi.advanceTimersByTimeAsync(50);
			expect(document.querySelector('.layer')).toBeTruthy();

			await fireEvent.keyDown(window, { key: 'MediaPause' });
			await vi.advanceTimersByTimeAsync(4100); // control bar auto-hides
			const badge = document.querySelector('.paused-badge');
			expect(badge?.textContent).toContain('Paused');
			expect(badge?.textContent).toContain('resumes in 5 min');

			await vi.advanceTimersByTimeAsync(2 * 60_000);
			expect(document.querySelector('.paused-badge')?.textContent).toContain('resumes in 3 min');

			await vi.advanceTimersByTimeAsync(3 * 60_000 + 100);
			expect(document.querySelector('.paused-badge')).toBeNull();
			expect(document.querySelector('.inner.paused')).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps a player paused indefinitely when auto-resume is set to never', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
		try {
			const profile = makeTestProfile();
			profile.slideshow.layout = 'single';
			profile.slideshow.pauseResumeMin = 0;
			render(Slideshow, { profile });
			await vi.advanceTimersByTimeAsync(50);

			await fireEvent.keyDown(window, { key: 'MediaPause' });
			await vi.advanceTimersByTimeAsync(4100);
			expect(document.querySelector('.paused-badge')?.textContent?.trim()).toBe('Paused');
			await vi.advanceTimersByTimeAsync(60 * 60_000);
			expect(document.querySelector('.paused-badge')).toBeTruthy();
			expect(document.querySelector('.inner.paused')).toBeTruthy();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('World map layout', () => {
	const located: SlideAsset[] = [
		{ id: 'iasi', connectionId: 'camera', ratio: 1.5, thumbhash: null, takenAt: '2023-07-14T10:00:00', location: 'Iași, Romania', lat: 47.16, lon: 27.59, camera: null, isFavorite: false, rating: null },
		{ id: 'taby', connectionId: 'camera', ratio: 0.75, thumbhash: null, takenAt: '2024-05-02T16:00:00', location: 'Täby, Sweden', lat: 59.44, lon: 18.07, camera: null, isFavorite: false, rating: null },
		{ id: 'nowhere', connectionId: 'camera', ratio: 1.5, thumbhash: null, takenAt: null, location: null, camera: null, isFavorite: false, rating: null }
	];
	const tinyWorld = { q: 1000, countries: [{ n: 'Romania', c: 'RO', k: 'Europe', r: [[20000, 44000, 10000, 0, 0, 4000, -10000, 0]] }], lakes: [] };
	const tinyPlaces = { rows: [['Iași', 'Romania', 'Iasi', 47.168, 27.575, 325914, 1, 4, 'Europe']] };

	beforeEach(() => {
		Object.defineProperty(window, 'innerWidth', { configurable: true, value: 3840 });
		Object.defineProperty(window, 'innerHeight', { configurable: true, value: 2160 });
		Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn(async () => undefined) });
		vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
		vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/playlist?')) return response({ slides: located, cursor: null, total: located.length });
			if (url.endsWith('/map/world.json')) return response(tinyWorld);
			if (url.endsWith('/map/places.json')) return response(tinyPlaces);
			if (url.includes('/api/places/trivia')) {
				if (url.includes('lat=47.16')) {
					expect(url).toContain('name=Ia');
					return response({ title: 'Iași', subtitle: 'Iasi, Romania', facts: ['Capital of Iasi', '326,000 people', 'Europe'], summary: null, summarySource: null });
				}
				return response({ title: 'Täby', subtitle: 'Stockholm, Sweden', facts: ['Sweden'], summary: null, summarySource: null });
			}
			if (url.includes('/places')) return response({ places: [{ key: 'a', name: 'Iași, Romania', lat: 47.16, lon: 27.59, count: 1 }], located: 2, total: 3 });
			if (url.includes('/api/faces/')) return response([]);
			return response({});
		}));
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('flies to a located photo, shows it as a card with a caption and a trivia card, and skips photos without coordinates', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
		const profile = makeTestProfile();
		profile.slideshow.layout = 'map';
		profile.slideshow.map.photoStyle = 'card';
		profile.slideshow.map.trivia = 'facts';
		profile.slideshow.map.triviaPosition = 'middle-right';
		profile.slideshow.map.triviaWidthPct = 36;
		profile.slideshow.map.triviaMaxHeightPct = 54;
		profile.slideshow.map.triviaUseThemeColors = false;
		profile.slideshow.map.triviaTextColor = '#112233';
		profile.slideshow.map.triviaBackgroundColor = '#445566';
		profile.slideshow.map.triviaAccentColor = '#ff3300';
		render(Slideshow, { profile });
		// Without WebGL (happy-dom) the stage uses still views separated by short fades.
		await vi.advanceTimersByTimeAsync(3000);

		const stage = document.querySelector('.map-stage');
		expect(stage).toBeTruthy();
		expect(document.querySelector('.layer')).toBeNull();
		const photo = document.querySelector('.photo.card.visible');
		expect(photo).toBeTruthy();
		expect(photo?.querySelector('img')?.getAttribute('src')).toContain('/api/image/iasi?');
		expect(photo?.querySelector('.caption')?.textContent).toContain('Iași');
		expect(photo?.querySelector('.caption')?.textContent).toContain('2023');
		const trivia = document.querySelector('.trivia.middle-right');
		expect(trivia?.textContent).toContain('Capital of Iasi');
		expect(trivia?.textContent).toContain('326,000 people');
		expect((stage as HTMLElement).style.getPropertyValue('--trivia-width')).toBe('36vw');
		expect((stage as HTMLElement).style.getPropertyValue('--trivia-max-height')).toBe('54vh');
		expect((stage as HTMLElement).style.getPropertyValue('--trivia-text')).toBe('#112233');
		expect((stage as HTMLElement).style.getPropertyValue('--trivia-bg')).toBe('#445566');
		expect((stage as HTMLElement).style.getPropertyValue('--trivia-accent')).toBe('#ff3300');
		expect(document.querySelector('.pin')).toBeTruthy();
		const lookahead = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith('/map-prefetch'));
		expect(lookahead?.[1]?.method).toBe('POST');
		expect(JSON.parse(String(lookahead?.[1]?.body))).toEqual({
			places: [
				{ lat: 59.44, lon: 18.07, name: 'Täby, Sweden' },
				{ lat: 47.16, lon: 27.59, name: 'Iași, Romania' }
			]
		});

		// Next stop: the fly-out hides the photo, then the next located photo appears. "nowhere" never shows.
		await fireEvent.keyDown(window, { key: 'ArrowRight' });
		await vi.advanceTimersByTimeAsync(4000);
		expect(document.querySelector('.photo.card.visible img')?.getAttribute('src')).toContain('/api/image/taby?');
		await fireEvent.keyDown(window, { key: 'ArrowRight' });
		await vi.advanceTimersByTimeAsync(4000);
		expect(document.querySelector('.photo.card.visible img')?.getAttribute('src')).not.toContain('nowhere');
	});

	it('uses the whole stop time as the slideshow interval and honours the photo style', async () => {
		const profile = makeTestProfile();
		profile.slideshow.layout = 'map';
		profile.slideshow.map.photoStyle = 'fullscreen';
		profile.slideshow.map.showMinimap = true;
		profile.slideshow.map.trivia = 'off';
		render(Slideshow, { profile });
		await waitFor(() => expect(document.querySelector('.photo.fullscreen.visible')).toBeTruthy(), { timeout: 4000 });
		expect(document.querySelector('.minimap')).toBeTruthy();
		expect(document.querySelector('.trivia')).toBeNull();
		expect(document.querySelector('.pin')).toBeNull();
	});

	it('shows split photos immediately, always fills the panel, and never captions the image', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
		const profile = makeTestProfile();
		profile.slideshow.layout = 'map';
		profile.slideshow.map.photoStyle = 'split';
		profile.slideshow.map.splitFill = 'never'; // legacy value must no longer create padding
		profile.slideshow.map.showCaption = true;
		profile.slideshow.map.trivia = 'facts';
		profile.slideshow.map.triviaPosition = 'top-center';
		render(Slideshow, { profile });
		await vi.advanceTimersByTimeAsync(100);

		const first = document.querySelector('.photo.split.fill.visible');
		expect(first).toBeTruthy();
		expect(first?.querySelector('img')?.getAttribute('src')).toContain('/api/image/iasi?');
		expect(first?.querySelector('.caption')).toBeNull();
		const stage = document.querySelector('.map-stage') as HTMLElement;
		expect(stage.style.getPropertyValue('--split-fade')).toBe('10vw');
		expect(stage.style.getPropertyValue('--split-blend')).toBe('20vw');

		await fireEvent.keyDown(window, { key: 'ArrowRight' });
		await vi.advanceTimersByTimeAsync(4000);
		const portrait = document.querySelector('.photo.split.portrait.fill.visible');
		expect(portrait).toBeTruthy();
		expect(portrait?.querySelector('.caption')).toBeNull();
		expect(document.querySelector('.trivia.split.top-center')).toBeTruthy();
	});

	it('keeps a positioned place card bounded on a portrait mobile player', async () => {
		Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 });
		Object.defineProperty(window, 'innerHeight', { configurable: true, value: 852 });
		const profile = makeTestProfile();
		profile.slideshow.layout = 'map';
		profile.slideshow.map.photoStyle = 'fullscreen';
		profile.slideshow.map.trivia = 'facts';
		profile.slideshow.map.triviaPosition = 'bottom-center';
		profile.slideshow.map.triviaWidthPct = 60;
		profile.slideshow.map.triviaMaxHeightPct = 40;
		render(Slideshow, { profile });
		await waitFor(() => expect(document.querySelector('.trivia.fullscreen.bottom-center')).toBeTruthy(), { timeout: 4000 });
		const stage = document.querySelector('.map-stage') as HTMLElement;
		expect(stage.style.getPropertyValue('--trivia-width')).toBe('60vw');
		expect(stage.style.getPropertyValue('--trivia-max-height')).toBe('40vh');
	});
});
