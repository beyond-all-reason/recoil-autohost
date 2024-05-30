import type { StartRequest } from './types/startRequest.js';
import { runEngine, type EngineRunner } from './engineRunner.js';
import { EventType } from './autohostInterface.js';

export class GamesManager {
	private games: Map<string, EngineRunner> = new Map();

	async start(req: StartRequest): Promise<void> {
		if (this.games.has(req.gameUUID)) {
			throw new Error(`game ${req.gameUUID} already exists`);
		}

		const er = runEngine({
			startRequest: req,
			hostIP: '127.0.0.1',
			hostPort: 8452,
			autohostPort: 13245,
		});

		this.games.set(req.gameUUID, er);

		er.on('error' , (err) => {
			console.error(`game ${req.gameUUID}: error`, err);
			this.games.delete(req.gameUUID);
		});

		er.on('exit', () => {
			console.log(`game ${req.gameUUID}: exited`);
			this.games.delete(req.gameUUID);
		});

		er.on('packet', (packet) => {
			if (packet.type !== EventType.GAME_LUAMSG) {
				console.log(`game ${req.gameUUID}: packet:`, packet);
			}
		});
	}
}
