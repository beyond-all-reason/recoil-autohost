/**
 * This module contains helpers to parse, validate and serialize Tachyon protocol messages.
 *
 * There is very little business logic in this module, and it works as a bridge between the
 * schemas and the actual implementation of the Tachyon protocol. Most of this code could be
 * automatically generated, but it's small enough that it's not worth the effort at the moment.
 */
import { randomUUID } from 'node:crypto';
import { Ajv } from 'ajv';
import ajvFormatsModule from 'ajv-formats';
const addFormats = ajvFormatsModule.default;

// Import all the schemas
import KillRequestSchema from './schemas/killRequest.json' with { type: 'json' };
import PlayerAddRequestSchema from './schemas/playerAddRequest.json' with { type: 'json' };
import PlayerKickRequestSchema from './schemas/playerKickRequest.json' with { type: 'json' };
import PlayerMuteRequestSchema from './schemas/playerMuteRequest.json' with { type: 'json' };
import PlayersSpecRequestSchema from './schemas/playersSpecRequest.json' with { type: 'json' };
import SendCommandRequestSchema from './schemas/sendCommandRequest.json' with { type: 'json' };
import SendMessageRequestSchema from './schemas/sendMessageRequest.json' with { type: 'json' };
import StartRequestSchema from './schemas/startRequest.json' with { type: 'json' };
import StartResponseSchema from './schemas/startResponse.json' with { type: 'json' };
import StatusEventSchema from './schemas/statusEvent.json' with { type: 'json' };
import SubscribeUpdatesRequestSchema from './schemas/subscribeUpdatesRequest.json' with { type: 'json' };
import TachyonMessageSchema from './schemas/tachyonMessage.json' with { type: 'json' };
import UpdateEventSchema from './schemas/updateEvent.json' with { type: 'json' };

const schemas = [
	StartRequestSchema,
	KillRequestSchema,
	PlayerAddRequestSchema,
	PlayerKickRequestSchema,
	PlayerMuteRequestSchema,
	PlayersSpecRequestSchema,
	SendCommandRequestSchema,
	SendMessageRequestSchema,
	StartResponseSchema,
	StatusEventSchema,
	SubscribeUpdatesRequestSchema,
	TachyonMessageSchema,
	UpdateEventSchema,
];
const ajv = new Ajv({ schemas, strict: true });
ajv.addVocabulary(['tsType']);
addFormats(ajv);

/**
 * Precompiles all the schemas so they are ready to be used for validation.
 *
 * It's refactored into a function so it can be called explicitly and not just when the module is
 * imported even in unrelated unit tests.
 */
export function precompileSchemas() {
	for (const schema of schemas) {
		ajv.getSchema(schema.$id);
	}
}

// Now let's import all the generated types
import type { KillRequest } from './types/killRequest.js';
import type { PlayerAddRequest } from './types/playerAddRequest.js';
import type { PlayerKickRequest } from './types/playerKickRequest.js';
import type { PlayerMuteRequest } from './types/playerMuteRequest.js';
import type { PlayersSpecRequest } from './types/playersSpecRequest.js';
import type { SendCommandRequest } from './types/sendCommandRequest.js';
import type { SendMessageRequest } from './types/sendMessageRequest.js';
import type { StartRequest } from './types/startRequest.js';
import type { StartResponse } from './types/startResponse.js';
import type { StatusEvent } from './types/statusEvent.js';
import type { SubscribeUpdatesRequest } from './types/subscribeUpdatesRequest.js';
import type { UpdateEvent } from './types/updateEvent.js';
import type {
	TachyonEvent,
	TachyonMessage,
	TachyonRequest,
	TachyonResponseFail,
	TachyonResponseOk,
} from './types/tachyonMessage.js';

// Export all the message types for convenience
export {
	KillRequest,
	PlayerAddRequest,
	PlayerKickRequest,
	PlayerMuteRequest,
	PlayersSpecRequest,
	SendCommandRequest,
	SendMessageRequest,
	StartRequest,
	StartResponse,
	StatusEvent,
	SubscribeUpdatesRequest,
	UpdateEvent,
	TachyonEvent,
	TachyonMessage,
	TachyonRequest,
	TachyonResponseFail,
	TachyonResponseOk,
};

/**
 * A custom error class to represent errors that can be returned by the Tachyon protocol.
 *
 * To be used primarily by the autohost interface implementation. All generic errors
 * otherwise will be caught and transformed into a generic internal error.
 */
export class TachyonError extends Error {
	constructor(
		public readonly reason: TachyonResponseFail['reason'],
		public readonly details: string,
	) {
		super(`failed with reason ${reason}: ${details}`);
		this.name = 'TachyonError';
	}
}

/**
 * The interface that the autohost should implement to handle Tachyon protocol messages
 * for the autohost protocol commands.
 */
