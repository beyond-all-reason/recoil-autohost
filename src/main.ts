import fs from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { once } from 'node:events';
import { Ajv, JSONSchemaType } from 'ajv';
import { GamesManager } from './games.js';
import {
	callTachyonAutohost,
	createTachyonEvent,
	TachyonAutohost,
	TachyonError,
	TachyonServer,
} from './tachyonTypes.js';
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
import { TachyonClient, TachyonClientOpts } from './tachyonClient.js';

class Autohost implements TachyonAutohost {
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

interface Config {
	hostname: string;
	port: number | null;
	clientId: string;
	clientSecret: string;
}

const ConfigSchema: JSONSchemaType<Config> = {
	$id: 'Config',
	type: 'object',
	properties: {
		hostname: { type: 'string' },
		port: { type: 'number' },
		clientId: { type: 'string' },
		clientSecret: { type: 'string' },
	},
	required: ['hostname', 'clientId', 'clientSecret'],
	additionalProperties: true,
};

const ajv = new Ajv({ strict: true });
const validateConfig = ajv.compile(ConfigSchema);

async function main(argv: string[]) {
	if (argv.length < 3) {
		console.error('Usage: autohost <configPath>');
		process.exit(1);
	}
	const configPath = argv[2];
	const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
	if (!validateConfig(config)) {
		console.error('Invalid config:', validateConfig.errors);
		process.exit(1);
	}

	const manager = new GamesManager();
	const autohost = new Autohost(manager);

	const clientOpts: TachyonClientOpts = {
		hostname: config.hostname,
		clientId: config.clientId,
		clientSecret: config.clientSecret,
	};
	if (config.port) {
		clientOpts.port = config.port;
	}

	// This is a simple exponential backoff reconnect loop, we
	// just keep trying to connect to the server and if we get
	// disconnected we wait a bit and try again.
	const minReconnectDelay = 50;
	const maxReconnectDelay = 30000;
	let nextReconnectDelay: number = minReconnectDelay;
	for (;;) {
		console.log('Connecting to', config.hostname, '...');
		const client = new TachyonClient(clientOpts);

		client.on('connected', () => {
			console.log('Connected to the Tachyon server');
			nextReconnectDelay = minReconnectDelay;
			const ts: TachyonServer = {
				status: (status) => client.send(createTachyonEvent('autohost/status', status)),
				update: (update) => client.send(createTachyonEvent('autohost/update', update)),
			};
			autohost.connected(ts);
		});

		client.on('message', async (msg) => {
			if (msg.type == 'response') {
				console.warn(
					"Unexpected response, we don't send requests, commandId: ",
					msg.commandId,
				);
				return;
			}
			if (msg.type == 'event') return;
			client.send(await callTachyonAutohost(msg, autohost));
		});

		try {
			await once(client, 'close');
		} catch (err) {
			console.error('Client connection error:', err);
			nextReconnectDelay = Math.min(nextReconnectDelay * 2, maxReconnectDelay);
		} finally {
			autohost.disconnected();
		}
		console.log(`Reconnecting in ${nextReconnectDelay}ms...`);
		await setTimeout(nextReconnectDelay);
	}
}

if (import.meta.filename == process.argv[1]) {
	await main(process.argv);
}
