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
import { randomUUID } from 'node:crypto';
import Fastify, { FastifyBaseLogger } from 'fastify';
import FastifyFormBody from '@fastify/formbody';
import FastifyBasicAuth from '@fastify/basic-auth';
import FastifyWebSocket from '@fastify/websocket';
import { JsonSchemaToTsProvider } from '@fastify/type-provider-json-schema-to-ts';
import { parseTachyonMessage, TachyonMessage, TACHYON_PROTOCOL_VERSION } from './tachyonTypes.js';
import { TypedEmitter } from 'tiny-typed-emitter';
import { WebSocket } from 'ws';
import { pino } from 'pino';

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
	constructor(
		private readonly ws: WebSocket,
		private readonly logger: FastifyBaseLogger,
	) {
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
				logger.warn('Received binary message, closing');
				this.ws.close(1003, 'Binary messages are not supported');
				return;
			}
			const msg = buf.toString('utf-8');
			try {
				const tachyonMsg = parseTachyonMessage(msg);
				this.emit('message', tachyonMsg);
			} catch {
				this.ws.close(1008, 'Failed to parse base tachyon message');
				return;
			}
		});
	}

	// Allow sending any object whatsoever as that's useful for testing.
	send(msg: object): void {
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
		private askedPort: number,
		public fastifyServer: F,
	) {
		super();
	}

	get port(): number {
		if (this.fastifyServer.addresses().length !== 1) {
			throw new Error('Server is not listening');
		}
		return this.fastifyServer.addresses()[0].port;
	}

	start() {
		return this.fastifyServer.listen({ port: this.askedPort, host: '0.0.0.0' });
	}

	close() {
		return this.fastifyServer.close();
	}
}

interface TachyonServerOpts {
	/**
	 * The port to listen on, defaults to 0 (random port).
	 */
	port?: number;

	/**
	 * Custom logger instance.
	 */
	loggerInstance?: FastifyBaseLogger;

	/**
	 * The OAuth2 client ID, defaults to 'autohost1'.
	 */
	clientId?: string;

	/**
	 * The OAuth2 client secret, defaults to 'pass1'.
	 */
	clientSecret?: string;
}

export async function createTachyonServer(options?: TachyonServerOpts) {
	const opts = {
		port: 0,
		clientId: 'autohost1',
		clientSecret: 'pass1',
		...options,
	};

	const server = Fastify({
		loggerInstance: opts.loggerInstance,
	}).withTypeProvider<JsonSchemaToTsProvider>();

	// OAuth2 stuff. It supports only client_credentials grant type
	// with a single hardcoded client. Example call to get a token:
	//
	//   curl http://localhost:8084/token \
	//     -u autohost1:pass1 \
	//     -d 'grant_type=client_credentials&scope=tachyon.lobby'

	await server.register(FastifyFormBody);
	await server.register(FastifyBasicAuth, {
		validate: async (username, password, _req, reply) => {
			if (
				decodeURIComponent(username) !== opts.clientId ||
				decodeURIComponent(password) !== opts.clientSecret
			) {
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

	server.get('/.well-known/oauth-authorization-server', async (req, resp) => {
		const port = server.addresses()[0].port;
		const hostname = req.hostname;
		resp.header('cache-control', 'max-age=3600, public');
		return {
			issuer: `http://${hostname}:${port}`,
			token_endpoint: `http://${hostname}:${port}/token`,
			response_types_supported: ['token'],
		};
	});

	server.get('/health', async (_req, resp) => {
		return { status: 'ok' };
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
		}, timeoutSeconds * 1000).unref();

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
				if (protocols.has(TACHYON_PROTOCOL_VERSION)) {
					return TACHYON_PROTOCOL_VERSION;
				}
				return false;
			},
		},
	});

	const tachyonServer = new TachyonServer(opts.port, server);

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
			const tachyonConnection = new TachyonClientConnection(conn, server.log);
			tachyonServer.emit('connection', tachyonConnection);
		},
	);

	return tachyonServer;
}

// Start the server and add some helpers if this file is run directly on CLI.
if (import.meta.filename == process.argv[1]) {
	const logger = pino();
	const srv = await createTachyonServer({
		port: 8084,
		loggerInstance: logger,
	});

	const connections = new Map<number, TachyonClientConnection>();

	// We will manage connection ids in a way that we always try to allocate
	// lowest number. This makes the id stable for the common case of autohost
	// that is connecting and disconnecting in a loop.
	let connIdx = 0;
	const connIdxFreeList: number[] = [];

	function getConnIdx(): number {
		if (connIdxFreeList.length > 0) {
			return connIdxFreeList.pop()!;
		} else {
			return connIdx++;
		}
	}

	function freeConnIdx(connIdx: number) {
		connIdxFreeList.push(connIdx);
		connIdxFreeList.sort((a, b) => b - a);
	}

	srv.on('connection', (conn) => {
		const connId = getConnIdx();
		const l = logger.child({ connId });
		connections.set(connId, conn);
		l.info('new connection');

		conn.on('close', () => {
			connections.delete(connId);
			freeConnIdx(connId);
			l.info('connection closed');
		});

		conn.on('message', (msg) => {
			l.info({ packet: msg }, 'new message');
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
			const tachyonMsg = {
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
