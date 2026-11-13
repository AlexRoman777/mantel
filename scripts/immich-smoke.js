// Quick connectivity check against a real Immich instance.
// Usage: npm run smoke   (reads IMMICH_URL / IMMICH_API_KEY from .env)

const base = (process.env.IMMICH_URL ?? '').replace(/\/+$/, '');
const key = process.env.IMMICH_API_KEY ?? '';

if (!base || !key) {
	console.error('Set IMMICH_URL and IMMICH_API_KEY in .env first.');
	process.exit(1);
}

const headers = { 'x-api-key': key, 'Content-Type': 'application/json' };

async function call(label, path, init) {
	const started = Date.now();
	try {
		const res = await fetch(`${base}/api${path}`, { headers, ...init });
		const ms = Date.now() - started;
		if (!res.ok) {
			console.log(`✗ ${label}: HTTP ${res.status} (${ms}ms)`);
			return null;
		}
		const type = res.headers.get('content-type') ?? '';
		const body = type.includes('json') ? await res.json() : await res.arrayBuffer();
		console.log(`✓ ${label} (${ms}ms)`);
		return body;
	} catch (e) {
		console.log(`✗ ${label}: ${e.message}`);
		return null;
	}
}

const ping = await call('ping', '/server/ping');
if (!ping) process.exit(1);

const albums = await call('albums', '/albums');
if (albums) console.log(`  ${albums.length} albums`);

const people = await call('people', '/people?withHidden=false&size=500');
if (people) console.log(`  ${people.total ?? people.people?.length ?? 0} people`);

const today = new Date().toISOString().slice(0, 10);
const memories = await call('memories', `/memories?for=${today}&type=on_this_day`);
if (memories) console.log(`  ${memories.length} memories today`);

const random = await call('search/random', '/search/random', {
	method: 'POST',
	body: JSON.stringify({ type: 'IMAGE', withExif: true, size: 3 })
});
if (random?.length) {
	console.log(`  ${random.length} random assets`);
	const thumb = await call('asset thumbnail', `/assets/${random[0].id}/thumbnail?size=preview`);
	if (thumb) console.log(`  preview bytes: ${thumb.byteLength}`);
}

if (albums?.length) {
	const meta = await call('search/metadata (first album)', '/search/metadata', {
		method: 'POST',
		body: JSON.stringify({ albumIds: [albums[0].id], withExif: true, size: 5, page: 1 })
	});
	if (meta) console.log(`  album "${albums[0].albumName}": ${meta.assets?.total ?? '?'} assets`);
}
