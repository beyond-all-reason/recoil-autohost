// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import { mock, suite, test } from 'node:test';
import { pino } from 'pino';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { TypedEmitter } from 'tiny-typed-emitter';
import { GamesManager, type Env as GamesManagerEnv } from './games.js';
import {
	Autohost,
	_getPlayerIds,
	engineEventToTachyonUpdate,
	type Env as AutohostEnv,
} from './autohost.js';
import { fakeRunEngine, EngineRunnerFake } from './engineRunner.fake.js';
import {
	AutohostStartRequestData,
	AutohostStatusEventData,
	StartUpdate,
	FinishedUpdate,
	EngineMessageUpdate,
	EngineWarningUpdate,
	EngineQuitUpdate,
	PlayerJoinedUpdate,
	PlayerLeftUpdate,
	PlayerChatUpdate,
	PlayerDefeatedUpdate,
	LuaMsgUpdate,
	AutohostUpdateEventData,
} from 'tachyon-protocol/types';
import { scriptGameFromStartRequest } from './startScriptGen.js';
import {
	EvServerStarted,
	EvServerQuit,
	EvServerStartPlaying,
	EvServerGameOver,
	EvServerMessage,
	EvServerWarning,
	EvPlayerJoined,
	EvPlayerLeft,
	EvPlayerReady,
	EvPlayerChat,
	EvPlayerDefeated,
	EvGameLuaMsg,
	EvGameTeamStat,
	EventType,
	ReadyState,
	LeaveReason,
	ChatDestination,
	LuaMsgScript,
	LuaMsgUIMode,
} from './engineAutohostInterface.js';
import { runEngine } from './engineRunner.js';
import type { EngineVersionsManager, EngineVersionsManagerEvents } from './engineVersions.js';

function createStartRequest(players: { name: string; userId: string }[]): AutohostStartRequestData {
	return {
		battleId: randomUUID(),
		engineVersion: 'test',
		mapName: 'map v1',
		gameName: 'mod v1',
		startPosType: 'fixed',
		allyTeams: [
			{
				teams: [
					{
						players: players.map(({ name, userId }) => ({
							userId,
							name,
							password: 'X',
							countryCode: 'PL',
						})),
					},
				],
			},
		],
	};
}

test('getPlayerNumbers match statscript gen', () => {
	const req = createStartRequest([{ name: 'Asd', userId: '0000-1' }]);
	req.spectators = [
		{
			userId: '0000-2',
			name: 'Asd2',
			password: 'X',
			countryCode: 'PL',
		},
	];
	req.allyTeams.push({
		teams: [
			{
				players: [
					{
						userId: '0000-3',
						name: 'Asd3',
						password: 'X',
						countryCode: 'PL',
					},
					{
						userId: '0000-4',
						name: 'Asd4',
						password: 'X',
						countryCode: 'PL',
					},
				],
			},
			{
				players: [
					{
						userId: '0000-5',
						name: 'Asd5',
						password: 'X',
						countryCode: 'PL',
					},
				],
			},
		],
	});
	const script = scriptGameFromStartRequest(req);
	const players = _getPlayerIds(req);
	assert.equal(players.length, script['NumPlayers']);
	for (const { userId, playerNumber } of players) {
		assert.equal((script[`PLAYER${playerNumber}`] as { UserID: string }).UserID, userId);
	}
});

class EngineVersionsManagerFake
	extends TypedEmitter<EngineVersionsManagerEvents>
	implements EngineVersionsManager
{
	public engineVersions: string[] = [];
	public installEngine(_version: string): void {}
}

