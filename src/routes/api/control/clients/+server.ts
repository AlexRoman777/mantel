import { json } from '@sveltejs/kit';
import { getConfig } from '#lib/server/config.js';
import { listSessions } from '#lib/server/control.js';
import type { RequestHandler } from './$types';

/** Shorten a user-agent string into something a human recognizes on a card. */
function describeDevice(ua: string): string {
	const browser = /firefox/i.test(ua)
		? 'Firefox'
		: /edg/i.test(ua)
			? 'Edge'
			: /chrom/i.test(ua)
				? 'Chromium'
				: /safari/i.test(ua)
					? 'Safari'
					: 'Browser';
	const os = /raspbian|raspberry/i.test(ua)
		? 'Raspberry Pi'
		: /android/i.test(ua)
			? 'Android'
			: /iphone|ipad/i.test(ua)
				? 'iOS'
				: /mac os/i.test(ua)
					? 'macOS'
					: /windows/i.test(ua)
						? 'Windows'
						: /linux/i.test(ua)
							? 'Linux'
							: '';
	return os ? `${browser} · ${os}` : browser;
}

export const GET: RequestHandler = async () => {
	const config = await getConfig();
	const profileNames = new Map(config.displays.map((d) => [d.slug, d.name]));
	const assignmentCounts = Object.values(config.clientProfiles).reduce<Record<string, number>>((counts, slug) => {
		counts[slug] = (counts[slug] ?? 0) + 1;
		return counts;
	}, {});

	return json(
		listSessions()
			.map((s) => ({
				clientId: s.clientId,
				name: config.clientNames[s.clientId] ?? null,
				device: describeDevice(s.userAgent),
				fingerprint: [s.platform, s.screen && `${s.screen}${s.dpr !== 1 ? ` @${s.dpr}x` : ''}`, s.touch ? 'touch' : 'remote/keyboard']
					.filter(Boolean)
					.join(' · '),
				slug: s.slug,
				profileName: profileNames.get(s.slug) ?? s.slug,
				assignmentCount: assignmentCounts[s.slug] ?? 1,
				connectedAt: s.connectedAt,
				lastSeen: s.lastSeen,
				controlAvailable: s.controlAvailable,
				diagnostics: s.diagnostics,
				state: s.state
			}))
			.sort((a, b) => a.connectedAt - b.connectedAt)
	);
};
