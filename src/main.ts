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

	let shuttingDown = false;
	let forceShutdownStarted = false;
	let activeClient: TachyonClient | null = null;
	let reconnectSleepAbort: AbortController | null = null;

	async function shutdown(signal: NodeJS.Signals): Promise<void> {
		if (forceShutdownStarted) return;

		if (shuttingDown) {
			forceShutdownStarted = true;
			logger.warn({ signal }, 'second shutdown signal received, forcing shutdown');

			reconnectSleepAbort?.abort();
			manager.killAllGames();
			activeClient?.close();

			await engineVersionMgr.close().catch((err) => {
				logger.error(err, 'failed to close engine version manager during forced shutdown');
			});

			process.exit(0);
		}

		shuttingDown = true;
		logger.info({ signal }, 'shutdown signal received, starting graceful shutdown');

		reconnectSleepAbort?.abort();
		manager.beginGracefulShutdown();
		await manager.waitForNoGames();
		await autohost.drainUpdates();

		activeClient?.close();
		await engineVersionMgr.close();

		process.exit(0);
	}

	process.on('SIGINT', (signal) => {
		void shutdown(signal);
	});

	process.on('SIGTERM', (signal) => {
		void shutdown(signal);
	});

	// This is a simple exponential backoff reconnect loop, we
	// just keep trying to connect to the server and if we get
	// disconnected we wait a bit and try again.
	const minReconnectDelay = 50;
	const maxReconnectDelay = config.maxReconnectDelaySeconds * 1000;
	let nextReconnectDelay: number = minReconnectDelay;

	while (!shuttingDown) {
		logger.info({ tachyonServer: config.tachyonServer }, 'connecting to tachyon server');
		const client = new TachyonClient(clientOpts);
		activeClient = client;

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
			if (!shuttingDown) {
				logger.error(err, 'failed to connect to tachyon server');
				nextReconnectDelay = Math.min(nextReconnectDelay * 2, maxReconnectDelay);
			}
		} finally {
			if (activeClient === client) {
				activeClient = null;
			}
			autohost.disconnected();
		}

		if (shuttingDown) {
			break;
		}
		logger.info(
			{
				reconnectDelay: nextReconnectDelay,
			},
			`will reconnect to tachyon server after delay`,
		);
		reconnectSleepAbort = new AbortController();
		try {
			await setTimeout(nextReconnectDelay, undefined, {
				signal: reconnectSleepAbort.signal,
			});
		} catch (err) {
			if (!shuttingDown) {
				throw err;
			}
		} finally {
			reconnectSleepAbort = null;
		}
	}
}

if (import.meta.filename == process.argv[1]) {
	await main(process.argv);
}