export interface TachyonAutohost {
	start(request: StartRequest): Promise<StartResponse>;
	kill(request: KillRequest): Promise<void>;
	playerAdd(request: PlayerAddRequest): Promise<void>;
	playerKick(request: PlayerKickRequest): Promise<void>;
	playerMute(request: PlayerMuteRequest): Promise<void>;
	playersSpec(request: PlayersSpecRequest): Promise<void>;
	sendCommand(request: SendCommandRequest): Promise<void>;
	sendMessage(request: SendMessageRequest): Promise<void>;
	subscribeUpdates(request: SubscribeUpdatesRequest): Promise<void>;
	connected(server: TachyonServer): void;
	disconnected(): void;
}

/**
 * The interface that represents the functionality that the autohost can call on the server.
 */
export interface TachyonServer {
	status(event: StatusEvent): void;
	update(event: UpdateEvent): void;
}

function dispatchTachyonAutohostCall(
	req: TachyonRequest,
	autohost: TachyonAutohost,
): Promise<StartResponse | void> {
	//
	// !!! WARNING !!!
	//
	// This switch is the most dangerous one in this file, because we do literal resolution of the
	// commandId to type. So if we make typo or cast to wrong type static analysis won't catch it.
	switch (req.commandId) {
		case 'autohost/start':
			return autohost.start(req.data as StartRequest);
		case 'autohost/kill':
			return autohost.kill(req.data as KillRequest);
		case 'autohost/playerAdd':
			return autohost.playerAdd(req.data as PlayerAddRequest);
		case 'autohost/playerKick':
			return autohost.playerKick(req.data as PlayerKickRequest);
		case 'autohost/playerMute':
			return autohost.playerMute(req.data as PlayerMuteRequest);
		case 'autohost/playersSpec':
			return autohost.playersSpec(req.data as PlayersSpecRequest);
		case 'autohost/sendCommand':
			return autohost.sendCommand(req.data as SendCommandRequest);
		case 'autohost/sendMessage':
			return autohost.sendMessage(req.data as SendMessageRequest);
		case 'autohost/subscribeUpdates':
			return autohost.subscribeUpdates(req.data as SubscribeUpdatesRequest);
		default:
			throw new Error(
				`Unknown command ${req.commandId}, that should never happen, it should have been caught by the validator`,
			);
	}
}

/**
 * Calls the appropriate method in the autohost given a Tachyon request object.
 *
 * It will validate the request, dispatch the call to the autohost interface instance, and return
 * a proper Tachyon response object ready to be serialized.
 */
export async function callTachyonAutohost(
	req: TachyonRequest,
	autohost: TachyonAutohost,
): Promise<TachyonResponseOk | TachyonResponseFail> {
	try {
		const validator = ajv.getSchema(
			`https://beyondallreason.dev/schema/tachyon/${req.commandId}/request`,
		);
		if (!validator) {
			throw new TachyonError(
				'unknown_command',
				`${req.commandId} of type request not recognized by autohost`,
			);
		}
		const valid = validator(req.data);
		if (!valid) {
			throw new TachyonError(
				'invalid_request',
				`Failed to validate command ${req.commandId} data: ${ajv.errorsText(validator.errors)}`,
			);
		}
		const respData = await dispatchTachyonAutohostCall(req, autohost);
		return {
			type: 'response',
			status: 'success',
			messageId: req.messageId,
			commandId: req.commandId,
			data: respData,
		};
	} catch (error) {
		const tachyonErr: TachyonResponseFail = {
			type: 'response',
			status: 'failed',
			messageId: req.messageId,
			commandId: req.commandId,
			reason: 'internal_error',
		};
		if (error instanceof TachyonError) {
			tachyonErr.reason = error.reason;
			tachyonErr.details = error.details;
		}
		return tachyonErr;
	}
}

/**
 * Parses a Tachyon message from a string.
 *
 * It won't validate the command nor command data, and only the top level tachyon message
 * structure.
 */
export function parseTachyonMessage(message: string): TachyonMessage {
	const parsed = JSON.parse(message);
	const valid = ajv.getSchema('https://beyondallreason.dev/schema/tachyon/message');
	if (!valid) {
		throw new Error('Failed to find the root request schema, this should never happen');
	}
	if (!valid(parsed)) {
		throw new Error(`Failed to validate the root request: ${ajv.errorsText(valid.errors)}`);
	}
	return parsed as TachyonMessage;
}

// Another, last one, dangerous mapping that can't be statically checked.
interface _EventTypeHelper {
	'autohost/status': StatusEvent;
	'autohost/update': UpdateEvent;
}

/**
 * Creates a proper tachyon message given the event type and the event data.
 */
export function createTachyonEvent<S extends string & keyof _EventTypeHelper>(
	status: S,
	event: _EventTypeHelper[S],
): TachyonEvent {
	return {
		type: 'event',
		messageId: randomUUID(),
		commandId: status,
		data: event,
	};
}
