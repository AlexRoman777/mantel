import { describe, expect, it } from 'vitest';
import { createClientId } from './client-id';

describe('createClientId', () => {
	it('creates RFC 4122 version 4 identifiers on an HTTP-compatible code path', () => {
		const id = createClientId();
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	});

	it('does not reuse an identifier', () => {
		expect(createClientId()).not.toBe(createClientId());
	});
});
