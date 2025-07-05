// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import { setTimeout } from 'node:timers/promises';
import { once } from 'node:events';
import { GamesManager } from './games.js';
import { EngineVersionsManagerImpl } from './engineVersions.js';
import { Autohost } from './autohost.js';
import { callTachyonAutohost, createTachyonEvent, TachyonServer } from './tachyonTypes.js';
import { TachyonClient, TachyonClientOpts } from './tachyonClient.js';
import { loadConfig } from './config.js';
import { pino } from 'pino';

async function main(argv: string[]) {
	if (argv.length < 3) {
		console.error('Usage: autohost <configPath>');
		process.exit(1);
	}
	const config = await loadConfig(argv[2]);
	const logger = pino();
	const env = { logger, config };

	const manager = new GamesManager(env);
	const engineVersionMgr = new EngineVersionsManagerImpl(env);
	engineVersionMgr.on('error', (err) => {
		logger.fatal(err, 'failed to initialize EngineVersionsManager, exiting');
		process.exit(1);
	});
	const autohost = new Autohost(env, manager, engineVersionMgr);

	const clientOpts: TachyonClientOpts = {
		hostname: config.tachyonServer,
		clientId: config.authClientId,
		clientSecret: config.authClientSecret,
	};
	if (config.tachyonServerPort) {
		clientOpts.port = config.tachyonServerPort;
	}
	if (config.useSecureConnection !== null && config.useSecureConnection !== undefined) {
		clientOpts.secure = config.useSecureConnection;
	}

	// This is a simple exponential backoff reconnect loop, we
	// just keep trying to connect to the server and if we get
	// disconnected we wait a bit and try again.
	const minReconnectDelay = 50;
	const maxReconnectDelay = config.maxReconnectDelaySeconds * 1000;
	let nextReconnectDelay: number = minReconnectDelay;
	for (;;) {
		logger.info({ tachyonServer: config.tachyonServer }, 'connecting to tachyon server');
		const client = new TachyonClient(clientOpts);

		client.on('connected', () => {
			logger.info('connected to tachyon server');
			nextReconnectDelay = minReconnectDelay;
			const ts: TachyonServer = {
				status: (status) => client.send(createTachyonEvent('autohost/status', status)),
				update: (update) => client.send(createTachyonEvent('autohost/update', update)),
			};
			autohost.connected(ts);
		});

		client.on('message', async (msg) => {
			if (msg.type == 'response') {
				logger.warn({ msg }, `Unexpected response, we don't send requests`);
				return;
			}
			if (msg.type == 'event') return;
			client.send(await callTachyonAutohost(msg, autohost)).catch(() => undefined);
		});

		try {
			await once(client, 'close');
		} catch (err) {
			logger.error(err, 'failed to connect to tachyon server');
			nextReconnectDelay = Math.min(nextReconnectDelay * 2, maxReconnectDelay);
		} finally {
			autohost.disconnected();
		}
		logger.info(
			{
				reconnectDelay: nextReconnectDelay,
			},
			`will reconnect to tachyon server after delay`,
		);
		await setTimeout(nextReconnectDelay);
	}
}

if (import.meta.filename == process.argv[1]) {
	await main(process.argv);
}
