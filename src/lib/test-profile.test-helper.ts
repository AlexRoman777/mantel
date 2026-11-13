import type { DisplayProfile } from '$lib/types';

const appearance = () => ({ scale: 1, colorMode: 'light' as const, color: '#ffffff' });

export function makeTestProfile(): DisplayProfile {
	return {
		id: 'profile-test', slug: 'living-room', name: 'Living room',
		sources: [{ type: 'album', albumId: 'album-one', name: 'Family', connectionId: 'camera' }],
		slideshow: {
			intervalSec: 30, pauseResumeMin: 5, transition: 'crossfade', transitionDurationMs: 1500,
			order: 'random', portraitMode: 'pair', layout: 'adaptive', mixedPortraitSide: 'alternate',
			visualEffect: 'natural', motionStyle: 'off', imageSize: 'preview', imageFit: 'contain',
			progressBar: 'off', focusMode: 'photo', faceZoom: 2.2,
			frameInsetPx: 0, photoGapPx: 3, cornerRadiusPx: 0, frameStyle: 'none',
			frameWidthPx: 24, matWidthPx: 0, matColor: '#f3f0e8', borderWidthPx: 0,
			borderColor: '#ffffff', backgroundColor: '#000000',
			instant: {
				arrangement: 'classic', cardCount: 2, cardScalePct: 100, overlapPct: 6,
				cardGapPx: 24, maxAngleDeg: 3, anglePattern: 'outward-v', paperRadiusPx: 6,
				photoRadiusPx: 3, paperSideBorderPct: 5.38, paperBottomBorderPct: 29.33,
				paperFinish: 'authentic', visualEffect: 'natural', transition: 'develop',
				transitionDurationMs: 2200, background: 'original', captionFont: 'caveat',
				captionScalePct: 125, backgroundRestEnabled: true, backgroundRestMinutes: 3,
				backgroundRestSeconds: 10, showDateTime: true, showLocation: true,
				showCamera: false, showRating: false, showPeople: false, showAge: false
			},
			map: {
				view: 'globe', renderer: 'shader', theme: 'midnight', earthTexture: 'none', seasonalTexture: true, imageryDetail: 'blue-marble', osmDetail: false,
				lighting: 'studio', nightLights: false, detailLayers: true,
				holdSec: 15, flightSec: 3, worldDwellSec: 2, zoomKm: 600,
				photoStyle: 'card', splitMapPct: 50, splitFill: 'always', splitBackground: '#000000', splitFade: true, splitFadePct: 10, photoScalePct: 55, photoFrame: 'thin', photoBorderPx: 8, photoBorderColor: '#ffffff',
				photoRadiusPx: 10, photoShadow: true, photoEdge: 'sharp', photoDepth: 'lift', photoPlacement: 'near-pin',
				showMarkers: true, showLabels: true, labelScalePct: 130, labelMinPopulation: 10000, labelMaxCount: 8, showGraticule: false, idleSpin: true, showMinimap: true,
				showCaption: true, showOverlays: true, trivia: 'facts', triviaDetail: 'full', cardScalePct: 120,
				triviaPosition: 'bottom-left', triviaWidthPct: 30, triviaMaxHeightPct: 70, triviaUseThemeColors: true,
				triviaTextColor: '#f4f2ee', triviaBackgroundColor: '#171a22', triviaAccentColor: '#ef725d', triviaBackgroundOpacityPct: 92,
				triviaBorderColor: '#ffffff', triviaBorderWidthPx: 0, triviaRadiusPx: 22, triviaPaddingPx: 22, triviaBlurPx: 14, triviaShadow: true,
				home: { name: 'Täby Park, Täby', lat: 59.4449, lon: 18.0896 }
			}		},
		filters: {
			orientation: 'all', dateFrom: null, dateTo: null, favoritesOnly: false,
			minRating: 0, newestLimit: 0, peopleMatch: 'any'
		},
		overlays: {
			autoHideSec: 30,
			clock: { enabled: true, style: 'digital', showDate: true, showSeconds: false, format24h: true, locale: 'en-GB', position: 'top-right', appearance: appearance() },
			weather: { enabled: false, provider: 'location', haEntityId: 'weather.home', lat: 0, lon: 0, cities: [], units: 'celsius', position: 'top-left', appearance: appearance() },
			calendar: { enabled: false, region: 'SE', showHolidays: true, showNameDays: true, showWeekNumber: false, position: 'top-left', appearance: appearance() },
			ticker: { enabled: false, text: '', speedSec: 35, position: 'bottom', background: false, appearance: appearance() },
			metadata: { enabled: true, showDate: true, showLocation: true, showCamera: false, showRating: false, showPeople: false, showAge: false, showFaceCards: true, position: 'bottom-left', appearance: appearance() },
			widgets: []
		},
		colorShortcuts: ['cycle-layout', 'cycle-motion', 'cycle-color', 'toggle-random']
	};
}
