// SPDX-FileCopyrightText: 2026 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import { Ajv, JSONSchemaType, type Plugin } from 'ajv';
import ajvFormats, { type FormatsPluginOptions } from 'ajv-formats';
import { engineBinaryName } from './engineBinary.js';
import { Environment } from './environment.js';
import { SevenZipExtractor } from './sevenZip.js';

// https://github.com/ajv-validator/ajv-formats/issues/85#issuecomment-2377962689
const addFormats = ajvFormats as unknown as Plugin<FormatsPluginOptions>;

interface Config {
	engineInstallTimeoutSeconds: number;
	engineDownloadMaxAttempts: number;
	engineDownloadRetryBackoffBaseMs: number;
	engineCdnBaseUrl: string;
}

interface Mocks {
	spawn?: typeof spawn;
	fetch?: typeof fetch;
}

interface RecoilReleaseInfo {
	filename: string;
	springname: string;
	md5: string;
	category: string;
	version: string;
	path: string;
	tags: string[];
	size: number;
	timestamp: string;
	mirrors: string[];
}

const releaseLookupSchema: JSONSchemaType<RecoilReleaseInfo[]> = {
	type: 'array',
	items: {
		type: 'object',
		properties: {
			filename: { type: 'string' },
			springname: { type: 'string' },
			md5: { type: 'string' },
			category: { type: 'string' },
			version: { type: 'string' },
			path: { type: 'string' },
			tags: { type: 'array', items: { type: 'string' } },
			size: { type: 'number' },
			timestamp: { type: 'string' },
			mirrors: { type: 'array', items: { type: 'string', format: 'uri' } },
		},
		required: [
			'filename',
			'springname',
			'md5',
			'category',
			'version',
			'path',
			'tags',
			'size',
			'timestamp',
			'mirrors',
		],
		additionalProperties: true,
	},
};

const ajv = new Ajv({ strict: true, coerceTypes: false });
addFormats(ajv);
const validateReleaseLookup = ajv.compile(releaseLookupSchema);

type Env = Environment<Config, Mocks>;

export class EngineInstaller {
	private static readonly DOWNLOADS_DIR = '.downloads';
	private static readonly TEMP_PREFIX = '.tmp-install-';

	private logger: Env['logger'];
	private sevenZip: SevenZipExtractor;

	constructor(private env: Env) {
		this.logger = env.logger.child({ class: 'EngineInstaller' });
		this.sevenZip = new SevenZipExtractor(this.logger, env.mocks?.spawn);
	}

	public async install(version: string): Promise<void> {
		if (await this.isEngineInstalled(version)) {
			this.logger.info({ version }, 'engine already installed');
			return;
		}

		this.logger.info({ version }, 'starting engine install');
		const release = await this.findEngineRelease(version);
		const mirrorUrl = release.mirrors[0];
		if (!mirrorUrl) {
			throw new Error(`No mirror found for engine ${version}`);
		}

		const timeoutMs = this.env.config.engineInstallTimeoutSeconds * 1000;
		const enginesRoot = path.resolve('engines');
		const downloadsDir = path.join(enginesRoot, EngineInstaller.DOWNLOADS_DIR);
		const archivePath = path.join(downloadsDir, release.filename);
		const finalDir = path.join(enginesRoot, version);
		const tempDir = path.join(
			enginesRoot,
			`${EngineInstaller.TEMP_PREFIX}${version}-${randomUUID()}`,
		);

		await fsPromises.mkdir(downloadsDir, { recursive: true });
		await fsPromises.mkdir(tempDir, { recursive: true });

		try {
			await this.downloadAndVerifyArchive(mirrorUrl, archivePath, release.md5, timeoutMs);
			await this.sevenZip.extract(archivePath, tempDir, timeoutMs);

			await fsPromises.access(path.join(tempDir, engineBinaryName()));

			await fsPromises.rm(finalDir, { recursive: true, force: true });
			await fsPromises.rename(tempDir, finalDir);
			this.logger.info({ version }, 'engine install completed');
		} finally {
			await fsPromises.rm(archivePath, { force: true });
			await fsPromises.rm(tempDir, { recursive: true, force: true });
		}
	}

	private async downloadAndVerifyArchive(
		url: string,
		targetPath: string,
		expectedMd5: string,
		timeoutMs: number,
	): Promise<void> {
		const maxAttempts = Math.max(1, this.env.config.engineDownloadMaxAttempts);
		const backoffBaseMs = Math.max(1, this.env.config.engineDownloadRetryBackoffBaseMs);
		let lastError: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				await this.downloadFile(url, targetPath, timeoutMs);
				await this.verifyArchiveChecksum(targetPath, expectedMd5);
				return;
			} catch (error) {
				lastError = error;
				await fsPromises.rm(targetPath, { force: true });

				if (attempt === maxAttempts) {
					break;
				}

				const backoffMs = backoffBaseMs * Math.pow(2, attempt - 1);
				this.logger.warn(
					{ attempt, maxAttempts, backoffMs, error },
					'engine archive download failed, retrying',
				);
				await this.delay(backoffMs);
			}
		}

		if (lastError instanceof Error) {
			throw lastError;
		}

		throw new Error(`Engine archive download failed after ${maxAttempts} attempts`);
	}

	private async delay(timeoutMs: number): Promise<void> {
		await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
	}

	private async isEngineInstalled(version: string): Promise<boolean> {
		const engineBinaryPath = path.resolve('engines', version, engineBinaryName());
		try {
			await fsPromises.access(engineBinaryPath);
			return true;
		} catch {
			return false;
		}
	}

	private engineCategory() {
		return process.platform === 'win32' ? 'engine_windows64' : 'engine_linux64';
	}

	private async findEngineRelease(version: string): Promise<RecoilReleaseInfo> {
		const url = new URL('/find', this.env.config.engineCdnBaseUrl);
		url.searchParams.set('category', this.engineCategory());
		url.searchParams.set('springname', version);

		const response = await (this.env.mocks?.fetch ?? globalThis.fetch)(url);
		if (!response.ok) {
			throw new Error(`Engine lookup failed with status ${response.status}`);
		}

		const payload = (await response.json()) as unknown;
		if (!validateReleaseLookup(payload)) {
			throw new Error(
				`Invalid release lookup payload: ${ajv.errorsText(validateReleaseLookup.errors)}`,
			);
		}
		if (payload.length === 0) {
			throw new Error(`No release found for engine ${version}`);
		}

		return payload[0];
	}

	private async downloadFile(url: string, targetPath: string, timeoutMs: number): Promise<void> {
		this.logger.info({ url, timeoutMs }, 'downloading engine archive');
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await (this.env.mocks?.fetch ?? globalThis.fetch)(url, {
				signal: controller.signal,
			});
			if (!response.ok || !response.body) {
				throw new Error(`Engine download failed with status ${response.status}`);
			}
			const bytes = new Uint8Array(await response.arrayBuffer());
			await fsPromises.writeFile(targetPath, bytes);
		} finally {
			clearTimeout(timeout);
		}
	}

	private async verifyArchiveChecksum(archivePath: string, expectedMd5: string): Promise<void> {
		const hash = createHash('md5');
		for await (const chunk of createReadStream(archivePath)) {
			hash.update(chunk);
		}

		const actualMd5 = hash.digest('hex').toLowerCase();
		if (actualMd5 !== expectedMd5.toLowerCase()) {
			throw new Error(
				`Engine archive checksum mismatch, expected ${expectedMd5.toLowerCase()}, got ${actualMd5}`,
			);
		}
	}
}
