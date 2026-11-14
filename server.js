import { createServer } from 'node:http';

// SvelteKit refuses a cross-origin DELETE, so it must know whether a request arrived over http or
// https. The adapter reads the protocol from this header and otherwise assumes https, which would
// refuse every delete on a plain-HTTP network. A reverse proxy that terminates TLS sets the header
// itself; a direct connection is marked http below. Set ORIGIN to override both.
process.env.PROTOCOL_HEADER ??= 'x-forwarded-proto';
const protocolHeader = process.env.PROTOCOL_HEADER.toLowerCase();
const { handler } = await import('./build/handler.js');

const playerPort = Number(process.env.PORT || 8780);
const controlPort = Number(process.env.CONTROL_PORT || 8781);
const host = process.env.HOST || '0.0.0.0';

function app(control = false) {
	return createServer((request, response) => {
		if (request.url === '/') {
			response.writeHead(302, { Location: control ? '/settings' : '/display/auto' });
			response.end();
			return;
		}
		request.headers[protocolHeader] ??= 'http';
		handler(request, response);
	});
}

app().listen(playerPort, host, () => console.log(`Mantel player listening on ${host}:${playerPort}`));
if (controlPort !== playerPort) {
	app(true).listen(controlPort, host, () =>
		console.log(`Mantel controller listening on ${host}:${controlPort}`)
	);
}
