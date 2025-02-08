import { test, after, beforeEach, suite } from 'node:test';
import { equal } from 'node:assert/strict';

import { getAccessToken } from './oauth2Client.js';

import Fastify from 'fastify';
import FastifyFormBody from '@fastify/formbody';
import { rejects } from 'node:assert';

const server = Fastify();
await server.register(FastifyFormBody);

const failHandler: Fastify.RouteHandler = async (_req, resp) => {
	resp.code(500);
	return 'fail';
};

let metadataHandler: Fastify.RouteHandler = failHandler;
let tokenHandler: Fastify.RouteHandler = failHandler;
beforeEach(() => {
	metadataHandler = failHandler;
	tokenHandler = failHandler;
});

server.get('/.well-known/oauth-authorization-server', (req, resp) =>
	metadataHandler.call(server, req, resp),
);
server.post('/oauth2/token', (req, resp) => tokenHandler.call(server, req, resp));

await server.listen();
const PORT = server.addresses()[0].port;

suite('oauth2client', () => {
	after(() => server.close());

	test('simple full example', async () => {
		metadataHandler = async () => {
			return {
				issuer: `http://localhost:${PORT}`,
				token_endpoint: `http://localhost:${PORT}/oauth2/token`,
				response_types_supported: ['token'],
			};
		};
		let tokenErr: Error | undefined;
		tokenHandler = async (req) => {
			try {
				equal(req.headers.authorization, 'Basic dXNlcjE6cGFzczElM0QlM0Q=');
				equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
				const params = new URLSearchParams(req.body as string);
				equal(params.get('grant_type'), 'client_credentials');
				equal(params.get('scope'), 'tachyon.lobby');
			} catch (error) {
				tokenErr = error as Error;
			}
			return {
				access_token: 'token_value',
				token_type: 'Bearer',
				expires_in: 60,
			};
		};
		const token = await getAccessToken(
			`http://localhost:${PORT}`,
			'user1',
			'pass1==',
			'tachyon.lobby',
		);
		if (tokenErr) throw tokenErr;
		equal(token, 'token_value');
	});

	test('wrong oauth2 metadata', async () => {
		metadataHandler = async () => {
			return {
				issuer: `http://localhost:${PORT}`,
			};
		};
		await rejects(
			getAccessToken(`http://localhost:${PORT}`, 'user1', 'pass1', 'tachyon.lobby'),
			/Invalid.*object/,
		);
	});

	test('propagates OAuth2 error message', async () => {
		metadataHandler = async () => {
			return {
				issuer: `http://localhost:${PORT}`,
				token_endpoint: `http://localhost:${PORT}/oauth2/token`,
				response_types_supported: ['token'],
			};
		};
		tokenHandler = async (_req, resp) => {
			resp.code(400);
			return {
				error: 'invalid_scope',
				error_description: 'Invalid scope',
			};
		};
		await rejects(
			getAccessToken(`http://localhost:${PORT}`, 'user1', 'pass1', 'tachyon.lobby'),
			/invalid_scope.*Invalid scope/,
		);
	});

	test('bad access token response', async () => {
		metadataHandler = async () => {
			return {
				issuer: `http://localhost:${PORT}`,
				token_endpoint: `http://localhost:${PORT}/oauth2/token`,
				response_types_supported: ['token'],
			};
		};
		tokenHandler = async () => {
			return {
				access_token: 'token_value',
				token_type: 'CustomType',
				expires_in: 60,
			};
		};
		await rejects(
			getAccessToken(`http://localhost:${PORT}`, 'user1', 'pass1', 'tachyon.lobby'),
			/expected Bearer/,
		);
	});
});
