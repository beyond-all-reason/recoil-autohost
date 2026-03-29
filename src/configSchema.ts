// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

export const ConfigSchema = {
	$id: 'Config',
	type: 'object',
	properties: {
		tachyonServer: {
			type: 'string',
			description: 'Hostname of the tachyon server to connect to.',
		},
		tachyonServerPort: {
			type: 'number',
			nullable: true,
			default: null,
			description:
				'Optional port of the tachyon server, by default standard HTTPS port will be used.',
		},
		useSecureConnection: {
			type: 'boolean',
			nullable: true,
			default: null,
			description:
				'Whether to use HTTPS/WSS to connect to tachyon server. Defaults to true, except for localhost.',
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
			description: 'Maximum number of battles that can be hosted.',
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
		maxGameDurationSeconds: {
			type: 'number',
			description: 'How many seconds to wait before automatically killing the game.',
			default: 8 * 60 * 60,
			minimum: 60 * 60,
		},
	},
	required: ['tachyonServer', 'authClientId', 'authClientSecret', 'hostingIP'],
	additionalProperties: true,
} as const;
