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
	maxReconnectDelaySeconds: number;
	engineSettings: { [k: string]: string };
	maxBattles: number;
	maxUpdatesSubscriptionAgeSeconds: number;
	engineStartPort: number;
	engineAutohostStartPort: number;
	maxPortsUsed: number;
	engineInstallTimeoutSeconds: number;
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
			description: 'The IP used by engine to hosting the battle.',
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
