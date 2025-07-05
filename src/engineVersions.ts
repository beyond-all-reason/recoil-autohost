// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Module with functionality responsible for managing installed engine versions.
 */
import { spawn } from 'node:child_process';
import { TypedEmitter } from 'tiny-typed-emitter';
import { Environment } from './environment.js';
import fs from 'node:fs/promises';

export interface EngineVersionsManagerEvents {
	versions: (versions: string[]) => void;
	error: (err: Error) => void;
}

export interface EngineVersionsManager extends TypedEmitter<EngineVersionsManagerEvents> {
	installEngine(version: string): void;
	readonly engineVersions: string[];
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
 * TODO: Add actual implementation, for now it's just types.
 */
export class EngineVersionsManagerImpl
	extends TypedEmitter<EngineVersionsManagerEvents>
	implements EngineVersionsManager
{
	private logger: Env['logger'];
	private env: Env;
	public engineVersions: string[] = [];

	constructor(env: Env) {
		super();
		this.env = env;
		this.logger = env.logger.child({ class: 'EngineVersionsManager' });

		this.discoverVersions()
			.then((versions) => {
				this.engineVersions = versions;
				this.emit('versions', this.engineVersions);
			})
			.catch((err) => {
				this.logger.error(err, 'failed to discover engine versions');
				this.emit('error', err);
			});
	}

	private async discoverVersions(): Promise<string[]> {
		await fs.mkdir('engines', { recursive: true });
		const entries = await fs.readdir('engines', { withFileTypes: true });
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	}

	public installEngine(version: string) {
		this.logger.info({ version }, 'got request to install engine, not implemented');
	}
}
