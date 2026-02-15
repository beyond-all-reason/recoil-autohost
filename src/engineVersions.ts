// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Module with functionality responsible for managing installed engine versions.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import { FSWatcher } from 'chokidar';
import { TypedEmitter } from 'tiny-typed-emitter';
import { Environment } from './environment.js';

export interface EngineVersionsManagerEvents {
	versions: (versions: string[]) => void;
	error: (err: Error) => void;
}

export interface EngineVersionsManager extends TypedEmitter<EngineVersionsManagerEvents> {
	installEngine(version: string): void;
	readonly engineVersions: string[];
	close(): Promise<void>;
}

interface Config {
	engineInstallTimeoutSeconds: number;
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
	timestamp: string; // ISO 8601 datetime string
	mirrors: string[];
}

export type Env = Environment<Config, Mocks>;

/**
 * EngineVersionsManager handles installation and listing of engine versions.
 */
export class EngineVersionsManagerImpl
	extends TypedEmitter<EngineVersionsManagerEvents>
	implements EngineVersionsManager
{
	private static readonly DOWNLOADS_DIR = '.downloads';
	private static readonly TEMP_PREFIX = '.tmp-install-';

	private logger: Env['logger'];
	public engineVersions: string[] = [];
	private watcher: FSWatcher;
	private installInFlight: Map<string, Promise<void>> = new Map();
	// We buffer `versions` events until the initial scan is complete to avoid
	// emitting an event for each engine individually at startup.
	private ready = false;

	constructor(private env: Env) {
		super();
		this.logger = env.logger.child({ class: 'EngineVersionsManager' });

		fs.mkdirSync('engines', { recursive: true });

		this.watcher = new FSWatcher({
			cwd: 'engines',
			depth: 0,
		});

		this.watcher.on('addDir', (entry) => this.addEngineVersion(entry));
		this.watcher.on('unlinkDir', (entry) => this.removeEngineVersion(entry));
		this.watcher.on('ready', () => {
			this.ready = true;
			this.emit('versions', this.engineVersions);
		});
		this.watcher.on('error', (error: unknown) => {
			if (error instanceof Error) {
				this.emit('error', error);
			} else {
				this.emit('error', new Error(`Unknown error from chokidar: ${error}`));
			}
		});

		this.watcher.add('.');
	}

	private addEngineVersion(version: string) {
		// Chokidar emits an 'addDir' event with an empty path for the root
		// directory itself, which we need to ignore.
		if (version === '' || version.startsWith('.')) {
			return;
		}
		if (!this.engineVersions.includes(version)) {
			this.engineVersions.push(version);
			if (this.ready) {
				this.emit('versions', this.engineVersions);
			}
		}
	}

	private removeEngineVersion(version: string) {
		if (version.startsWith('.')) {
			return
		}
		const index = this.engineVersions.indexOf(version);
		if (index > -1) {
			this.engineVersions.splice(index, 1);
			if (this.ready) {
				this.emit('versions', this.engineVersions);
			}
		}
	}

	public installEngine(version: string) {
		if (this.installInFlight.has(version)) {
			this.logger.info({ version }, 'engine install already in progress');
			return;
		}

		const installJob = this.installEngineImpl(version)
			.catch((error) => {
				this.logger.error({ error, version }, 'engine install failed');
			})
			.finally(() => {
				this.installInFlight.delete(version);
			});

		this.installInFlight.set(version, installJob);
	}

	private async installEngineImpl(version: string): Promise<void> {
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
		const downloadsDir = path.join(enginesRoot, EngineVersionsManagerImpl.DOWNLOADS_DIR);
		const archivePath = path.join(downloadsDir, release.filename);
		const finalDir = path.join(enginesRoot, version);
		const tempDir = path.join(
			enginesRoot,
			`${EngineVersionsManagerImpl.TEMP_PREFIX}${version}-${randomUUID()}`,
		);

		await fsPromises.mkdir(downloadsDir, { recursive: true });
		await fsPromises.mkdir(tempDir, { recursive: true });

		try {
			await this.downloadFile(mirrorUrl, archivePath, timeoutMs);
			await this.run7zipExtract(archivePath, tempDir, timeoutMs);

			await fsPromises.access(path.join(tempDir, 'spring-dedicated'));

			await fsPromises.rm(finalDir, { recursive: true, force: true });
			await fsPromises.rename(tempDir, finalDir);
			this.logger.info({ version }, 'engine install completed');
		} finally {
			await fsPromises.rm(archivePath, { force: true });
			await fsPromises.rm(tempDir, { recursive: true, force: true });
		}
	}

	private async isEngineInstalled(version: string): Promise<boolean> {
		const engineBinaryPath = path.resolve('engines', version, 'spring-dedicated');
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
		const url = new URL('https://files-cdn.beyondallreason.dev/find');
		url.searchParams.set('category', this.engineCategory());
		url.searchParams.set('springname', version);

		const response = await (this.env.mocks?.fetch ?? globalThis.fetch)(url);
		if (!response.ok) {
			throw new Error(`Engine lookup failed with status ${response.status}`);
		}

		// TODO: validation necessary?
		const payload: RecoilReleaseInfo[] = await response.json() as RecoilReleaseInfo[];
		if (!Array.isArray(payload) || payload.length === 0) {
			throw new Error(`No release found for engine ${version}`);
		}

		return payload[0];
	}

	private async downloadFile(url: string, targetPath: string, timeoutMs: number): Promise<void> {
		this.logger.info({ url }, 'downloading engine archive');
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

	private async run7zipExtract(
		archivePath: string,
		outputPath: string,
		timeoutMs: number,
	): Promise<void> {
		const sevenZipBin = process.env['SEVEN_ZIP_BIN'] ?? '7z';
		this.logger.info({ archivePath, outputPath }, 'extracting engine archive');

		await new Promise<void>((resolve, reject) => {
			const proc = (this.env.mocks?.spawn ?? spawn)(
				sevenZipBin,
				['x', archivePath, '-y', `-o${outputPath}`],
				{ stdio: ['ignore', 'ignore', 'pipe'] },
			);

			let stderr = '';
			proc.stderr?.on('data', (chunk) => {
				stderr += chunk.toString();
			});

			const timeout = setTimeout(() => {
				proc.kill();
				reject(new Error(`Engine extraction timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			proc.on('error', (err) => {
				clearTimeout(timeout);
				reject(err);
			});

			proc.on('exit', (code) => {
				clearTimeout(timeout);
				if (code === 0) {
					resolve();
					return;
				}
				reject(new Error(stderr || `7z exited with code ${code}`));
			});
		});
	}

	public close(): Promise<void> {
		return this.watcher.close();
	}
}
