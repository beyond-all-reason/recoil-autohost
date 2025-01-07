import { type Logger, pino } from 'pino';
import type { AutohostStartRequestData } from 'tachyon-protocol/types';
import { runEngine, type EngineRunner } from './engineRunner.js';
import { type Event, EventType } from './autohostInterface.js';
import { TypedEmitter } from 'tiny-typed-emitter';
import events from 'node:events';

// TODO: make this properly configurable
const ENGINE_START_PORT = 20000;
const AUTOHOST_START_PORT = 22000;
const MAX_PORTS = 1000;
const MAX_GAMES = 50;
const HOST_IP = '127.0.0.1';

interface Game {
	battleId: string;
	engineRunner: EngineRunner;
	portOffset: number;
	started: boolean;
	logger: Logger;
}

/**
 * Events emitted by the GamesManager
 */
interface Events {
	// Emitted when a packet is received from the engine from started game.
	packet: (battleId: string, ev: Event) => void;

	// Emitted when an error occurs in the engine from started game.
	error: (battleId: string, err: Error) => void;

	// Emitted when the engine has exited, only if it was started before.
	exit: (battleId: string) => void;
}

/**
 * GamesManager is responsible for managing a pool of EngineRunners and assigning
 * them to free ports from the designated range.
 */
export class GamesManager extends TypedEmitter<Events> {
	private games: Map<string, Game> = new Map();
	private usedBattleIds: Set<string> = new Set();
	private usedPortOffset: Set<number> = new Set();
	private lastPortOffset: number = 0;
	private runEngine: typeof runEngine;
	private logger: Logger;

	/**
	 * @param opts Optional, runEngineFn is for tests.
	 */
	constructor(opts?: { logger?: Logger; runEngineFn?: typeof runEngine }) {
		super();
		const o = opts || {};
		this.runEngine = o.runEngineFn ?? runEngine;
		const parentLogger = o.logger ?? pino();
		this.logger = parentLogger.child({ class: 'GamesManager' });
	}

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

	async start(req: AutohostStartRequestData): Promise<{ ip: string; port: number }> {
		if (this.usedBattleIds.has(req.battleId)) {
			throw new Error(`game ${req.battleId} already used`);
		}
		if (this.games.size >= MAX_GAMES) {
			throw new Error('too many games running');
		}
		this.usedBattleIds.add(req.battleId);

		const portOffset = this.findFreePortOffset();
		const er = this.runEngine({
			startRequest: req,
			hostIP: HOST_IP,
			hostPort: ENGINE_START_PORT + portOffset,
			autohostPort: AUTOHOST_START_PORT + portOffset,
		});
		const game: Game = {
			battleId: req.battleId,
			engineRunner: er,
			portOffset: portOffset,
			started: false,
			logger: this.logger.child({ battleId: req.battleId }),
		};
		this.games.set(game.battleId, game);

		er.on('error', (err) => {
			game.logger.error(err, 'battle crashed');
			if (game.started) this.emit('error', game.battleId, err);
		});

		er.on('exit', () => {
			game.logger.info('battle exited');
			this.games.delete(game.battleId);
			this.usedPortOffset.delete(game.portOffset);
			if (game.started) this.emit('exit', game.battleId);
		});

		er.on('packet', (packet) => {
			if (packet.type !== EventType.GAME_LUAMSG) {
				game.logger.trace(packet, 'got packet');
			}
			if (game.started) this.emit('packet', game.battleId, packet);
		});

		await events.once(er, 'start');
		game.started = true;
		return { ip: HOST_IP, port: ENGINE_START_PORT + portOffset };
	}

	async sendPacket(battleId: string, packet: Buffer): Promise<void> {
		const game = this.games.get(battleId);
		if (!game) throw new Error(`game ${battleId} doesn't exist`);
		return game.engineRunner.sendPacket(packet);
	}

	killGame(battleId: string) {
		const game = this.games.get(battleId);
		if (!game) throw new Error(`game ${battleId} doesn't exist`);
		game.engineRunner.close();
	}
}
