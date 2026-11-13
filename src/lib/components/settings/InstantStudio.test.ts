// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstantSettings } from '$lib/types';
import InstantStudioHarness from './InstantStudio.test-harness.svelte';

const makeSettings = (): InstantSettings => ({
	arrangement: 'classic', cardCount: 2, cardScalePct: 100, overlapPct: 6, cardGapPx: 24,
	maxAngleDeg: 3, anglePattern: 'outward-v', paperRadiusPx: 20, photoRadiusPx: 18,
	paperSideBorderPct: 10, paperBottomBorderPct: 40, paperFinish: 'glossy',
	visualEffect: 'natural', transition: 'develop', transitionDurationMs: 2200,
	background: 'original', captionFont: 'caveat', captionScalePct: 125,
	backgroundRestEnabled: true, backgroundRestMinutes: 3, backgroundRestSeconds: 10,
	showDateTime: true, showLocation: true, showCamera: false, showRating: false,
	showPeople: false, showAge: false
});

describe('Instant Studio controls', () => {
	let latest: InstantSettings;
	const renderStudio = (initial = makeSettings(), slug = 'living-room') => {
		latest = structuredClone(initial);
		return render(InstantStudioHarness, {
			initial,
			slug,
			onsettings: (settings) => { latest = settings; }
		});
	};

	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'missing' }), {
			status: 200, headers: { 'content-type': 'application/json' }
		})));
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it('renders every customization group with bounded controls', async () => {
		renderStudio();
		expect(screen.getByRole('heading', { name: 'Instant studio' })).toBeTruthy();
		expect(screen.getByRole('group', { name: 'Arrangement' })).toBeTruthy();
		expect(screen.getByRole('group', { name: 'Instant colour and transition' })).toBeTruthy();
		expect(screen.getByRole('group', { name: 'Background material' })).toBeTruthy();
		expect(screen.getByLabelText(/Cards shown/).getAttribute('min')).toBe('1');
		expect(screen.getByLabelText(/Cards shown/).getAttribute('max')).toBe('5');
		expect(screen.getByLabelText(/Card size/).getAttribute('min')).toBe('35');
		expect(screen.getByLabelText(/Card size/).getAttribute('max')).toBe('140');
		expect(screen.getByLabelText(/Caption size/).getAttribute('max')).toBe('300');
		await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/displays/living-room/instant-background?status=1'));
	});

	it('changes arrangement, material, finish, angle and transition controls', async () => {
		renderStudio(makeSettings(), 'family');
		await fireEvent.click(screen.getByRole('button', { name: /Hero stack/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Dark walnut' }));
		let angle = screen.getByLabelText('Angle pattern') as HTMLSelectElement;
		angle.value = 'inward-v';
		await fireEvent.change(angle);
		const finish = screen.getByLabelText('Paper finish') as HTMLSelectElement;
		finish.value = 'matte';
		await fireEvent.change(finish);
		const transition = screen.getByLabelText('Card transition') as HTMLSelectElement;
		transition.value = 'drop';
		await fireEvent.change(transition);
		await waitFor(() => expect(latest).toMatchObject({
			arrangement: 'hero-stack', background: 'walnut', anglePattern: 'inward-v',
			paperFinish: 'matte', transition: 'drop'
		}));
	});

	it('offers and selects every generated 4K material', async () => {
		renderStudio();
		for (const name of [
			'Ruby red velvet', 'Patinated bronze', 'Ivory travertine', 'Calacatta marble',
			'Azuli blue onyx', 'Black metal mesh', 'Midnight indigo', 'Dark terrazzo'
		]) expect(screen.getByRole('button', { name })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Ruby red velvet' }));
		await waitFor(() => expect(latest.background).toBe('red-velvet'));
	});

	it('restores authentic paper without overwriting composition choices', async () => {
		const settings = makeSettings();
		settings.arrangement = 'scattered';
		settings.cardCount = 5;
		settings.cardScalePct = 65;
		settings.maxAngleDeg = 11;
		settings.transition = 'deal';
		settings.visualEffect = 'fuji';
		renderStudio(settings, 'family');
		await fireEvent.click(screen.getByRole('button', { name: 'Restore authentic paper' }));
		await waitFor(() => expect(latest).toMatchObject({
			paperRadiusPx: 6, photoRadiusPx: 3, paperSideBorderPct: 5.38,
			paperBottomBorderPct: 29.33, paperFinish: 'authentic',
			arrangement: 'scattered', cardCount: 5, cardScalePct: 65,
			maxAngleDeg: 11, transition: 'deal', visualEffect: 'fuji'
		}));
	});

	it('requires a review before starting the expensive mosaic build', async () => {
		const fetchMock = vi.mocked(fetch);
		fetchMock
			.mockResolvedValueOnce(new Response(JSON.stringify({ state: 'missing' }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				seed: 7, available: 1065, willUse: 62, cached: 14, missing: 48,
				estimatedAdditionalBytes: 6_500_000
			}), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ status: { state: 'building' } }), { status: 202 }))
			.mockResolvedValue(new Response(JSON.stringify({ state: 'ready', photos: 62, bytes: 3_000_000 }), { status: 200 }));

		renderStudio(makeSettings(), 'family room');
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		await fireEvent.click(screen.getByRole('button', { name: 'Review build' }));
		const build = await screen.findByRole('button', { name: 'Build clean 4K photo mosaic' });
		expect(build).toBeTruthy();
		expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/displays/family%20room/instant-background?plan=1');
		await fireEvent.click(build);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
			'/api/displays/family%20room/instant-background',
			expect.objectContaining({ method: 'POST' })
		));
	});
});
