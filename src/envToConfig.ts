// SPDX-FileCopyrightText: 2026 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises';

function parseStringMap(raw: string | undefined): Record<string, string> | undefined {
	if (raw === undefined || raw.trim() === '') {
		return undefined;
	}

	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return undefined;
		}
		const entries = Object.entries(parsed);
		const result: Record<string, string> = {};
		for (const [key, value] of entries) {
			if (typeof value === 'string') {
				result[key] = value;
			} else if (value !== undefined && value !== null) {
				result[key] = String(value);
			}
		}
		return result;
	} catch {
		return undefined;
	}
}

function readConfigFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
	const config: Record<string, unknown> = {
		tachyonServer: env['tachyonServer'],
		tachyonServerPort: env['tachyonServerPort'],
		useSecureConnection: env['useSecureConnection'],
		authClientId: env['authClientId'],
		authClientSecret: env['authClientSecret'],
		hostingIP: env['hostingIP'],
		engineBindIP: env['engineBindIP'],
		maxReconnectDelaySeconds: env['maxReconnectDelaySeconds'],
		engineSettings: parseStringMap(env['engineSettings']),
		maxBattles: env['maxBattles'],
		maxUpdatesSubscriptionAgeSeconds: env['maxUpdatesSubscriptionAgeSeconds'],
		engineStartPort: env['engineStartPort'],
		engineAutohostStartPort: env['engineAutohostStartPort'],
		maxPortsUsed: env['maxPortsUsed'],
		engineInstallTimeoutSeconds: env['engineInstallTimeoutSeconds'],
		maxGameDurationSeconds: env['maxGameDurationSeconds'],
	};

	for (const [key, value] of Object.entries(config)) {
		if (value === undefined) {
			delete config[key];
		}
	}

	return config;
}

async function main(argv: string[]) {
	if (argv.length < 3) {
		throw new Error('usage: node dist/env-to-config.js <config-path>');
	}

	const configPath = argv[2];
	const config = readConfigFromEnv(process.env);
	await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

if (import.meta.filename === process.argv[1]) {
	await main(process.argv);
}
