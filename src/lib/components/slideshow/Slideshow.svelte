<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { isOffHours } from '#lib/off-hours.js';
	import { createClientId } from '#lib/client-id.js';
	import type { ClientCommand } from '#lib/server/control.js';
	import type { DisplayProfile, FaceInfo, MotionStyle, PlaylistResponse, InstantSettings, RemoteShortcutAction, SlideAsset, VisualEffect } from '#lib/types.js';
	import Overlays from '#lib/components/overlays/Overlays.svelte';
	import Controls from './Controls.svelte';
	import Slide from './Slide.svelte';
	import MapStage from './MapStage.svelte';
	import type { PhotoPlace } from '#lib/map/geo.js';
	import type { MapSettings } from '#lib/types.js';

	let { profile }: { profile: DisplayProfile } = $props();

	const slug = $derived(profile.slug);
	const fadeMs = $derived(profile.slideshow.transitionDurationMs);
	const imageSize = $derived(profile.slideshow.imageSize);
	let runtimeImageFit = $state<'contain' | 'cover' | null>(null);
	const imageFit = $derived(runtimeImageFit ?? profile.slideshow.imageFit);

	/** One rendered unit: a single slide or a side-by-side portrait pair. */
	interface Unit {
		key: number;
		slide: SlideAsset;
		pair: SlideAsset | null;
		gallery: SlideAsset[];
		transition: 'none' | 'crossfade' | 'kenburns' | 'slide' | 'zoom' | 'wipe' | 'card' | 'reveal';
		instantTransition: Exclude<InstantSettings['transition'], 'random'>;
		layout: 'single' | 'adaptive' | 'portrait-stack' | 'mosaic' | 'filmstrip' | 'instant' | 'map';
		mixedPortraitSide: 'left' | 'right';
		visualEffect: Exclude<VisualEffect, 'random'>;
		motionStyle: Exclude<MotionStyle, 'random'>;
		kbFrom: string;
		kbTo: string;
		kbOrigin: string;
		faces: FaceInfo[];
		facesBySlide: FaceInfo[][];
		focus: FaceInfo | null;
		cropFocus: FaceInfo | null;
	}

	let stack = $state<Unit[]>([]);
	const currentSlide = $derived(stack.length ? stack[stack.length - 1].slide : null);
	const currentGallery = $derived(stack.length ? stack[stack.length - 1].gallery : []);
	let paused = $state(false);
	// A pause must never look like a frozen frame: the banner names the state and,
	// unless the profile says "never", the player resumes on its own.
	let pausedAt = $state(0);
	let pauseClock = $state(0);
	const pauseResumeMs = $derived(Math.max(0, profile.slideshow.pauseResumeMin ?? 5) * 60_000);
	const pauseResumeInMin = $derived(
		paused && pauseResumeMs > 0 ? Math.max(1, Math.ceil((pausedAt + pauseResumeMs - pauseClock) / 60_000)) : 0
	);
	let manualBlackout = $state(false);
	let controlsVisible = $state(false);
	let idleCursor = $state(false);
	let screenOff = $state(false);
	let failed = $state<string | null>(null);
	let identifyVisible = $state(false);
	let infoVisible = $state(false);
	let runtimeHideText = $state(false);
	let runtimeVisualEffect = $state<Unit['visualEffect'] | null>(null);
	let runtimeMotionStyle = $state<Unit['motionStyle'] | null>(null);
	let runtimeLayout = $state<Unit['layout'] | null>(null);
	let mapPlaces = $state<PhotoPlace[]>([]);
	/** Temporary World map tweaks from the coloured remote buttons. */
	let runtimeMap = $state<Partial<MapSettings> | null>(null);
	const mapSettings = $derived<MapSettings>({ ...profile.slideshow.map, ...(runtimeMap ?? {}) });

	let runtimeInstantSettings = $state<InstantSettings | null>(null);
	let instantCaptionsVisible = $state(true);
	let runtimeRandom = $state(false);
	// Map layout: the engine's interval covers the whole stop (fly out, world, fly in, hold).
	const mapMode = $derived((runtimeLayout ?? profile.slideshow.layout) === 'map' && !runtimeRandom);
	const intervalMs = $derived(
		mapMode
			? Math.round((mapSettings.holdSec + mapSettings.flightSec * 2 + mapSettings.worldDwellSec + 1.5) * 1000)
			: profile.slideshow.intervalSec * 1000
	);
	let runtimeHiddenOverlays = $state(new Set<'clock' | 'calendar' | 'weather'>());
	let instantMemories = $state<SlideAsset[]>([]);
	let lastShownGallery = $state<SlideAsset[]>([]);
	let instantBackgroundResting = $state(false);
	let runtimePerson = $state<{ id: string; name: string; connectionId?: string } | null>(null);
	let transientMessage = $state<{ text: string; mode: 'popup' | 'ticker'; position: 'top' | 'bottom'; speedSec: number } | null>(null);
	let refreshHz = $state<number | null>(null);
	let remoteMenuVisible = $state(false);
	let remoteMenuIndex = $state(0);
	const effectiveInstantSettings = $derived.by((): InstantSettings => {
		const settings = runtimeInstantSettings ?? profile.slideshow.instant;
		return instantCaptionsVisible ? settings : {
			...settings,
			showDateTime: false,
			showLocation: false,
			showCamera: false,
			showRating: false,
			showPeople: false,
			showAge: false
		};
	});
	const instantMode = $derived(stack[stack.length - 1]?.layout === 'instant');
	const shortcutNames: Record<RemoteShortcutAction, string> = {
		none: 'No action', next: 'Next photo', previous: 'Previous photo',
		'play-pause': 'Play / pause', 'toggle-clock': 'Clock', 'toggle-calendar': 'Calendar',
		'toggle-weather': 'Weather', 'toggle-text': 'All text', 'photo-info': 'Photo information',
		'cycle-layout': 'Next layout', 'cycle-motion': 'Next motion', 'cycle-color': 'Next colour',
		'random-everything': 'Random everything', 'toggle-random': 'Random / saved', restore: 'Saved setup'
	};
	const nextLayoutName = $derived.by(() => {
		const saved = profile.slideshow.layout === 'random' ? LAYOUT_CYCLE[0] : profile.slideshow.layout;
		let index = (LAYOUT_CYCLE.indexOf(runtimeLayout ?? saved) + 1) % LAYOUT_CYCLE.length;
		if (LAYOUT_CYCLE[index] === 'map' && mapPlaces.length === 0) index = (index + 1) % LAYOUT_CYCLE.length;
		return LAYOUT_NAMES[LAYOUT_CYCLE[index]];
	});
	const colorShortcutLegend = $derived(mapMode
		? [
			`Mode · ${nextLayoutName}`,
			`Photo · ${mapSettings.photoStyle === 'card' ? 'floating card' : mapSettings.photoStyle}`,
			`View · ${mapSettings.view}`,
			`Place card · ${mapSettings.trivia === 'off' ? 'off' : mapSettings.triviaDetail}`
		]
		: instantMode
		? [
			`Mode · ${nextLayoutName}`,
			`Background · ${effectiveInstantSettings.background === 'collage' ? 'live memories' : effectiveInstantSettings.background === 'collage-saved' ? 'saved 4K memories' : effectiveInstantSettings.background === 'original' ? 'no material' : effectiveInstantSettings.background}`,
			`Cards · ${effectiveInstantSettings.cardCount}`,
			instantCaptionsVisible ? 'Hide captions' : 'Show captions'
		]
		: [`Mode · ${nextLayoutName}`, ...profile.colorShortcuts.slice(1).map((action) => shortcutNames[action])]);
	type RemoteAction = 'prev' | 'next' | 'pause' | 'text' | 'info' | 'fit' | 'motion' | 'colour' | 'clock' | 'calendar' | 'weather' | 'random' | 'restore' | 'person' | 'clear-person' | 'close';
	const remoteMenuItems = $derived.by(() => {
		const items: Array<{ label: string; action: RemoteAction; person?: { id: string; name: string; connectionId?: string } }> = [
			{ label: 'Previous', action: 'prev' },
			{ label: 'Next', action: 'next' },
			{ label: paused ? 'Resume' : 'Pause', action: 'pause' },
			{ label: runtimeHideText ? 'Show text' : 'Hide all text', action: 'text' },
			{ label: infoVisible ? 'Hide photo info' : 'Photo info', action: 'info' },
			{ label: imageFit === 'contain' ? 'Fill screen' : 'Whole photo', action: 'fit' },
			{ label: runtimeMotionStyle === 'off' ? 'Restore motion' : 'Still photos', action: 'motion' },
			{ label: runtimeVisualEffect === 'monochrome' ? 'Natural colour' : 'Black & white', action: 'colour' },
			{ label: runtimeHiddenOverlays.has('clock') ? 'Show clock' : 'Hide clock', action: 'clock' },
			{ label: runtimeHiddenOverlays.has('calendar') ? 'Show calendar' : 'Hide calendar', action: 'calendar' },
			{ label: runtimeHiddenOverlays.has('weather') ? 'Show weather' : 'Hide weather', action: 'weather' },
			{ label: runtimeRandom ? 'Random mode active' : 'Random everything', action: 'random' },
			{ label: 'Restore saved setup', action: 'restore' }
		];
		if (runtimePerson) items.push({ label: `All photos (not only ${runtimePerson.name})`, action: 'clear-person' });
		else {
			const seen = new Set<string>();
			for (const slide of currentGallery) for (const person of slide.people ?? []) {
				if (!person.name || seen.has(person.id)) continue;
				seen.add(person.id);
				items.push({ label: `Only ${person.name}`, action: 'person', person: { id: person.id, name: person.name, connectionId: slide.connectionId } });
			}
		}
		items.push({ label: 'Close', action: 'close' });
		return items;
	});

	let nextKey = 0;
	let queue: SlideAsset[] = [];
	let pos = 0;
	let cursor: string | null = null;
	let fetching = false;
	let playlistTotal = 0;
	const playbackSignature = $derived(
		JSON.stringify([
			profile.id,
			profile.sources,
			profile.filters,
			profile.slideshow.order,
			profile.slideshow.portraitMode,
			profile.slideshow.layout
		])
	);
	const focusPersonId = $derived(
		profile.slideshow.focusMode === 'person'
			? profile.sources.find((source) => source.type === 'person')?.personId ?? null
			: null
	);

	// History of shown units for prev/next navigation.
	let history: Unit[] = [];
	let histIndex = -1;
	let navigationChain: Promise<void> = Promise.resolve();

	let timer: ReturnType<typeof setTimeout> | undefined;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let identifyTimer: ReturnType<typeof setTimeout> | undefined;
	let messageTimer: ReturnType<typeof setTimeout> | undefined;
	let remoteMenuTimer: ReturnType<typeof setTimeout> | undefined;
	let offHoursTimer: ReturnType<typeof setInterval> | undefined;
	let updateTimer: ReturnType<typeof setInterval> | undefined;
	let stateTimer: ReturnType<typeof setInterval> | undefined;
	let backgroundRestTimer: ReturnType<typeof setTimeout> | undefined;
	let backgroundResumeTimer: ReturnType<typeof setTimeout> | undefined;
	let mapPrefetchTimer: ReturnType<typeof setTimeout> | undefined;
	let pauseResumeTimer: ReturnType<typeof setTimeout> | undefined;
	let pauseTicker: ReturnType<typeof setInterval> | undefined;
	let pendingNavigations = 0;
	let consecutiveLoadFailures = 0;
	let wakeLock: { release: () => Promise<void> } | null = null;
	let destroyed = false;
	const priorityShownIds = new Set<string>();
	let unitStartedAt = 0;
	let unitEndsAt = 0;
	let remainingMs = 0;

	// --- remote control (settings previews don't register as controllable clients) ---
	const isPreview = page.url.searchParams.has('preview');
	let eventSource: EventSource | null = null;
	let clientId = '';

	function getClientId(): string {
		let id = localStorage.getItem('mantel-client-id');
		if (!id) {
			id = createClientId();
			localStorage.setItem('mantel-client-id', id);
		}
		return id;
	}

	function reportState(): void {
		if (isPreview || !clientId) return;
		const unit = stack.length ? stack[stack.length - 1] : null;
		const s = unit?.slide ?? null;
		const remaining = paused ? remainingMs : Math.max(0, unitEndsAt - Date.now());
		void fetch('/api/control/state', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				clientId,
				slug,
				client: {
					platform: navigator.platform || '',
					screen: `${screen.width}x${screen.height}`,
					dpr: devicePixelRatio || 1,
					touch: navigator.maxTouchPoints > 0,
					diagnostics: clientDiagnostics()
				},
				state: {
					paused,
					blackout: manualBlackout,
					slide: s ? { id: s.id, connectionId: s.connectionId, takenAt: s.takenAt, location: s.location } : null,
					slides: (unit?.gallery ?? []).map((image) => ({ id: image.id, connectionId: image.connectionId, ratio: image.ratio })),
					startedAt: unit ? unitStartedAt : null,
					endsAt: unit && !paused ? unitEndsAt : null,
					durationMs: intervalMs,
					remainingMs: remaining
				}
			})
		}).catch(() => {});
	}

	function handleCommand(cmd: ClientCommand): void {
		switch (cmd.type) {
			case 'toggle':
				togglePause();
				break;
			case 'pause':
				if (!paused) togglePause();
				break;
			case 'resume':
				if (paused) togglePause();
				break;
			case 'next':
				next();
				break;
			case 'prev':
				prev();
				break;
			case 'switch':
				// Full reload keeps the frame simple and state-free across profiles.
				if (cmd.slug && cmd.slug !== slug) location.href = `/display/${cmd.slug}`;
				break;
			case 'identify':
				identifyVisible = true;
				clearTimeout(identifyTimer);
				identifyTimer = setTimeout(() => (identifyVisible = false), 4000);
				break;
			case 'refresh':
				location.reload();
				break;
			case 'blackout':
				manualBlackout = true;
				clearTimeout(timer);
				reportState();
				break;
			case 'wake':
				manualBlackout = false;
				schedule();
				reportState();
				break;
			case 'reset':
				localStorage.removeItem(playbackKey());
				location.reload();
				break;
			case 'message':
				if (!cmd.text) break;
				transientMessage = {
					text: cmd.text,
					mode: cmd.messageMode === 'ticker' ? 'ticker' : 'popup',
					position: cmd.position === 'top' ? 'top' : 'bottom',
					speedSec: Math.max(3, cmd.speedSec ?? 10)
				};
				clearTimeout(messageTimer);
				messageTimer = setTimeout(() => (transientMessage = null), Math.max(5, cmd.durationSec ?? 7) * 1000);
				break;
		}
	}

	function clientDiagnostics() {
		type MemoryPerformance = Performance & { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } };
		type MemoryNavigator = Navigator & { deviceMemory?: number };
		const memory = (performance as MemoryPerformance).memory;
		return {
			viewport: `${innerWidth}x${innerHeight}`,
			refreshHz,
			hardwareConcurrency: navigator.hardwareConcurrency || null,
			deviceMemoryGb: (navigator as MemoryNavigator).deviceMemory ?? null,
			usedHeapBytes: memory?.usedJSHeapSize ?? null,
			heapLimitBytes: memory?.jsHeapSizeLimit ?? null
		};
	}

	function estimateRefreshRate(): void {
		const samples: number[] = [];
		let previous = performance.now();
		const sample = (now: number) => {
			const delta = now - previous;
			previous = now;
			if (delta > 0 && delta < 100) samples.push(delta);
			if (samples.length < 45) requestAnimationFrame(sample);
			else {
				const sorted = samples.slice().sort((a, b) => a - b);
				const median = sorted[Math.floor(sorted.length / 2)];
				refreshHz = median ? Math.round(1000 / median) : null;
				reportState();
			}
		};
		requestAnimationFrame(sample);
	}

	function connectControl(): void {
		if (isPreview) return;
		clientId = getClientId();
		const params = new URLSearchParams({
			client: clientId,
			slug,
			platform: navigator.platform || '',
			screen: `${screen.width}x${screen.height}`,
			dpr: String(devicePixelRatio || 1),
			touch: navigator.maxTouchPoints > 0 ? '1' : '0'
		});
		eventSource = new EventSource(`/api/control/stream?${params}`);
		eventSource.onmessage = (e) => {
			const msg = JSON.parse(e.data) as ClientCommand | { type: 'ping' | 'hello' };
			if (msg.type === 'hello') reportState();
			else if (msg.type !== 'ping') handleCommand(msg as ClientCommand);
		};
		// EventSource auto-reconnects on drop; nothing else to do.
	}

	const imageUrl = (s: SlideAsset) => {
		const params = new URLSearchParams({ size: imageSize });
		if (s.connectionId) params.set('connection', s.connectionId);
		return `/api/image/${s.id}?${params}`;
	};
	const playbackKey = () => `mantel-playback:${profile.id}`;

	function savePlayback(): void {
		if (isPreview) return;
		try {
			localStorage.setItem(
				playbackKey(),
				JSON.stringify({ signature: playbackSignature, queue: queue.slice(pos), cursor })
			);
		} catch {
			// Storage can be unavailable in locked-down kiosk browsers; playback still works in memory.
		}
	}

	function restorePlayback(): void {
		if (isPreview) return;
		try {
			const raw = localStorage.getItem(playbackKey());
			if (!raw) return;
			const saved = JSON.parse(raw) as {
				signature?: string;
				queue?: SlideAsset[];
				cursor?: string | null;
			};
			if (saved.signature !== playbackSignature || !Array.isArray(saved.queue)) return;
			queue = saved.queue;
			pos = 0;
			cursor = saved.cursor ?? null;
		} catch {
			localStorage.removeItem(playbackKey());
		}
	}

	async function fetchBatch(): Promise<void> {
		if (fetching) return;
		fetching = true;
		try {
			const params = new URLSearchParams({ count: '30' });
			if (innerHeight > innerWidth) params.set('viewport', 'portrait');
			if (cursor) params.set('cursor', cursor);
			if (runtimePerson) {
				params.set('person', runtimePerson.id);
				if (runtimePerson.connectionId) params.set('connection', runtimePerson.connectionId);
			}
			const res = await fetch(`/api/displays/${slug}/playlist?${params}`, { signal: AbortSignal.timeout(45_000) });
			if (!res.ok) throw new Error(`playlist ${res.status}`);
			const data: PlaylistResponse = await res.json();
			queue.push(...data.slides);
			playlistTotal = Math.max(playlistTotal, data.total);
			cursor = data.cursor;
			savePlayback();
			failed = null;
		} catch (e) {
			failed = e instanceof Error ? e.message : String(e);
		} finally {
			fetching = false;
		}
	}

	async function pollUpdates(): Promise<void> {
		try {
			const res = await fetch(`/api/displays/${slug}/updates`, { cache: 'no-store' });
			if (!res.ok) return;
			const update = (await res.json()) as { newSlides?: SlideAsset[] };
			const knownIds = new Set([
				...priorityShownIds,
				...queue.slice(pos).map((slide) => slide.id),
				...stack.flatMap((unit) => unit.gallery.map((slide) => slide.id))
			]);
			const fresh = (update.newSlides ?? []).filter((slide) => !knownIds.has(slide.id));
			if (fresh.length === 0) return;
			// Insert at the playback head. preload() bypasses the slow bulk-cache
			// queue, so a newly added album photo gets screen priority too.
			queue.splice(pos, 0, ...fresh);
			savePlayback();
			if (!paused && !screenOff) {
				clearTimeout(timer);
				timer = setTimeout(next, 100);
			}
		} catch {
			// Immich may be offline; the current local deck remains playable.
		}
	}

	const PRELOAD_TIMEOUT_MS = 30_000;
	const HISTORY_LIMIT = 300;

	/**
	 * Decode ahead of the swap so the transition never shows a half-loaded photo.
	 * Bounded in time: a stalled download must fail this slide, not freeze the
	 * whole navigation chain behind it. decode() can also reject for images the
	 * browser did load (memory pressure on small devices); those still count.
	 */
	function preload(s: SlideAsset): Promise<boolean> {
		return new Promise((resolve) => {
			const img = new Image();
			let settled = false;
			const finish = (ok: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(deadline);
				resolve(ok);
			};
			const deadline = setTimeout(() => {
				img.src = '';
				finish(false);
			}, PRELOAD_TIMEOUT_MS);
			img.onerror = () => finish(false);
			img.src = imageUrl(s);
			// decode() waits for the download itself; a rejection after a completed
			// load still leaves a usable image.
			img.decode().then(() => finish(true), () => finish(img.complete && img.naturalWidth > 0));
		});
	}

	async function loadFaces(s: SlideAsset, needsCrop = false): Promise<FaceInfo[]> {
		const motionNeedsFaces = (runtimeMotionStyle ?? profile.slideshow.motionStyle).startsWith('face-') || runtimeRandom;
		// The map's filled split panel crops the photo, so it needs the face boxes too.
		const mapNeedsFaces = mapMode && mapSettings.photoStyle === 'split';
		const layoutNeedsFaces = needsCrop || profile.slideshow.layout === 'instant' || mapNeedsFaces;
		if (!focusPersonId && !profile.overlays.metadata.showPeople && imageFit !== 'cover' && !motionNeedsFaces && !layoutNeedsFaces) return [];
		try {
			const params = new URLSearchParams();
			if (s.takenAt) params.set('takenAt', s.takenAt);
			if (s.connectionId) params.set('connection', s.connectionId);
			const res = await fetch(`/api/faces/${s.id}?${params}`, { signal: AbortSignal.timeout(15_000) });
			return res.ok ? await res.json() : [];
		} catch {
			return [];
		}
	}

	function groupFaceFocus(faces: FaceInfo[]): FaceInfo | null {
		if (!faces.length) return null;
		const left = Math.min(...faces.map((face) => face.centerX - face.width / 2));
		const right = Math.max(...faces.map((face) => face.centerX + face.width / 2));
		const top = Math.min(...faces.map((face) => face.centerY - face.height / 2));
		const bottom = Math.max(...faces.map((face) => face.centerY + face.height / 2));
		return {
			id: 'face-safe-crop',
			personId: null,
			name: null,
			birthDate: null,
			ageAtPhoto: null,
			centerX: Math.max(0, Math.min(1, (left + right) / 2)),
			centerY: Math.max(0, Math.min(1, (top + bottom) / 2)),
			width: Math.max(0, right - left),
			height: Math.max(0, bottom - top)
		};
	}

	/** Random gentle pan+zoom endpoints for Ken Burns. */
	function kbTransforms(style: Unit['motionStyle'], face: FaceInfo | null): { kbFrom: string; kbTo: string; kbOrigin: string } {
		const kbOrigin = face && style.startsWith('face-')
			? `${(face.centerX * 100).toFixed(2)}% ${(face.centerY * 100).toFixed(2)}%`
			: '50% 50%';
		if (style === 'off' || style === 'face-journey') return { kbFrom: 'scale(1)', kbTo: 'scale(1)', kbOrigin };
		if (style === 'push-in' || style === 'face-push-in') {
			return { kbFrom: 'scale(1)', kbTo: 'scale(1.16)', kbOrigin };
		}
		if (style === 'pull-out' || style === 'face-pull-out') {
			return { kbFrom: 'scale(1.16)', kbTo: 'scale(1)', kbOrigin };
		}
		if (style === 'drift') {
			const dx = (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 1.2);
			const dy = (Math.random() * 2 - 1) * 1.5;
			return {
				kbFrom: `scale(1.06) translate(${(-dx).toFixed(2)}%, ${(-dy).toFixed(2)}%)`,
				kbTo: `scale(1.06) translate(${dx.toFixed(2)}%, ${dy.toFixed(2)}%)`,
				kbOrigin
			};
		}
		const amount = style === 'cinematic' ? 0.045 : style === 'dynamic' ? 0.16 : 0.085;
		const travel = style === 'cinematic' ? 0.8 : style === 'dynamic' ? 3.5 : 1.5;
		const zoomIn = Math.random() < 0.5;
		const scaleA = zoomIn ? 1 : 1 + amount * (0.8 + Math.random() * 0.4);
		const scaleB = zoomIn ? 1 + amount * (0.8 + Math.random() * 0.4) : 1;
		const dx = (Math.random() * 2 - 1) * travel;
		const dy = (Math.random() * 2 - 1) * travel;
		return {
			kbFrom: `scale(${scaleA.toFixed(3)}) translate(0%, 0%)`,
			kbTo: `scale(${scaleB.toFixed(3)}) translate(${dx.toFixed(2)}%, ${dy.toFixed(2)}%)`,
			kbOrigin
		};
	}

	function pickLayout(): Unit['layout'] {
		if (runtimeLayout) return runtimeLayout;
		if (!runtimeRandom && profile.slideshow.layout !== 'random') return profile.slideshow.layout;
		const choices: Exclude<Unit['layout'], 'map'>[] = ['single', 'adaptive', 'portrait-stack', 'mosaic', 'filmstrip', 'instant'];
		return choices[Math.floor(Math.random() * choices.length)];
	}

	function pickVisualEffect(): Unit['visualEffect'] {
		if (runtimeVisualEffect) return runtimeVisualEffect;
		if (!runtimeRandom && profile.slideshow.visualEffect !== 'random') return profile.slideshow.visualEffect;
		const choices: Unit['visualEffect'][] = ['natural', 'warm', 'vivid', 'monochrome', 'negative', 'kodak', 'fuji', 'instant', 'art', 'noir'];
		return choices[Math.floor(Math.random() * choices.length)];
	}

	function pickMotionStyle(): Unit['motionStyle'] {
		if (runtimeMotionStyle) return runtimeMotionStyle;
		if (!runtimeRandom && profile.slideshow.motionStyle !== 'random') return profile.slideshow.motionStyle;
		const choices: Unit['motionStyle'][] = [
			'off', 'gentle', 'cinematic', 'dynamic', 'drift', 'push-in', 'pull-out',
			'face-push-in', 'face-pull-out', 'face-journey'
		];
		return choices[Math.floor(Math.random() * choices.length)];
	}

	function pickTransition(): Unit['transition'] {
		if (!runtimeRandom && profile.slideshow.transition !== 'random') return profile.slideshow.transition;
		const choices: Unit['transition'][] = ['crossfade', 'kenburns', 'slide', 'zoom', 'wipe', 'card', 'reveal'];
		return choices[Math.floor(Math.random() * choices.length)];
	}

	function pickInstantTransition(): Unit['instantTransition'] {
		if (!runtimeRandom && effectiveInstantSettings.transition !== 'random') return effectiveInstantSettings.transition;
		const choices: Unit['instantTransition'][] = ['fade', 'deal', 'develop', 'drop'];
		return choices[Math.floor(Math.random() * choices.length)];
	}

	function pickInstantVisualEffect(): Unit['visualEffect'] {
		if (runtimeVisualEffect) return runtimeVisualEffect;
		const selected = effectiveInstantSettings.visualEffect;
		if (!runtimeRandom && selected !== 'random') return selected;
		const choices: Unit['visualEffect'][] = ['natural', 'warm', 'vivid', 'monochrome', 'negative', 'kodak', 'fuji', 'instant', 'art', 'noir'];
		return choices[Math.floor(Math.random() * choices.length)];
	}

	/** Pull one composition from the queue. Every consumed asset advances the deck once. */
	async function buildNextUnit(): Promise<Unit | null> {
		if (runtimeRandom) runtimeImageFit = Math.random() < 0.5 ? 'contain' : 'cover';
		if (pos > 300) {
			// Drop the consumed prefix: a kiosk runs for months and history keeps its own copies.
			queue.splice(0, pos);
			pos = 0;
		}
		if (queue.length - pos < 10) void fetchBatch();

		while (pos < queue.length) {
			const s = queue[pos++];
			const unitLayout = focusPersonId && !runtimeRandom ? 'single' : pickLayout();
			// The map can only fly somewhere: photos without coordinates are skipped.
			if (unitLayout === 'map' && (typeof s.lat !== 'number' || typeof s.lon !== 'number')) continue;
			const motionStyle = pickMotionStyle();
			let pair: SlideAsset | null = null;
			let gallery: SlideAsset[] = [s];
			const portraitViewport = innerHeight > innerWidth;
			if (!focusPersonId && unitLayout === 'portrait-stack' && !portraitViewport) {
				const take = (predicate: (candidate: SlideAsset) => boolean): SlideAsset | null => {
					const index = queue.findIndex((candidate, candidateIndex) => candidateIndex >= pos && predicate(candidate));
					return index >= pos ? queue.splice(index, 1)[0] : null;
				};
				if (s.ratio < 0.95) {
					const firstLandscape = take((candidate) => candidate.ratio > 1.05);
					const secondLandscape = take((candidate) => candidate.ratio > 1.05);
					if (firstLandscape && secondLandscape) gallery = [s, firstLandscape, secondLandscape];
					else {
						if (firstLandscape) queue.splice(pos, 0, firstLandscape);
						if (secondLandscape) queue.splice(pos, 0, secondLandscape);
					}
				} else if (s.ratio > 1.05) {
					const portrait = take((candidate) => candidate.ratio < 0.95);
					const secondLandscape = take((candidate) => candidate.ratio > 1.05);
					if (portrait && secondLandscape) gallery = [portrait, s, secondLandscape];
					else {
						if (portrait) queue.splice(pos, 0, portrait);
						if (secondLandscape) queue.splice(pos, 0, secondLandscape);
					}
				}
			} else if (!focusPersonId && unitLayout === 'adaptive' && portraitViewport && s.ratio > 1.05) {
				// On a portrait phone, pair landscape photos vertically. Portrait photos
				// already fit the viewport and should remain single.
				const partnerIndex = queue.findIndex((candidate, index) => index >= pos && candidate.ratio > 1.05);
				if (partnerIndex >= pos) {
					pair = queue[partnerIndex];
					queue.splice(partnerIndex, 1);
					gallery.push(pair);
				}
			} else if (!focusPersonId && unitLayout === 'adaptive' && s.pairWithNext && pos < queue.length) {
				pair = queue[pos++];
				gallery.push(pair);
			} else if (!focusPersonId && (unitLayout === 'mosaic' || unitLayout === 'filmstrip')) {
				const target = unitLayout === 'mosaic' ? 6 : 5;
				while (gallery.length < target && pos < queue.length) gallery.push(queue[pos++]);
			} else if (!focusPersonId && unitLayout === 'instant') {
				const target = Math.max(1, Math.min(5, effectiveInstantSettings.cardCount));
				while (gallery.length < target && pos < queue.length) gallery.push(queue[pos++]);
			}
			savePlayback();
			const [loads, loadedFaces] = await Promise.all([
				Promise.all(gallery.map(preload)),
				Promise.all(gallery.map((image) => loadFaces(image, unitLayout === 'instant')))
			]);
			if (!loads[0]) {
				// Several broken photos in a row means the library is unreachable, not
				// that the photos are bad. Stop here so the retry loop paces itself
				// instead of racing through the whole deck while Immich is down.
				if (++consecutiveLoadFailures >= 5) return null;
				continue;
			}
			consecutiveLoadFailures = 0;
			const facesBySlide = loadedFaces.filter((_, index) => loads[index]);
			gallery = gallery.filter((_, index) => loads[index]);
			if (pair && !loads[1]) pair = null;
			const faces = facesBySlide[0] ?? [];
			const focus = focusPersonId
				? faces.find((face) => face.personId === focusPersonId) ?? null
				: null;
			const groupFocus = groupFaceFocus(faces);
			const cropFocus = imageFit === 'cover' ? groupFocus : null;
			return {
				key: nextKey++,
				slide: s,
				pair,
				gallery,
				faces,
				facesBySlide,
				focus,
				cropFocus,
				transition: unitLayout === 'instant' ? 'none' : pickTransition(),
				instantTransition: unitLayout === 'instant' ? pickInstantTransition() : 'none',
				layout: unitLayout,
				mixedPortraitSide: profile.slideshow.mixedPortraitSide === 'alternate'
					? nextKey % 2 === 0 ? 'left' : 'right'
					: profile.slideshow.mixedPortraitSide,
				visualEffect: unitLayout === 'instant' ? pickInstantVisualEffect() : pickVisualEffect(),
				motionStyle,
				...kbTransforms(motionStyle, groupFocus)
			};
		}
		return null;
	}

	function show(unit: Unit): void {
		for (const image of unit.gallery) priorityShownIds.add(image.id);
		const remembered = new Set(instantMemories.map((image) => `${image.connectionId ?? 'default'}:${image.id}`));
		const additions = lastShownGallery.filter((image) => !remembered.has(`${image.connectionId ?? 'default'}:${image.id}`));
		if (additions.length) instantMemories = [...instantMemories, ...additions].slice(-100);
		lastShownGallery = unit.gallery;
		stack = [...stack, unit].slice(-2);
		unitStartedAt = Date.now();
		remainingMs = intervalMs;
		unitEndsAt = unitStartedAt + remainingMs;
		reportState();
		scheduleMapLookahead();
	}

	/**
	 * Give the active stop first use of network/disk, then prepare only the next
	 * two distinct GPS stops from the actual deck. This follows every playback
	 * order (random, chronological, restored queue) without warming the gallery.
	 */
	function scheduleMapLookahead(): void {
		clearTimeout(mapPrefetchTimer);
		if (!mapMode) return;
		mapPrefetchTimer = setTimeout(() => {
			if (destroyed || !mapMode) return;
			const seen = new Set<string>();
			const places: Array<{ lat: number; lon: number; name: string }> = [];
			for (const candidate of queue.slice(pos)) {
				if (typeof candidate.lat !== 'number' || typeof candidate.lon !== 'number') continue;
				const key = `${candidate.lat.toFixed(3)}:${candidate.lon.toFixed(3)}`;
				if (seen.has(key)) continue;
				seen.add(key);
				places.push({ lat: candidate.lat, lon: candidate.lon, name: candidate.location ?? '' });
				if (places.length === 2) break;
			}
			if (!places.length) return;
			void fetch(`/api/displays/${slug}/map-prefetch`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ places }),
				signal: AbortSignal.timeout(5000)
			}).catch(() => {});
		}, 2500);
	}

	async function advance(): Promise<void> {
		if (destroyed || screenOff) return;

		// Resume forward through history first (after "prev" navigation).
		if (histIndex < history.length - 1) {
			histIndex++;
			show(history[histIndex]);
			schedule();
			return;
		}

		const unit = await buildNextUnit();
		if (unit) {
			// A remote never steps back more than a few hundred photos, and a kiosk
			// runs for months: keep history bounded regardless of deck size.
			history = [...history, unit].slice(-HISTORY_LIMIT);
			histIndex = history.length - 1;
			show(unit);
			schedule();
			return;
		}

		// Queue exhausted, or the library stopped serving photos: retry shortly.
		const outage = consecutiveLoadFailures >= 5;
		consecutiveLoadFailures = 0;
		await fetchBatch();
		clearTimeout(timer);
		timer = setTimeout(next, queue.length > pos && !outage ? 100 : 5000);
	}

	function schedule(): void {
		clearTimeout(timer);
		if (!paused && !document.hidden && !screenOff) {
			unitEndsAt = Date.now() + remainingMs;
			timer = setTimeout(next, remainingMs);
		}
	}

	function enqueueNavigation(action: () => void | Promise<void>): void {
		pendingNavigations++;
		navigationChain = navigationChain
			.then(async () => {
				if (destroyed) return;
				clearTimeout(timer);
				await action();
			})
			.catch((error) => {
				failed = error instanceof Error ? error.message : String(error);
				// An unexpected error must not end the show: try again shortly.
				clearTimeout(timer);
				if (!destroyed) timer = setTimeout(next, 5000);
			})
			.finally(() => {
				pendingNavigations--;
			});
	}

	/**
	 * Safety net for the timer chain. Whatever wedged it (a lost timer after a
	 * visibility glitch, a promise that never settled), the frame should never
	 * sit on one photo for longer than a couple of intervals while playing.
	 */
	function watchdog(): void {
		if (destroyed || paused || screenOff || manualBlackout || document.hidden || stack.length === 0) return;
		if (pendingNavigations > 0 && Date.now() - unitEndsAt < 120_000) return;
		if (Date.now() - unitEndsAt < Math.max(15_000, intervalMs)) return;
		if (pendingNavigations > 0) {
			// The chain has been stuck for two minutes: abandon it and start a fresh one.
			navigationChain = Promise.resolve();
			pendingNavigations = 0;
		}
		unitEndsAt = Date.now(); // pace repeat firings to one per interval
		next();
	}

	function next(): void {
		enqueueNavigation(advance);
	}

	function prev(): void {
		enqueueNavigation(() => {
			if (histIndex <= 0) return;
			histIndex--;
			show({ ...history[histIndex], key: nextKey++ });
			schedule();
		});
	}

	function togglePause(): void {
		if (!paused) {
			remainingMs = Math.max(0, unitEndsAt - Date.now());
			paused = true;
			pausedAt = Date.now();
			pauseClock = pausedAt;
			clearTimeout(timer);
			clearInterval(pauseTicker);
			pauseTicker = setInterval(() => (pauseClock = Date.now()), 10_000);
			clearTimeout(pauseResumeTimer);
			if (pauseResumeMs > 0) {
				pauseResumeTimer = setTimeout(() => {
					if (paused) togglePause();
				}, pauseResumeMs);
			}
		} else {
			paused = false;
			clearInterval(pauseTicker);
			clearTimeout(pauseResumeTimer);
			schedule();
		}
		reportState();
	}

	async function setRuntimePerson(person: { id: string; name: string; connectionId?: string } | null): Promise<void> {
		runtimePerson = person;
		queue = [];
		pos = 0;
		cursor = null;
		history = [];
		histIndex = -1;
		stack = [];
		localStorage.removeItem(playbackKey());
		await fetchBatch();
		next();
	}

	function restoreSavedSetup(): void {
		runtimeRandom = false;
		runtimeHideText = false;
		runtimeVisualEffect = null;
		runtimeMotionStyle = null;
		runtimeLayout = null;
		runtimeMap = null;
		runtimeInstantSettings = null;
		instantCaptionsVisible = true;
		runtimeImageFit = null;
		infoVisible = false;
		runtimeHiddenOverlays = new Set();
		if (runtimePerson) void setRuntimePerson(null);
		else next();
	}

	function toggleRuntimeOverlay(name: 'clock' | 'calendar' | 'weather'): void {
		const nextHidden = new Set(runtimeHiddenOverlays);
		if (nextHidden.has(name)) nextHidden.delete(name);
		else nextHidden.add(name);
		runtimeHiddenOverlays = nextHidden;
	}

	const LAYOUT_CYCLE: Unit['layout'][] = ['single', 'adaptive', 'portrait-stack', 'mosaic', 'filmstrip', 'instant', 'map'];
	const LAYOUT_NAMES: Record<Unit['layout'], string> = {
		single: 'One photo', adaptive: 'Adaptive', 'portrait-stack': 'Portrait + 2 wide',
		mosaic: 'Mosaic', filmstrip: 'Moving wall', instant: 'Instant table', map: 'World map'
	};

	/** The red button always moves to the next presentation mode, whatever mode is running. */
	function cycleLayout(): void {
		const saved = profile.slideshow.layout === 'random' ? LAYOUT_CYCLE[0] : profile.slideshow.layout;
		const current = runtimeLayout ?? saved;
		runtimeRandom = false;
		let index = (LAYOUT_CYCLE.indexOf(current) + 1) % LAYOUT_CYCLE.length;
		// The map can only run when the library has located photos.
		if (LAYOUT_CYCLE[index] === 'map' && mapPlaces.length === 0) index = (index + 1) % LAYOUT_CYCLE.length;
		runtimeLayout = LAYOUT_CYCLE[index];
		runtimeMap = null;
		next();
	}

	function cycleMotion(): void {
		const choices: Unit['motionStyle'][] = [
			'off', 'gentle', 'cinematic', 'dynamic', 'drift', 'push-in', 'pull-out',
			'face-push-in', 'face-pull-out', 'face-journey'
		];
		const saved = profile.slideshow.motionStyle === 'random' ? choices[0] : profile.slideshow.motionStyle;
		const current = runtimeMotionStyle ?? saved;
		runtimeRandom = false;
		runtimeMotionStyle = choices[(choices.indexOf(current) + 1) % choices.length];
		next();
	}

	function cycleColor(): void {
		const choices: Unit['visualEffect'][] = ['natural', 'warm', 'vivid', 'monochrome', 'negative', 'kodak', 'fuji', 'instant', 'art', 'noir'];
		const saved = profile.slideshow.visualEffect === 'random' ? choices[0] : profile.slideshow.visualEffect;
		const current = runtimeVisualEffect ?? saved;
		runtimeRandom = false;
		runtimeVisualEffect = choices[(choices.indexOf(current) + 1) % choices.length];
		next();
	}

	function toggleRandomEverything(): void {
		if (runtimeRandom) {
			restoreSavedSetup();
			return;
		}
		runtimeRandom = true;
		runtimeLayout = null;
		runtimeVisualEffect = null;
		runtimeMotionStyle = null;
		if (runtimePerson) void setRuntimePerson(null);
		else next();
	}

	/** Green, yellow and blue while the World map is running. */
	function runMapShortcut(index: number): void {
		const map = { ...mapSettings };
		switch (index) {
			case 1: {
				const styles: MapSettings['photoStyle'][] = ['card', 'split', 'fullscreen'];
				map.photoStyle = styles[(styles.indexOf(map.photoStyle) + 1) % styles.length];
				runtimeMap = map;
				break;
			}
			case 2:
				map.view = map.view === 'globe' ? 'flat' : 'globe';
				runtimeMap = map;
				next();
				break;
			case 3: {
				const detail: Array<[MapSettings['trivia'], MapSettings['triviaDetail']]> = [['facts', 'full'], ['facts', 'short'], ['off', 'short']];
				const current = detail.findIndex(([trivia, level]) => trivia === map.trivia && level === map.triviaDetail);
				const [trivia, level] = detail[(current + 1) % detail.length];
				map.trivia = trivia;
				map.triviaDetail = level;
				runtimeMap = map;
				break;
			}
		}
		poke();
	}

	function runInstantShortcut(index: number): void {
		const settings = { ...effectiveInstantSettings };
		switch (index) {
			case 1: {
				const choices: InstantSettings['background'][] = [
					'original', 'leather', 'cork', 'walnut', 'linen', 'felt', 'slate', 'metal',
					'red-velvet', 'bronze', 'travertine', 'marble', 'onyx', 'metal-mesh', 'indigo-plaster', 'terrazzo',
					'collage', 'collage-saved'
				];
				settings.background = choices[(choices.indexOf(settings.background) + 1) % choices.length];
				runtimeInstantSettings = settings;
				break;
			}
			case 2:
				settings.cardCount = settings.cardCount >= 5 ? 1 : settings.cardCount + 1;
				runtimeInstantSettings = settings;
				next();
				break;
			case 3:
				instantCaptionsVisible = !instantCaptionsVisible;
				break;
		}
		poke();
	}

	function runRemoteShortcut(action: RemoteShortcutAction): void {
		switch (action) {
			case 'next': next(); break;
			case 'previous': prev(); break;
			case 'play-pause': togglePause(); break;
			case 'toggle-clock': toggleRuntimeOverlay('clock'); break;
			case 'toggle-calendar': toggleRuntimeOverlay('calendar'); break;
			case 'toggle-weather': toggleRuntimeOverlay('weather'); break;
			case 'toggle-text': runtimeHideText = !runtimeHideText; break;
			case 'photo-info': infoVisible = !infoVisible; break;
			case 'cycle-layout': cycleLayout(); break;
			case 'cycle-motion': cycleMotion(); break;
			case 'cycle-color': cycleColor(); break;
			case 'random-everything':
				runtimeRandom = true;
				runtimeVisualEffect = null;
				runtimeMotionStyle = null;
				if (runtimePerson) void setRuntimePerson(null);
				else next();
				break;
			case 'toggle-random': toggleRandomEverything(); break;
			case 'restore': restoreSavedSetup(); break;
		}
		poke();
	}

	function runRemoteMenuAction(): void {
		const item = remoteMenuItems[remoteMenuIndex];
		if (!item) return;
		switch (item.action) {
			case 'prev':
				prev();
				break;
			case 'next':
				next();
				break;
			case 'pause':
				togglePause();
				break;
			case 'text':
				runtimeHideText = !runtimeHideText;
				break;
			case 'info':
				infoVisible = !infoVisible;
				break;
			case 'fit':
				runtimeImageFit = imageFit === 'contain' ? 'cover' : 'contain';
				break;
			case 'motion':
				runtimeMotionStyle = runtimeMotionStyle === 'off' ? null : 'off';
				next();
				break;
			case 'colour':
				runtimeVisualEffect = runtimeVisualEffect === 'monochrome' ? null : 'monochrome';
				next();
				break;
			case 'clock':
				toggleRuntimeOverlay('clock');
				break;
			case 'calendar':
				toggleRuntimeOverlay('calendar');
				break;
			case 'weather':
				toggleRuntimeOverlay('weather');
				break;
			case 'random':
				runtimeRandom = true;
				runtimeVisualEffect = null;
				runtimeMotionStyle = null;
				if (runtimePerson) void setRuntimePerson(null);
				else next();
				break;
			case 'restore':
				restoreSavedSetup();
				break;
			case 'person':
				if (item.person) void setRuntimePerson(item.person);
				break;
			case 'clear-person':
				void setRuntimePerson(null);
				break;
		}
		remoteMenuVisible = false;
		clearTimeout(remoteMenuTimer);
	}

	function poke(): void {
		controlsVisible = true;
		idleCursor = false;
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			controlsVisible = false;
			idleCursor = true;
		}, 4000);
		if (remoteMenuVisible) {
			clearTimeout(remoteMenuTimer);
			remoteMenuTimer = setTimeout(() => {
				remoteMenuVisible = false;
				controlsVisible = false;
			}, 8000);
		}
	}

	// Covers desktop/TV keyboards and HDMI-CEC remotes after the Pi's native
	// CEC bridge translates their commands into regular browser key events.
	function onKeydown(e: KeyboardEvent): void {
		const colorIndex = ({ F13: 0, F14: 1, F15: 2, F16: 3 } as Record<string, number>)[e.key];
		if (colorIndex !== undefined) {
			e.preventDefault();
			// Red always moves to the next presentation mode, so no mode can trap the remote.
			if (colorIndex === 0) {
				cycleLayout();
				poke();
			} else if (instantMode) runInstantShortcut(colorIndex);
			else if (mapMode) runMapShortcut(colorIndex);
			else runRemoteShortcut(profile.colorShortcuts[colorIndex] ?? 'none');
			return;
		}
		switch (e.key) {
			case ' ':
			case 'Enter':
				e.preventDefault();
				if (remoteMenuVisible) runRemoteMenuAction();
				else togglePause();
				poke();
				break;
			case 'MediaPlayPause':
				e.preventDefault();
				togglePause();
				poke();
				break;
			case 'ArrowRight':
				if (remoteMenuVisible) {
					e.preventDefault();
					remoteMenuIndex = (remoteMenuIndex + 1) % remoteMenuItems.length;
					poke();
					break;
				}
			case 'MediaTrackNext':
			case 'MediaFastForward':
				next();
				poke();
				break;
			case 'ArrowLeft':
				if (remoteMenuVisible) {
					e.preventDefault();
					remoteMenuIndex = (remoteMenuIndex - 1 + remoteMenuItems.length) % remoteMenuItems.length;
					poke();
					break;
				}
			case 'MediaTrackPrevious':
			case 'MediaRewind':
				prev();
				poke();
				break;
			case 'MediaPlay':
				if (paused) togglePause();
				break;
			case 'MediaPause':
			case 'MediaStop':
				if (!paused) togglePause();
				break;
			case 'ArrowUp':
				// Deliberately harmless: an Up press right after the TV wakes once
				// paused a frame for a day. Pausing is OK / Play-Pause only.
				e.preventDefault();
				poke();
				break;
			case 'ArrowDown':
				e.preventDefault();
				remoteMenuIndex = Math.min(remoteMenuIndex, remoteMenuItems.length - 1);
				remoteMenuVisible = true;
				poke();
				break;
			case 'ContextMenu':
				poke();
				break;
			case 'Escape':
			case 'Back':
			case 'GoBack':
			case 'BrowserBack':
				if (remoteMenuVisible) {
					remoteMenuVisible = false;
					clearTimeout(remoteMenuTimer);
					break;
				}
				// Hide chrome immediately (the "back" button on most remotes).
				clearTimeout(idleTimer);
				controlsVisible = false;
				idleCursor = true;
				break;
		}
	}

	function onVisibilityChange(): void {
		if (document.hidden) clearTimeout(timer);
		else {
			schedule();
			void acquireWakeLock();
		}
	}

	async function acquireWakeLock(): Promise<void> {
		try {
			wakeLock = await navigator.wakeLock?.request('screen');
		} catch {
			// Not supported or denied — fine, the device's own settings rule.
		}
	}

	function checkOffHours(): void {
		const off = isOffHours(new Date(), profile.offHours);
		if (off === screenOff) return;
		screenOff = off;
		if (off) clearTimeout(timer);
		else next();
	}

	function scheduleInstantBackgroundRest(): void {
		clearTimeout(backgroundRestTimer);
		clearTimeout(backgroundResumeTimer);
		instantBackgroundResting = false;
		const settings = profile.slideshow.instant;
		if (!settings.backgroundRestEnabled) return;
		backgroundRestTimer = setTimeout(() => {
			instantBackgroundResting = true;
			backgroundResumeTimer = setTimeout(() => {
				instantBackgroundResting = false;
				scheduleInstantBackgroundRest();
			}, settings.backgroundRestSeconds * 1000);
		}, settings.backgroundRestMinutes * 60_000);
	}

	async function loadMapPlaces(): Promise<void> {
		if (profile.slideshow.layout !== 'map') return;
		try {
			const res = await fetch(`/api/displays/${slug}/places`, { signal: AbortSignal.timeout(60_000) });
			if (res.ok) mapPlaces = ((await res.json()) as { places: PhotoPlace[] }).places;
		} catch {
			// Markers are decoration; the flights work without them.
		}
	}

	onMount(() => {
		estimateRefreshRate();
		void loadMapPlaces();
		void (async () => {
			restorePlayback();
			if (queue.length === 0) await fetchBatch();
			checkOffHours();
			if (!screenOff) next();
		})();
		void acquireWakeLock();
		connectControl();
		offHoursTimer = setInterval(checkOffHours, 30_000);
		stateTimer = setInterval(() => {
			watchdog();
			reportState();
		}, 20_000);
		updateTimer = setInterval(() => void pollUpdates(), 5 * 60_000);
		scheduleInstantBackgroundRest();
		document.addEventListener('visibilitychange', onVisibilityChange);
		return () => {
			destroyed = true;
			clearTimeout(timer);
			clearTimeout(idleTimer);
			clearTimeout(identifyTimer);
			clearTimeout(messageTimer);
			clearTimeout(remoteMenuTimer);
			clearInterval(offHoursTimer);
			clearInterval(updateTimer);
			clearInterval(stateTimer);
			clearTimeout(backgroundRestTimer);
			clearTimeout(backgroundResumeTimer);
			clearTimeout(mapPrefetchTimer);
			clearTimeout(pauseResumeTimer);
			clearInterval(pauseTicker);
			eventSource?.close();
			document.removeEventListener('visibilitychange', onVisibilityChange);
			void wakeLock?.release().catch(() => {});
		};
	});
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="stage"
	class:idle={idleCursor}
	style="--fade-ms: {fadeMs}ms; --frame-inset: {profile.slideshow.frameInsetPx}px; --frame-radius: {profile.slideshow.cornerRadiusPx}px; --outer-frame: {profile.slideshow.frameStyle === 'none' ? 0 : profile.slideshow.frameWidthPx}px; --mat-width: {profile.slideshow.matWidthPx}px; --mat-color: {profile.slideshow.matColor}; --frame-border: {profile.slideshow.borderWidthPx}px; --frame-border-color: {profile.slideshow.borderColor}; --frame-bg: {profile.slideshow.backgroundColor}"
	onpointermove={poke}
	onpointerdown={poke}
	role="presentation"
