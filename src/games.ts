import type { Environment } from './environment.js';
import type { AutohostStartRequestData } from 'tachyon-protocol/types';
import { runEngine, type EngineRunner, type Env as EngineRunnerEnv } from './engineRunner.js';
import { type Event, EventType } from './engineAutohostInterface.js';
import { TypedEmitter } from 'tiny-typed-emitter';
import { TachyonError } from './tachyonTypes.js';
import events from 'node:events';

interface Game {
	battleId: string;
	engineRunner: EngineRunner;
	portOffset: number;
	started: boolean;
	logger: Environment['logger'];
}

interface GamesCapacity {
	currentBattles: number;
	maxBattles: number;
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

	// Emitted when server capacity changes.
	capacity: (capacity: GamesCapacity) => void;
}

interface Config {
	engineStartPort: number;
	engineAutohostStartPort: number;
	maxPortsUsed: number;
	maxBattles: number;
	hostingIP: string;
}

interface Mocks {
	runEngine?: typeof runEngine;
}

export type Env = Environment<Config, Mocks> & EngineRunnerEnv;

/**
 * GamesManager is responsible for managing a pool of EngineRunners and assigning
 * them to free ports from the designated range.
 */
export class GamesManager extends TypedEmitter<Events> implements GamesManager {
	private games: Map<string, Game> = new Map();
	private usedBattleIds: Set<string> = new Set();
	private usedPortOffset: Set<number> = new Set();
	private lastPortOffset: number = 0;
	private logger: Env['logger'];
	private currCapacity: GamesCapacity;

	constructor(private env: Env) {
		super();
		this.logger = env.logger.child({ class: 'GamesManager' });
		this.currCapacity = {
			currentBattles: 0,
			maxBattles: env.config.maxBattles,
		};
	}

	private findFreePortOffset(): number {
		for (let i = 0; i < this.env.config.maxPortsUsed; i++) {
			this.lastPortOffset = (this.lastPortOffset + 1) % this.env.config.maxPortsUsed;
			if (!this.usedPortOffset.has(this.lastPortOffset)) {
				this.usedPortOffset.add(this.lastPortOffset);
				return this.lastPortOffset;
			}
		}
		throw new TachyonError('internal_error', 'no free port offsets');
	}

	async start(req: AutohostStartRequestData): Promise<{ ip: string; port: number }> {
		if (this.usedBattleIds.has(req.battleId)) {
			throw new TachyonError<'autohost/start'>(
				'battle_already_exists',
				`game ${req.battleId} already used`,
			);
		}
		if (this.games.size >= this.env.config.maxBattles) {
			throw new TachyonError('invalid_request', 'too many battles running');
		}
		this.usedBattleIds.add(req.battleId);

		const portOffset = this.findFreePortOffset();
		const er = (this.env.mocks?.runEngine ?? runEngine)(this.env, {
			startRequest: req,
			hostIP: this.env.config.hostingIP,
			hostPort: this.env.config.engineStartPort + portOffset,
			autohostPort: this.env.config.engineAutohostStartPort + portOffset,
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
			if (game.started) {
				this.emit('exit', game.battleId);
				this.currCapacity.currentBattles -= 1;
				this.emit('capacity', this.capacity);
			}
		});

		er.on('packet', (packet) => {
			if (packet.type !== EventType.GAME_LUAMSG) {
				game.logger.trace(packet, 'got packet');
			}
			if (game.started) this.emit('packet', game.battleId, packet);
		});

		await events.once(er, 'start');
		game.started = true;
		this.currCapacity.currentBattles += 1;
		process.nextTick(() => {
			this.emit('capacity', this.capacity);
		});
		return {
			ip: this.env.config.hostingIP,
			port: this.env.config.engineStartPort + portOffset,
		};
	}

	async sendPacket(battleId: string, packet: Buffer): Promise<void> {
		const game = this.games.get(battleId);
		if (!game) throw new TachyonError('invalid_request', `game ${battleId} doesn't exist`);
		return game.engineRunner.sendPacket(packet);
	}

	killGame(battleId: string) {
		const game = this.games.get(battleId);
		if (!game) throw new TachyonError('invalid_request', `game ${battleId} doesn't exist`);
		game.engineRunner.close();
	}

	get capacity(): GamesCapacity {
		return { ...this.currCapacity };
	}
}