suite('Autohost', async () => {
	function getEnv(runEngineMock?: typeof runEngine): GamesManagerEnv & AutohostEnv {
		return {
			logger: pino({ level: 'silent' }),
			config: {
				engineStartPort: 20000,
				engineAutohostStartPort: 22000,
				maxPortsUsed: 1000,
				maxBattles: 1000,
				hostingIP: '127.0.0.1',
				engineSettings: {},
				maxUpdatesSubscriptionAgeSeconds: 10 * 60,
				maxGameDurationSeconds: 8 * 60 * 60,
			},
			mocks: { runEngine: runEngineMock ?? fakeRunEngine },
		};
	}

	await test('simple start', async () => {
		const env = getEnv();
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const res = await ah.start(createStartRequest([{ name: 'user1', userId: randomUUID() }]));
		assert.ok(res.ips.length > 0);
	});

	await test('multiple starts', async () => {
		const env = getEnv();
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		await ah.start(createStartRequest([{ name: 'user1', userId: randomUUID() }]));
		await ah.start(createStartRequest([{ name: 'user1', userId: randomUUID() }]));
		await ah.start(createStartRequest([{ name: 'user1', userId: randomUUID() }]));
		await ah.start(createStartRequest([{ name: 'user1', userId: randomUUID() }]));
	});

	await test('start duplicate games fails', async () => {
		const er = new EngineRunnerFake();
		const env = getEnv(() => er);
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req1 = createStartRequest([{ name: 'user1', userId: randomUUID() }]);
		await ah.start(req1);

		const req2 = createStartRequest([{ name: 'user2', userId: randomUUID() }]);
		req2.battleId = req1.battleId;

		const expectedError = { name: 'TachyonError', reason: 'battle_already_exists' };
		await assert.rejects(ah.start(req2), expectedError);

		// rejects even after the previous battle is done
		process.nextTick(() => er.close());
		await once(gm, 'exit');
		await assert.rejects(ah.start(req2), expectedError);
	});

	test('simple tachyon connect/disconnect', () => {
		const env = getEnv();
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const ts = { update: async () => {}, status: mock.fn(async () => {}) };
		ah.connected(ts);
		assert.equal(ts.status.mock.callCount(), 1);
		ah.disconnected();
	});

	await test('tachyon status updates battles', async () => {
		const ers: EngineRunnerFake[] = [];
		const env = getEnv(() => {
			const er = new EngineRunnerFake();
			ers.push(er);
			return er;
		});
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const ts = {
			update: async () => {},
			status: mock.fn(async (_status: AutohostStatusEventData) => {}),
		};
		ah.connected(ts);
		assert.equal(ts.status.mock.callCount(), 1);
		assert.equal(ts.status.mock.calls[0].arguments[0].currentBattles, 0);
		ts.status.mock.resetCalls();

		const { promise, resolve } = Promise.withResolvers();
		let callsLeft = 4;
		ts.status.mock.mockImplementation(async (_status: AutohostStatusEventData) => {
			if (--callsLeft == 0) {
				resolve(undefined);
			}
		});
		await ah.start(createStartRequest([{ name: 'user1', userId: randomUUID() }]));
		await ah.start(createStartRequest([{ name: 'user1', userId: randomUUID() }]));
		ers[0].close();
		ers[1].close();
		await promise;

		assert.equal(ts.status.mock.callCount(), 4);
		assert.deepEqual(
			[0, 1, 2, 3].map((n) => ts.status.mock.calls[n].arguments[0].currentBattles),
			[1, 2, 1, 0],
		);
	});

	await test('tachyon install engine', async () => {
		const env = getEnv();
		const gm = new GamesManager(env);
		const evm = new EngineVersionsManagerFake();
		const installEngineMock = mock.method(evm, 'installEngine');
		installEngineMock.mock.mockImplementation((version: string) => {
			evm.engineVersions.push(version);
			evm.emit('versions', evm.engineVersions);
		});
		const ah = new Autohost(env, gm, evm);
		const ts = { update: async () => {}, status: mock.fn(async (_status: unknown) => {}) };
		ah.connected(ts);

		await ah.installEngine({ version: '1234' });

		assert.equal(ts.status.mock.callCount(), 2);
		assert.deepEqual(ts.status.mock.calls[0].arguments[0], {
			...gm.capacity,
			availableEngines: [],
		});
		assert.deepEqual(ts.status.mock.calls[1].arguments[0], {
			...gm.capacity,
			availableEngines: ['1234'],
		});

		ah.disconnected();
	});

	await test('kill', async () => {
		const er = new EngineRunnerFake();
		const env = getEnv(() => er);
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req = createStartRequest([{ name: 'user1', userId: randomUUID() }]);
		await ah.start(req);
		await ah.kill({ battleId: req.battleId });
		assert.equal(er.close.mock.callCount(), 1);
	});

	await test('timeout kill', async (t) => {
		t.mock.timers.enable({ apis: ['setTimeout'] });
		const er = new EngineRunnerFake();
		const env = getEnv(() => er);
		env.config.maxGameDurationSeconds = 0.1;
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req = createStartRequest([{ name: 'user1', userId: randomUUID() }]);
		const startPromise = ah.start(req);
		t.mock.timers.tick(0);
		await startPromise;
		t.mock.timers.tick(99);
		assert.equal(er.close.mock.callCount(), 0);
		t.mock.timers.tick(1);
		assert.equal(er.close.mock.callCount(), 1);
	});

	await test('kill battle not found', async () => {
		const env = getEnv();
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		await assert.rejects(ah.kill({ battleId: 'asdasd' }), {
			name: 'TachyonError',
			reason: 'invalid_request',
			message: /.*doesn't exist.*/i,
		});
	});

	await test('sendCommand', async () => {
		const er = new EngineRunnerFake();
		const env = getEnv(() => er);
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req = createStartRequest([{ name: 'user1', userId: randomUUID() }]);
		await ah.start(req);
		await ah.sendCommand({ battleId: req.battleId, command: 'test', arguments: ['a', 'b'] });
		assert.equal(er.sendPacket.mock.callCount(), 1);
		assert.deepEqual(er.sendPacket.mock.calls[0].arguments, [Buffer.from('/test a b')]);
	});

	await test('sendCommand battle not found', async () => {
		const env = getEnv();
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		await assert.rejects(ah.sendCommand({ battleId: 'asdasd', command: 'asd' }), {
			name: 'TachyonError',
			reason: 'invalid_request',
			message: /.*doesn't exist.*/i,
		});
	});

	await test('sendMessage', async () => {
		const er = new EngineRunnerFake();
		const env = getEnv(() => er);
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req = createStartRequest([{ name: 'user1', userId: randomUUID() }]);
		await ah.start(req);
		await ah.sendMessage({ battleId: req.battleId, message: 'asd' });
		assert.equal(er.sendPacket.mock.callCount(), 1);
		assert.deepEqual(er.sendPacket.mock.calls[0].arguments, [Buffer.from('asd')]);
	});

	await test('kickPlayer', async () => {
		const er = new EngineRunnerFake();
		const env = getEnv(() => er);
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req = createStartRequest([{ name: 'user1', userId: '10' }]);
		await ah.start(req);
		await ah.kickPlayer({
			battleId: req.battleId,
			userId: '10',
		});
		assert.equal(er.sendPacket.mock.callCount(), 1);
		assert.deepEqual(er.sendPacket.mock.calls[0].arguments, [Buffer.from('/kick user1')]);
	});

	await test('kickPlayer not found player', async () => {
		const er = new EngineRunnerFake();
		const env = getEnv(() => er);
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req = createStartRequest([{ name: 'user1', userId: '10' }]);
		await ah.start(req);
		await assert.rejects(ah.kickPlayer({ battleId: req.battleId, userId: '11' }), {
			name: 'TachyonError',
			reason: 'invalid_request',
			message: /.*player.*/i,
		});
	});

	await test('kickPlayer not found battle', async () => {
		const er = new EngineRunnerFake();
		const env = getEnv(() => er);
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req = createStartRequest([{ name: 'user1', userId: '10' }]);
		await ah.start(req);
		await assert.rejects(ah.kickPlayer({ battleId: 'asdasdasd', userId: '10' }), {
			name: 'TachyonError',
			reason: 'invalid_request',
			message: /.*battle.*/i,
		});
	});

	await test('mutePlayer', async () => {
		const er = new EngineRunnerFake();
		const env = getEnv(() => er);
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req = createStartRequest([{ name: 'user1', userId: '10' }]);
		await ah.start(req);
		await ah.mutePlayer({
			battleId: req.battleId,
			userId: '10',
			chat: false,
			draw: true,
		});
		assert.equal(er.sendPacket.mock.callCount(), 1);
		assert.deepEqual(er.sendPacket.mock.calls[0].arguments, [Buffer.from('/mute user1 0 1')]);
	});

	await test('specPlayers', async () => {
		const er = new EngineRunnerFake();
		const env = getEnv(() => er);
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req = createStartRequest([
			{ name: 'user1', userId: '10' },
			{ name: 'user2', userId: '12' },
			{ name: 'user3', userId: '13' },
		]);
		await ah.start(req);
		await ah.specPlayers({
			battleId: req.battleId,
			userIds: ['12', '13'],
		});
		assert.equal(er.sendPacket.mock.callCount(), 2);
		assert.deepEqual(er.sendPacket.mock.calls[0].arguments, [Buffer.from('/spec user2')]);
		assert.deepEqual(er.sendPacket.mock.calls[1].arguments, [Buffer.from('/spec user3')]);
	});

	await test('specPlayers all or none', async () => {
		const er = new EngineRunnerFake();
		const env = getEnv(() => er);
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req = createStartRequest([
			{ name: 'user1', userId: '10' },
			{ name: 'user2', userId: '12' },
			{ name: 'user3', userId: '13' },
		]);
		await ah.start(req);
		await assert.rejects(
			ah.specPlayers({
				battleId: req.battleId,
				userIds: ['12', '10', '15'],
			}),
			{ name: 'TachyonError', reason: 'invalid_request' },
		);
		assert.equal(er.sendPacket.mock.callCount(), 0);
	});

	await test('addPlayer', async () => {
		const er = new EngineRunnerFake();
		const env = getEnv(() => er);
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req = createStartRequest([{ name: 'user1', userId: randomUUID() }]);
		await ah.start(req);
		await ah.addPlayer({
			battleId: req.battleId,
			name: 'user2',
			userId: '10',
			password: 'pass123',
		});
		assert.equal(er.sendPacket.mock.callCount(), 1);
		assert.deepEqual(er.sendPacket.mock.calls[0].arguments, [
			Buffer.from('/adduser user2 pass123 1'),
		]);
	});

	await test('addPlayer change password', async () => {
		const er = new EngineRunnerFake();
		const env = getEnv(() => er);
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req = createStartRequest([{ name: 'user1', userId: '10' }]);
		await ah.start(req);
		await ah.addPlayer({
			battleId: req.battleId,
			name: 'user1',
			userId: '10',
			password: 'pass123',
		});
		assert.equal(er.sendPacket.mock.callCount(), 1);
		assert.deepEqual(er.sendPacket.mock.calls[0].arguments, [
			Buffer.from('/adduser user1 pass123'),
		]);
	});

	await test('addPlayer duplicate name', async () => {
		const env = getEnv();
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req = createStartRequest([{ name: 'user1', userId: '10' }]);
		await ah.start(req);
		await assert.rejects(
			ah.addPlayer({
				battleId: req.battleId,
				name: 'user1',
				userId: '11',
				password: 'pass123',
			}),
			{ name: 'TachyonError', reason: 'invalid_request' },
		);
	});

	await test('addPlayer same user id different name', async () => {
		const env = getEnv();
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req = createStartRequest([{ name: 'user1', userId: '10' }]);
		await ah.start(req);
		await assert.rejects(
			ah.addPlayer({
				battleId: req.battleId,
				name: 'user2',
				userId: '10',
				password: 'pass123',
			}),
			{ name: 'TachyonError', reason: 'invalid_request' },
		);
	});

	await test("addPlayer doesn't add if packet send fails", async () => {
		const er = new EngineRunnerFake();
		const env = getEnv(() => er);
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const req = createStartRequest([{ name: 'user1', userId: randomUUID() }]);
		await ah.start(req);
		er.sendPacket.mock.mockImplementationOnce(async () => {
			throw new Error('failed');
		});
		await assert.rejects(
			ah.addPlayer({
				battleId: req.battleId,
				name: 'user2',
				userId: '10',
				password: 'pass123',
			}),
			{ name: 'Error' },
		);
		await ah.addPlayer({
			battleId: req.battleId,
			name: 'user2',
			userId: '11', // Different userId then above, if above was added this will fail
			password: 'pass123',
		});
		assert.equal(er.sendPacket.mock.callCount(), 2);
	});

	await test('subscribeUpdates', async (t) => {
		const er = new EngineRunnerFake();
		const env = getEnv(() => er);
		const gm = new GamesManager(env);
		const ah = new Autohost(env, gm, new EngineVersionsManagerFake());
		const ts = {
			update: mock.fn(async (_u: AutohostUpdateEventData) => {}),
			status: async () => {},
		};
		ah.connected(ts);
		const player0Id = randomUUID();
		const req = createStartRequest([{ name: 'user1', userId: player0Id }]);
		await ah.start(req);

		t.mock.timers.enable({ apis: ['Date'] });
		t.mock.timers.setTime(1000);
		er.emit('packet', {
			type: EventType.SERVER_MESSAGE,
			message: 'some message',
		});
		t.mock.timers.tick(1);
		er.emit('packet', {
			type: EventType.SERVER_MESSAGE,
			message: 'some message2',
		});

		const { promise, resolve } = Promise.withResolvers();
		let eventsLeft = 3;
		ts.update.mock.mockImplementation(async () => {
			if (--eventsLeft == 0) {
				resolve(undefined);
			}
		});

		await ah.subscribeUpdates({ since: 1000000 });

		t.mock.timers.tick(1);
		er.emit('packet', {
			type: EventType.PLAYER_CHAT,
			fromPlayer: 0,
			destination: ChatDestination.TO_EVERYONE,
			message: 'test',
		});
		t.mock.timers.tick(1);
		er.emit('packet', {
			type: EventType.SERVER_QUIT,
		});

		await promise;

		assert.equal(ts.update.mock.callCount(), 3);
		assert.deepEqual(ts.update.mock.calls[0].arguments[0], {
			time: 1001000,
			battleId: req.battleId,
			update: {
				type: 'engine_message',
				message: 'some message2',
			},
		});
		assert.deepEqual(ts.update.mock.calls[1].arguments[0], {
			time: 1002000,
			battleId: req.battleId,
			update: {
				type: 'player_chat',
				userId: player0Id,
				destination: 'all',
				message: 'test',
			},
		});
		assert.deepEqual(ts.update.mock.calls[2].arguments[0], {
			time: 1003000,
			battleId: req.battleId,
			update: {
				type: 'engine_quit',
			},
		});

		ah.disconnected();
	});
});

