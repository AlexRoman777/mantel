import { describe, expect, it } from 'vitest';
import { normalizeAlbumIds, normalizeImmichUrl } from './immich-connection';

describe('normalizeImmichUrl', () => {
	it('removes trailing slashes and a pasted API suffix', () => {
		expect(normalizeImmichUrl('http://immich.local:2283/api/')).toBe('http://immich.local:2283');
	});

	it('keeps a reverse-proxy path', () => {
		expect(normalizeImmichUrl('https://photos.example.test/immich/')).toBe(
			'https://photos.example.test/immich'
		);
	});

	it('rejects URLs without an HTTP protocol', () => {
		expect(() => normalizeImmichUrl('immich.local:2283')).toThrow('must use http:// or https://');
	});

	it('rejects embedded credentials', () => {
		expect(() => normalizeImmichUrl('http://user:secret@immich.local')).toThrow(
			'Do not put credentials'
		);
	});
});

describe('normalizeAlbumIds', () => {
	it('accepts UUIDs and full Immich album URLs and removes duplicates', () => {
		expect(normalizeAlbumIds([
			'3dc23322-27fa-4039-9746-f7d3551f8d47',
			'http://immich.local:2283/albums/3dc23322-27fa-4039-9746-f7d3551f8d47'
		])).toEqual(['3dc23322-27fa-4039-9746-f7d3551f8d47']);
	});

	it('accepts newline and comma separated input', () => {
		expect(normalizeAlbumIds('3dc23322-27fa-4039-9746-f7d3551f8d47,\n8aa3d65c-bf92-4c28-83ef-37b9a67f5df7')).toHaveLength(2);
	});

	it('rejects malformed references', () => {
		expect(() => normalizeAlbumIds('not-an-album')).toThrow('Invalid Immich album ID or URL');
	});
});
