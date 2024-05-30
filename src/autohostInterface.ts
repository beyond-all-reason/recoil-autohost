/**
 * This module provides a parser and serializer for the autohost interface packets.
 *
 * Unfortunately, the autohost interface is not documented, so the parser is based on
 * the implementation in the engine code and validation against actual packets
 * in the wild in BAR. Even for the pieces that are documented, the documentation is
 * often incorrect or incomplete.
 */

/**
 * This enum values are from rts/Net/AutohostInterface.cpp and the comments are
 * fixed to match the reality.
 *
 * Each packet from engine to autohost interface starts with a byte that
 * indicates the type of the message, followed by the message-specific data.
 * In the documentation the message-specific data is described as a list of
 * fields, in brackets.
 *
 * char[] are *not* delimited in any way e.g. by '\0', so they can be used only
 * as a last element of the UDP packet.
 */
export enum EventType {
	/**
	 * Server has started
	 *
	 *   ()
	 */
	SERVER_STARTED = 0,

	/**
	 * Server is about to exit
	 *
	 *   ()
	 */
	SERVER_QUIT = 1,

	/**
	 * Game starts
	 *
	 *   (uint32 msgsize, uint8[16] gameId, char[] demoName)
	 */
	SERVER_STARTPLAYING = 2,

	/**
	 * Game has ended
	 *
	 *   (uint8 player, uint8 msgsize, uint8[msgsize - 3] winningAllyTeamss)
	 */
	SERVER_GAMEOVER = 3,

	/**
	 * An information message from server
	 *
	 *   (char[] message)
	 */
	SERVER_MESSAGE = 4,

	/**
	 * A warning message from server
	 *
	 *   (char[] warningmessage)
	 */
	SERVER_WARNING = 5,

	/**
	 * Player has joined the game
	 *
	 *   (uint8 playernumber, char[] name)
	 */
	PLAYER_JOINED = 10,

	/**
	 * Player has left
	 *
	 *   (uint8 playernumber, uint8 reason)
	 *
	 * Reason:
	 *   - 0: lost connection
	 *   - 1: left
	 *   - 2: kicked
	 */
	PLAYER_LEFT = 11,

	/**
	 * Player has updated its ready-state
	 *
	 *   (uint8 playernumber, uint8 state)
	 *
	 * State:
	 *   - 0: not ready
	 *   - 1: ready
	 *   - 2: forced
	 *   - 3: failed to ready (in engine code it says it's not clear if possible)
	 */
	PLAYER_READY = 12,

	/**
	 * Player has sent a chat message
	 *
	 *   (uint8 playernumber, uint8 destination, char[] text)
	 *
	 * Destination can be any of:
	 *   - a playernumber
	 *   - TO_ALLIES = 252
	 *   - TO_SPECTATORS = 253
	 *   - TO_EVERYONE = 254
	 *
	 * Enum values from rts/Game/ChatMessage.h, value 255 is a SERVER_PLAYER
	 * but in this context, it's meaningless, server doesn't do anything with
	 * them, messages that don't match any player are not used for anything and
	 * nobody sees them.
	 */
	PLAYER_CHAT = 13,

	/**
	 * Player has been defeated
	 *
	 *   (uint8 playernumber)
	 */
	PLAYER_DEFEATED = 14,

	/**
	 * Message sent by Lua script
	 *
	 *   (uint8 magic = 50, uint16 msgsize, uint8 playernumber, uint16 script, uint8 uiMode, uint8[msgsize - 8] data)
	 *
	 * The message data is a straight copy of the whole NETMSG_LUAMSG packet
	 * including the magic 50 byte. Take a look at the engine code for
	 * CBaseNetProtocol::SendLuaMsg function and all of it's callers to see
	 * how it's constructed.
	 */
	GAME_LUAMSG = 20,

	/**
	 * Team statistics
	 *
	 *   (uint8 teamnumber, TeamStatistics stats)
	 *
	 * TeamStatistics is object as defined in rts/Sim/Misc/TeamStatistics.h
	 */
	GAME_TEAMSTAT = 60,
}

export interface EvServerStarted {
	type: EventType.SERVER_STARTED;
}

export interface EvServerQuit {
	type: EventType.SERVER_QUIT;
}

export interface EvServerStartPlaying {
	type: EventType.SERVER_STARTPLAYING;
	gameId: string;
	demoPath: string;
}

