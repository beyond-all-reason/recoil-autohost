import test from 'node:test';
import assert from 'node:assert/strict';
import { StartRequest } from './types/startRequest.js';
import { scriptGameFromStartRequest } from './startScriptGen.js';

test('simple full example', () => {
	const startReq: StartRequest = {
		gameUUID: 'e4f9f751-3626-48eb-bb8b-1ff8f25e12f9',
		engineVersion: 'recoil 2024.08.15-gdefse23',
		modName: 'Game 22',
		mapName: 'de_duck 1.2',
		modHash:
			'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
		mapHash:
			'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
		startPosType: 'ingame',
		gameStartDelay: 10,
		allyTeams: [
			{
				teams: [
					{
						players: [
							{
								name: 'Player 1',
								password: '87dw9cnqr86437w',
								countryCode: 'NA',
							},
						],
						side: 'ARM',
						color: {
							r: 1,
							g: 0,
							b: 0.5,
						},
						customOpts: {
							'specialModOption': 'asd',
						},
					},
				],
				startbox: {
					top: 0,
					left: 0,
					bottom: 0,
					right: 0.2,
				},
			},
			{
				teams: [
					{
						side: 'CORE',
						advantage: 0.5,
						incomeMultiplier: 1.2,
						startPos: {
							x: 100,
							z: 100,
						},
						ais: [
							{
								hostPlayer: 'Player 1',
								shortName: 'BARb',
								version: '3.2',
								name: 'AI 1',
								options: {
									'difficulty': 'op',
								},
							},
						],
					},
				],
				startbox: {
					top: 0,
					left: 0.8,
					bottom: 0,
					right: 1,
				},
			},
			{
				allies: [0],
				teams: [],
			},
		],
		spectators: [
			{
				name: 'Player 2',
				password: 'asd',
				countryCode: 'PL',
				rank: 1,
				customOpts: {
					'key': 'value',
				},
			},
		],
		mapOptions: {
			'waterLevel': '1000',
		},
		modOptions: {
			'bigGun': 'asdasd',
		},
		restrictions: {
			'unitname': 20,
			'anotherunit': 30,
		},
	};

	const expected = {
		'GameID': 'e4f9f751-3626-48eb-bb8b-1ff8f25e12f9',
		'GameType': 'Game 22',
		'MapName': 'de_duck 1.2',
		'ModHash':
			'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
		'MapHash':
			'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
		'StartPosType': 2,
		'GameStartDelay': 10,
		'MODOPTIONS': {
			'bigGun': 'asdasd',
		},
		'MAPOPTIONS': {
			'waterLevel': '1000',
		},
		'NumRestrictions': 2,
		'RESTRICT': {
			'Unit0': 'unitname',
			'Limit0': 20,
			'Unit1': 'anotherunit',
			'Limit1': 30,
		},
		'ALLYTEAM0': {
			'StartRectTop': 0,
			'StartRectLeft': 0,
			'StartRectBottom': 0,
			'StartRectRight': 0.2,
		},
		'TEAM0': {
			'AllyTeam': 0,
			'TeamLeader': 0,
			'Side': 'ARM',
			'RgbColor': '1 0 0.5',
			'specialModOption': 'asd',
		},
		'PLAYER0': {
			'Name': 'Player 1',
			'Password': '87dw9cnqr86437w',
			'Team': 0,
			'CountryCode': 'NA',
		},
		'ALLYTEAM1': {
			'StartRectTop': 0,
			'StartRectLeft': 0.8,
			'StartRectBottom': 0,
			'StartRectRight': 1,
		},
		'TEAM1': {
			'AllyTeam': 1,
			'TeamLeader': 0,
			'IncomeMultiplier': 1.2,
			'Side': 'CORE',
			'Advantage': 0.5,
			'StartPosX': 100,
			'StartPosZ': 100,
		},
		'AI0': {
			'Name': 'AI 1',
			'ShortName': 'BARb',
			'Host': 0,
			'Team': 1,
			'Version': '3.2',
			'OPTIONS': {
				'difficulty': 'op',
			},
		},
		'ALLYTEAM2': {
			'NumAllies': 1,
			'Ally0': 0,
		},
		'PLAYER1': {
			'Name': 'Player 2',
			'Password': 'asd',
			'Spectator': 1,
			'CountryCode': 'PL',
			'Rank': 1,
			'key': 'value',
		},
		'NumAllyTeams': 3,
		'NumTeams': 2,
		'NumPlayers': 2,
	};

	const actual = scriptGameFromStartRequest(startReq);

	assert.deepStrictEqual(actual, expected);
});

const throwStartReqBase: StartRequest = {
	gameUUID: 'e4f9f751-3626-48eb-bb8b-1ff8f25e12f9',
	engineVersion: 'recoil 2024.08.15-gdefse23',
	modName: 'Game 22',
	mapName: 'de_duck 1.2',
	startPosType: 'ingame',
	allyTeams: [{ teams: [] }],
};

test('throw on non-unique players', () => {
	// Players in different teams.
	const startReq1: StartRequest = {
		...throwStartReqBase,
		allyTeams: [
			{
				teams: [
					{
						players: [
							{
								name: 'Player 1',
								password: '87dw9cnqr86437w',
							},
						],
					},
				],
			},
			{
				teams: [
					{
						players: [
							{
								name: 'Player 1',
								password: '87dw9cnqr86437w',
							},
						],
					},
				],
			},
		],
	};
	assert.throws(() => scriptGameFromStartRequest(startReq1));

	// Also in spectators.
	const startReq2: StartRequest = {
		...throwStartReqBase,
		allyTeams: [
			{
				teams: [
					{
						players: [
							{
								name: 'Player 1',
								password: '87dw9cnqr86437w',
							},
						],
					},
				],
			},
		],
		spectators: [
			{
				name: 'Player 1',
				password: '87dw9cnqr86437w',
			},
		],
	};
	assert.throws(() => scriptGameFromStartRequest(startReq2));
});

test('at least one ai/player is required', () => {
	const startReq: StartRequest = {
		...throwStartReqBase,
		allyTeams: [
			{
				teams: [{}],
			},
		],
	};
	assert.throws(() => scriptGameFromStartRequest(startReq));
});

test("custom opts can't override built-in fields", () => {
	const startReq: StartRequest = {
		...throwStartReqBase,
		allyTeams: [
			{
				teams: [
					{
						players: [
							{
								name: 'Player 1',
								password: '87dw9cnqr86437w',
							},
						],
						customOpts: {
							'AllyTeam': '1',
						},
					},
				],
			},
		],
	};
	assert.throws(() => scriptGameFromStartRequest(startReq));
});

test('ai must reference existing player', () => {
	const startReq: StartRequest = {
		...throwStartReqBase,
		allyTeams: [
			{
				teams: [
					{
						players: [
							{
								name: 'Player 1',
								password: '87dw9cnqr86437w',
							},
						],
						ais: [
							{
								hostPlayer: 'Player 2',
								shortName: 'BARb',
							},
						],
					},
				],
			},
		],
	};
	assert.throws(() => scriptGameFromStartRequest(startReq));
});
