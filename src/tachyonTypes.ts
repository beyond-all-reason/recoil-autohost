/**
 * This module contains helpers to parse, validate and serialize Tachyon protocol messages.
 *
 * There is very little business logic in this module, and it works as a bridge between the
 * schemas and the actual implementation of the Tachyon protocol. Most of this code could be
 * automatically generated, but it's small enough that it's not worth the effort at the moment.
 */
import { type Logger } from 'pino';
import { type TachyonMeta, tachyonMeta } from 'tachyon-protocol';
import { validator } from 'tachyon-protocol/validators';
import { randomUUID } from 'node:crypto';
import { Ajv, type JSONSchemaType } from 'ajv';
import type {
	AutohostAddPlayerRequestData,
	AutohostKickPlayerRequestData,
	AutohostKillRequestData,
	AutohostMutePlayerRequestData,
	AutohostSendCommandRequestData,
	AutohostSendMessageRequestData,
	AutohostSpecPlayersRequestData,
	AutohostStartOkResponseData,
	AutohostStartRequestData,
	AutohostStatusEventData,
	AutohostSubscribeUpdatesRequestData,
	AutohostUpdateEventData,
	TachyonCommand,
} from 'tachyon-protocol/types';

export const TACHYON_PROTOCOL_VERSION = 'v0.tachyon';

// Top level message schema for Tachyon messages as they appear in the WebSocket.
export interface TachyonMessage {
	type: 'request' | 'response' | 'event';
	messageId: string;
	commandId: string;
}

const TachyonMessageSchema: JSONSchemaType<TachyonMessage> = {
	type: 'object',
	properties: {
		type: { type: 'string', enum: ['request', 'response', 'event'] },
		messageId: { type: 'string' },
		commandId: { type: 'string' },
	},
	required: ['messageId', 'commandId', 'type'],
	additionalProperties: true,
};

const ajv = new Ajv({ strict: true });
const validateTachyonMessage = ajv.compile(TachyonMessageSchema);

/**
 * Parses a Tachyon message from a string.
 *
 * It won't validate the command nor command data, and only the top level tachyon message
 * structure.
 */
export function parseTachyonMessage(message: string): TachyonMessage {
	const parsed = JSON.parse(message);
	if (!validateTachyonMessage(parsed)) {
		throw new Error(
			`Failed to validate the root request: ${ajv.errorsText(validateTachyonMessage.errors)}`,
		);
	}
	return parsed;
}

/**
 * A custom error class to represent errors that can be returned by the Tachyon protocol.
 *
 * To be used primarily by the autohost interface implementation. All generic errors
 * otherwise will be caught and transformed into a generic internal error.
 */
export class TachyonError<
	// sendMessage is one of the simples messages with only basic common errors, so let's use it as default
	T extends keyof TachyonMeta['failedReasons'] = 'autohost/sendMessage',
