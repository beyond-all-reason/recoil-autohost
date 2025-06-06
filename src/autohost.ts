// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The core module providing a translation between tachyon-land and engine-land.
 * See Autohost class for more details.
 */
import { TachyonAutohost, TachyonError, TachyonServer } from './tachyonTypes.js';
import {
	AutohostAddPlayerRequestData,
	AutohostInstallEngineRequestData,
	AutohostKickPlayerRequestData,
	AutohostKillRequestData,
	AutohostMutePlayerRequestData,
	AutohostSendCommandRequestData,
	AutohostSendMessageRequestData,
	AutohostSpecPlayersRequestData,
	AutohostStartOkResponseData,
	AutohostStartRequestData,
	AutohostStatusEventData,
	AutohostSubscribeUpdatesRequestData,
	AutohostUpdateEventData,
	LuaMsgUpdate,
	PlayerChatUpdate,
	PlayerLeftUpdate,
} from 'tachyon-protocol/types';
import {
	serializeMessagePacket,
	serializeCommandPacket,
	PacketSerializeError,
	type Event,
	EventType,
	LeaveReason,
	ChatDestination,
	LuaMsgUIMode,
	LuaMsgScript,
} from './engineAutohostInterface.js';
import type { GamesManager } from './games.js';
import type { EngineVersionsManager } from './engineVersions.js';
import { MultiIndex } from './multiIndex.js';
import { EventsBuffer, EventsBufferError } from './eventsBuffer.js';
import { Environment } from './environment.js';

// Engine commands compatible bool to str conversion.
function boolToStr(b: boolean): string {
	return b ? '1' : '0';
}

// Index type for MultiIndex used in Autohost.
type PlayerIds = {
	userId: string;
	name: string;
	playerNumber: number;
};

// Get all the player ids, including playerNumber, as will be seen by engine.
// It must return the same order as generated in the start script generator and
// we verify this in tests.
export function _getPlayerIds(req: AutohostStartRequestData): PlayerIds[] {
	return req.allyTeams
		.flatMap((at) => at.teams)
		.flatMap((t) => t.players || [])
		.concat(req.spectators || [])
		.map(({ userId, name }, playerNumber) => ({ userId, name, playerNumber }));
}

interface Config {
	maxUpdatesSubscriptionAgeSeconds: number;
}

export type Env = Environment<Config>;

/**
 * Autohost implements the functionality as required by tachyon protocol and uses
 * GamesManager to spin up new instances.
 *
 * The implementation is basically the conversion from tachyon-native to engine-native
 * events with requires:
 *   - Tracking of the userId to player number and name mapping as tachyon operates on
 *     userIds while engine uses player numbers and names.
 *   - Tracking the history of events from engine instances to support subscribeUpdates
 *     that can ask for events from the past (graceful reconnect support).
 */
export class Autohost implements TachyonAutohost {
	private server?: TachyonServer;
	// battleId -> (userId <-> playerNumber <-> name).
	private battlePlayers: Map<string, MultiIndex<PlayerIds>> = new Map();
	// finishedBattles represents battles for which we have already published `engine_quit`
	// or `engine_crash` updates but we didn't get the `exit` event for yet. This is to make
	// sure we are only publishing a single event of this type.
	private finishedBattles: Set<string> = new Set();
	private currentStatus: AutohostStatusEventData;
	private shuttingDown: boolean = false;
	private eventsBuffer: EventsBuffer<{
		battleId: string;
		update: AutohostUpdateEventData['update'];
	}>;
	public logger: Env['logger'];

