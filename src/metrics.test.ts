// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { pino } from 'pino';
import { Counter, Registry } from '@prometheus-io/client';
import { startMetricsServer } from './metrics.js';

const metrics = new Registry();
const counter = new Counter({ name: 'test_total', help: 'Test counter', registers: [metrics] });
const server = startMetricsServer({ logger: pino({ level: 'silent' }), config: {}, metrics }, 0);
await once(server, 'listening');
after(() => {
	server.close();
	server.closeAllConnections();
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

test('MetricsServer serves the registry on /metrics, and nothing else', async () => {
	counter.inc(3);
	const res = await fetch(`${base}/metrics`);
	assert.equal(res.headers.get('content-type'), metrics.contentType);
	assert.match(await res.text(), /^test_total 3$/m);

	assert.equal((await fetch(`${base}/metrics?x=1`)).status, 200);
	assert.equal((await fetch(`${base}/nope`)).status, 404);
});
