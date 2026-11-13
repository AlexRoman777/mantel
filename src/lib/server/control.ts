// In-memory registry of connected display clients. Each open /display page
// holds one SSE connection; commands from the /remote dashboard are pushed
// through it. Single-process (adapter-node), so a plain module-level Map works.

export interface ClientCommand {
	type: 'toggle' | 'pause' | 'resume' | 'next' | 'prev' | 'switch' | 'identify' | 'refresh' | 'reset' | 'blackout' | 'wake' | 'message';
	slug?: string;
	text?: string;
	messageMode?: 'popup' | 'ticker';
	position?: 'top' | 'bottom';
	durationSec?: number;
	speedSec?: number;
}

export interface ClientDiagnostics {
	viewport?: string;
	refreshHz?: number | null;
	hardwareConcurrency?: number | null;
	deviceMemoryGb?: number | null;
	usedHeapBytes?: number | null;
	heapLimitBytes?: number | null;
}

export interface ClientState {
	paused: boolean;
	blackout: boolean;
	slide: { id: string; connectionId?: string; takenAt: string | null; location: string | null } | null;
	/** Every photo currently visible (one, portrait pair, or gallery composition). */
	slides: Array<{ id: string; connectionId?: string; ratio: number }>;
	startedAt: number | null;
	endsAt: number | null;
	durationMs: number;
	remainingMs: number;
}

export interface Session {
	clientId: string;
	slug: string;
	userAgent: string;
	platform: string;
	screen: string;
	dpr: number;
	touch: boolean;
	connectedAt: number;
	lastSeen: number;
	controlAvailable: boolean;
	diagnostics: ClientDiagnostics;
	state: ClientState;
	push: (msg: ClientCommand | { type: 'ping' | 'hello' }) => void;
	close: () => void;
}

const sessions = new Map<string, Session>();

export function registerClient(opts: {
	clientId: string;
	slug: string;
	userAgent: string;
	platform?: string;
	screen?: string;
	dpr?: number;
	touch?: boolean;
	push: Session['push'];
	close: Session['close'];
}): Session {
	// A reconnect (or duplicate tab) replaces the previous connection.
	sessions.get(opts.clientId)?.close();
	const session: Session = {
		...opts,
		platform: opts.platform ?? '',
		screen: opts.screen ?? '',
		dpr: Number.isFinite(opts.dpr) ? Math.max(0.5, Math.min(8, opts.dpr!)) : 1,
		touch: Boolean(opts.touch),
		connectedAt: Date.now(),
		lastSeen: Date.now(),
		controlAvailable: true,
		diagnostics: {},
		state: {
			paused: false,
			blackout: false,
			slide: null,
			slides: [],
			startedAt: null,
			endsAt: null,
			durationMs: 0,
			remainingMs: 0
		}
	};
	sessions.set(opts.clientId, session);
	return session;
}

/** Register a slideshow that can post state but cannot keep an SSE channel open (some embedded HA browsers). */
export function registerPassiveClient(opts: {
	clientId: string;
	slug: string;
	userAgent: string;
	platform?: string;
	screen?: string;
	dpr?: number;
	touch?: boolean;
}): Session {
	const existing = sessions.get(opts.clientId);
	if (existing) return existing;
	const session = registerClient({ ...opts, push: () => {}, close: () => {} });
	session.controlAvailable = false;
	return session;
}

export function touchClient(session: Session): void {
	session.lastSeen = Date.now();
}

export function unregisterClient(session: Session): void {
	// Only remove if this exact connection still owns the slot (a replacement
	// connection must not be evicted by the old one's teardown).
	if (sessions.get(session.clientId) === session) {
		sessions.delete(session.clientId);
	}
}

export function listSessions(): Session[] {
	const staleBefore = Date.now() - 90_000;
	for (const [id, session] of sessions) {
		if (session.lastSeen < staleBefore) sessions.delete(id);
	}
	return [...sessions.values()];
}

export function sendCommand(clientId: string, command: ClientCommand): boolean {
	const session = sessions.get(clientId);
	if (!session?.controlAvailable) return false;
	session.push(command);
	return true;
}

export function broadcastCommand(command: ClientCommand, clientIds?: string[]): number {
	const selected = clientIds?.length ? new Set(clientIds) : null;
	let delivered = 0;
	for (const session of sessions.values()) {
		if (selected && !selected.has(session.clientId)) continue;
		if (!session.controlAvailable) continue;
		session.push(command);
		delivered++;
	}
	return delivered;
}

/** Push a saved profile to every browser currently showing it. */
export function refreshProfile(slug: string): number {
	let delivered = 0;
	for (const session of sessions.values()) {
		if (session.slug !== slug) continue;
		session.push({ type: 'refresh' });
		delivered++;
	}
	return delivered;
}

/** Clear browser playback queues before reloading every client on a profile. */
export function resetProfile(slug: string): number {
	let delivered = 0;
	for (const session of sessions.values()) {
		if (session.slug !== slug) continue;
		session.push({ type: 'reset' });
		delivered++;
	}
	return delivered;
}

export function updateClientState(clientId: string, slug: string, state: ClientState, diagnostics?: ClientDiagnostics): boolean {
	const session = sessions.get(clientId);
	if (!session) return false;
	session.slug = slug;
	session.state = {
		paused: Boolean(state.paused),
		blackout: Boolean(state.blackout),
		slide: state.slide ?? null,
		slides: Array.isArray(state.slides)
			? state.slides.filter((slide) => slide && typeof slide.id === 'string')
			: state.slide
				? [{ id: state.slide.id, ratio: 1 }]
				: [],
		startedAt: typeof state.startedAt === 'number' ? state.startedAt : null,
		endsAt: typeof state.endsAt === 'number' ? state.endsAt : null,
		durationMs: typeof state.durationMs === 'number' ? state.durationMs : 0,
		remainingMs: typeof state.remainingMs === 'number' ? state.remainingMs : 0
	};
	session.lastSeen = Date.now();
	if (diagnostics) session.diagnostics = { ...session.diagnostics, ...diagnostics };
	return true;
}
