import fs from 'node:fs/promises';
import { Ajv, JSONSchemaType, type Plugin } from 'ajv';
import ajvFormats, { type FormatsPluginOptions } from 'ajv-formats';
// https://github.com/ajv-validator/ajv-formats/issues/85#issuecomment-2377962689
const addFormats = ajvFormats as unknown as Plugin<FormatsPluginOptions>;

export interface Config {
	hostname: string;
	port: number | null;
	clientId: string;
	clientSecret: string;
	maxReconnectDelaySeconds: number;
	engineStartPort: number;
	autohostStartPort: number;
	maxPortsUsed: number;
	maxBattles: number;
	gameHostIP: string;
	maxUpdatesSubscriptionAgeSeconds: number;
	springsettings: { [k: string]: string };
}

const ConfigSchema: JSONSchemaType<Config> = {
	$id: 'Config',
	type: 'object',
	properties: {
		hostname: { type: 'string' },
		port: { type: 'number' },
		clientId: { type: 'string' },
		clientSecret: { type: 'string' },
		maxReconnectDelaySeconds: { type: 'number', default: 30, minimum: 1 },
		engineStartPort: { type: 'integer', default: 20000, minimum: 1025, maximum: 65535 },
		autohostStartPort: { type: 'integer', default: 22000, minimum: 1025, maximum: 65535 },
		maxPortsUsed: { type: 'integer', default: 1000, minimum: 1 },
		maxBattles: { type: 'integer', default: 50, minimum: 1 },
		gameHostIP: { type: 'string', format: 'ipv4', default: '127.0.0.1' },
		maxUpdatesSubscriptionAgeSeconds: { type: 'number', default: 10 * 60 },
		springsettings: {
			type: 'object',
			additionalProperties: { type: 'string' },
			default: {},
			required: [],
		},
	},
	required: ['hostname', 'clientId', 'clientSecret'],
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
