// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Fake for the EngineRunner class to be used in the tests of other components.
 */
import { TypedEmitter } from 'tiny-typed-emitter';
import { mock } from 'node:test';
import { EngineRunner, EngineRunnerEvents, runEngine } from './engineRunner.js';

export class EngineRunnerFake extends TypedEmitter<EngineRunnerEvents> implements EngineRunner {
	private stopped = false;

	constructor() {
		super();
		setTimeout(() => {
			if (!this.stopped) {
				this.emit('start');
			}
		}, 0);
	}

	close = mock.fn(() => {
		if (!this.stopped) {
			this.stopped = true;
			process.nextTick(() => {
				this.emit('exit');
			});
		}
	});

	sendPacket = mock.fn(async () => {});
}

export const fakeRunEngine: typeof runEngine = function () {
	return new EngineRunnerFake();
};
