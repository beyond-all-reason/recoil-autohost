import { mock, suite, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { GamesManager } from './games.js';
import { Autohost, _getPlayerIds } from './autohost.js';
import { fakeRunEngine, EngineRunnerFake } from './engineRunner.fake.js';
import { AutohostStartRequestData } from 'tachyon-protocol/types';
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

		await assert.rejects(async () => {
			await ah.start(req2);
		});

		// rejects even after the previous battle is done
		process.nextTick(() => er.close());
		await once(gm, 'exit');
		await assert.rejects(async () => {
			await ah.start(req2);
		});
	});

	test('simple tachyon connect/disconnect', () => {
		const gm = new GamesManager({ runEngineFn: fakeRunEngine });
		const ah = new Autohost(gm);
		const ts = { update: async () => {}, status: mock.fn(async () => {}) };
		ah.connected(ts);
		assert.equal(ts.status.mock.callCount(), 1);
		ah.disconnected();
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
		await assert.rejects(async () => {
			await ah.kill({ battleId: 'asdasd' });
		}, /.*doesn't exist.*/i);
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
		await assert.rejects(async () => {
			await ah.sendCommand({ battleId: 'asdasd', command: 'asd' });
		}, /.*doesn't exist.*/i);
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
		await assert.rejects(async () => {
			await ah.kickPlayer({
				battleId: req.battleId,
				userId: '11',
			});
		}, /player/i);
	});

	await test('kickPlayer not found battle', async () => {
		const er = new EngineRunnerFake();
		const gm = new GamesManager({ runEngineFn: () => er });
		const ah = new Autohost(gm);
		const req = createStartRequest([{ name: 'user1', userId: '10' }]);
		await ah.start(req);
		await assert.rejects(async () => {
			await ah.kickPlayer({
				battleId: 'asdasdasd',
				userId: '10',
			});
		}, /battle/i);
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
		await assert.rejects(async () => {
			await ah.specPlayers({
				battleId: req.battleId,
				userIds: ['12', '10', '15'],
			});
		});
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
		await assert.rejects(async () => {
			await ah.addPlayer({
				battleId: req.battleId,
				name: 'user1',
				userId: '11',
				password: 'pass123',
			});
		});
	});

	await test('addPlayer same user id different name', async () => {
		const gm = new GamesManager({ runEngineFn: fakeRunEngine });
		const ah = new Autohost(gm);
		const req = createStartRequest([{ name: 'user1', userId: '10' }]);
		await ah.start(req);
		await assert.rejects(async () => {
			await ah.addPlayer({
				battleId: req.battleId,
				name: 'user2',
				userId: '10',
				password: 'pass123',
			});
		});
	});
});
