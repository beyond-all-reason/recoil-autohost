// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import { test, suite } from 'node:test';
import assert from 'node:assert/strict';
import { MultiIndex } from './multiIndex.js';

suite('MultiIndex', () => {
	test('set', () => {
		const mi = new MultiIndex({ a1: '', a2: 0, a3: '' });
		assert.equal(mi.set({ a1: 'a1.1', a2: 1, a3: 'a3.1' }), true);
		assert.equal(mi.set({ a1: 'a1.2', a2: 2, a3: 'a3.2' }), true);
		assert.equal(mi.set({ a1: 'a1.2', a2: 2, a3: 'a3.2' }), false);
		assert.throws(() => {
			mi.set({ a1: 'a1.2', a2: 2, a3: 'a3.2_prime' });
		});
		assert.equal(mi.size, 2);
	});

	test('get', () => {
		const mi = new MultiIndex({ a1: '', a2: 0, a3: '' });
		mi.set({ a1: 'a1.1', a2: 1, a3: 'a3.1' });

		assert.equal(mi.get('a1', 'a1.1')?.a3, 'a3.1');
		assert.equal(mi.get('a2', 1)?.a1, 'a1.1');
		assert.equal(mi.get('a3', 'a3.1')?.a1, 'a1.1');

		assert.equal(mi.get('a1', 'non-existent'), undefined);
	});

	test('has', () => {
		const mi = new MultiIndex({ a1: '', a2: 0 });
		mi.set({ a1: 'a1.1', a2: 1 });

		assert.equal(mi.has('a1', 'a1.1'), true);
		assert.equal(mi.has('a1', 'non-existent'), false);
	});

	test('delete', () => {
		const mi = new MultiIndex({ a1: '', a2: 0 });
		mi.set({ a1: 'a1.1', a2: 1 });
		mi.set({ a1: 'a1.2', a2: 2 });
		assert.equal(mi.size, 2);

		assert.equal(mi.delete('a1', 'a1.1'), true);
		assert.ok(!mi.hasAny({ a1: 'a1.1', a2: 1 }));
		assert.ok(mi.hasAll({ a1: 'a1.2', a2: 2 }));
		assert.equal(mi.size, 1);
	});
});
