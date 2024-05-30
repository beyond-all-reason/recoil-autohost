import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';

import StartRequestSchema from './schemas/startRequest.json' assert { type: 'json' };
import type { StartRequest } from './types/startRequest.js';

import { GamesManager } from './games.js';

const server = Fastify({
	logger: true,
});

server.register(fastifyWebsocket);

const manager = new GamesManager();

server.post<{ Body: StartRequest }>(
	'/start',
	{ schema: { body: StartRequestSchema } },
	async (req) => {
		const connectInfo = await manager.start(req.body);
		return JSON.stringify(connectInfo);
	},
);

server.get('/updates', { websocket: true }, (conn) => {
	conn.setEncoding('utf8');
	conn.socket.on('message', (message) => {
		console.log('Message', message);
	});
});

try {
	await server.listen({ port: 8080 });
} catch (e) {
	server.log.error(e);
	process.exit(1);
}
