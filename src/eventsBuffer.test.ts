// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import { suite, test } from 'node:test';
import assert from 'node:assert/strict';
import { binarySearch, EventsBuffer } from './eventsBuffer.js';

suite('binary search', () => {
	test('simple', () => {
		assert.equal(
			binarySearch(0, 10, (v) => v >= 5),
			5,
		);
		assert.equal(
			binarySearch(0, 11, (v) => v >= 5),
			5,
		);
		assert.equal(
			binarySearch(5, 11, (v) => v >= 7),
			7,
		);
	});

	test('edge cases', () => {
		assert.equal(
			binarySearch(10, 10, () => true),
			10,
		);
		assert.equal(
			binarySearch(10, 10, () => true),
			10,
		);
		assert.equal(
			binarySearch(0, 1, () => true),
			0,
		);
		assert.equal(
			binarySearch(0, 1, () => false),
			1,
		);
		assert.equal(
			binarySearch(0, 100, () => false),
			100,
		);
		assert.equal(
			binarySearch(0, 100, () => true),
			0,
		);
	});

	test('full range', () => {
		for (let begin = 0; begin < 16; ++begin) {
			for (let end = begin; end < 16; ++end) {
				for (let val = begin; val <= end; ++val) {
					assert.equal(
						binarySearch(begin, end, (n) => n >= val),
						val,
					);
				}
			}
		}
	});
});

suite('EventsBuffer', async () => {
	await test('base behavior', async (t) => {
		t.mock.timers.enable({ apis: ['Date'] });
		const eb: EventsBuffer<string> = new EventsBuffer(10 * 1000 * 1000);
		const { promise, resolve } = Promise.withResolvers();
		let eventsLeft = 4;
		const cb = t.mock.fn(async (_t: number, _e: string) => {
			--eventsLeft;
			if (eventsLeft == 1) {
				t.mock.timers.tick(1);
				eb.push('d');
			} else if (eventsLeft == 0) {
				resolve(undefined);
			}
		});
		eb.subscribe(0, cb);

		t.mock.timers.tick(1);
		eb.push('a');
		t.mock.timers.tick(1);
		eb.push('b');
		eb.push('c');
		await promise;

		assert.equal(cb.mock.callCount(), 4);
		assert.deepEqual(cb.mock.calls[0].arguments, [1000, 'a']);
		assert.deepEqual(cb.mock.calls[1].arguments, [2000, 'b']);
		assert.deepEqual(cb.mock.calls[2].arguments, [2001, 'c']);
		assert.deepEqual(cb.mock.calls[3].arguments, [3000, 'd']);

		assert.equal(eb.length, 4);

		eb.unsubscribe();
	});

	await test("can't subscribe while subscribed", async (t) => {
		t.mock.timers.enable({ apis: ['Date'] });
		const eb: EventsBuffer<string> = new EventsBuffer(10 * 1000 * 1000);
		eb.subscribe(0, async () => {});
		assert.throws(
			() => {
				eb.subscribe(0, async () => {});
			},
			{
				name: 'EventsBufferError',
				type: 'callback_already_set',
			},
		);
	});

	await test("can't subscribe too much in the past", async (t) => {
		const maxAge = 1000;
		t.mock.timers.enable({ apis: ['Date'] });
		const eb: EventsBuffer<string> = new EventsBuffer(maxAge);
		t.mock.timers.tick(2);
		assert.throws(
			() => {
				eb.subscribe(999, async () => {});
			},
			{
				name: 'EventsBufferError',
				type: 'too_far_in_the_past',
			},
		);
		eb.subscribe(1001, async () => {});
	});

	await test("doesn't grow infinitely", async (t) => {
		t.mock.timers.enable({ apis: ['Date'] });
		t.mock.timers.setTime(99999);
		const maxAge = 10000;
		const droppingFrequency = 1; // Try to drop every single time.
		const eb: EventsBuffer<string> = new EventsBuffer(maxAge, droppingFrequency);
		eb.push('a');
		t.mock.timers.tick(1);
		eb.push('b');
		t.mock.timers.tick(1);
		eb.push('c');
		assert.equal(eb.length, 3);

		t.mock.timers.tick(1000);
		eb.push('d');
		assert.equal(eb.length, 1);
	});

	await test('subscribe in the past', async (t) => {
		t.mock.timers.enable({ apis: ['Date'] });
		const maxAge = 1000000000;
		const eb: EventsBuffer<string> = new EventsBuffer(maxAge);
		eb.push('a');
		eb.push('b');
		t.mock.timers.tick(1);
		eb.push('c');
		eb.push('d');
		t.mock.timers.tick(1);
		eb.push('e');

		const { promise, resolve } = Promise.withResolvers();
		let eventsLeft = 2;
		const cb = t.mock.fn(async (_t: number, _e: string) => {
			--eventsLeft;
			if (eventsLeft == 0) {
				resolve(undefined);
			}
		});
		eb.subscribe(1000, cb);
		await promise;

		assert.equal(cb.mock.callCount(), 2);
		assert.deepEqual(cb.mock.calls[0].arguments, [1001, 'd']);
		assert.deepEqual(cb.mock.calls[1].arguments, [2000, 'e']);
	});

	await test('slow subscriber blocks deletion', async (t) => {
		t.mock.timers.enable({ apis: ['Date'] });
		const maxAge = 1; // basically remove instantly
		const eb: EventsBuffer<string> = new EventsBuffer(maxAge);
		const { promise, resolve } = Promise.withResolvers();
		let eventsLeft = 3;
		const cb = t.mock.fn(async (_t: number, _e: string) => {
			if (--eventsLeft == 0) resolve(undefined);
		});
		eb.subscribe(0, cb);

		t.mock.timers.tick(1);
		eb.push('a');
		t.mock.timers.tick(1);
		eb.push('b');
		eb.push('c');
		await promise;

		assert.equal(cb.mock.callCount(), 3);
		assert.deepEqual(cb.mock.calls[0].arguments, [1000, 'a']);
		assert.deepEqual(cb.mock.calls[1].arguments, [2000, 'b']);
		assert.deepEqual(cb.mock.calls[2].arguments, [2001, 'c']);

		eb.unsubscribe();
	});
});