export interface EvServerGameOver {
	type: EventType.SERVER_GAMEOVER;
	player: number;
	winningAllyTeams: number[];
}

export interface EvServerMessage {
	type: EventType.SERVER_MESSAGE;
	message: string;
}

export interface EvServerWarning {
	type: EventType.SERVER_WARNING;
	message: string;
}

export interface EvPlayerJoined {
	type: EventType.PLAYER_JOINED;
	player: number;
	name: string;
}

export enum LeaveReason {
	LOST_CONNECTION = 0,
	LEFT = 1,
	KICKED = 2,
}

export interface EvPlayerLeft {
	type: EventType.PLAYER_LEFT;
	player: number;
	reason: LeaveReason;
}

// This is based on enum values in rts/Game/Players/Player.h
// For all BAR logs, the only values I saw are NOT_READY and FORCED.
export enum ReadyState {
	NOT_READY = 0,
	READY = 1,
	FORCED = 2,
	FAILED = 3,
}

export interface EvPlayerReady {
	type: EventType.PLAYER_READY;
	player: number;
	state: ReadyState;
}

// Enum values from rts/Game/ChatMessage.h
export enum ChatDestination {
	TO_PLAYER = 0,
	TO_ALLIES = 252,
	TO_SPECTATORS = 253,
	TO_EVERYONE = 254,
}

export interface EvPlayerChat {
	type: EventType.PLAYER_CHAT;
	fromPlayer: number;

	/**
	 * If destination is TO_PLAYER, this field is set.
	 */
	toPlayer?: number;
	destination: ChatDestination;
	message: string;
}

export interface EvPlayerDefeated {
	type: EventType.PLAYER_DEFEATED;
	player: number;
}

// The allowed values are determined from all the calls to
// CBaseNetProtocol::SendLuaMsg function in engine.
export enum LuaMsgScript {
	UI = 2000,
	GAIA = 300,
	RULES = 100,
}

// From implementation of LuaUnsyncedCtrl::SendLuaUIMsg.
export enum LuaMsgUIMode {
	ALL = 0,
	ALLIES = 0x61, // 'a'
	SPECTATORS = 0x73, // 's'
}

export interface EvGameLuaMsg {
	type: EventType.GAME_LUAMSG;
	player: number;
	script: LuaMsgScript;

	/**
	 * Field set only when script is LuaMsgScript.UI
	 */
	uiMode?: LuaMsgUIMode;

	/**
	 * What can be set in the bugger is determined entirely by the game.
	 *
	 * For example
	 * https://github.com/Jazcash/sdfz-demo-parser/blob/1068cafd49f2eca49c06874ab004a8408ed783f1/src/lua-parser.ts
	 * has some examples of what can be here and how to parse it.
	 */
	data: Buffer;
}

// From rts/Sim/Misc/TeamStatistics.h
export interface TeamStatistics {
	frame: number;
	metalUsed: number;
	energyUsed: number;
	metalProduced: number;
	energyProduced: number;
	metalExcess: number;
	energyExcess: number;
	metalReceived: number;
	energyReceived: number;
	metalSent: number;
	energySent: number;
	damageDealt: number;
	damageReceived: number;
	unitsProduced: number;
	unitsDied: number;
	unitsReceived: number;
	unitsSent: number;
	unitsCaptured: number;
	unitsOutCaptured: number;
	unitsKilled: number;
}

export interface EvGameTeamStat {
	type: EventType.GAME_TEAMSTAT;
	teamNumber: number;
	stats: TeamStatistics;
}

export type Event =
	| EvServerStarted
	| EvServerQuit
	| EvServerStartPlaying
	| EvServerGameOver
	| EvServerMessage
	| EvServerWarning
	| EvPlayerJoined
	| EvPlayerLeft
	| EvPlayerReady
	| EvPlayerChat
	| EvPlayerDefeated
	| EvGameLuaMsg
	| EvGameTeamStat;

export class PacketParseError extends Error {
	constructor(msg: string) {
		super(msg);
		this.name = 'DecodeError';
	}
}

/**
 * Parse a packet from the autohost interface.
 *
 * @param msg The packet to parse
 * @returns The parsed event object
 * @throws PacketParseError if the packet is invalid
 */
