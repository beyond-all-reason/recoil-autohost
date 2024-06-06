/**
 * This file is a fake implementation of the Tachyon server.
 *
 * It's used for testing the autohost interface without the need to run the real Tachyon server.
 * Even though it's a fake implementation, it's still a fully functional from the protocol
 * perspective: it contains all the required OAuth2 endpoints and the Tachyon websocket endpoint
 * as needed by the autohost.
 *
 * The server has a single hardcoded client with credentials `autohost1:pass1` and supports only
 * `client_credentials` grant type with the `tachyon.lobby` scope. The server generates a new access
 * token for each request to `/token` with a timeout of 60 seconds.
 *
 * This file can be also run as a CLI application. Then the server starts at port 8084 and prints
 * all messages it receives via websocket on stdout. It's possible to send a request from server
 * to the client by sending a POST request to /request/:connIdx/:autohostCommand. For example:
 *
 *   curl http://localhost:8084/request/0/kill \
 *     --json '{"battleId": "24b72b50-ef8c-4899-8372-d2b3a0ca3d7b"}'
 *
 */
import util from 'node:util';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import FastifyFormBody from '@fastify/formbody';
import FastifyBasicAuth from '@fastify/basic-auth';
import FastifyWebSocket from '@fastify/websocket';
import { JsonSchemaToTsProvider } from '@fastify/type-provider-json-schema-to-ts';
import { parseTachyonMessage, TachyonMessage, TachyonRequest } from './tachyonTypes.js';
import { TypedEmitter } from 'tiny-typed-emitter';
import { WebSocket } from 'ws';

const TACHYON_V0_PROTOCOL = 'v0.tachyon';

class Oauth2Error extends Error {
	error: string;
	constructor(error: string) {
		super(error);
		this.error = error;
	}
}

export class TachyonClientConnection extends TypedEmitter<{
	message: (msg: TachyonMessage) => void;
	close: () => void;
}> {
	constructor(private readonly ws: WebSocket) {
		super();

		const pingInterval = setInterval(() => {
			ws.ping();
		}, 5000);

		ws.on('close', () => {
			clearInterval(pingInterval);
			this.emit('close');
		});

		ws.on('message', (buf, isBinary) => {
			if (isBinary) {
				console.warn('Received binary message, closing');
				this.ws.close(1003, 'Binary messages are not supported');
				return;
			}
			const msg = buf.toString('utf-8');
			try {
				const tachyonMsg = parseTachyonMessage(msg);
				this.emit('message', tachyonMsg);
			} catch (e) {
				this.ws.close(1008, 'Failed to parse base tachyon message');
				return;
			}
		});
	}

	send(msg: TachyonMessage): void {
		const buf = JSON.stringify(msg);
		this.ws.send(buf);
	}

	close(reason: string) {
		this.ws.close(1000, reason);
	}
}
export class TachyonServer<F extends Fastify.FastifyInstance> extends TypedEmitter<{
	connection: (conn: TachyonClientConnection) => void;
}> {
	constructor(
		public port: number,
		public fastifyServer: F,
	) {
		super();
	}

	start() {
		return this.fastifyServer.listen({ port: this.port });
	}
}

