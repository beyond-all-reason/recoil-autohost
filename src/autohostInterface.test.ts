import test from 'node:test';
import assert from 'node:assert/strict';

import {
	parsePacket,
	EventType,
	LuaMsgScript,
	LuaMsgUIMode,
	PacketParseError,
	LeaveReason,
	ReadyState,
	ChatDestination,
	PacketSerializeError,
	serializeMessagePacket,
	serializeCommandPacket,
} from './autohostInterface.js';

test('parse SERVER_STARTED', () => {
	const event = parsePacket(Buffer.from('00', 'hex'));
	assert.equal(event.type, EventType.SERVER_STARTED);

	assert.throws(() => {
		parsePacket(Buffer.from('0000', 'hex'));
	}, PacketParseError);
});

test('parse SERVER_QUIT', () => {
	const event = parsePacket(Buffer.from('01', 'hex'));
	assert.equal(event.type, EventType.SERVER_QUIT);

	assert.throws(() => {
		parsePacket(Buffer.from('0100', 'hex'));
	}, PacketParseError);
});

test('parse SERVER_STARTPLAYING', () => {
	const event = parsePacket(
		Buffer.from(
			'02a40000002e9836666a18a55fbcc6228ee62217492f686f6d652f73706164732f73706164732f7661722f436c75737465724d616e616765722f5b7465685d636c75737465725553345b31305d2f64656d6f732d7365727665722f323032342d30352d30345f32302d31382d35342d3236305f48656c6c617320426173696e2076315f3130352e312e312d323434392d6766313233346139204241523130352e7364667a',
			'hex',
		),
	);
	assert.deepEqual(event, {
		type: EventType.SERVER_STARTPLAYING,
		gameId: '2e9836666a18a55fbcc6228ee6221749',
		demoPath:
			'/home/spads/spads/var/ClusterManager/[teh]clusterUS4[10]/demos-server/2024-05-04_20-18-54-260_Hellas Basin v1_105.1.1-2449-gf1234a9 BAR105.sdfz',
	});

	assert.throws(() => {
		parsePacket(Buffer.from('0200', 'hex'));
	}, PacketParseError);

	assert.throws(() => {
		parsePacket(
			Buffer.from(
				'02a40000002e9836666a18a55fbcc6228ee62217492f686f6d652f73706164732f73706164732f7661722f436c75737465724d616e616765722f5b7465685d636c75737465725553345b3130',
				'hex',
			),
		);
	}, PacketParseError);
});

test('parse SERVER_GAMEOVER', () => {
	const event = parsePacket(Buffer.from('03040601', 'hex'));
	assert.deepEqual(event, {
		type: EventType.SERVER_GAMEOVER,
		player: 6,
		winningAllyTeams: [1],
	});

	assert.throws(() => {
		parsePacket(Buffer.from('030406', 'hex'));
	}, PacketParseError);
});

test('parse SERVER_MESSAGE', () => {
	const event = parsePacket(
		Buffer.from(
			'04436f6e6e656374696e6720746f206175746f686f7374206f6e20706f7274203533313232',
			'hex',
		),
	);
	assert.deepEqual(event, {
		type: EventType.SERVER_MESSAGE,
		message: 'Connecting to autohost on port 53122',
	});
});

test('parse SERVER_WARNING', () => {
	const event = parsePacket(Buffer.from('054f6e6c696e65207761726e696e67206c6f6c', 'hex'));
	assert.deepEqual(event, {
		type: EventType.SERVER_WARNING,
		message: 'Online warning lol',
	});
});

test('parse PLAYER_JOINED', () => {
	const event = parsePacket(Buffer.from('0a0b417865', 'hex'));
	assert.deepEqual(event, {
		type: EventType.PLAYER_JOINED,
		player: 11,
		name: 'Axe',
	});
	assert.throws(() => {
		parsePacket(Buffer.from('0a0b', 'hex'));
	}, PacketParseError);
});

