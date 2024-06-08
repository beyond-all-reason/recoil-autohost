import Fastify from 'fastify';

import StartRequestSchema from './schemas/startRequest.json' with { type: 'json' };
import type { StartRequest } from './types/startRequest.js';

import { GamesManager } from './games.js';

const server = Fastify({
	logger: true,
});

const manager = new GamesManager();

server.post<{ Body: StartRequest }>(
	'/start',
	{ schema: { body: StartRequestSchema } },
	async (req) => {
		const connectInfo = await manager.start(req.body);
		return JSON.stringify(connectInfo);
	},
);

try {
	await server.listen({ port: 8080 });
} catch (e) {
	server.log.error(e);
	process.exit(1);
}
