// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import { suite, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from './config.js';

/**
 * Minimal set of required env vars that produce a valid config.
 */
const REQUIRED_ENV = {
	AUTOHOST_TACHYON_SERVER: 'tachyon.example.com',
	AUTOHOST_AUTH_CLIENT_ID: 'client1',
	AUTOHOST_AUTH_CLIENT_SECRET: 'secret1',
	AUTOHOST_HOSTING_IP: '10.0.0.1',
};

/**
 * Minimal valid JSON config (required fields only).
 */
const REQUIRED_JSON: Record<string, unknown> = {
	tachyonServer: 'tachyon.example.com',
	authClientId: 'client1',
	authClientSecret: 'secret1',
	hostingIP: '10.0.0.1',
};

suite('loadConfig', () => {
	let tmpDir: string;

	// Save and restore the full env to prevent cross-test pollution.
	let savedEnv: NodeJS.ProcessEnv;
	beforeEach(async () => {
		savedEnv = { ...process.env };
		tmpDir = await mkdtemp(join(tmpdir(), 'config-test-'));
		// Clear all AUTOHOST_ env vars so tests start clean
		for (const key of Object.keys(process.env)) {
			if (key.startsWith('AUTOHOST_')) {
				delete process.env[key];
			}
		}
	});
	afterEach(async () => {
		process.env = savedEnv;
		await rm(tmpDir, { recursive: true, force: true });
	});

	function setEnv(vars: Record<string, string>) {
		for (const [k, v] of Object.entries(vars)) {
			process.env[k] = v;
		}
	}

	async function writeJson(obj: Record<string, unknown>): Promise<string> {
		const p = join(tmpDir, 'config.json');
		await writeFile(p, JSON.stringify(obj));
		return p;
	}

	// ── env-only tests ─────────────────────────────────────────────

	test('loads config from env vars only (no JSON file)', async () => {
		setEnv(REQUIRED_ENV);
		const config = await loadConfig();
		assert.equal(config.tachyonServer, 'tachyon.example.com');
		assert.equal(config.authClientId, 'client1');
		assert.equal(config.authClientSecret, 'secret1');
		assert.equal(config.hostingIP, '10.0.0.1');
	});

	test('applies defaults for optional fields from env', async () => {
		setEnv(REQUIRED_ENV);
		const config = await loadConfig();
		assert.equal(config.engineBindIP, '0.0.0.0');
		assert.equal(config.maxReconnectDelaySeconds, 30);
		assert.equal(config.maxBattles, 50);
		assert.equal(config.engineStartPort, 20000);
		assert.equal(config.engineAutohostStartPort, 22000);
		assert.equal(config.maxPortsUsed, 1000);
		assert.equal(config.engineInstallTimeoutSeconds, 600);
		assert.equal(config.maxGameDurationSeconds, 28800);
		assert.deepEqual(config.engineSettings, {});
		assert.equal(config.tachyonServerPort, null);
		assert.equal(config.useSecureConnection, null);
	});

	test('reads optional env vars', async () => {
		setEnv({
			...REQUIRED_ENV,
			AUTOHOST_TACHYON_SERVER_PORT: '9090',
			AUTOHOST_USE_SECURE_CONNECTION: 'true',
			AUTOHOST_ENGINE_BIND_IP: '192.168.1.1',
			AUTOHOST_MAX_RECONNECT_DELAY_SECONDS: '60',
			AUTOHOST_ENGINE_SETTINGS: '{"Foo":"bar"}',
			AUTOHOST_MAX_BATTLES: '100',
			AUTOHOST_MAX_UPDATES_SUBSCRIPTION_AGE_SECONDS: '900',
			AUTOHOST_ENGINE_START_PORT: '30000',
			AUTOHOST_ENGINE_AUTOHOST_START_PORT: '32000',
			AUTOHOST_MAX_PORTS_USED: '500',
			AUTOHOST_ENGINE_INSTALL_TIMEOUT_SECONDS: '300',
			AUTOHOST_MAX_GAME_DURATION_SECONDS: '7200',
		});
		const config = await loadConfig();
		assert.equal(config.tachyonServerPort, 9090);
		assert.equal(config.useSecureConnection, true);
		assert.equal(config.engineBindIP, '192.168.1.1');
		assert.equal(config.maxReconnectDelaySeconds, 60);
		assert.deepEqual(config.engineSettings, { Foo: 'bar' });
		assert.equal(config.maxBattles, 100);
		assert.equal(config.maxUpdatesSubscriptionAgeSeconds, 900);
		assert.equal(config.engineStartPort, 30000);
		assert.equal(config.engineAutohostStartPort, 32000);
		assert.equal(config.maxPortsUsed, 500);
		assert.equal(config.engineInstallTimeoutSeconds, 300);
		assert.equal(config.maxGameDurationSeconds, 7200);
	});

	test('useSecureConnection false string', async () => {
		setEnv({ ...REQUIRED_ENV, AUTOHOST_USE_SECURE_CONNECTION: 'false' });
		const config = await loadConfig();
		assert.equal(config.useSecureConnection, false);
	});

	// ── JSON-only tests ────────────────────────────────────────────

	test('loads config from JSON file only', async () => {
		const p = await writeJson(REQUIRED_JSON);
		const config = await loadConfig(p);
		assert.equal(config.tachyonServer, 'tachyon.example.com');
		assert.equal(config.authClientId, 'client1');
		assert.equal(config.maxBattles, 50); // default
	});

	test('loads optional fields from JSON', async () => {
		const p = await writeJson({
			...REQUIRED_JSON,
			tachyonServerPort: 8084,
			engineBindIP: '10.0.0.2',
			maxBattles: 25,
			engineSettings: { InitialNetworkTimeout: '1000' },
		});
		const config = await loadConfig(p);
		assert.equal(config.tachyonServerPort, 8084);
		assert.equal(config.engineBindIP, '10.0.0.2');
		assert.equal(config.maxBattles, 25);
		assert.deepEqual(config.engineSettings, { InitialNetworkTimeout: '1000' });
	});

	// ── Merge / precedence tests ───────────────────────────────────

	test('env vars override JSON values', async () => {
		const p = await writeJson({
			...REQUIRED_JSON,
			maxBattles: 25,
			engineBindIP: '10.0.0.2',
		});
		setEnv({
			AUTOHOST_MAX_BATTLES: '99',
			AUTOHOST_ENGINE_BIND_IP: '192.168.0.1',
		});
		const config = await loadConfig(p);
		assert.equal(config.maxBattles, 99);
		assert.equal(config.engineBindIP, '192.168.0.1');
		// Non-overridden JSON values are preserved
		assert.equal(config.tachyonServer, 'tachyon.example.com');
	});

	test('undefined env vars do not override JSON', async () => {
		const p = await writeJson({
			...REQUIRED_JSON,
			maxBattles: 25,
		});
		// No AUTOHOST_MAX_BATTLES in env
		const config = await loadConfig(p);
		assert.equal(config.maxBattles, 25);
	});

	// ── Validation error tests ─────────────────────────────────────

	test('throws on missing required fields (no config at all)', async () => {
		// No env, no file
		await assert.rejects(() => loadConfig(), /Invalid config/);
	});

	test('throws on invalid IPv4 for hostingIP', async () => {
		setEnv({ ...REQUIRED_ENV, AUTOHOST_HOSTING_IP: 'not-an-ip' });
		await assert.rejects(() => loadConfig(), /Invalid config/);
	});

	test('throws on invalid IPv4 for engineBindIP', async () => {
		setEnv({ ...REQUIRED_ENV, AUTOHOST_ENGINE_BIND_IP: '999.999.999.999' });
		await assert.rejects(() => loadConfig(), /Invalid config/);
	});

	test('throws on port out of range', async () => {
		setEnv({ ...REQUIRED_ENV, AUTOHOST_ENGINE_START_PORT: '99999' });
		await assert.rejects(() => loadConfig(), /Invalid config/);
	});

	test('throws on maxBattles below minimum', async () => {
		setEnv({ ...REQUIRED_ENV, AUTOHOST_MAX_BATTLES: '0' });
		await assert.rejects(() => loadConfig(), /Invalid config/);
	});

	test('throws on invalid engineSettings JSON', async () => {
		setEnv({ ...REQUIRED_ENV, AUTOHOST_ENGINE_SETTINGS: 'not json' });
		await assert.rejects(() => loadConfig(), /Invalid JSON/);
	});

	test('throws on non-existent config file', async () => {
		await assert.rejects(() => loadConfig(join(tmpDir, 'does-not-exist.json')), /ENOENT/);
	});

	test('throws on malformed JSON file', async () => {
		const p = join(tmpDir, 'bad.json');
		await writeFile(p, '{ invalid json }}}');
		await assert.rejects(() => loadConfig(p), /JSON/);
	});

	// ── Type coercion tests ────────────────────────────────────────

	test('coerces string numbers from env vars', async () => {
		setEnv({
			...REQUIRED_ENV,
			AUTOHOST_MAX_BATTLES: '42',
			AUTOHOST_ENGINE_START_PORT: '25000',
		});
		const config = await loadConfig();
		assert.equal(config.maxBattles, 42);
		assert.equal(typeof config.maxBattles, 'number');
		assert.equal(config.engineStartPort, 25000);
		assert.equal(typeof config.engineStartPort, 'number');
	});
});
