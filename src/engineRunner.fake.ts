/**
 * Fake for the EngineRunner class to be used in the tests of other components.
 */
import { TypedEmitter } from 'tiny-typed-emitter';
import { EngineRunner, EngineRunnerEvents, runEngine } from './engineRunner.js';

export class EngineRunnerFake extends TypedEmitter<EngineRunnerEvents> implements EngineRunner {
	private stopped = false;

	public async sendPacket() {}

	constructor() {
		super();
		setTimeout(() => {
			if (!this.stopped) {
				this.emit('start');
			}
		}, 0);
	}

	public close() {
		if (!this.stopped) {
			this.stopped = true;
			process.nextTick(() => {
				this.emit('exit');
			});
		}
	}
}

export const fakeRunEngine: typeof runEngine = function () {
	return new EngineRunnerFake();
};