> extends Error {
	constructor(
		public readonly reason: TachyonMeta['failedReasons'][T][number],
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
	start(request: AutohostStartRequestData): Promise<AutohostStartOkResponseData>;
	kill(request: AutohostKillRequestData): Promise<void>;
	addPlayer(request: AutohostAddPlayerRequestData): Promise<void>;
	kickPlayer(request: AutohostKickPlayerRequestData): Promise<void>;
	mutePlayer(request: AutohostMutePlayerRequestData): Promise<void>;
	specPlayers(request: AutohostSpecPlayersRequestData): Promise<void>;
	sendCommand(request: AutohostSendCommandRequestData): Promise<void>;
	sendMessage(request: AutohostSendMessageRequestData): Promise<void>;
	subscribeUpdates(request: AutohostSubscribeUpdatesRequestData): Promise<void>;
	connected(server: TachyonServer): void;
	disconnected(): void;
	logger: Logger;
}

/**
 * The interface that represents the functionality that the autohost can call on the server.
 */
export interface TachyonServer {
	status(event: AutohostStatusEventData): Promise<void>;
	update(event: AutohostUpdateEventData): Promise<void>;
}

// Helper that works as a type guard to check if an element is included in an array.
function includes<T extends U, U>(coll: ReadonlyArray<T>, el: U): el is T {
	return coll.includes(el as T);
}

// Helper to assert that a switch statement is exhaustive.
function assertUnreachable(_x: never): never {
	throw new Error('Unreachable autohost command reached!');
}

/**
 * Calls the appropriate method in the autohost given a Tachyon request object.
 *
 * It will validate the request, dispatch the call to the autohost interface instance, and return
 * a proper Tachyon response object ready to be serialized.
 */
export async function callTachyonAutohost(
	req: TachyonMessage,
	autohost: TachyonAutohost,
): Promise<Extract<TachyonCommand, { type: 'response' }>> {
	if (req.type !== 'request') {
		throw new Error('Only requests are allowed');
	}
	if (!includes(tachyonMeta.schema.actors.autohost.request.receive, req.commandId)) {
		return createTachyonResponseFail(
			req,
			'command_unimplemented',
			`${req.commandId} of type request not recognized by autohost`,
		);
	}
	try {
		const reqValidator = validator[req.commandId]['request'];
		const valid = reqValidator(req);
		if (!valid) {
			throw new TachyonError(
				'invalid_request',
				`Failed to validate command ${req.commandId} data: ${ajv.errorsText(reqValidator.errors)}`,
			);
		}
		switch (req.commandId) {
			case 'autohost/start':
				return createTachyonResponseOk(req, await autohost.start(req.data));
			case 'autohost/kill':
				return createTachyonResponseOk(req, await autohost.kill(req.data));
			case 'autohost/addPlayer':
				return createTachyonResponseOk(req, await autohost.addPlayer(req.data));
			case 'autohost/kickPlayer':
				return createTachyonResponseOk(req, await autohost.kickPlayer(req.data));
			case 'autohost/mutePlayer':
				return createTachyonResponseOk(req, await autohost.mutePlayer(req.data));
			case 'autohost/specPlayers':
				return createTachyonResponseOk(req, await autohost.specPlayers(req.data));
			case 'autohost/sendCommand':
				return createTachyonResponseOk(req, await autohost.sendCommand(req.data));
			case 'autohost/sendMessage':
				return createTachyonResponseOk(req, await autohost.sendMessage(req.data));
			case 'autohost/subscribeUpdates':
				return createTachyonResponseOk(req, await autohost.subscribeUpdates(req.data));
			default:
				assertUnreachable(req);
		}
	} catch (error) {
		const failedReasons = tachyonMeta.schema.failedReasons;
		if (
			(error instanceof TachyonError && error.reason === 'internal_error') ||
			!(error instanceof TachyonError)
		) {
			autohost.logger.error(error, `autohost failed to process command ${req.commandId}`);
		}

		if (error instanceof TachyonError) {
			if (
				req.commandId in failedReasons &&
				includes(failedReasons[req.commandId as keyof typeof failedReasons], error.reason)
			) {
				if (error.reason === 'internal_error') {
					autohost.logger.error(
						error,
						`autohost failed to process command ${req.commandId}`,
					);
				}
				return createTachyonResponseFail(req, error.reason, error.details);
			}
			// This should never happen.
			autohost.logger.error(
				error,
				`Autohost returned invalid TachyonError reason: ${error.reason} for command ${req.commandId}`,
			);
		}
		return createTachyonResponseFail(req, 'internal_error');
	}
}

type AutohostEvent = Extract<
	TachyonCommand,
	{ type: 'event'; commandId: TachyonMeta['actors']['autohost']['event']['send'][number] }
>;

/**
 * Creates a event message given the event type and the event data.
 */
export function createTachyonEvent<
	CommandId extends AutohostEvent['commandId'],
	Event extends Extract<AutohostEvent, { commandId: CommandId }>,
>(status: CommandId, event: Event['data']): Event {
	return {
		type: 'event',
		messageId: randomUUID(),
		commandId: status,
		data: event,
	} as Event;
}

/**
 * Creates a successful response object given the request object and the data
 * for the response matching the request.
 */
export function createTachyonResponseOk<
	Req extends Extract<TachyonCommand, { type: 'request' }>,
	Res extends Extract<
		TachyonCommand,
		{ type: 'response'; status: 'success'; commandId: Req['commandId'] }
	>,
>(req: Req, data: Res extends { data: unknown } ? Res['data'] : void): Res {
	return {
		type: 'response',
		status: 'success',
		commandId: req.commandId,
		messageId: req.messageId,
		data,
	} as Res;
}

/**
 * Creates a failed response object given the request object and reason for the failure.
 *
 * If the commandId is constant, then it's fully typed, otherwise any response
 * that is a valid reason for any of the commands will be accepted.
 */
export function createTachyonResponseFail<
	CommandId,
	Req extends { commandId: CommandId; messageId: string },
	Res extends Extract<
		TachyonCommand,
		{ type: 'response'; commandId: Req['commandId']; status: 'failed' }
	>,
>(req: Req, reason: Res['reason'], details?: string): Res {
	return {
		type: 'response',
		status: 'failed',
		commandId: req.commandId,
		messageId: req.messageId,
		reason,
		details,
	} as Res;
}
