import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import events from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StartRequest } from './types/startRequest.js';
import { setImmediate as asyncSetImmediate } from 'timers/promises';

import { runEngine, EngineRunner } from './engineRunner.js';
import { chdir } from 'node:process';
import { ChildProcess, spawn, type SpawnOptions } from 'node:child_process';

// Find a free port to use for testing
const tmpSock = dgram.createSocket('udp4').bind(0, '127.0.0.1');
await events.once(tmpSock, 'listening');
const testPort = tmpSock.address().port;
tmpSock.close();
console.log('testPort', testPort);

// The contents of this except for the gameUUID doesn't matter much
// unit tests don't execute the real engine.
const demoStartRequest: StartRequest = {
	gameUUID: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
	engineVersion: 'test',
	mapName: 'map v1',
	modName: 'mod v1',
	startPosType: 'fixed',
	allyTeams: [{ teams: [] }],
};

const optsBase = {
	startRequest: demoStartRequest,
	hostIP: '127.0.0.1',
	hostPort: 8452,
	autohostPort: testPort,
};

const origCwd = process.cwd();
let testDir: string;

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
	const er = runEngine(optsBase);
	er.close();
	await events.once(er, 'exit');
});

test('engineRunner emits error on server start', async () => {
	const er = new EngineRunner();
	er._run({
		...optsBase,
		spawnMock: (() => {
			const cp = new ChildProcess();
			process.nextTick(() => {
				cp.emit('error', new Error('test error'));
			});
			return cp;
		}) as typeof spawn,
	});
	await assert.rejects(async () => {
		await events.once(er, 'start');
	}, /test error/);
});

test('engineRunner spawns process correctly', async () => {
	const er = new EngineRunner();
	er._run({
		...optsBase,
		spawnMock: ((cmd: string, args: string[], opts: SpawnOptions) => {
			assert.match(cmd, /.*\/engines\/test\/spring-dedicated$/);
			return spawn('echo', args, opts);
		}) as typeof spawn,
	});
	await events.once(er, 'exit');
});

test('engineRunner close before spawn works', async () => {
	const er = new EngineRunner();
	er._run({
		...optsBase,
		spawnMock: (() => {
			process.nextTick(() => {
				er.close();
			});
			return spawn('sleep', ['1000'], { stdio: 'ignore' });
		}) as typeof spawn,
	});
	await events.once(er, 'exit');
});

test('engineRunner multi start, multi close', async () => {
	const er = new EngineRunner();
	er._run(optsBase);
	assert.throws(() => er._run(optsBase));
	er.close();
	er.close();
	await events.once(er, 'exit');
});

test('engineRunner full run simulated engine', async () => {
	const er = new EngineRunner();
	er._run({
		...optsBase,
		spawnMock: (() => {
			const cp = new ChildProcess();

			cp.kill = (() => {
				assert.fail('kill should not be called');
			}) as typeof ChildProcess.prototype.kill;

			process.nextTick(() => {
				cp.emit('spawn');
			});

			setImmediate(() => simulateEngine(cp));

			return cp;
		}) as typeof spawn,
	});

	async function simulateEngine(cp: ChildProcess) {
		const s = dgram.createSocket('udp4');
		s.connect(testPort);
		await events.once(s, 'connect');

		for (const packet of [
			Buffer.from('00', 'hex'),
			Buffer.from('054f6e6c696e65207761726e696e67206c6f6c', 'hex'),
			Buffer.from('01', 'hex'),
		]) {
			await asyncSetImmediate();
			s.send(packet);
			const msg = (await events.once(s, 'message')) as [Buffer, dgram.RemoteInfo];
			assert.equal(msg[0].toString('utf8'), `test${packet[0]}`);
		}

		await asyncSetImmediate();
		cp.emit('exit', 0, 'exit');
		s.close();
	}

	assert.rejects(async () => {
		await er.sendPacket(Buffer.from('asd'));
	}, /not running/);

	er.on('packet', async (packet) => {
		await er.sendPacket(Buffer.from(`test${packet.type}`));
	});

	await events.once(er, 'start');
	await events.once(er, 'exit');
});
