import { setTimeout } from 'node:timers/promises';
import { once } from 'node:events';
import { GamesManager } from './games.js';
import { Autohost } from './autohost.js';
import { callTachyonAutohost, createTachyonEvent, TachyonServer } from './tachyonTypes.js';
import { TachyonClient, TachyonClientOpts } from './tachyonClient.js';
import { loadConfig } from './config.js';

async function main(argv: string[]) {
	if (argv.length < 3) {
		console.error('Usage: autohost <configPath>');
		process.exit(1);
	}
	const config = await loadConfig(argv[2]);

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
	const maxReconnectDelay = config.maxReconnectDelaySeconds * 1000;
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
