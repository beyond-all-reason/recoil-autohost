/**
 * Module with functionality responsible for managing installed engine versions.
 */
import { spawn } from 'node:child_process';
import { TypedEmitter } from 'tiny-typed-emitter';
import { Environment } from './environment.js';

export interface EngineVersionsManagerEvents {
	versions: (versions: string[]) => void;
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
	}

	public installEngine(version: string) {
		this.logger.info({ version }, 'got request to install engine, not implemented');
	}
}
