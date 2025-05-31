// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import { test, suite } from 'node:test';
import assert from 'node:assert/strict';
import {
	callTachyonAutohost,
	createTachyonEvent,
	parseTachyonMessage,
	TachyonAutohost,
	TachyonMessage,
} from './tachyonTypes.js';
import { AutohostKillRequestData } from 'tachyon-protocol/types';

suite('tachyon types', () => {
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
		const event = createTachyonEvent('autohost/status', {
			currentBattles: 2,
			maxBattles: 4,
			availableEngines: ['2025.01.02'],
		});
		assert.deepStrictEqual(event, {
			type: 'event',
			messageId: event.messageId,
			commandId: 'autohost/status',
			data: { currentBattles: 2, maxBattles: 4, availableEngines: ['2025.01.02'] },
		});
	});

	test('calling tachyon autohost succeeds', async () => {
		const killData: AutohostKillRequestData = {
			battleId: '873bf189-d659-4527-befd-e9d63b308955',
		};
		const req = {
			messageId: 'some-message-id',
			commandId: 'autohost/kill',
			type: 'request',
			data: killData,
		} as TachyonMessage;
		let called = 0;
		const autohost = {
			kill: async (data: AutohostKillRequestData) => {
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
		const req = {
			messageId: 'some-message-id',
			commandId: 'autohost/killss',
			type: 'request',
			data: {},
		} as TachyonMessage;
		const response = await callTachyonAutohost(req, {} as TachyonAutohost);
		assert(response.status === 'failed');
		assert.deepStrictEqual(response, {
			type: 'response',
			status: 'failed',
			messageId: req.messageId,
			commandId: req.commandId,
			reason: 'command_unimplemented',
			details: response.details,
		});
	});

	test('calling tachyon autohost validates data', async () => {
		const killData: AutohostKillRequestData = {
			battleId: '873bf189-d659-4527-befd-e9d63b308', // invalid uuid
		};
		const req = {
			messageId: 'some-message-id',
			commandId: 'autohost/kill',
			type: 'request',
			data: killData,
		} as TachyonMessage;
		const response = await callTachyonAutohost(req, {} as TachyonAutohost);
		assert(response.status === 'failed');
		assert.deepStrictEqual(response, {
			type: 'response',
			status: 'failed',
			messageId: req.messageId,
			commandId: req.commandId,
			reason: 'invalid_request',
			details: response.details,
		});
	});
});