>
	{#if mapMode}
		<MapStage
			slide={currentSlide}
			unitKey={stack[stack.length - 1]?.key ?? -1}
			settings={mapSettings}
			{slug}
			places={mapPlaces}
			faces={stack[stack.length - 1]?.faces ?? []}
			{paused}
			{imageUrl}
		/>
	{:else}
	{#each stack as unit (unit.key)}
		<div
			class="layer"
			class:frame-white={profile.slideshow.frameStyle === 'white'}
			class:frame-black={profile.slideshow.frameStyle === 'black'}
			class:frame-walnut={profile.slideshow.frameStyle === 'walnut'}
			class:frame-aluminium={profile.slideshow.frameStyle === 'aluminium'}
			class:no-transition={unit.transition === 'none'}
			class:transition-slide={unit.transition === 'slide'}
			class:transition-zoom={unit.transition === 'zoom'}
			class:transition-wipe={unit.transition === 'wipe'}
			class:transition-card={unit.transition === 'card'}
			class:transition-reveal={unit.transition === 'reveal'}
		>
			<div class="mat"><div class="photo-window"><Slide
				slide={unit.slide}
				pair={unit.pair}
				gallery={unit.gallery}
				layout={unit.layout === 'map' ? 'single' : unit.layout}
				mixedPortraitSide={unit.mixedPortraitSide}
				photoGapPx={profile.slideshow.photoGapPx}
				visualEffect={unit.visualEffect}
				{imageSize}
				{imageFit}
				kenburns={unit.motionStyle !== 'off' && unit.motionStyle !== 'face-journey'}
				motionStyle={unit.motionStyle}
				faces={unit.faces}
				facesBySlide={unit.facesBySlide}
				instantSeed={unit.key}
				instantSettings={effectiveInstantSettings}
				instantTransition={unit.instantTransition}
				{instantMemories}
				instantBackgroundUrl={`/api/displays/${encodeURIComponent(slug)}/instant-background`}
				suppressInstantBackground={instantBackgroundResting}
				kbFrom={unit.kbFrom}
				kbTo={unit.kbTo}
				kbOrigin={unit.kbOrigin}
				kbDurationMs={intervalMs + fadeMs * 2}
				{paused}
				focus={unit.focus}
				cropFocus={unit.cropFocus}
				faceZoom={profile.slideshow.faceZoom}
			/></div></div>
		</div>
	{/each}
	{/if}

	{#if stack.length === 0}
		{#if profile.sources.length > 0}
			<div class="status">
			{#if failed}
				<p>Can't reach the photo library</p>
				<p class="detail">{failed}</p>
			{:else}
				<p class="loading">Loading photos…</p>
			{/if}
			</div>
		{/if}
	{/if}

	{#if profile.slideshow.progressBar !== 'off' && currentSlide && !screenOff && !runtimeHideText}
		{#key stack[stack.length - 1]?.key}
			<div
				class="progress"
				class:top={profile.slideshow.progressBar === 'top'}
				class:paused
				style="--interval-ms: {intervalMs}ms"
			>
				<span></span>
			</div>
		{/key}
	{/if}

	{#if paused && !screenOff && !manualBlackout && !controlsVisible}
		<div class="paused-badge" role="status">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 5h3v14h-3zm6 0h3v14h-3z" fill="currentColor"/></svg>
			<span>Paused{#if pauseResumeInMin > 0} · resumes in {pauseResumeInMin} min{/if}</span>
		</div>
	{/if}

	{#if !screenOff && !runtimeHideText && stack[stack.length - 1]?.layout !== 'instant' && !(mapMode && !mapSettings.showOverlays)}
		<Overlays
			{profile}
			{currentSlide}
			slides={currentGallery}
			faces={stack[stack.length - 1]?.faces ?? []}
			facesBySlide={stack[stack.length - 1]?.facesBySlide ?? []}
			hidePhotoMetadata={false}
			hiddenOverlays={runtimeHiddenOverlays}
		/>
	{/if}

	{#if screenOff || manualBlackout}
		<div class="blackout"></div>
	{/if}

	{#if identifyVisible}
		<div class="identify">
			<span class="identify-name">{profile.name}</span>
			<span class="identify-slug">/display/{slug}</span>
		</div>
	{/if}

	{#if infoVisible && currentSlide && !screenOff && !manualBlackout && !runtimeHideText}
		<div class="remote-info">
			<strong>Photo information</strong>
			{#if currentSlide.takenAt}<span>{new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(currentSlide.takenAt))}</span>{/if}
			{#if currentSlide.location}<span>{currentSlide.location}</span>{/if}
			{#if currentSlide.camera}<span>{currentSlide.camera}</span>{/if}
			<span>{imageFit === 'contain' ? 'Whole photo' : 'Fill screen · face-aware crop'}</span>
		</div>
	{/if}

	{#if remoteMenuVisible && !screenOff && !manualBlackout}
		<div class="remote-menu" aria-label="TV remote commands">
			{#each remoteMenuItems as item, index}
				<div class:active={index === remoteMenuIndex}>{item.label}</div>
			{/each}
		</div>
	{/if}

	{#if remoteMenuVisible && !screenOff && !manualBlackout}
		<div class="shortcut-guide" aria-label="Magic Remote color button shortcuts">
			<strong>{instantMode ? 'Instant controls' : 'Colour button controls'}</strong>
			<div>
				{#each colorShortcutLegend as label, index}
					<span><i class="remote-dot dot-{index}"></i>{label}</span>
				{/each}
			</div>
		</div>
	{/if}

	{#if transientMessage && !screenOff && !manualBlackout}
		{#if transientMessage.mode === 'popup'}
			<div class="broadcast-popup" role="status">{transientMessage.text}</div>
		{:else}
			<div class="broadcast-ticker" class:top={transientMessage.position === 'top'} style={`--message-speed: ${transientMessage.speedSec}s`} role="status">
				<span>{transientMessage.text}</span>
			</div>
		{/if}
	{/if}

	<Controls
		name={profile.name}
		{paused}
		visible={controlsVisible && !screenOff && !manualBlackout}
		onprev={prev}
		onnext={next}
		ontoggle={togglePause}
	/>
</div>

<style>
	.stage {
		position: fixed;
		inset: 0;
		background: var(--frame-bg);
		overflow: hidden;
		cursor: none;
	}

	.stage.idle {
		cursor: none;
	}

	.stage :global(*) {
		cursor: none !important;
	}

	.layer {
		position: absolute;
		inset: var(--frame-inset);
		border-radius: calc(var(--frame-radius) + var(--outer-frame) + var(--mat-width));
		overflow: hidden;
		animation: fade-in var(--fade-ms) ease both;
		background: transparent;
		will-change: transform, opacity;
		backface-visibility: hidden;
	}

	.layer.frame-white { background: linear-gradient(135deg, #fff, #dedede 52%, #fafafa); box-shadow: inset 0 0 0 1px rgba(0,0,0,.14), 0 0.5rem 2rem rgba(0,0,0,.3); }
	.layer.frame-black { background: linear-gradient(135deg, #292929, #050505 55%, #222); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12), 0 0.5rem 2rem rgba(0,0,0,.45); }
	.layer.frame-walnut { background: #59321e url('/textures/frame-walnut.webp') center / 38rem auto; box-shadow: inset 0 0 0 1px rgba(255,255,255,.16), inset 0 0 1rem rgba(0,0,0,.42), 0 0.5rem 2rem rgba(0,0,0,.42); }
	.layer.frame-aluminium { background: #c8cbcd url('/textures/frame-aluminium.webp') center / 34rem auto; box-shadow: inset 0 0 0 1px rgba(255,255,255,.7), inset 0 0 0.8rem rgba(0,0,0,.25), 0 0.5rem 2rem rgba(0,0,0,.3); }
	.mat { position: absolute; inset: var(--outer-frame); background: var(--mat-color); }
	.photo-window { position: absolute; inset: var(--mat-width); overflow: hidden; border: var(--frame-border) solid var(--frame-border-color); border-radius: var(--frame-radius); background: var(--frame-bg); }

	.layer.no-transition {
		animation: none;
	}

	.layer.transition-slide { animation-name: glide-in; }
	.layer.transition-zoom { animation-name: zoom-in; }
	.layer.transition-wipe { animation-name: wipe-in; }
	.layer.transition-card { animation-name: card-in; transform-origin: 50% 50%; }
	.layer.transition-reveal { animation-name: reveal-in; }

	/* Must read on a dark photo and on a pale Instant table alike, from across
	   the room on a 4K panel: a dark track under a light fill, scaled with the screen. */
	.progress {
		position: absolute;
		z-index: 4;
		left: 0;
		right: 0;
		bottom: 0;
		height: clamp(3px, 0.32vh, 8px);
		background: rgba(0, 0, 0, 0.35);
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
	}

	.progress.top {
		top: 0;
		bottom: auto;
	}

	.progress span {
		display: block;
		width: 100%;
		height: 100%;
		transform-origin: left;
		background: rgba(255, 255, 255, 0.9);
		animation: progress var(--interval-ms) linear both;
	}

	/* Small corner pill: says why the photo is not changing without covering it. */
	.paused-badge {
		position: absolute;
		z-index: 6;
		right: clamp(0.8rem, 1.6vw, 2rem);
		bottom: clamp(0.8rem, 1.6vw, 2rem);
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		padding: 0.4em 0.85em 0.4em 0.6em;
		border: 1px solid rgba(255, 255, 255, 0.22);
		border-radius: 999px;
		background: rgba(5, 5, 5, 0.72);
		color: rgba(255, 255, 255, 0.9);
		font-size: clamp(0.8rem, 0.95vw, 1.15rem);
		font-weight: 650;
		white-space: nowrap;
		animation: fade-in 0.25s ease both;
	}

	.paused-badge svg {
		width: 1.15em;
		height: 1.15em;
	}

	.progress.paused span {
		animation-play-state: paused;
	}

	@keyframes progress {
		from { transform: scaleX(0); }
		to { transform: scaleX(1); }
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes glide-in {
		from { opacity: 0; transform: translate3d(5%, 0, 0); }
		to { opacity: 1; transform: translate3d(0, 0, 0); }
	}

	@keyframes zoom-in {
		from { opacity: 0; transform: scale(1.045); }
		to { opacity: 1; transform: scale(1); }
	}

	@keyframes wipe-in {
		from { clip-path: inset(0 100% 0 0); }
		to { clip-path: inset(0 0 0 0); }
	}

	@keyframes card-in {
		from { opacity: 0; transform: perspective(1600px) rotateY(-8deg) scale(0.94) translate3d(4%, 0, 0); }
		to { opacity: 1; transform: perspective(1600px) rotateY(0) scale(1) translate3d(0, 0, 0); }
	}

	@keyframes reveal-in {
		from { opacity: 0; transform: translate3d(0, 3%, 0) scale(1.025); }
		to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
	}

	@media (prefers-reduced-motion: reduce) {
		.layer { animation: fade-in 0.15s ease both; }
	}

	.blackout {
		position: absolute;
		inset: 0;
		background: #000;
		z-index: 5;
	}

	.identify {
		position: absolute;
		inset: 0;
		z-index: 4;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 0.5rem;
		background: rgba(0, 0, 0, 0.55);
		animation: fade-in 0.25s ease both;
	}

	.identify-name {
		font-size: clamp(2.5rem, 8vw, 6rem);
		font-weight: 700;
		letter-spacing: -0.02em;
		color: #fff;
		text-shadow: var(--overlay-shadow);
	}

	.identify-slug {
		font-size: clamp(1rem, 2.5vw, 1.6rem);
		color: rgba(255, 255, 255, 0.75);
	}

	.remote-info {
		position: absolute;
		z-index: 6;
		top: clamp(1rem, 3vw, 3rem);
		left: clamp(1rem, 3vw, 3rem);
		display: grid;
		gap: 0.3rem;
		max-width: min(34rem, calc(100vw - 2rem));
		padding: 1rem 1.2rem;
		border: 1px solid rgba(255, 255, 255, 0.22);
		border-radius: 0.8rem;
		background: rgba(5, 5, 5, 0.78);
		backdrop-filter: blur(14px);
		color: rgba(255, 255, 255, 0.78);
		font-size: clamp(0.85rem, 1.35vw, 1.15rem);
	}

	.remote-info strong { color: #fff; }

	.shortcut-guide {
		position: absolute;
		z-index: 8;
		top: clamp(1rem, 3vh, 2.5rem);
		left: 50%;
		transform: translateX(-50%);
		display: grid;
		gap: 0.65rem;
		width: max-content;
		max-width: calc(100vw - 2rem);
		padding: clamp(0.75rem, 1.2vw, 1.15rem) clamp(0.9rem, 1.5vw, 1.4rem);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 1rem;
		background: rgba(5, 5, 5, 0.84);
		box-shadow: 0 0.8rem 2.5rem rgba(0, 0, 0, 0.35);
		color: #fff;
		backdrop-filter: blur(16px);
	}
	.shortcut-guide > strong { text-align: center; font-size: clamp(0.78rem, 1vw, 1.1rem); letter-spacing: 0.08em; text-transform: uppercase; }
	.shortcut-guide > div { display: flex; flex-wrap: wrap; justify-content: center; gap: clamp(0.65rem, 1.4vw, 1.5rem); }
	.shortcut-guide span { display: inline-flex; align-items: center; gap: 0.45rem; color: rgba(255,255,255,.82); font-size: clamp(0.85rem, 1.25vw, 1.3rem); font-weight: 700; white-space: nowrap; }
	.remote-dot { width: clamp(0.7rem, 1vw, 1rem); aspect-ratio: 1; border-radius: 50%; box-shadow: 0 0 0 2px rgba(255,255,255,.2); }
	.remote-dot.dot-0 { background: #e33b35; }
	.remote-dot.dot-1 { background: #2ebd59; }
	.remote-dot.dot-2 { background: #efc12b; }
	.remote-dot.dot-3 { background: #3284df; }

	.remote-menu {
		position: absolute;
		z-index: 7;
		left: 50%;
		bottom: clamp(1.5rem, 5vh, 4rem);
		transform: translateX(-50%);
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: clamp(0.45rem, 0.8vw, 0.8rem);
		width: min(92rem, calc(100vw - 3rem));
		max-height: min(38vh, 20rem);
		padding: clamp(0.8rem, 1.5vw, 1.35rem);
		border: 2px solid rgba(255, 255, 255, 0.24);
		border-radius: 1.35rem;
		background: rgba(5, 5, 5, 0.84);
		backdrop-filter: blur(18px);
		box-shadow: 0 1rem 4rem rgba(0, 0, 0, 0.45);
		overflow: auto;
	}

	.remote-menu div {
		padding: clamp(0.9rem, 1.35vw, 1.35rem) clamp(1.1rem, 1.8vw, 1.8rem);
		border-radius: 0.9rem;
		color: rgba(255, 255, 255, 0.6);
		font-size: clamp(1rem, 1.55vw, 1.55rem);
		font-weight: 750;
		white-space: nowrap;
	}

	.remote-menu div.active {
		background: #fff;
		color: #111;
	}

	.broadcast-popup {
		position: absolute;
		z-index: 9;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		max-width: min(80vw, 70rem);
		padding: clamp(1.4rem, 3vw, 3rem) clamp(1.8rem, 4vw, 4rem);
		border: 2px solid rgba(255, 255, 255, 0.28);
		border-radius: 1.4rem;
		background: rgba(0, 0, 0, 0.8);
		color: #fff;
		font-size: clamp(2rem, 5vw, 5rem);
		font-weight: 800;
		line-height: 1.08;
		text-align: center;
		text-shadow: var(--overlay-shadow);
		animation: fade-in 0.2s ease both;
	}

	.broadcast-ticker {
		position: absolute;
		z-index: 9;
		left: 0;
		right: 0;
		bottom: 0;
		overflow: hidden;
		padding: clamp(0.8rem, 1.4vw, 1.4rem) 0;
		background: rgba(0, 0, 0, 0.82);
		color: #fff;
		font-size: clamp(1.4rem, 3vw, 3rem);
		font-weight: 750;
		white-space: nowrap;
	}

	.broadcast-ticker.top { top: 0; bottom: auto; }
	.broadcast-ticker span {
		display: inline-block;
		min-width: 100%;
		padding-left: 100%;
		animation: broadcast-scroll var(--message-speed) linear infinite;
	}

	@keyframes broadcast-scroll {
		to { transform: translateX(-100%); }
	}

	.status {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		text-align: center;
		color: var(--text-dim);
	}

	.status .detail {
		font-size: 0.85rem;
		color: var(--text-faint);
	}

	.loading {
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		50% {
			opacity: 0.4;
		}
	}
</style>
