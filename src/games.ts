import type { BattleStartRequest } from './types/battleStartRequest.js';
import { runEngine, type EngineRunner } from './engineRunner.js';
import { EventType } from './autohostInterface.js';
import events from 'node:events';

// TODO: make this properly configurable
const ENGINE_START_PORT = 20000;
const AUTOHOST_START_PORT = 22000;
const MAX_PORTS = 1000;
const MAX_GAMES = 50;
const HOST_IP = '127.0.0.1';

interface Game {
	gameUUID: string;
	engineRunner: EngineRunner;
	portOffset: number;
}

export class GamesManager {
	private games: Map<string, Game> = new Map();
	private usedUUIDs: Set<string> = new Set();
	private usedPortOffset: Set<number> = new Set();
	private lastPortOffset: number = 0;

	private findFreePortOffset(): number {
		for (let i = 0; i < MAX_PORTS; i++) {
			this.lastPortOffset = (this.lastPortOffset + 1) % MAX_PORTS;
			if (!this.usedPortOffset.has(this.lastPortOffset)) {
				this.usedPortOffset.add(this.lastPortOffset);
				return this.lastPortOffset;
			}
		}
		throw new Error('no free port offsets');
	}

	async start(req: BattleStartRequest): Promise<{ ip: string; port: number }> {
		if (this.usedUUIDs.has(req.battleId)) {
			throw new Error(`game ${req.battleId} already used`);
		}
		if (this.games.size >= MAX_GAMES) {
			throw new Error('too many games running');
		}
		this.usedUUIDs.add(req.battleId);

		const portOffset = this.findFreePortOffset();
		const er = runEngine({
			startRequest: req,
			hostIP: HOST_IP,
			hostPort: ENGINE_START_PORT + portOffset,
			autohostPort: AUTOHOST_START_PORT + portOffset,
		});
		const game: Game = {
			gameUUID: req.battleId,
			engineRunner: er,
			portOffset: portOffset,
		};
		this.games.set(game.gameUUID, game);

		er.on('error', (err) => {
			console.error(`game ${game.gameUUID}: error`, err);
		});

		er.on('exit', () => {
			console.log(`game ${game.gameUUID}: exited`);
			this.games.delete(game.gameUUID);
			this.usedPortOffset.delete(game.portOffset);
		});

		er.on('packet', (packet) => {
			if (packet.type !== EventType.GAME_LUAMSG) {
				console.log(`game ${game.gameUUID}: packet:`, packet);
			}
		});

		await events.once(er, 'start');
		return { ip: HOST_IP, port: ENGINE_START_PORT + portOffset };
	}
}
