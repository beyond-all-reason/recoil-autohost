// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import { suite, test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pino } from 'pino';
import { EngineVersionsManagerImpl, type Env } from './engineVersions.js';
import { FSWatcher } from 'chokidar';
import { TypedEmitter } from 'tiny-typed-emitter';
import fs from 'node:fs';

suite('EngineVersionsManagerImpl', () => {
	let fakeWatcher: TypedEmitter & { add: () => void; close: () => void };

	beforeEach(() => {
		class FakeWatcher extends TypedEmitter {
			add() {}
			close() {}
		}
		fakeWatcher = new FakeWatcher();
		mock.method(FSWatcher.prototype, 'on', fakeWatcher.on.bind(fakeWatcher));
		mock.method(FSWatcher.prototype, 'add', fakeWatcher.add.bind(fakeWatcher));
		mock.method(FSWatcher.prototype, 'close', fakeWatcher.close.bind(fakeWatcher));
		mock.method(fs, 'mkdirSync', () => {});
	});

	function getEnv(): Env {
		return {
			logger: pino({ level: 'silent' }),
			config: {
				engineInstallTimeoutSeconds: 60,
			},
			mocks: {},
		};
	}

	test('watches for new and removed engines', async () => {
		const evm = new EngineVersionsManagerImpl(getEnv());
		const { promise: readyPromise, resolve: readyResolve } = Promise.withResolvers<void>();
		evm.once('versions', () => readyResolve());
		fakeWatcher.emit('ready');
		await readyPromise;

		const { promise: addPromise1, resolve: addResolve1 } = Promise.withResolvers<void>();
		evm.once('versions', (versions) => {
			assert.deepStrictEqual(versions, ['105.1.1-1523-g63a25e1']);
			addResolve1();
		});
		fakeWatcher.emit('addDir', '105.1.1-1523-g63a25e1');
		await addPromise1;

		const { promise: addPromise2, resolve: addResolve2 } = Promise.withResolvers<void>();
		evm.once('versions', (versions) => {
			assert.deepStrictEqual(versions, ['105.1.1-1523-g63a25e1', '105.1.1-2449-gf1234a9']);
			addResolve2();
		});
		fakeWatcher.emit('addDir', '105.1.1-2449-gf1234a9');
		await addPromise2;

		const { promise: removePromise, resolve: removeResolve } = Promise.withResolvers<void>();
		evm.once('versions', (versions) => {
			assert.deepStrictEqual(versions, ['105.1.1-2449-gf1234a9']);
			removeResolve();
		});
		fakeWatcher.emit('unlinkDir', '105.1.1-1523-g63a25e1');
		await removePromise;
	});

	test('initial discovery works', async () => {
		const evm = new EngineVersionsManagerImpl(getEnv());

		const { promise, resolve } = Promise.withResolvers<void>();
		evm.once('versions', (versions) => {
			assert.deepStrictEqual(versions, ['105.1.1-1523-g63a25e1', '105.1.1-2449-gf1234a9']);
			resolve();
		});

		fakeWatcher.emit('addDir', '');
		fakeWatcher.emit('addDir', '105.1.1-1523-g63a25e1');
		fakeWatcher.emit('addDir', '105.1.1-2449-gf1234a9');
		fakeWatcher.emit('ready');

		await promise;
	});
});