	constructor(
		env: Env,
		private gamesMgr: GamesManager,
		private engineVersionsMgr: EngineVersionsManager,
	) {
		this.logger = env.logger;
		this.eventsBuffer = new EventsBuffer(
			env.config.maxUpdatesSubscriptionAgeSeconds * 1000 * 1000,
		);

		this.currentStatus = {
			availableEngines: Array.from(engineVersionsMgr.engineVersions),
			...this.gamesMgr.capacity,
		};

		this.engineVersionsMgr.on('versions', (versions) => {
			this.currentStatus = { ...this.currentStatus, availableEngines: Array.from(versions) };

			if (this.server) this.server.status(this.currentStatus).catch(() => null);
		});

		this.gamesMgr.on('error', (battleId, err) => {
			if (!this.finishedBattles.has(battleId)) {
				this.eventsBuffer.push({
					battleId,
					update: { type: 'engine_crash', details: err.message },
				});
				this.finishedBattles.add(battleId);
			}
		});

		this.gamesMgr.on('exit', (battleId) => {
			this.battlePlayers.delete(battleId);
			if (!this.finishedBattles.has(battleId)) {
				this.logger.warn(
					{ battleId },
					'engine exited normally but no SERVER_QUIT was received',
				);
				this.eventsBuffer.push({ battleId, update: { type: 'engine_quit' } });
			} else {
				this.finishedBattles.delete(battleId);
			}
		});
		this.gamesMgr.on('capacity', (newCapacity) => {
			this.currentStatus = { ...this.currentStatus, ...newCapacity };

			if (this.server) this.server.status(this.currentStatus).catch(() => null);
		});
		this.gamesMgr.on('packet', (battleId, ev) => this.handlePacket(battleId, ev));
	}

	async start(req: AutohostStartRequestData): Promise<AutohostStartOkResponseData> {
		const { ip, port } = await this.gamesMgr.start(req);

		const players: MultiIndex<PlayerIds> = new MultiIndex({
			userId: '',
			name: '',
			playerNumber: 0,
		});
		for (const playerIds of _getPlayerIds(req)) {
			players.set(playerIds);
		}
		this.battlePlayers.set(req.battleId, players);

		return { ips: [ip], port };
	}

	async kill(req: AutohostKillRequestData): Promise<void> {
		this.gamesMgr.killGame(req.battleId);
	}

	async addPlayer(req: AutohostAddPlayerRequestData): Promise<void> {
		// TODO: for now can only add new spectators or set new password
		// for existing user, can't add new users directly to teams even
		// though engine supports that: requires tachyon change.
		const players = this.battlePlayers.get(req.battleId);
		if (!players) {
			throw new TachyonError('invalid_request', `Battle not found`);
		}
		const playerId = players.get('userId', req.userId);
		if (playerId && playerId.name != req.name) {
			throw new TachyonError('invalid_request', `userId and name don't match`);
		}
		if (!playerId && players.has('name', req.name)) {
			throw new TachyonError('invalid_request', 'name in game with different userId');
		}
		const args = [req.name, req.password];
		if (!playerId) {
			players.set({
				name: req.name,
				userId: req.userId,
				playerNumber: players.size,
			});
			args.push(boolToStr(true));
		}
		const command = serializeCommandPacket('adduser', args);
		try {
			await this.gamesMgr.sendPacket(req.battleId, command);
		} catch (err) {
			this.logger.warn(err, 'failing to send adduser, it might cause playerNumber desync');
			// If it was new player, drop him.
			if (!playerId) {
				players.delete('userId', req.userId);
			}
			throw err;
		}
	}

	async kickPlayer(req: AutohostKickPlayerRequestData): Promise<void> {
		const player = this.getPlayerName(req.battleId, req.userId);
		const command = serializeCommandPacket('kick', [player]);
		await this.gamesMgr.sendPacket(req.battleId, command);
	}

	async mutePlayer(req: AutohostMutePlayerRequestData): Promise<void> {
		const player = this.getPlayerName(req.battleId, req.userId);
		const command = serializeCommandPacket('mute', [
			player,
			boolToStr(req.chat),
			boolToStr(req.draw),
		]);
		await this.gamesMgr.sendPacket(req.battleId, command);
	}

	async specPlayers(req: AutohostSpecPlayersRequestData): Promise<void> {
		for (const p of req.userIds.map((userId) => this.getPlayerName(req.battleId, userId))) {
			const command = serializeCommandPacket('spec', [p]);
			await this.gamesMgr.sendPacket(req.battleId, command);
		}
	}

