import { mock, suite, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { GamesManager } from './games.js';
import { Autohost, _getPlayerIds } from './autohost.js';
import { fakeRunEngine, EngineRunnerFake } from './engineRunner.fake.js';
import { AutohostStartRequestData, AutohostStatusEventData } from 'tachyon-protocol/types';
import { scriptGameFromStartRequest } from './startScriptGen.js';

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

suite('Autohost', async () => {
	await test('simple start', async () => {
		const gm = new GamesManager({ runEngineFn: fakeRunEngine });
		const ah = new Autohost(gm);
		const res = await ah.start(createStartRequest([{ name: 'user1', userId: randomUUID() }]));
		assert.ok(res.ips.length > 0);
	});

	await test('multiple starts', async () => {
		const gm = new GamesManager({ runEngineFn: fakeRunEngine });
		const ah = new Autohost(gm);
		await ah.start(createStartRequest([{ name: 'user1', userId: randomUUID() }]));
		await ah.start(createStartRequest([{ name: 'user1', userId: randomUUID() }]));
		await ah.start(createStartRequest([{ name: 'user1', userId: randomUUID() }]));
		await ah.start(createStartRequest([{ name: 'user1', userId: randomUUID() }]));
	});

	await test('start duplicate games fails', async () => {
		const er = new EngineRunnerFake();
		const gm = new GamesManager({ runEngineFn: () => er });
		const ah = new Autohost(gm);
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
		const gm = new GamesManager({ runEngineFn: fakeRunEngine });
		const ah = new Autohost(gm);
		const ts = { update: async () => {}, status: mock.fn(async () => {}) };
		ah.connected(ts);
		assert.equal(ts.status.mock.callCount(), 1);
		ah.disconnected();
	});

	await test('tachyon status updates', async () => {
		const ers: EngineRunnerFake[] = [];
		const gm = new GamesManager({
			runEngineFn: () => {
				const er = new EngineRunnerFake();
				ers.push(er);
				return er;
			},
		});
		const ah = new Autohost(gm);
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

	await test('kill', async () => {
		const er = new EngineRunnerFake();
		const gm = new GamesManager({ runEngineFn: () => er });
		const ah = new Autohost(gm);
		const req = createStartRequest([{ name: 'user1', userId: randomUUID() }]);
		await ah.start(req);
		await ah.kill({ battleId: req.battleId });
		assert.equal(er.close.mock.callCount(), 1);
	});

	await test('kill battle not found', async () => {
		const gm = new GamesManager({ runEngineFn: fakeRunEngine });
		const ah = new Autohost(gm);
		await assert.rejects(ah.kill({ battleId: 'asdasd' }), {
			name: 'TachyonError',
			reason: 'invalid_request',
			message: /.*doesn't exist.*/i,
		});
	});

	await test('sendCommand', async () => {
		const er = new EngineRunnerFake();
		const gm = new GamesManager({ runEngineFn: () => er });
		const ah = new Autohost(gm);
		const req = createStartRequest([{ name: 'user1', userId: randomUUID() }]);
		await ah.start(req);
		await ah.sendCommand({ battleId: req.battleId, command: 'test', arguments: ['a', 'b'] });
		assert.equal(er.sendPacket.mock.callCount(), 1);
		assert.deepEqual(er.sendPacket.mock.calls[0].arguments, [Buffer.from('/test a b')]);
	});

	await test('sendCommand battle not found', async () => {
		const gm = new GamesManager({ runEngineFn: fakeRunEngine });
		const ah = new Autohost(gm);
		await assert.rejects(ah.sendCommand({ battleId: 'asdasd', command: 'asd' }), {
			name: 'TachyonError',
			reason: 'invalid_request',
			message: /.*doesn't exist.*/i,
		});
	});

	await test('sendMessage', async () => {
		const er = new EngineRunnerFake();
		const gm = new GamesManager({ runEngineFn: () => er });
		const ah = new Autohost(gm);
		const req = createStartRequest([{ name: 'user1', userId: randomUUID() }]);
		await ah.start(req);
		await ah.sendMessage({ battleId: req.battleId, message: 'asd' });
		assert.equal(er.sendPacket.mock.callCount(), 1);
		assert.deepEqual(er.sendPacket.mock.calls[0].arguments, [Buffer.from('asd')]);
	});

	await test('kickPlayer', async () => {
		const er = new EngineRunnerFake();
		const gm = new GamesManager({ runEngineFn: () => er });
		const ah = new Autohost(gm);
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
		const gm = new GamesManager({ runEngineFn: () => er });
		const ah = new Autohost(gm);
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
		const gm = new GamesManager({ runEngineFn: () => er });
		const ah = new Autohost(gm);
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
		const gm = new GamesManager({ runEngineFn: () => er });
		const ah = new Autohost(gm);
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
		const gm = new GamesManager({ runEngineFn: () => er });
		const ah = new Autohost(gm);
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
		const gm = new GamesManager({ runEngineFn: () => er });
		const ah = new Autohost(gm);
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
		const gm = new GamesManager({ runEngineFn: () => er });
		const ah = new Autohost(gm);
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
		const gm = new GamesManager({ runEngineFn: () => er });
		const ah = new Autohost(gm);
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
		const gm = new GamesManager({ runEngineFn: fakeRunEngine });
		const ah = new Autohost(gm);
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
		const gm = new GamesManager({ runEngineFn: fakeRunEngine });
		const ah = new Autohost(gm);
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
		const gm = new GamesManager({ runEngineFn: () => er });
		const ah = new Autohost(gm);
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
});
