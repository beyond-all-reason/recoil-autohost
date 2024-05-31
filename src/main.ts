import Fastify from 'fastify';

import StartRequestSchema from './schemas/battleStartRequest.json' assert { type: 'json' };
import type { BattleStartRequest } from './types/battleStartRequest.js';

import { GamesManager } from './games.js';

const server = Fastify({
	logger: true,
});

const manager = new GamesManager();

server.post<{ Body: BattleStartRequest }>(
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
