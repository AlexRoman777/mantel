import { createServer } from 'node:http';
import { handler } from './build/handler.js';

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
		handler(request, response);
	});
}

app().listen(playerPort, host, () => console.log(`Mantel player listening on ${host}:${playerPort}`));
if (controlPort !== playerPort) {
	app(true).listen(controlPort, host, () =>
		console.log(`Mantel controller listening on ${host}:${controlPort}`)
	);
}
