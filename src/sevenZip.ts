// SPDX-FileCopyrightText: 2026 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';
import type { Logger } from 'pino';

export class SevenZipExtractor {
	constructor(
		private logger: Logger,
		private spawnImpl: typeof spawn = spawn,
	) {}

	public async extract(
		archivePath: string,
		outputPath: string,
		timeoutMs: number,
	): Promise<void> {
		const sevenZipBin = process.env['SEVEN_ZIP_BIN'] ?? '7z';
		this.logger.info({ archivePath, outputPath }, 'extracting engine archive');

		await new Promise<void>((resolve, reject) => {
			const proc = this.spawnImpl(sevenZipBin, ['x', archivePath, '-y', `-o${outputPath}`], {
				stdio: ['ignore', 'ignore', 'pipe'],
			});

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
}