export async function createTachyonServer(port: number) {
	const server = Fastify({ logger: true }).withTypeProvider<JsonSchemaToTsProvider>();

	// OAuth2 stuff. It supports only client_credentials grant type
	// with a single hardcoded client. Example call to get a token:
	//
	//   curl http://localhost:8084/token \
	//     -u autohost1:pass1 \
	//     -d 'grant_type=client_credentials&scope=tachyon.lobby'

	await server.register(FastifyFormBody);
	await server.register(FastifyBasicAuth, {
		validate: async (username, password, _req, reply) => {
			if (username !== 'autohost1' || password !== 'pass1') {
				reply.status(401);
				reply.header('www-authenticate', 'Basic realm="tachyon_oauth2"');
				return new Oauth2Error('invalid_client');
			}
		},
		authenticate: true,
	});

	server.setErrorHandler((error, _req, reply) => {
		if (error instanceof Oauth2Error) {
			reply.send({ error: error.error });
			return;
		}
		reply.send(error);
	});

	server.get('/.well-known/oauth-authorization-server', async (_req, resp) => {
		resp.header('cache-control', 'max-age=3600, public');
		return {
			issuer: `http://localhost:${port}`,
			token_endpoint: `http://localhost:${port}/token`,
			response_types_supported: ['token'],
		};
	});

	const validAccessTokens = new Set<string>();

	server.post('/token', { onRequest: server.basicAuth }, async (req, resp) => {
		if (
			req.headers['content-type'] !== 'application/x-www-form-urlencoded' ||
			typeof req.body !== 'object' ||
			req.body === null ||
			!('grant_type' in req.body)
		) {
			resp.status(400);
			throw new Oauth2Error('invalid_request');
		}
		if (req.body.grant_type !== 'client_credentials') {
			resp.status(400);
			throw new Oauth2Error('unsupported_grant_type');
		}
		if (!('scope' in req.body) || req.body.scope !== 'tachyon.lobby') {
			resp.status(400);
			throw new Oauth2Error('invalid_scope');
		}

		const accessToken = randomUUID();
		const timeoutSeconds = 60;
		validAccessTokens.add(accessToken);
		setTimeout(() => {
			validAccessTokens.delete(accessToken);
		}, timeoutSeconds * 1000);

		resp.header('cache-control', 'no-store');
		return {
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: timeoutSeconds,
		};
	});

	// Now time for actual Tachyon stuff
	await server.register(FastifyWebSocket, {
		options: {
			handleProtocols: (protocols) => {
				if (protocols.has(TACHYON_V0_PROTOCOL)) {
					return TACHYON_V0_PROTOCOL;
				}
				return false;
			},
		},
	});

	const tachyonServer = new TachyonServer(port, server);

	server.get(
		'/tachyon',
		{
			websocket: true,
			onRequest: (req, res, done) => {
				const auth = (req.headers['authorization'] ?? '').split(' ');
				if (auth.length !== 2 || auth[0] !== 'Bearer') {
					res.status(401);
					res.header('www-authenticate', 'Bearer realm="tachyon", scope="tachyon.lobby"');
					done(new Error('Not authorized'));
					return;
				}
				if (!validAccessTokens.has(auth[1])) {
					res.status(401);
					res.header(
						'www-authenticate',
						'Bearer realm="tachyon", scope="tachyon.lobby", error="invalid_token"',
					);
					done(new Error('Invalid token'));
					return;
				}
				done();
			},
		},
		(conn) => {
			const tachyonConnection = new TachyonClientConnection(conn);
			tachyonServer.emit('connection', tachyonConnection);
		},
	);

	return tachyonServer;
}

// Start the server and add some helpers if this file is run directly on CLI.
if (import.meta.filename == process.argv[1]) {
	const srv = await createTachyonServer(8084);

	const connections = new Map<number, TachyonClientConnection>();
	let connIdx = 0;

	srv.on('connection', (conn) => {
		const connId = connIdx++;
		connections.set(connId, conn);
		console.log(`Opened connection ${connId}`);

		conn.on('close', () => {
			connections.delete(connId);
			console.log(`Closed connection ${connId}`);
		});

		conn.on('message', (msg) => {
			console.log(`Msg from ${connId}`, util.inspect(msg, { depth: null, colors: true }));
		});
	});

	srv.fastifyServer.post(
		'/request/:connIdx/:autohostCommand',
		{
			schema: {
				params: {
					type: 'object',
					properties: {
						connIdx: { type: 'integer' },
						autohostCommand: { type: 'string' },
					},
					required: ['connIdx', 'autohostCommand'],
				},
				body: {
					type: 'object',
				},
			},
		},
		async (req, resp) => {
			if (!connections.has(req.params.connIdx)) {
				resp.code(404);
				return `Couldn't find the open connection ${req.params.connIdx}`;
			}
			const conn = connections.get(req.params.connIdx)!;
			const tachyonMsg: TachyonRequest = {
				type: 'request',
				commandId: `autohost/${req.params.autohostCommand}`,
				messageId: randomUUID(),
				data: req.body,
			};
			conn.send(tachyonMsg);
			return `send request ${tachyonMsg.messageId}`;
		},
	);

	await srv.start();
}
