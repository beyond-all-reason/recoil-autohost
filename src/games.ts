import { spawn } from 'child_process';
import * as fs from 'node:fs/promises';
import * as tdf from 'recoil-tdf';
import * as path from 'node:path';
import { StartRequest } from './types/startRequest.js';
import { scriptGameFromStartRequest } from './startScriptGen.js';

function serializeEngineSettings(obj: {[k: string]: string}): string {
	return Object.entries(obj).map(([key, val]) => `${key}=${val}\n`).join('');
}

export class GamesManager {
	async start(req: StartRequest): Promise<void> {
		const instanceDir = path.resolve('instances', req.gameUUID);
		await fs.mkdir(instanceDir, {recursive: true});

		const engineDir = path.resolve('engines', req.engineVersion);
		if (!await fs.stat(engineDir).catch(() => null)) {
			throw new Error(`engine version ${req.engineVersion} doesn't exist`);
		}

		const game = scriptGameFromStartRequest(req);
		game['IsHost'] = 1;
		game['HostIP'] = '0.0.0.0';
		game['HostPort'] = 8452;
		game['AutohostIP'] = '127.0.0.1';
		game['AutohostPort'] = 13245;
		const script = tdf.serialize({'GAME': game});

		const scriptPath = path.join(instanceDir, 'script.txt');
		await fs.writeFile(scriptPath, script);

		// TODO: load spring settings from somewhere
		const engineSettings = serializeEngineSettings({
			'NetworkTimeout': '1000',
			'InitialNetworkTimeout': '1000',
		});
		await fs.writeFile(path.join(instanceDir, 'springsettings.cfg'), engineSettings);

		const child = spawn(
			path.join(engineDir, 'spring-dedicated'),
			['-isolation', scriptPath],
			{
				cwd: instanceDir,
				stdio: 'ignore',
				env: {
					...process.env,
					'SPRING_WRITEDIR': instanceDir
				}
			});

		child.on('exit', (code, signal) => {
			console.log(`${req.gameUUID} finished with (${code}, ${signal})`);
		});

		child.on('error', (err) => {
			console.log(`Failed to spawn ${req.gameUUID}: ${err}`);
		});

		child.on('spawn', () => {
			console.log(`${req.gameUUID} spawned`);
		});
	}
}
