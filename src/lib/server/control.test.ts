import { describe, expect, it } from 'vitest';
import { broadcastCommand, listSessions, registerClient, registerPassiveClient, sendCommand, unregisterClient, updateClientState } from './control';

describe('embedded player presence', () => {
	it('keeps a state-reporting browser visible without pretending commands were delivered', () => {
		const session = registerPassiveClient({
			clientId: 'ha-dashboard-test', slug: 'default', userAgent: 'Home Assistant',
			platform: 'Linux', screen: '1920x1080', dpr: 1, touch: true
		});
		expect(updateClientState('ha-dashboard-test', 'default', {
			paused: false, blackout: false,
			slide: { id: 'photo-1', takenAt: null, location: null },
			slides: [{ id: 'photo-1', ratio: 1.5 }],
			startedAt: Date.now(), endsAt: Date.now() + 30_000,
			durationMs: 30_000, remainingMs: 30_000
		})).toBe(true);
		expect(listSessions().find((item) => item.clientId === 'ha-dashboard-test')?.state.slide?.id).toBe('photo-1');
		expect(sendCommand('ha-dashboard-test', { type: 'next' })).toBe(false);
		unregisterClient(session);
	});
});

describe('live player messages and diagnostics', () => {
	it('targets connected players and keeps reported display capabilities', () => {
		const received: unknown[] = [];
		const session = registerClient({
			clientId: 'message-player-test', slug: 'living-room', userAgent: 'Chromium',
			push: (message) => received.push(message), close: () => {}
		});
		updateClientState('message-player-test', 'living-room', session.state, {
			viewport: '3840x2160', refreshHz: 60, hardwareConcurrency: 4
		});
		expect(broadcastCommand({ type: 'message', text: 'Dinner', messageMode: 'popup', durationSec: 7 })).toBe(1);
		expect(received).toContainEqual(expect.objectContaining({ type: 'message', text: 'Dinner' }));
		expect(listSessions().find((item) => item.clientId === 'message-player-test')?.diagnostics.refreshHz).toBe(60);
		unregisterClient(session);
	});
});
