import { describe, expect, it } from 'vitest';
import { resolveScopedAlbumIds } from './immich';

describe('resolveScopedAlbumIds', () => {
	const allowed = [
		'3dc23322-27fa-4039-9746-f7d3551f8d47',
		'8aa3d65c-bf92-4c28-83ef-37b9a67f5df7'
	];

	it('injects the full allowlist when a query does not name an album', () => {
		expect(resolveScopedAlbumIds(allowed)).toEqual(allowed);
	});

	it('keeps an explicitly requested allowed album', () => {
		expect(resolveScopedAlbumIds(allowed, [allowed[0]])).toEqual([allowed[0]]);
	});

	it('rejects an album outside the connection allowlist', () => {
		expect(() => resolveScopedAlbumIds(allowed, ['11111111-1111-4111-8111-111111111111']))
			.toThrow('not allowed');
	});
});
