import test, { after, afterEach } from 'node:test';
import { equal } from 'node:assert/strict';
import { once } from 'node:events';

import { TachyonClient } from './tachyonClient.js';
import { createTachyonServer } from './tachyonServer.fake.js';
import { deepEqual } from 'node:assert';
import { TachyonMessage } from './tachyonTypes.js';

// Let's reuse the same server for all tests to make them quicker.
const server = await createTachyonServer({ clientId: 'c', clientSecret: 's' });
await server.start();
const port = server.fastifyServer.addresses()[0].port;
after(() => server.close());
afterEach(() => server.removeAllListeners());

test('simple full example', async () => {
	server.on('connection', (conn) => {
		conn.on('message', (msg) => {
			equal(msg.type, 'request');
			equal(msg.commandId, 'test/command');
			deepEqual(msg.data, { test: 'test' });
			conn.send({
				type: 'response',
				commandId: msg.commandId,
				messageId: msg.messageId,
				status: 'success',
			});
		});
	});

	const client = new TachyonClient({
		clientId: 'c',
		clientSecret: 's',
		hostname: 'localhost',
		port,
	});
	await once(client, 'connected');
	client.send({
		type: 'request',
		commandId: 'test/command',
		messageId: 'test-message1',
		data: { test: 'test' },
	});
	const msg = (await once(client, 'message')) as [TachyonMessage];
	deepEqual(msg[0], {
		type: 'response',
		commandId: 'test/command',
		messageId: 'test-message1',
		status: 'success',
	});
	client.close();
});

// TODO: Add more tests then only a simple happy path.