	async sendCommand(req: AutohostSendCommandRequestData): Promise<void> {
		try {
			const command = serializeCommandPacket(req.command, req.arguments || []);
			await this.gamesMgr.sendPacket(req.battleId, command);
		} catch (err) {
			if (err instanceof PacketSerializeError) {
				throw new TachyonError(
					'invalid_request',
					`failed to serialize given command: ${err.message}`,
				);
			}
			throw err;
		}
	}

	async sendMessage(req: AutohostSendMessageRequestData): Promise<void> {
		try {
			const message = serializeMessagePacket(req.message);
			await this.gamesMgr.sendPacket(req.battleId, message);
		} catch (err) {
			if (err instanceof PacketSerializeError) {
				throw new TachyonError(
					'invalid_request',
					`failed to serialize given command: ${err.message}`,
				);
			}
			throw err;
		}
	}

	async subscribeUpdates(req: AutohostSubscribeUpdatesRequestData): Promise<void> {
		try {
			this.eventsBuffer.subscribe(req.since, async (time, ev) => {
				try {
					if (this.server) await this.server.update({ time, ...ev });
				} catch {
					// ignore
				}
			});
		} catch (err) {
			if (err instanceof EventsBufferError) {
				throw new TachyonError('invalid_request', err.message);
			}
			throw err;
		}
	}

	async installEngine(req: AutohostInstallEngineRequestData): Promise<void> {
		this.engineVersionsMgr.installEngine(req.version);
	}

	connected(server: TachyonServer): void {
		this.server = server;
		server.status(this.currentStatus).catch(() => null);
	}

	disconnected(): void {
		this.server = undefined;
		this.eventsBuffer.unsubscribe();
	}

	private getPlayerName(battleId: string, userId: string): string {
		const players = this.battlePlayers.get(battleId);
		if (!players) {
			throw new TachyonError('invalid_request', `Battle not found`);
		}
		const playerId = players.get('userId', userId);
		if (!playerId) {
			throw new TachyonError('invalid_request', `Player not in battle`);
		}
		return playerId.name;
	}

	private handlePacket(battleId: string, ev: Event) {
		try {
			const update = engineEventToTachyonUpdate(ev, (playerNumber) => {
				const userId = this.battlePlayers
					.get(battleId)
					?.get('playerNumber', playerNumber)?.userId;
				if (!userId) {
					throw new Error('failed to resolve player');
				}
				return userId;
			});
			if (update) {
				if (update.type == 'engine_quit') {
					this.finishedBattles.add(battleId);
				}
				this.eventsBuffer.push({ battleId, update });
			}
		} catch (err) {
			this.logger.error(
				{ battleId, ev, err },
				'failed to convert engine event to tachyon event',
			);
		}
	}

	shutdown(): void {
		// Force shutdown (i.e. pressing CTRL+C, CTRL+C in sequence), kill all games then exit.
		if (this.shuttingDown) {
			this.logger.warn(
				'second shutdown signal recieved, forcing shutdown by killing all games and exiting',
			);
			this.gamesMgr.killAllGames();
			process.exit(0);
		}

		this.shuttingDown = true;

		// No games running, exit immediately.
		if (this.gamesMgr.gameCount === 0) {
			this.logger.info('shutdown signal received, no games running - exiting immediately');
			this.gamesMgr.setMaxBattles(0);
			this.eventsBuffer.drain().then(() => {
				process.exit(0);
			});
			return;
		}

		// Graceful shutdown, wait for all games to finish then exit.
		this.logger.info(
			'shutdown signal recieved, waiting for all games to finish before exiting',
		);
		this.gamesMgr.setMaxBattles(0);
		this.gamesMgr.on('capacity', (newCapacity) => {
			if (newCapacity.currentBattles === 0) {
				this.logger.info('all games have finished - exiting');
				this.eventsBuffer.drain().then(() => {
					process.exit(0);
				});
			}
		});
	}
}

