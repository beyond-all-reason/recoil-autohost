// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises';
import { Ajv, type Plugin } from 'ajv';
import ajvFormats, { type FormatsPluginOptions } from 'ajv-formats';
import { ConfigSchema } from './configSchema.js';
import dotenv from 'dotenv';

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
	maxGameDurationSeconds: number;
}

const ajv = new Ajv({ strict: true, useDefaults: true, coerceTypes: true });
addFormats(ajv);
const validateConfig = ajv.compile<Config>(ConfigSchema);

function camelToEnvKey(key: string): string {
	return 'AUTOHOST_' + key.replace(/([A-Z]+)/g, '_$1').toUpperCase();
}

function readEnvFromSchema(env: Record<string, string | undefined>): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const [configKey, schemaProp] of Object.entries(ConfigSchema.properties)) {
		const envKey = camelToEnvKey(configKey);
		const raw = env[envKey];
		if (raw === undefined) continue;

		if (schemaProp.type === 'object') {
			try {
				result[configKey] = JSON.parse(raw);
			} catch {
				throw new Error(
					`Invalid JSON in ${envKey}: expected a JSON object like '{"key":"value"}', got: ${raw}`,
				);
			}
			continue;
		}

		result[configKey] = raw;
	}

	return result;
}

export async function loadConfig(path?: string): Promise<Config> {
	dotenv.config({ quiet: true });

	let fileConfig: Record<string, unknown> = {};
	if (path) {
		fileConfig = JSON.parse(await fs.readFile(path, 'utf-8'));
	}

	const config = { ...fileConfig, ...readEnvFromSchema(process.env) };
	if (!validateConfig(config)) {
		throw new Error('Invalid config', {
			cause: new Error(ajv.errorsText(validateConfig.errors)),
		});
	}
	return config;
}
