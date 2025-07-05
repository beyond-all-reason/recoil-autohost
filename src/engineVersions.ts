// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Module with functionality responsible for managing installed engine versions.
 */
import { spawn } from 'node:child_process';
import { TypedEmitter } from 'tiny-typed-emitter';
import { Environment } from './environment.js';
import { FSWatcher } from 'chokidar';
import fs from 'node:fs';

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
}

export type Env = Environment<Config, Mocks>;

/**
 * EngineVersionsManager handles installation and listing of engine versions.
 *
 * TODO: Implement installEngine method.
 */
export class EngineVersionsManagerImpl
	extends TypedEmitter<EngineVersionsManagerEvents>
	implements EngineVersionsManager
{
	private logger: Env['logger'];
	private env: Env;
	public engineVersions: string[] = [];
	private watcher: FSWatcher;
	// We buffer `versions` events until the initial scan is complete to avoid
	// emitting an event for each engine individually at startup.
	private ready = false;

	constructor(env: Env) {
		super();
		this.env = env;
		this.logger = env.logger.child({ class: 'EngineVersionsManager' });

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
		if (version === '') {
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
		const index = this.engineVersions.indexOf(version);
		if (index > -1) {
			this.engineVersions.splice(index, 1);
			if (this.ready) {
				this.emit('versions', this.engineVersions);
			}
		}
	}

	public installEngine(version: string) {
		this.logger.info({ version }, 'got request to install engine, not implemented');
	}

	public close(): Promise<void> {
		return this.watcher.close();
	}
}