export function parsePacket(msg: Buffer): Event {
	if (msg.length < 1) {
		throw new PacketParseError('Empty packet');
	}
	const type = msg.readUInt8(0);
	switch (type) {
		case EventType.SERVER_STARTED:
			if (msg.length != 1) {
				throw new PacketParseError('SERVER_STARTED: invalid message length');
			}
			return { type };
		case EventType.SERVER_QUIT:
			if (msg.length != 1) {
				throw new PacketParseError('SERVER_QUIT: invalid message length');
			}
			return { type };
		case EventType.SERVER_STARTPLAYING: {
			if (msg.length < 5 + 16) {
				throw new PacketParseError('SERVER_STARTPLAYING: message too short');
			}
			const msgSize = msg.readUint32LE(1);
			if (msgSize != msg.length) {
				throw new PacketParseError(
					'SERVER_STARTPLAYING: msgSize does not match message length',
				);
			}
			return {
				type,
				gameId: msg.toString('hex', 5, 5 + 16),
				demoPath: msg.toString('utf8', 5 + 16),
			};
		}
		case EventType.SERVER_GAMEOVER: {
			if (msg.length < 3) {
				throw new PacketParseError('SERVER_GAMEOVER: message too short');
			}
			const msgSize = msg.readUInt8(1);
			if (msgSize != msg.length) {
				throw new PacketParseError(
					'SERVER_GAMEOVER: msgSize does not match message length',
				);
			}
			const winningAllyTeams = new Array<number>(msgSize - 3);
			for (let i = 0; i < msgSize - 3; i++) {
				winningAllyTeams[i] = msg.readUInt8(3 + i);
			}
			return { type, player: msg.readUInt8(2), winningAllyTeams };
		}
		case EventType.SERVER_MESSAGE:
			return { type, message: msg.toString('utf8', 1) };
		case EventType.SERVER_WARNING:
			return { type, message: msg.toString('utf8', 1) };
		case EventType.PLAYER_JOINED:
			if (msg.length < 3) {
				throw new PacketParseError('PLAYER_JOINED: message too short');
			}
			return { type, player: msg.readUInt8(1), name: msg.toString('utf8', 2) };
		case EventType.PLAYER_LEFT: {
			if (msg.length != 3) {
				throw new PacketParseError('PLAYER_LEFT: invalid message length');
			}
			const reason = msg.readUInt8(2);
			if (reason > 2) {
				throw new PacketParseError(`PLAYER_LEFT: invalid leave reason: ${reason}`);
			}
			return { type, player: msg.readUInt8(1), reason: reason as LeaveReason };
		}
		case EventType.PLAYER_READY: {
			if (msg.length != 3) {
				throw new PacketParseError('PLAYER_READY: invalid message length');
			}
			const state = msg.readUInt8(2);
			if (state > 3) {
				throw new PacketParseError(`PLAYER_READY: invalid ready state: ${state}`);
			}
			return { type, player: msg.readUInt8(1), state: state as ReadyState };
		}
		case EventType.PLAYER_CHAT: {
			if (msg.length < 3) {
				throw new PacketParseError('PLAYER_CHAT: message too short');
			}
			const destination = msg.readUInt8(2);
			// We split the destination into two fields for easier processing.
			let destinationType: ChatDestination;
			let toPlayer: number | undefined;
			if (
				destination == ChatDestination.TO_ALLIES ||
				destination == ChatDestination.TO_SPECTATORS ||
				destination == ChatDestination.TO_EVERYONE
			) {
				destinationType = destination;
			} else {
				toPlayer = destination;
				destinationType = ChatDestination.TO_PLAYER;
			}
			const res: EvPlayerChat = {
				type,
				fromPlayer: msg.readUInt8(1),
				destination: destinationType,
				message: msg.toString('utf8', 3),
			};
			if (toPlayer !== undefined) {
				res.toPlayer = toPlayer;
			}
			return res;
		}
		case EventType.PLAYER_DEFEATED:
			if (msg.length != 2) {
				throw new PacketParseError('PLAYER_DEFEATED: invalid message length');
			}
			return { type, player: msg.readUInt8(1) };
		case EventType.GAME_LUAMSG: {
			if (msg.length < 8) {
				throw new PacketParseError('GAME_LUAMSG: message too short');
			}
			const packetType = msg.readUInt8(1);
			if (packetType != 50) {
				throw new PacketParseError(`GAME_LUAMSG: invalid packet type: ${packetType}`);
			}
			const packetSize = msg.readUInt16LE(2);
			if (packetSize != msg.length - 1) {
				throw new PacketParseError(
					'GAME_LUAMSG: packet size does not match message length',
				);
			}
			const script = msg.readUInt16LE(5);
			if (
				script != LuaMsgScript.UI &&
				script != LuaMsgScript.GAIA &&
				script != LuaMsgScript.RULES
			) {
				throw new PacketParseError(`GAME_LUAMSG: invalid script: ${script}`);
			}
			const res: EvGameLuaMsg = {
				type,
				player: msg.readUInt8(4),
				script,
				data: msg.subarray(8),
			};
			const uiMode = msg.readUInt8(7);
			if (script == LuaMsgScript.UI) {
				if (
					uiMode != LuaMsgUIMode.ALL &&
					uiMode != LuaMsgUIMode.ALLIES &&
					uiMode != LuaMsgUIMode.SPECTATORS
				) {
					throw new PacketParseError(`GAME_LUAMSG: invalid UI mode: ${uiMode}`);
				}
				res.uiMode = uiMode;
			} else if (uiMode != 0) {
				throw new PacketParseError(
					`GAME_LUAMSG: expected mode 0 for ${LuaMsgScript[script]}, got ${uiMode}`,
				);
			}
			return res;
		}
		case EventType.GAME_TEAMSTAT: {
			if (msg.length != 82) {
				throw new PacketParseError(`GAME_TEAMSTAT: invalid message length (${msg.length})`);
			}
			let off;
			const stats: TeamStatistics = {
				frame: msg.readInt32LE((off = 2)),
				metalUsed: msg.readFloatLE((off += 4)),
				energyUsed: msg.readFloatLE((off += 4)),
				metalProduced: msg.readFloatLE((off += 4)),
				energyProduced: msg.readFloatLE((off += 4)),
				metalExcess: msg.readFloatLE((off += 4)),
				energyExcess: msg.readFloatLE((off += 4)),
				metalReceived: msg.readFloatLE((off += 4)),
				energyReceived: msg.readFloatLE((off += 4)),
				metalSent: msg.readFloatLE((off += 4)),
				energySent: msg.readFloatLE((off += 4)),
				damageDealt: msg.readFloatLE((off += 4)),
				damageReceived: msg.readFloatLE((off += 4)),
				unitsProduced: msg.readInt32LE((off += 4)),
				unitsDied: msg.readInt32LE((off += 4)),
				unitsReceived: msg.readInt32LE((off += 4)),
				unitsSent: msg.readInt32LE((off += 4)),
				unitsCaptured: msg.readInt32LE((off += 4)),
				unitsOutCaptured: msg.readInt32LE((off += 4)),
				unitsKilled: msg.readInt32LE((off += 4)),
			};
			return { type, teamNumber: msg.readUInt8(1), stats };
		}
	}
	throw new PacketParseError(`Unknown event type: ${type}`);
}

