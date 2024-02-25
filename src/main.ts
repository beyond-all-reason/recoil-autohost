import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';

import StartRequestSchema from './schemas/startRequest.json' assert { type: 'json' };
import { StartRequest } from './types/startRequest.js';

import { GamesManager } from './games.js';

import dgram from 'node:dgram';

const server = Fastify({
	logger: true,
});

server.register(fastifyWebsocket);

const manager = new GamesManager();

server.post<{ Body: StartRequest }>(
	'/start',
	{ schema: { body: StartRequestSchema } },
	async (req) => {
		await manager.start(req.body);
		return 'ok\n';
	});

server.get('/updates', { websocket: true }, (conn) => {
	conn.setEncoding('utf8');
	conn.socket.on('message', (message) => {
		console.log('Message', message);
	});
});

// Start UDP server listening for engine updates on port 13245.
const udpServer = dgram.createSocket('udp4');

udpServer.on('error', (err) => {
	console.log(`UDP server error:\n${err.stack}`);
	udpServer.close();
});

udpServer.on('message', (msg, rinfo) => {
	console.log(`server got ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);
});

udpServer.on('listening', () => {
	const address = udpServer.address();
	console.log(`server listening ${address.address}:${address.port}`);
});

udpServer.bind(13245);

try {
	await server.listen({ port: 8080 });
} catch (e) {
	server.log.error(e);
	process.exit(1);
}
