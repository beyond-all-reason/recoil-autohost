// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Environment } from './environment.js';

/**
 * Serves metrics from env.metrics registry on GET /metrics. It should not be
 * exposed publicly.
 */
export function startMetricsServer(env: Environment, port: number): Server {
	const logger = env.logger.child({ class: 'MetricsServer' });

	const server = createServer(async (req, res) => {
		try {
			// Match on the path only: the exposition format takes no arguments, but
			// Prometheus scrape configs can append arbitrary `params:` to the URL.
			const path = new URL(req.url ?? '/', 'http://localhost').pathname;
			if (req.method === 'GET' && path === '/metrics') {
				const body = await env.metrics.metrics();
				res.writeHead(200, { 'content-type': env.metrics.contentType });
				res.end(body);
			} else {
				res.writeHead(404).end('Not found\n');
			}
		} catch (err) {
			logger.error(err, 'metrics collection failed');
			if (!res.headersSent) res.writeHead(500);
			res.end(`${err instanceof Error ? err.message : err}\n`);
		}
	});
	server.listen(port, () => {
		logger.info(
			{ port: (server.address() as AddressInfo).port },
			'listening for metrics scrapes',
		);
	});
	return server;
}
