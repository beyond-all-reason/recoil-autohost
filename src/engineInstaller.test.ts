// SPDX-FileCopyrightText: 2026 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { pino } from 'pino';
import { EngineInstaller } from './engineInstaller.js';

type EngineInstallerAccess = {
	findEngineRelease(version: string): Promise<unknown>;
};

suite('EngineInstaller', () => {
	function getEnv(fetchImpl: typeof fetch) {
		return {
			logger: pino({ level: 'silent' }),
			config: {
				engineInstallTimeoutSeconds: 60,
				engineCdnBaseUrl: 'https://files-cdn.beyondallreason.dev',
			},
			mocks: {
				fetch: fetchImpl,
			},
		};
	}

	test('rejects invalid release lookup payload', async () => {
		const installer = new EngineInstaller(
			getEnv(async () => {
				return new Response(JSON.stringify([{ invalid: 'shape' }]), { status: 200 });
			}),
		) as unknown as EngineInstallerAccess;

		await assert.rejects(
			installer.findEngineRelease('105.1.1-1234-gabcd'),
			/Invalid release lookup payload/,
		);
	});

	test('uses configured CDN base URL for release lookup', async () => {
		let requestUrl = '';
		const installer = new EngineInstaller({
			...getEnv(async (url) => {
				requestUrl = String(url);
				return new Response(
					JSON.stringify([
						{
							filename: 'engine.7z',
							springname: '105.1.1-1234-gabcd',
							md5: 'abc123',
							category: 'engine_linux64',
							version: '105.1.1-1234-gabcd',
							path: '/engine.7z',
							tags: ['stable'],
							size: 123,
							timestamp: '2026-01-01T00:00:00Z',
							mirrors: ['https://example.com/engine.7z'],
						},
					]),
					{ status: 200 },
				);
			}),
			config: {
				engineInstallTimeoutSeconds: 60,
				engineCdnBaseUrl: 'https://cdn.example.test/base',
			},
		}) as unknown as EngineInstallerAccess;

		await installer.findEngineRelease('105.1.1-1234-gabcd');

		const url = new URL(requestUrl);
		assert.equal(url.origin, 'https://cdn.example.test');
		assert.equal(url.pathname, '/find');
		assert.equal(url.searchParams.get('springname'), '105.1.1-1234-gabcd');
	});
});
