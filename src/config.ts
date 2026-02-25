// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises';
import { Ajv, JSONSchemaType, type Plugin } from 'ajv';
import ajvFormats, { type FormatsPluginOptions } from 'ajv-formats';
// https://github.com/ajv-validator/ajv-formats/issues/85#issuecomment-2377962689
const addFormats = ajvFormats as unknown as Plugin<FormatsPluginOptions>;

export interface Config {
	tachyonServer: string;
	tachyonServerPort: number | null;
	useSecureConnection: boolean | null;
	authClientId: string;
	authClientSecret: string;
	hostingIP: string;
	engineBindIP: string;
	maxReconnectDelaySeconds: number;
	engineSettings: { [k: string]: string };
	maxBattles: number;
	maxUpdatesSubscriptionAgeSeconds: number;
	engineStartPort: number;
	engineAutohostStartPort: number;
	maxPortsUsed: number;
	engineInstallTimeoutSeconds: number;
	engineDownloadMaxAttempts: number;
	engineDownloadRetryBackoffBaseMs: number;
	engineCdnBaseUrl: string;
	maxGameDurationSeconds: number;
}

const ConfigSchema: JSONSchemaType<Config> = {
	$id: 'Config',
	type: 'object',
	properties: {
		tachyonServer: {
			type: 'string',
			description: 'Hostname of the tachyon server to connect to.',
		},
		tachyonServerPort: {
			type: 'number',
			description:
				'Optional port of the tachyon server, by default standard HTTPS port will be used.',
		},
		useSecureConnection: {
			type: 'boolean',
			description:
				'Whatever to use HTTPS/WSS to connect to tachyon server. Defaults to true, except for localhost.',
		},
		authClientId: {
			type: 'string',
			description: 'OAuth2 client id for authentication.',
		},
		authClientSecret: {
			type: 'string',
			description: 'OAuth2 client secret for authentication',
		},
		hostingIP: {
			type: 'string',
			description: 'The IP advertised to clients for connecting to the battle.',
			format: 'ipv4',
		},
		engineBindIP: {
			type: 'string',
			description: 'The local IP/interface used by engine to bind the battle socket.',
			default: '0.0.0.0',
			format: 'ipv4',
		},
		maxReconnectDelaySeconds: {
			type: 'number',
			description: 'Maximum delay for reconnects to tachyon server.',
			default: 30,
			minimum: 1,
		},
		engineSettings: {
			type: 'object',
			description: 'Engine settings to be serialized into springsettings.cfg',
			additionalProperties: { type: 'string' },
			default: {},
			required: [],
		},
		maxBattles: {
			type: 'integer',
			description: 'Maximum number of battler that can be hosted.',
			default: 50,
			minimum: 1,
		},
		maxUpdatesSubscriptionAgeSeconds: {
			type: 'number',
			description:
				'For how long autohost will keep engine updates. This determines the max time used in subscribeUpdates.',
			default: 10 * 60,
		},
		engineStartPort: {
			type: 'integer',
			description: 'Start of the port range used by engine instances.',
			default: 20000,
			minimum: 1025,
			maximum: 65535,
		},
		engineAutohostStartPort: {
			type: 'integer',
			description:
				'Start of the port range used by engine for autohost interface on localhost.',
			default: 22000,
			minimum: 1025,
			maximum: 65535,
		},
		maxPortsUsed: {
			type: 'integer',
			description:
				'Maximum number of ports that can be used by the service, this +StartPorts define the port range.',
			default: 1000,
			minimum: 1,
		},
		engineInstallTimeoutSeconds: {
			type: 'integer',
			description: 'Hard timeout for engine installation by engine manager',
			default: 10 * 60,
			minimum: 5,
		},
		engineDownloadMaxAttempts: {
			type: 'integer',
			description: 'Maximum number of attempts to download and verify an engine archive.',
			default: 3,
			minimum: 1,
		},
		engineDownloadRetryBackoffBaseMs: {
			type: 'integer',
			description:
				'Base backoff in milliseconds used between engine download retry attempts.',
			default: 1000,
			minimum: 1000,
		},
		engineCdnBaseUrl: {
			type: 'string',
			description: 'Base URL of BAR CDN API used for engine release lookup.',
			default: 'https://files-cdn.beyondallreason.dev',
			format: 'uri',
		},
		maxGameDurationSeconds: {
			type: 'number',
			description: 'How many seconds to wait before automatically killing the game.',
			default: 8 * 60 * 60,
			minimum: 60 * 60,
		},
	},
	required: ['tachyonServer', 'authClientId', 'authClientSecret', 'hostingIP'],
	additionalProperties: true,
};

const ajv = new Ajv({ strict: true, useDefaults: true, coerceTypes: true });
addFormats(ajv);
const validateConfig = ajv.compile(ConfigSchema);

export async function loadConfig(path: string): Promise<Config> {
	const config = JSON.parse(await fs.readFile(path, 'utf-8'));
	if (!validateConfig(config)) {
		throw new Error('Invalid config', {
			cause: new Error(ajv.errorsText(validateConfig.errors)),
		});
	}
	return config;
}
