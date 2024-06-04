import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createTachyonEvent,
	parseTachyonMessage,
	callTachyonAutohost,
	TachyonRequest,
	KillRequest,
	TachyonAutohost,
} from './tachyonTypes.js';

test('parsing correct tachyon message succeeds', () => {
	const message = {
		messageId: 'someid',
		commandId: 'some/command',
		type: 'request',
		data: {},
	};
	const parsed = parseTachyonMessage(JSON.stringify(message));
	assert.deepStrictEqual(parsed, message);
});

test('parsing incorrect tachyon message fails', () => {
	const message = {
		messageId: 'someid',
		commandId: 'some/command',
		type: 'reqwest',
		data: {},
	};
	assert.throws(() => {
		parseTachyonMessage(JSON.stringify({ ...message, extra: 'field' }));
	});
});

test('creating a tachyon event succeeds', () => {
	const event = createTachyonEvent('autohost/status', { currentGames: 2, maxGames: 4 });
	assert.deepStrictEqual(event, {
		type: 'event',
		messageId: event.messageId,
		commandId: 'autohost/status',
		data: { currentGames: 2, maxGames: 4 },
	});
});

test('calling tachyon autohost succeeds', async () => {
	const killData: KillRequest = {
		battleId: '873bf189-d659-4527-befd-e9d63b308955',
	};
	const req: TachyonRequest = {
		messageId: 'some-message-id',
		commandId: 'autohost/kill',
		type: 'request',
		data: killData,
	};
	let called = 0;
	const autohost = {
		kill: async (data: KillRequest) => {
			assert.deepStrictEqual(data, killData);
			++called;
		},
	} as TachyonAutohost;
	const response = await callTachyonAutohost(req, autohost);
	assert.deepStrictEqual(response, {
		type: 'response',
		status: 'success',
		messageId: req.messageId,
		commandId: req.commandId,
		data: undefined,
	});
	assert.strictEqual(called, 1);
});

test('calling tachyon autohost catches bad commands', async () => {
	const req: TachyonRequest = {
		messageId: 'some-message-id',
		commandId: 'autohost/killss',
		type: 'request',
		data: {},
	};
	const response = await callTachyonAutohost(req, {} as TachyonAutohost);
	assert.deepStrictEqual(response, {
		type: 'response',
		status: 'failed',
		messageId: req.messageId,
		commandId: req.commandId,
		reason: 'unknown_command',
		details: response.details,
	});
});

test('calling tachyon autohost validates data', async () => {
	const killData: KillRequest = {
		battleId: '873bf189-d659-4527-befd-e9d63b308', // invalid uuid
	};
	const req: TachyonRequest = {
		messageId: 'some-message-id',
		commandId: 'autohost/kill',
		type: 'request',
		data: killData,
	};
	const response = await callTachyonAutohost(req, {} as TachyonAutohost);
	assert.deepStrictEqual(response, {
		type: 'response',
		status: 'failed',
		messageId: req.messageId,
		commandId: req.commandId,
		reason: 'invalid_request',
		details: response.details,
	});
});