test('parse PLAYER_LEFT', () => {
	assert.deepEqual(parsePacket(Buffer.from('0b1201', 'hex')), {
		type: EventType.PLAYER_LEFT,
		player: 18,
		reason: LeaveReason.LEFT,
	});
	assert.deepEqual(parsePacket(Buffer.from('0b0400', 'hex')), {
		type: EventType.PLAYER_LEFT,
		player: 4,
		reason: LeaveReason.LOST_CONNECTION,
	});
	assert.deepEqual(parsePacket(Buffer.from('0b1202', 'hex')), {
		type: EventType.PLAYER_LEFT,
		player: 18,
		reason: LeaveReason.KICKED,
	});
	assert.throws(() => {
		parsePacket(Buffer.from('0b12', 'hex'));
	}, PacketParseError);
	assert.throws(() => {
		parsePacket(Buffer.from('0b1203', 'hex'));
	}, PacketParseError);
});

test('parse PLAYER_READY', () => {
	assert.deepEqual(parsePacket(Buffer.from('0c0200', 'hex')), {
		type: EventType.PLAYER_READY,
		player: 2,
		state: ReadyState.NOT_READY,
	});
	assert.deepEqual(parsePacket(Buffer.from('0c0d01', 'hex')), {
		type: EventType.PLAYER_READY,
		player: 13,
		state: ReadyState.READY,
	});
	assert.deepEqual(parsePacket(Buffer.from('0c0d02', 'hex')), {
		type: EventType.PLAYER_READY,
		player: 13,
		state: ReadyState.FORCED,
	});
	assert.throws(() => {
		parsePacket(Buffer.from('0c0d', 'hex'));
	}, PacketParseError);
	assert.throws(() => {
		parsePacket(Buffer.from('0b1204', 'hex'));
	}, PacketParseError);
});

test('parse PLAYER_CHAT', () => {
	assert.deepEqual(parsePacket(Buffer.from('0d08fc6e696365', 'hex')), {
		type: EventType.PLAYER_CHAT,
		fromPlayer: 8,
		destination: ChatDestination.TO_ALLIES,
		message: 'nice',
	});
	assert.deepEqual(parsePacket(Buffer.from('0d0bfe72657369676e', 'hex')), {
		type: EventType.PLAYER_CHAT,
		fromPlayer: 11,
		destination: ChatDestination.TO_EVERYONE,
		message: 'resign',
	});
	assert.deepEqual(parsePacket(Buffer.from('0d11fd6c6f6c', 'hex')), {
		type: EventType.PLAYER_CHAT,
		fromPlayer: 17,
		destination: ChatDestination.TO_SPECTATORS,
		message: 'lol',
	});
	assert.deepEqual(parsePacket(Buffer.from('0d11016c6f6c', 'hex')), {
		type: EventType.PLAYER_CHAT,
		fromPlayer: 17,
		toPlayer: 1,
		destination: ChatDestination.TO_PLAYER,
		message: 'lol',
	});
	assert.throws(() => {
		parsePacket(Buffer.from('0d11', 'hex'));
	}, PacketParseError);
});

test('parse PLAYER_DEFEATED', () => {
	assert.deepEqual(parsePacket(Buffer.from('0e0b', 'hex')), {
		type: EventType.PLAYER_DEFEATED,
		player: 11,
	});
	assert.throws(() => {
		parsePacket(Buffer.from('0e', 'hex'));
	}, PacketParseError);
});

test('parse GAME_LUAMSG', () => {
	const event1 = parsePacket(Buffer.from('14320c000a640000407a683630', 'hex'));
	assert.deepEqual(event1, {
		type: EventType.GAME_LUAMSG,
		script: LuaMsgScript.RULES,
		player: 10,
		data: Buffer.from('407a683630', 'hex'),
	});

	const event2 = parsePacket(
		Buffer.from('1432180000d0070044726166744f726465725f52616e646f6d', 'hex'),
	);
	assert.deepEqual(event2, {
		type: EventType.GAME_LUAMSG,
		script: LuaMsgScript.UI,
		uiMode: LuaMsgUIMode.ALL,
		player: 0,
		data: Buffer.from('DraftOrder_Random'),
	});

	assert.throws(() => {
		parsePacket(Buffer.from('143200', 'hex'));
	}, PacketParseError);

	assert.throws(() => {
		parsePacket(Buffer.from('14330c000a640000407a683630', 'hex'));
	}, PacketParseError);
});

