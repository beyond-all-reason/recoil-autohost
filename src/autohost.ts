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
import { type GamesManager } from './games.js';

export class Autohost implements TachyonAutohost {
	private server?: TachyonServer;

	constructor(private manager: GamesManager) {}

	async start(req: AutohostStartRequestData): Promise<AutohostStartOkResponseData> {
		const { ip, port } = await this.manager.start(req);
		return { ips: [ip], port };
	}

	async kill(_req: AutohostKillRequestData): Promise<void> {
		throw new TachyonError('command_unimplemented', 'kill not implemented');
	}

	async addPlayer(_req: AutohostAddPlayerRequestData): Promise<void> {
		throw new TachyonError('command_unimplemented', 'playerAdd not implemented');
	}

	async kickPlayer(_req: AutohostKickPlayerRequestData): Promise<void> {
		throw new TachyonError('command_unimplemented', 'playerKick not implemented');
	}

	async mutePlayer(_req: AutohostMutePlayerRequestData): Promise<void> {
		throw new TachyonError('command_unimplemented', 'playerMute not implemented');
	}

	async specPlayers(_req: AutohostSpecPlayersRequestData): Promise<void> {
		throw new TachyonError('command_unimplemented', 'playersSpec not implemented');
	}

	async sendCommand(_req: AutohostSendCommandRequestData): Promise<void> {
		throw new TachyonError('command_unimplemented', 'sendCommand not implemented');
	}

	async sendMessage(_req: AutohostSendMessageRequestData): Promise<void> {
		throw new TachyonError('command_unimplemented', 'sendMessage not implemented');
	}

	async subscribeUpdates(_req: AutohostSubscribeUpdatesRequestData): Promise<void> {
		throw new TachyonError('command_unimplemented', 'subscribeUpdates not implemented');
	}

	connected(server: TachyonServer): void {
		this.server = server;
		server.status({ currentBattles: 0, maxBattles: 10 });
	}

	disconnected(): void {
		this.server = undefined;
	}
}
