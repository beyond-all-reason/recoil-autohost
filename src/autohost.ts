/**
 * The core module providing a translation between tachyon-land and engine-land.
 * See Autohost class for more details.
 */
import { type Logger, pino } from 'pino';
import { TachyonAutohost, TachyonError, TachyonServer } from './tachyonTypes.js';
import {
	AutohostAddPlayerRequestData,
	AutohostKickPlayerRequestData,
	AutohostKillRequestData,
	AutohostMutePlayerRequestData,
	AutohostSendCommandRequestData,
	AutohostSendMessageRequestData,
	AutohostSpecPlayersRequestData,
	AutohostStartOkResponseData,
	AutohostStartRequestData,
	AutohostSubscribeUpdatesRequestData,
} from 'tachyon-protocol/types';
import { serializeMessagePacket, serializeCommandPacket } from './autohostInterface.js';
import { type GamesManager } from './games.js';
import { MultiIndex } from './multiIndex.js';

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
	// battleId -> (userId <-> playerNumber <-> name)
	private battlePlayers: Map<string, MultiIndex<PlayerIds>> = new Map();
	public logger: Logger;

	constructor(
		private manager: GamesManager,
		opts?: { logger?: Logger },
	) {
		this.manager.on('exit', (battleId) => this.battlePlayers.delete(battleId));
		const parentLogger = (opts || {}).logger ?? pino();
		this.logger = parentLogger.child({ class: 'Autohost' });
	}

	async start(req: AutohostStartRequestData): Promise<AutohostStartOkResponseData> {
		const { ip, port } = await this.manager.start(req);

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
		this.manager.killGame(req.battleId);
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
			await this.manager.sendPacket(req.battleId, command);
		} catch (err) {
			this.logger.warn(err, 'failing to send adduser, it might cause playerNumber desync');
			// If it was new player, drop him.
			if (!playerId) {
				players.delete('userId', req.userId);
			}
			throw err;
		}
	}

	kickPlayer(req: AutohostKickPlayerRequestData): Promise<void> {
		const player = this.getPlayerName(req.battleId, req.userId);
		const command = serializeCommandPacket('kick', [player]);
		return this.manager.sendPacket(req.battleId, command);
	}

	mutePlayer(req: AutohostMutePlayerRequestData): Promise<void> {
		const player = this.getPlayerName(req.battleId, req.userId);
		const command = serializeCommandPacket('mute', [
			player,
			boolToStr(req.chat),
			boolToStr(req.draw),
		]);
		return this.manager.sendPacket(req.battleId, command);
	}

	async specPlayers(req: AutohostSpecPlayersRequestData): Promise<void> {
		for (const p of req.userIds.map((userId) => this.getPlayerName(req.battleId, userId))) {
			const command = serializeCommandPacket('spec', [p]);
			await this.manager.sendPacket(req.battleId, command);
		}
	}

	sendCommand(req: AutohostSendCommandRequestData): Promise<void> {
		const command = serializeCommandPacket(req.command, req.arguments || []);
		return this.manager.sendPacket(req.battleId, command);
	}

	sendMessage(req: AutohostSendMessageRequestData): Promise<void> {
		const message = serializeMessagePacket(req.message);
		return this.manager.sendPacket(req.battleId, message);
	}

	async subscribeUpdates(_req: AutohostSubscribeUpdatesRequestData): Promise<void> {
		throw new TachyonError('command_unimplemented', 'subscribeUpdates not implemented');
	}

	connected(server: TachyonServer): void {
		this.server = server;
		server.status({ currentBattles: 0, maxBattles: 10 }).catch(() => null);
	}

	disconnected(): void {
		this.server = undefined;
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
}
