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

const connectionParams = {
	clientId: 'c',
	clientSecret: 's',
	hostname: 'localhost',
	port,
};

test('simple full example', async () => {
	server.on('connection', (conn) => {
		conn.on('message', (msg) => {
			equal(msg.type, 'request');
			equal(msg.commandId, 'autohost/sendMessage');
			deepEqual((msg as unknown as { data: string }).data, {
				battleId: 'id',
				message: 'msg',
			});
			conn.send({
				type: 'response',
				commandId: msg.commandId,
				messageId: msg.messageId,
				status: 'success',
			});
		});
	});

	const client = new TachyonClient(connectionParams);
	await once(client, 'connected');
	client.send({
		type: 'request',
		commandId: 'autohost/sendMessage',
		messageId: 'test-message1',
		data: { battleId: 'id', message: 'msg' },
	});
	const msg = (await once(client, 'message')) as [TachyonMessage];
	deepEqual(msg[0], {
		type: 'response',
		commandId: 'autohost/sendMessage',
		messageId: 'test-message1',
		status: 'success',
	});
	client.close();
});

test("doesn't emit bad tachyon messages", async () => {
	server.on('connection', (conn) => {
		conn.on('message', () => {
			conn.send({
				type: 'asdasdasd',
			});
		});
	});
	const client = new TachyonClient(connectionParams);
	await once(client, 'connected');
	client.send({
		type: 'request',
		commandId: 'autohost/sendMessage',
		messageId: 'test-message1',
		data: { battleId: 'id', message: 'msg' },
	});
	let gotMessages = 0;
	client.on('message', () => {
		++gotMessages;
	});
	await once(client, 'close');
	equal(gotMessages, 0);
});

// TODO: Add more tests then only a simple happy path.