suite('engine event to tachyon event translation', async () => {
	function toUserId(playerNumber: number): string {
		return `id:${playerNumber}`;
	}

	test('SERVER_STARTED event', () => {
		const ev: EvServerStarted = {
			type: EventType.SERVER_STARTED,
		};
		assert.deepEqual(engineEventToTachyonUpdate(ev, toUserId), null);
	});

	test('SERVER_QUIT event', () => {
		const ev: EvServerQuit = {
			type: EventType.SERVER_QUIT,
		};
		const expected: EngineQuitUpdate = {
			type: 'engine_quit',
		};
		assert.deepEqual(engineEventToTachyonUpdate(ev, toUserId), expected);
	});

	test('SERVER_STARTPLAYING event', () => {
		const ev: EvServerStartPlaying = {
			type: EventType.SERVER_STARTPLAYING,
			gameId: 'asd',
			demoPath: 'asd2',
		};
		const expected: StartUpdate = {
			type: 'start',
		};
		assert.deepEqual(engineEventToTachyonUpdate(ev, toUserId), expected);
	});

	test('SERVER_GAMEOVER event', () => {
		const ev: EvServerGameOver = {
			type: EventType.SERVER_GAMEOVER,
			player: 0,
			winningAllyTeams: [0],
		};
		const expected: FinishedUpdate = {
			type: 'finished',
			userId: 'id:0',
			winningAllyTeams: [0],
		};
		assert.deepEqual(engineEventToTachyonUpdate(ev, toUserId), expected);
	});

	test('SERVER_MESSAGE event', () => {
		const ev: EvServerMessage = {
			type: EventType.SERVER_MESSAGE,
			message: 'some message',
		};
		const expected: EngineMessageUpdate = {
			type: 'engine_message',
			message: 'some message',
		};
		assert.deepEqual(engineEventToTachyonUpdate(ev, toUserId), expected);
	});

	test('SERVER_WARNING event', () => {
		const ev: EvServerWarning = {
			type: EventType.SERVER_WARNING,
			message: 'warning',
		};
		const expected: EngineWarningUpdate = {
			type: 'engine_warning',
			message: 'warning',
		};
		assert.deepEqual(engineEventToTachyonUpdate(ev, toUserId), expected);
	});

	test('PLAYER_JOINED event', () => {
		const ev: EvPlayerJoined = {
			type: EventType.PLAYER_JOINED,
			player: 1,
			name: 'john',
		};
		const expected: PlayerJoinedUpdate = {
			type: 'player_joined',
			userId: 'id:1',
			playerNumber: 1,
		};
		assert.deepEqual(engineEventToTachyonUpdate(ev, toUserId), expected);
	});

	test('PLAYER_LEFT event', () => {
		const ev: EvPlayerLeft = {
			type: EventType.PLAYER_LEFT,
			player: 3,
			reason: LeaveReason.KICKED,
		};
		const expected: PlayerLeftUpdate = {
			type: 'player_left',
			userId: 'id:3',
			reason: 'kicked',
		};
		assert.deepEqual(engineEventToTachyonUpdate(ev, toUserId), expected);
	});

	test('PLAYER_READY event', () => {
		const ev: EvPlayerReady = {
			type: EventType.PLAYER_READY,
			player: 0,
			state: ReadyState.NOT_READY,
		};
		assert.deepEqual(engineEventToTachyonUpdate(ev, toUserId), null);
	});

	test('PLAYER_CHAT event', () => {
		const ev1: EvPlayerChat = {
			type: EventType.PLAYER_CHAT,
			message: 'lool',
			fromPlayer: 10,
			destination: ChatDestination.TO_ALLIES,
		};
		const expected1: PlayerChatUpdate = {
			type: 'player_chat',
			message: 'lool',
			userId: 'id:10',
			destination: 'allies',
		};
		assert.deepEqual(engineEventToTachyonUpdate(ev1, toUserId), expected1);

		const ev2: EvPlayerChat = {
			type: EventType.PLAYER_CHAT,
			message: 'lool',
			fromPlayer: 10,
			toPlayer: 11,
			destination: ChatDestination.TO_PLAYER,
		};
		const expected2: PlayerChatUpdate = {
			type: 'player_chat',
			message: 'lool',
			userId: 'id:10',
			toUserId: 'id:11',
			destination: 'player',
		};
		assert.deepEqual(engineEventToTachyonUpdate(ev2, toUserId), expected2);
	});

	test('PLAYER_DEFEATED event', () => {
		const ev: EvPlayerDefeated = {
			type: EventType.PLAYER_DEFEATED,
			player: 1,
		};
		const expected: PlayerDefeatedUpdate = {
			type: 'player_defeated',
			userId: 'id:1',
		};
		assert.deepEqual(engineEventToTachyonUpdate(ev, toUserId), expected);
	});

	test('GAME_LUAMSG event', () => {
		const ev: EvGameLuaMsg = {
			type: EventType.GAME_LUAMSG,
			player: 2,
			script: LuaMsgScript.UI,
			uiMode: LuaMsgUIMode.ALL,
			data: Buffer.from('2983X7RNMQ74'),
		};
		const expected: LuaMsgUpdate = {
			type: 'luamsg',
			userId: 'id:2',
			script: 'ui',
			uiMode: 'all',
			data: Buffer.from('2983X7RNMQ74').toString('base64'),
		};
		assert.deepEqual(engineEventToTachyonUpdate(ev, toUserId), expected);
	});

	test('GAME_TEAMSTAT event', () => {
		const ev = {
			type: EventType.GAME_TEAMSTAT,
		} as EvGameTeamStat; // Yep, putting all in yet as we expect null anyway.
		assert.deepEqual(engineEventToTachyonUpdate(ev, toUserId), null);
	});
});
