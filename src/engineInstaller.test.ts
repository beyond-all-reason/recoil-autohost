// SPDX-FileCopyrightText: 2026 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { suite, test, mock } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { EngineInstaller } from './engineInstaller.js';

type EngineInstallerAccess = {
	findEngineRelease(version: string): Promise<unknown>;
	downloadFile(url: string, targetPath: string, timeoutMs: number): Promise<void>;
	verifyArchiveChecksum(archivePath: string, expectedMd5: string): Promise<void>;
	downloadAndVerifyArchive(
		url: string,
		targetPath: string,
		expectedMd5: string,
		timeoutMs: number,
	): Promise<void>;
	delay(timeoutMs: number): Promise<void>;
};

suite('EngineInstaller', () => {
	function getEnv(fetchImpl: typeof fetch) {
		return {
			logger: pino({ level: 'silent' }),
			config: {
				engineInstallTimeoutSeconds: 60,
				engineDownloadMaxAttempts: 3,
				engineDownloadRetryBackoffBaseMs: 1000,
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
				engineDownloadMaxAttempts: 3,
				engineDownloadRetryBackoffBaseMs: 1000,
				engineCdnBaseUrl: 'https://cdn.example.test/base',
			},
		}) as unknown as EngineInstallerAccess;

		await installer.findEngineRelease('105.1.1-1234-gabcd');

		const url = new URL(requestUrl);
		assert.equal(url.origin, 'https://cdn.example.test');
		assert.equal(url.pathname, '/find');
		assert.equal(url.searchParams.get('springname'), '105.1.1-1234-gabcd');
	});

	test('verifies archive checksum', async () => {
		const tmp = await mkdtemp(join(tmpdir(), 'engine-installer-test-'));
		const archivePath = join(tmp, 'engine.7z');
		const archiveData = Buffer.from('fake-archive-data');
		await writeFile(archivePath, archiveData);

		const md5 = createHash('md5').update(archiveData).digest('hex');
		const installer = new EngineInstaller(
			getEnv(async () => new Response('', { status: 200 })),
		) as unknown as EngineInstallerAccess;

		await assert.doesNotReject(installer.verifyArchiveChecksum(archivePath, md5));
		await assert.rejects(
			installer.verifyArchiveChecksum(archivePath, '00000000000000000000000000000000'),
			/checksum mismatch/,
		);

		await rm(tmp, { recursive: true, force: true });
	});

	test('retries download when checksum verification fails', async () => {
		const installer = new EngineInstaller(
			getEnv(async () => new Response('', { status: 200 })),
		) as unknown as EngineInstallerAccess;

		let downloadCalls = 0;
		let verifyCalls = 0;
		mock.method(installer, 'downloadFile', async () => {
			downloadCalls += 1;
		});
		mock.method(installer, 'verifyArchiveChecksum', async () => {
			verifyCalls += 1;
			if (verifyCalls < 3) {
				throw new Error('checksum mismatch');
			}
		});
		mock.method(installer, 'delay', async () => {});

		await assert.doesNotReject(
			installer.downloadAndVerifyArchive(
				'https://example.invalid/engine.7z',
				join(tmpdir(), 'engine.7z'),
				'abc123',
				1000,
			),
		);

		assert.equal(downloadCalls, 3);
		assert.equal(verifyCalls, 3);
	});
});
