// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import test, { suite } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import events from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AutohostStartRequestData } from 'tachyon-protocol/types';
import { setImmediate as asyncSetImmediate } from 'timers/promises';

import { runEngine, EngineRunnerImpl } from './engineRunner.js';
import { chdir } from 'node:process';
import { ChildProcess, spawn, type SpawnOptions } from 'node:child_process';
import { pino } from 'pino';
import { EventType } from './engineAutohostInterface.js';

// Find a free port to use for testing
const tmpSock = dgram.createSocket('udp4').bind(0, '127.0.0.1');
await events.once(tmpSock, 'listening');
const testPort = tmpSock.address().port;
tmpSock.close();

// The contents of this except for the gameUUID doesn't matter much
// unit tests don't execute the real engine.
const demoStartRequest: AutohostStartRequestData = {
	battleId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
	engineVersion: 'test',
	mapName: 'map v1',
	gameName: 'mod v1',
	startPosType: 'fixed',
	allyTeams: [
		{
			teams: [
				{
					players: [
						{
							userId: '441a8dde-4a7a-4baf-9a3f-f51015fa61c4',
							name: 'Player X',
							password: 'X',
							countryCode: 'DE',
						},
					],
				},
			],
		},
	],
};

const optsBase = {
	startRequest: demoStartRequest,
	hostIP: '127.0.0.1',
	hostPort: 8452,
	autohostPort: testPort,
};

function getEnv(spawnMock?: typeof spawn) {
	return {
		logger: pino({ level: 'silent' }),
		config: { engineSettings: {} },
		mocks: { spawn: spawnMock },
	};
}

const origCwd = process.cwd();
let testDir: string;

suite('engineRunner', () => {
	test.beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), 'engine-runner-test-'));
		chdir(testDir);
		await mkdir('engines/test', { recursive: true });
	});

	test.afterEach(async () => {
		chdir(origCwd);
		await rm(testDir, { recursive: true });
	});

	test('runEngine quick close works', async () => {
		const er = runEngine(getEnv(), optsBase);
		er.close();
		await events.once(er, 'exit');
	});

	test('engineRunner emits error on server start', async () => {
		const er = new EngineRunnerImpl(
			getEnv((() => {
				const cp = new ChildProcess();
				process.nextTick(() => {
					cp.emit('error', new Error('test error'));
				});
				return cp;
			}) as typeof spawn),
		);
		er._run(optsBase);
		await assert.rejects(events.once(er, 'start'), /test error/);
	});

	test('engineRunner spawns process correctly', async () => {
		const er = new EngineRunnerImpl(
			getEnv(((cmd: string, args: string[], opts: SpawnOptions) => {
				assert.match(cmd, /.*\/engines\/test\/spring-dedicated$/);
				return spawn('echo', args, opts);
			}) as typeof spawn),
		);
		er._run(optsBase);
		await events.once(er, 'exit');
	});

	test('engineRunner close before spawn works', async () => {
		const er = new EngineRunnerImpl(
			getEnv((() => {
				process.nextTick(() => {
					er.close();
				});
				return spawn('sleep', ['1000'], { stdio: 'ignore' });
			}) as typeof spawn),
		);
		er._run(optsBase);
		await events.once(er, 'exit');
	});

	test('engineRunner multi start, multi close', async () => {
		const er = new EngineRunnerImpl(getEnv());
		er._run(optsBase);
		assert.throws(() => er._run(optsBase));
		er.close();
		er.close();
		await events.once(er, 'exit');
	});

	test('engineRunner full run simulated engine', async () => {
		const er = new EngineRunnerImpl(
			getEnv((() => {
				const cp = new ChildProcess();

				cp.kill = (() => {
					assert.fail('kill should not be called');
				}) as typeof ChildProcess.prototype.kill;

				process.nextTick(() => {
					cp.emit('spawn');
				});

				setImmediate(() => simulateEngine(cp));

				return cp;
			}) as typeof spawn),
		);
		er._run(optsBase);

		async function simulateEngine(cp: ChildProcess) {
			const s = dgram.createSocket('udp4');
			s.connect(testPort);
			await events.once(s, 'connect');

			for (const packet of [
				Buffer.from('00', 'hex'),
				Buffer.from('054f6e6c696e65207761726e696e67206c6f6c', 'hex'),
				Buffer.from('14320c000a640000407a683630', 'hex'),
				Buffer.from('01', 'hex'),
			]) {
				await asyncSetImmediate();
				s.send(packet);
				// 0x14 -> luamsg, filtered out by default.
				if (packet[0] != 0x14) {
					const msg = (await events.once(s, 'message')) as [Buffer, dgram.RemoteInfo];
					assert.equal(msg[0].toString('utf8'), `test${packet[0]}`);
				}
			}

			await asyncSetImmediate();
			cp.emit('exit', 0, 'exit');
			s.close();
		}

		assert.rejects(er.sendPacket(Buffer.from('asd')), /not running/);

		er.on('packet', async (packet) => {
			await er.sendPacket(Buffer.from(`test${packet.type}`));
		});

		await events.once(er, 'start');
		await events.once(er, 'exit');
	});

	test('emit only luamsg matching regex', async () => {
		const er = new EngineRunnerImpl(
			getEnv((() => {
				const cp = new ChildProcess();
				process.nextTick(() => cp.emit('spawn'));
				setImmediate(() => simulateEngine(cp));
				return cp;
			}) as typeof spawn),
		);
		er._run({
			...optsBase,
			startRequest: {
				...demoStartRequest,
				luamsgRegexp: '^id:',
			},
		});

		const { promise: receivedAll, resolve: receivedAllResolve } = Promise.withResolvers();
		let expectedPackets = 4;

		async function simulateEngine(cp: ChildProcess) {
			const s = dgram.createSocket('udp4');
			s.connect(testPort);
			await events.once(s, 'connect');

			for (const packet of [
				Buffer.from('00', 'hex'),
				Buffer.from('14320c000a64000069643a6173', 'hex'),
				Buffer.from('14320c000a64000078783a7878', 'hex'),
				Buffer.from('14320c000a64000069643a786e', 'hex'),
				Buffer.from('14320c000a64000069643affff', 'hex'),
			]) {
				s.send(packet);
			}
			await receivedAll;
			cp.emit('exit', 0, 'exit');
			s.close();
		}

		assert.rejects(er.sendPacket(Buffer.from('asd')), /not running/);

		const packetsData: Buffer[] = [];
		er.on('packet', (packet) => {
			if (packet.type == EventType.GAME_LUAMSG) {
				packetsData.push(packet.data);
			}
			if (--expectedPackets == 0) {
				receivedAllResolve(undefined);
			}
		});

		await events.once(er, 'exit');

		assert.deepEqual(packetsData, [
			Buffer.from('id:as'),
			Buffer.from('id:xn'),
			Buffer.from('69643affff', 'hex'),
		]);
	});
});