test('parse GAME_TEAMSTAT', () => {
	const event = parsePacket(
		Buffer.from(
			'3c0700e10000ade0ad470abc944a8c38d747b4138f4a000000004a052144a2208244d308ca48f19406461fdc5148da6d3f478c976947f50100000e010000010000000600000000000000000000004c000000',
			'hex',
		),
	);
	assert.deepEqual(event, {
		type: EventType.GAME_TEAMSTAT,
		teamNumber: 7,
		// I hope that floating point numbers in decimal are precise enough
		// for this test to work reliably...
		stats: {
			frame: 57600,
			metalUsed: 89025.3515625,
			energyUsed: 4873733,
			metalProduced: 110193.09375,
			energyProduced: 4688346,
			metalExcess: 0,
			energyExcess: 644.0826416015625,
			metalReceived: 1041.019775390625,
			energyReceived: 413766.59375,
			metalSent: 8613.2353515625,
			energySent: 214896.484375,
			damageDealt: 49005.8515625,
			damageReceived: 59799.546875,
			unitsProduced: 501,
			unitsDied: 270,
			unitsReceived: 1,
			unitsSent: 6,
			unitsCaptured: 0,
			unitsOutCaptured: 0,
			unitsKilled: 76,
		},
	});
	assert.throws(() => {
		parsePacket(Buffer.from('3c0700e10000ade0', 'hex'));
	}, PacketParseError);
});

test('serialize message', () => {
	assert.deepEqual(serializeMessagePacket('msg'), Buffer.from('msg'));
	assert.deepEqual(serializeMessagePacket('/asdasd'), Buffer.from('//asdasd'));
	assert.deepEqual(serializeMessagePacket('//asd'), Buffer.from('///asd'));
	assert.deepEqual(serializeMessagePacket(''), Buffer.from(''));
	assert.throws(() => {
		serializeMessagePacket('a'.repeat(200));
	}, PacketSerializeError);
});

test('serialize command', () => {
	assert.deepEqual(serializeCommandPacket('cmd', []), Buffer.from('/cmd'));
	assert.deepEqual(serializeCommandPacket('a', ['1', '2', 'asd']), Buffer.from('/a 1 2 asd'));
	assert.deepEqual(
		serializeCommandPacket('b', ['1', '2', 'some text with stuff']),
		Buffer.from('/b 1 2 some text with stuff'),
	);
	assert.throws(() => {
		serializeCommandPacket('', ['1', '2']);
	}, PacketSerializeError);
	assert.throws(() => {
		serializeCommandPacket('a', ['', '2']);
	}, PacketSerializeError);
	assert.throws(() => {
		serializeCommandPacket('cmd', ['asd asd', 'asd asd']);
	}, PacketSerializeError);
	assert.throws(() => {
		serializeCommandPacket('cmd', ['asd', 'asd //asd']);
	}, PacketSerializeError);
});

/**
 * You can dump the network traffic with tcpdump:
 *
 *   sudo tcpdump -i lo -w autohost.pcap udp portrange 53100-53250
 *
 * and then use the code similar to below to analyze the pcap file.

import pcap from 'pcap';
import util from 'node:util';

const session = pcap.createOfflineSession('/path/to/autohost.pcap.pcap');

let count = 0;
let totalCount = 0;
const typeMap = new Map();

session.on('packet', (rawPacket) => {
	const packet = pcap.decode.packet(rawPacket);
	totalCount++;

	const sport = packet.payload.payload.payload.sport;
	if (sport >= 53100 && sport <= 53250) {
		return;
	}

	const decoded = parsePacket(packet.payload.payload.payload.data);
	typeMap.set(decoded.type, (typeMap.get(decoded.type) || 0) + 1);


	// Filter out some events
	if (decoded.type != EventType.PLAYER_JOINED) {
		return;
	}
	count++;
	if (count >= 100) {
		session.close();
	}

	console.log(EventType[decoded.type], decoded);
	console.log(packet.payload.payload.payload.data.toString('hex'));
	console.log(util.inspect(packet.payload.payload.payload, { depth: null }));
});

session.on('complete', () => {
	console.log('total:', totalCount);
	Array.from(typeMap.keys()).sort((a, b) => a - b).forEach((key) => {
		console.log(`  ${EventType[key]}[${key}] => ${typeMap.get(key)}`);
	});
});

*/