export class PacketSerializeError extends Error {
	constructor(msg: string) {
		super(msg);
		this.name = 'PacketSerializeError';
	}
}

/**
 * Serialize a chat message packet to send to the autohost interface.
 *
 * @param message Chat message to serialize
 * @returns Serialized buffer to send to autohost interface
 * @throws PacketSerializeError if the message is too long
 */
export function serializeMessagePacket(message: string): Buffer {
	if (message.length > 127) {
		throw new PacketSerializeError('Message too long');
	}
	if (message.length > 0 && message[0] == '/') {
		return Buffer.from('/' + message, 'utf8');
	}
	return Buffer.from(message, 'utf8');
}

/**
 * Serialize a command packet to send to the autohost interface.
 *
 * The implementation validates argument to ensure that Action::Action
 * in the engine can parse it correctly.
 *
 * @param command Command to serialize e.g. kick
 * @param args Arguments to serialize as to pass to the command
 * @returns Serialized buffer to send to autohost interface
 * @throws PacketSerializeError if the command or arguments contain invalid characters
 */
export function serializeCommandPacket(command: string, args: string[]): Buffer {
	if (!command.match(/^[a-z0-9_-]+$/)) {
		throw new PacketSerializeError('Invalid command name');
	}
	for (let i = 0; i < args.length - 1; i++) {
		if (args[i].match(/[ \t]|\/\/|^$/)) {
			throw new PacketSerializeError(`Invalid command argument ${i + 1}`);
		}
	}
	if (args.length > 0 && args[args.length - 1].match(/\/\/|^$/)) {
		throw new PacketSerializeError('Invalid last command argument');
	}
	return Buffer.from(['/' + command, ...args].join(' '), 'utf8');
}
