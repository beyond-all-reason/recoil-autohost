import fs from 'node:fs/promises';
import { Ajv, JSONSchemaType } from 'ajv';

export interface Config {
	hostname: string;
	port: number | null;
	clientId: string;
	clientSecret: string;
	maxReconnectDelaySeconds: number;
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
	},
	required: ['hostname', 'clientId', 'clientSecret'],
	additionalProperties: true,
};

const ajv = new Ajv({ strict: true, useDefaults: true, coerceTypes: true });
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
