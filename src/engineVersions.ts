// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Module with functionality responsible for managing installed engine versions.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { FSWatcher } from 'chokidar';
import { TypedEmitter } from 'tiny-typed-emitter';
import { EngineInstaller } from './engineInstaller.js';
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
	engineCdnBaseUrl: string;
}

interface Mocks {
	spawn?: typeof spawn;
	fetch?: typeof fetch;
}

export type Env = Environment<Config, Mocks>;

/**
 * EngineVersionsManager handles installation and listing of engine versions.
 */
export class EngineVersionsManagerImpl
	extends TypedEmitter<EngineVersionsManagerEvents>
	implements EngineVersionsManager
{
	private logger: Env['logger'];
	public engineVersions: string[] = [];
	private watcher: FSWatcher;
	private installer: EngineInstaller;
	private installInFlight: Map<string, Promise<void>> = new Map();
	// We buffer `versions` events until the initial scan is complete to avoid
	// emitting an event for each engine individually at startup.
	private ready = false;

	constructor(env: Env) {
		super();
		this.logger = env.logger.child({ class: 'EngineVersionsManager' });
		this.installer = new EngineInstaller(env);

		fs.mkdirSync('engines', { recursive: true });

		this.watcher = new FSWatcher({
			cwd: 'engines',
			depth: 0,
		});

		this.watcher.on('addDir', (path) => this.addEngineVersion(path));
		this.watcher.on('unlinkDir', (path) => this.removeEngineVersion(path));
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
			return;
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

		const installJob = this.installer
			.install(version)
			.catch((error) => {
				this.logger.error({ error, version }, 'engine install failed');
			})
			.finally(() => {
				this.installInFlight.delete(version);
			});

		this.installInFlight.set(version, installJob);
	}

	public close(): Promise<void> {
		return this.watcher.close();
	}
}
