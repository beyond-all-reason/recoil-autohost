// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import { suite, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { pino } from 'pino';
import fs from 'node:fs/promises';
import { once } from 'node:events';
import { EngineVersionsManagerImpl, type Env } from './engineVersions.js';

suite('EngineVersionsManagerImpl', () => {
	function getEnv(): Env {
		return {
			logger: pino({ level: 'silent' }),
			config: {
				engineInstallTimeoutSeconds: 60,
			},
			mocks: {},
		};
	}

	test('discoverVersions discovers engine versions', async (t) => {
		const readdirMock = t.mock.method(fs, 'readdir', async () => [
			{ name: '105.1.1-1523-g63a25e1', isDirectory: () => true },
			{ name: '105.1.1-2449-gf1234a9', isDirectory: () => true },
			{ name: 'README.md', isDirectory: () => false },
		]);
		const mkdirMock = t.mock.method(fs, 'mkdir', async () => {});

		const evm = new EngineVersionsManagerImpl(getEnv());
		const [versions] = await once(evm, 'versions');

		assert.equal(readdirMock.mock.callCount(), 1);
		assert.equal(mkdirMock.mock.callCount(), 1);
		assert.deepStrictEqual(versions, ['105.1.1-1523-g63a25e1', '105.1.1-2449-gf1234a9']);
		assert.deepStrictEqual(evm.engineVersions, [
			'105.1.1-1523-g63a25e1',
			'105.1.1-2449-gf1234a9',
		]);
	});

	test('discoverVersions handles empty engines dir', async (t) => {
		const readdirMock = t.mock.method(fs, 'readdir', async () => []);
		const mkdirMock = t.mock.method(fs, 'mkdir', async () => {});

		const evm = new EngineVersionsManagerImpl(getEnv());
		const [versions] = await once(evm, 'versions');

		assert.equal(readdirMock.mock.callCount(), 1);
		assert.equal(mkdirMock.mock.callCount(), 1);
		assert.deepStrictEqual(versions, []);
		assert.deepStrictEqual(evm.engineVersions, []);
	});

	test('discoverVersions propagates other errors', async (t) => {
		const logger = pino({ level: 'silent' });
		const loggerErrorMock = mock.fn();
		const env = getEnv();
		env.logger = {
			...logger,
			child: () => ({
				...logger,
				// We mock the logger to verify that the error is logged correctly.
				error: loggerErrorMock,
			}),
		} as unknown as typeof logger;

		const testError = new Error('some other error');
		t.mock.method(fs, 'readdir', async () => {
			throw testError;
		});

		const evm = new EngineVersionsManagerImpl(env);

		const [err] = await once(evm, 'error');

		assert.equal(loggerErrorMock.mock.callCount(), 1);
		assert.deepStrictEqual(loggerErrorMock.mock.calls[0].arguments[0], testError);
		assert.deepStrictEqual(err, testError);
	});
});
