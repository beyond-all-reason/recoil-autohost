// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

/**
 * A client for the Tachyon protocol.
 *
 * The client only handles the connection and message sending, it does not handle the
 * protocol messages themselves in a semantic way. The messages are emitted as events
 * and the client can send messages to the server.
 */
import { TypedEmitter } from 'tiny-typed-emitter';
import { parseTachyonMessage, TACHYON_PROTOCOL_VERSION, TachyonMessage } from './tachyonTypes.js';
import { TachyonCommand } from 'tachyon-protocol/types';
import { getAccessToken } from './oauth2Client.js';
import WebSocket from 'ws';

export interface TachyonClientOpts {
	/**
	 * The OAuth2 client ID for authentication.
	 */
	clientId: string;

	/**
	 * The OAuth2 client secret for authentication.
	 */
	clientSecret: string;

	/**
	 * The hostname of the Tachyon server.
	 */
	hostname: string;

	/**
	 * The port of the Tachyon server, if not set uses the default port for the scheme.
	 */
	port?: number;

	/**
	 * Whether to use HTTPS or not, defaults to true with the exception of localhost.
	 */
	secure?: boolean;
}

enum ClientState {
	STARTING,
	CONNECTED,
	CLOSED,
}

export class TachyonClient extends TypedEmitter<{
	connected: () => void;
	close: () => void;
	error: (err: Error) => void;
	message: (msg: TachyonMessage) => void;
}> {
	private state = ClientState.STARTING;
	private clientCredentials: { id: string; secret: string };
	private baseOAuth2Url: string;
	private tachyonUrl: string;
	private ws?: WebSocket;

	public constructor(clientOpts: TachyonClientOpts) {
		super();

		const secure = clientOpts.secure ?? clientOpts.hostname !== 'localhost';
		const portSuffix = clientOpts.port ? `:${clientOpts.port}` : '';
		this.baseOAuth2Url = `${secure ? 'https' : 'http'}://${clientOpts.hostname}${portSuffix}`;
		this.tachyonUrl = `${secure ? 'wss' : 'ws'}://${clientOpts.hostname}${portSuffix}/tachyon`;
		this.clientCredentials = { id: clientOpts.clientId, secret: clientOpts.clientSecret };

		this.connect().catch((err) => this.handleError(err));
	}

	private async connect() {
		const accessToken = await getAccessToken(
			this.baseOAuth2Url,
			this.clientCredentials.id,
			this.clientCredentials.secret,
			'tachyon.lobby',
		);
		const ws = new WebSocket(this.tachyonUrl, [TACHYON_PROTOCOL_VERSION], {
			headers: {
				authorization: `Bearer ${accessToken}`,
			},
			perMessageDeflate: false,
		});
		this.ws = ws;

		ws.on('open', () => {
			this.state = ClientState.CONNECTED;
			this.emit('connected');
		});

		ws.on('error', (err) => this.handleError(err));
		ws.on('close', () => this.close());

		ws.on('message', (msg, isBinary) => {
			if (isBinary) {
				ws.close(1003, 'Binary messages are not supported');
				this.close();
				return;
			}
			let tachyonMsg: TachyonMessage;
			try {
				tachyonMsg = parseTachyonMessage(msg.toString('utf-8'));
			} catch {
				ws.close(1008, 'Failed to parse base tachyon message');
				this.close();
				return;
			}
			this.emit('message', tachyonMsg);
		});
	}

	private handleError(err: Error) {
		if (this.state === ClientState.CLOSED) return;
		this.emit('error', err);
		this.close();
	}

	public send(msg: TachyonCommand): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this.state !== ClientState.CONNECTED) {
				reject(new Error('Client is not connected'));
				return;
			}
			this.ws!.send(JSON.stringify(msg), { binary: false }, (err) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}

	public close() {
		if (this.state === ClientState.CLOSED) return;
		this.state = ClientState.CLOSED;
		if (this.ws) {
			this.ws.close(1000);
		}
		this.emit('close');
	}
}