function toTachyonLeaveReason(reason: LeaveReason): PlayerLeftUpdate['reason'] {
	switch (reason) {
		case LeaveReason.KICKED:
			return 'kicked';
		case LeaveReason.LEFT:
			return 'left';
		case LeaveReason.LOST_CONNECTION:
			return 'lost_connection';
	}
}

function toTachyonDestination(destination: ChatDestination): PlayerChatUpdate['destination'] {
	switch (destination) {
		case ChatDestination.TO_PLAYER:
			return 'player';
		case ChatDestination.TO_ALLIES:
			return 'allies';
		case ChatDestination.TO_EVERYONE:
			return 'all';
		case ChatDestination.TO_SPECTATORS:
			return 'spectators';
	}
}

function toTachyonLuaMsgScript(script: LuaMsgScript): LuaMsgUpdate['script'] {
	switch (script) {
		case LuaMsgScript.GAIA:
			return 'game';
		case LuaMsgScript.RULES:
			return 'rules';
		case LuaMsgScript.UI:
			return 'ui';
	}
}

function toTachyonLuaMsgUIMode(uiMode?: LuaMsgUIMode): LuaMsgUpdate['uiMode'] {
	switch (uiMode) {
		case undefined:
			return undefined;
		case LuaMsgUIMode.ALL:
			return 'all';
		case LuaMsgUIMode.ALLIES:
			return 'allies';
		case LuaMsgUIMode.SPECTATORS:
			return 'spectators';
	}
}

/**
 * Convert the engine event to tachyon event update data.
 *
 * @param ev Event
 * @param toUserId Function to map from player number in game to userId
 * @returns Tachyon update data
 */
export function engineEventToTachyonUpdate(
	ev: Event,
	toUserId: (playerNumber: number) => string,
): AutohostUpdateEventData['update'] | null {
	switch (ev.type) {
		case EventType.GAME_LUAMSG:
			return {
				type: 'luamsg',
				userId: toUserId(ev.player),
				script: toTachyonLuaMsgScript(ev.script),
				uiMode: toTachyonLuaMsgUIMode(ev.uiMode),
				data: ev.data.toString('base64'),
			};
		case EventType.PLAYER_CHAT: {
			const destination = toTachyonDestination(ev.destination);
			if (destination === 'player') {
				return {
					type: 'player_chat',
					userId: toUserId(ev.fromPlayer),
					destination,
					message: ev.message,
					toUserId: toUserId(ev.toPlayer!),
				};
			} else {
				return {
					type: 'player_chat',
					userId: toUserId(ev.fromPlayer),
					destination,
					message: ev.message,
				};
			}
		}
		case EventType.PLAYER_DEFEATED:
			return {
				type: 'player_defeated',
				userId: toUserId(ev.player),
			};
		case EventType.PLAYER_JOINED: {
			return {
				type: 'player_joined',
				userId: toUserId(ev.player),
				playerNumber: ev.player,
			};
		}
		case EventType.PLAYER_LEFT:
			return {
				type: 'player_left',
				userId: toUserId(ev.player),
				reason: toTachyonLeaveReason(ev.reason),
			};
		case EventType.SERVER_GAMEOVER:
			if (ev.winningAllyTeams.length < 1) {
				throw new Error('winning ally teams must be at least 1');
			}
			return {
				type: 'finished',
				userId: toUserId(ev.player),
				winningAllyTeams: ev.winningAllyTeams as [number, ...number[]],
			};
		case EventType.SERVER_MESSAGE:
			return { type: 'engine_message', message: ev.message };
		case EventType.SERVER_STARTPLAYING:
			return { type: 'start' };
		case EventType.SERVER_WARNING:
			return { type: 'engine_warning', message: ev.message };
		case EventType.SERVER_QUIT:
			return { type: 'engine_quit' };
		case EventType.SERVER_STARTED: // The return of start call indicates that server started, Tachyon doens't have this message.
		case EventType.GAME_TEAMSTAT: // At the moment Tachyon lacks definition of this message.
		case EventType.PLAYER_READY: // In my testing, it didn't behave as expected. Tachyon lacks definition for this message.
			return null;
	}
}
