/**
 * Engine runner module providing functionality to start and manage the engine.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import dgram from 'node:dgram';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as tdf from 'recoil-tdf';
import { TypedEmitter } from 'tiny-typed-emitter';
import { parsePacket, type Event, EventType } from './autohostInterface.js';
import { scriptGameFromStartRequest } from './startScriptGen.js';
import type { BattleStartRequest } from './types/battleStartRequest.js';

function serializeEngineSettings(obj: { [k: string]: string }): string {
	return Object.entries(obj)
		.map(([key, val]) => `${key}=${val}\n`)
		.join('');
}

/**
 * Events emitted by the engine runner
 */
interface Events {
	// Emitted when a packet is received from the engine.
	packet: (ev: Event) => void;

	// Emitted when an error occurs, the engine runner will close itself after.
	// This event is emitted only once, after the first error, any subsequent
	// errors are ignored.
	error: (err: Error) => void;

	// Emitted after the engine has started and the first SERVER_STARTED packet
	// has been received
	start: () => void;

	// Emitted when the engine has exited and the UDP server has been closed so
	// the autohost port is free to use again. This event is emitted always,
	// even if the starting was interrupted by an error.
	exit: () => void;
}

/**
 * Represents the state of the engine runner
 *
 * The possible transitions are:
 * - None -> Starting
 * - Starting -> Running | Stopping
 * - Running -> Stopping
 * - Stopping -> Stopped
 */
enum State {
	None,
	Starting,
	Running,
	Stopping,
	Stopped,
}

/**
 * Options for the engine runner
 */
interface Opts {
	startRequest: BattleStartRequest;
	autohostPort: number;
	hostIP: string;
	hostPort: number;
}

/**
 * Engine runner class responsible for lifecycle of the engine process and the
 * UDP server for autohost packets.
 *
 * Use the `runEngine` function to create an instance of this class.
 */
export class EngineRunner extends TypedEmitter<Events> {
	private udpServer: null | dgram.Socket = null;
	private engineAutohostPort: number = 0;
	private engineProcess: null | ChildProcess = null;
	private engineSpawned: boolean = false;
	private state: State = State.None;

	public constructor() {
		super();
	}

	/**
	 * Should be only called by `runEngine` function as part of initialization.
	 *
	 * @param opts Options for the engine runner, but with `spawnMock` option
	 *             that can be used for testing.
	 */
	public _run(opts: Opts & { spawnMock?: typeof spawn }) {
		if (this.state != State.None) {
			throw new Error('EngineRunner already started');
		}
		this.state = State.Starting;
		const run = async () => {
			const instanceDir = await EngineRunner.setupInstanceDir(opts);
			await this.startUdpServer(opts.autohostPort);
			await this.startEngine(instanceDir, opts.startRequest, opts.spawnMock ?? spawn);
			// The last part of startup is handled in the packed handler
		};
		run().catch((err) => this.handleError(err));
	}

	/**
	 * Send an autohost packet to the running engine process
	 *
	 * Promise rejects if the engine is not in running state.
	 *
	 * @param packet The buffer serialized with autohostInterface
	 *               serializeMessagePacket or serializeCommandPacket
	 */
	public async sendPacket(packet: Buffer): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this.state != State.Running) {
				throw new Error('Failed to send packet, engine not running');
			}
			this.udpServer!.send(packet, this.engineAutohostPort, '127.0.0.1', (err) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}

	/**
	 * Close the engine runner and stop the engine process and the UDP server.
	 *
	 * This function can be called any time, any number of times.
	 */
	public close(): void {
		if (this.state >= State.Stopping) return;
		this.state = State.Stopping;

		// TODO: handle instance dir somehow?

		this.killEngine();
		if (this.udpServer) {
			this.udpServer.close();
		}
		this.maybeEmitExit();
	}

	private killEngine(): void {
		if (this.engineProcess == null || !this.engineSpawned) return;

		// If the engine doesn't exit in 20 seconds after SIGTERM, we kill it
		// with SIGKILL. This is a bit aggressive but we don't want to wait
		// forever for the engine to exit, it should exit quickly.
		const engineSigKill = setTimeout(() => {
			console.error("Engine didn't exit after SIGTERM, trying with SIGKILL");
			this.engineProcess?.kill('SIGKILL');
		}, 20000);

		this.engineProcess.once('exit', () => {
			// We must clear the timeout because the pid might be reused
			// and the timeout would kill a different process.
			clearTimeout(engineSigKill);
		});

		if (!this.engineProcess.kill('SIGTERM')) {
			// This should never happen, if it does there isn't much we
			// can do here except unref and log it :(
			this.engineProcess.unref();
			console.error('Failed to SIGTERM engine process, it might linger');
		}
	}

	private maybeEmitExit(): void {
		// We can only emit exit when both the engine and the UDP server are
		// stopped because we need to ensure that autohost UDP port isn't used
		// for anything anymore and can be reused:
		//  - if the engine is stopped but the UDP server is still running, the
		//    autohost port is still in use and we can't start new server.
		//  - if the UDP server is stopped but the engine is still running, the
		//	  engine might still be sending packets to the autohost port.
		if (this.state == State.Stopping && this.engineProcess == null && this.udpServer == null) {
			this.state = State.Stopped;
			// Must be in next tick because we can get here directly from the close call
			// and not all listeners might be attached yet.
			process.nextTick(() => {
				this.emit('exit');
			});
		}
	}

	private handleError(err: Error): void {
		if (this.state >= State.Stopping) return;
		this.emit('error', err);
		this.close();
	}

	private async startUdpServer(autohostPort: number): Promise<void> {
		if (this.state != State.Starting) return;

		this.udpServer = dgram.createSocket('udp4');
		this.udpServer.bind(autohostPort, '127.0.0.1');
		this.udpServer.on('error', (err) => this.handleError(err));
		this.udpServer.on('message', (msg, rinfo) => this.handleAutohostPacket(msg, rinfo));
		this.udpServer.on('close', () => {
			this.udpServer = null;
			this.maybeEmitExit();
		});
	}

	private handleAutohostPacket(msg: Buffer, rinfo: dgram.RemoteInfo): void {
		try {
			const packet = parsePacket(msg);
			if (this.state == State.Starting) {
				if (packet.type != EventType.SERVER_STARTED) {
					// Maybe this is a bit brutal? We could try to ignore the packet
					// and wait for the next one, but maybe it's better to fail if the
					// packed successfully parsed as engine packet and let the autohost
					// try some other port.
					this.handleError(new Error('Expected SERVER_STARTED packet as first packet'));
					return;
				}
				this.engineAutohostPort = rinfo.port;
				this.state = State.Running;
				this.emit('start');
			}
			if (this.engineAutohostPort != rinfo.port) {
				console.log(`Received packet from ${rinfo.port}, blocked`);
				return;
			}
			this.emit('packet', packet);
		} catch (err) {
			// Don't crash the server on packet parsing errors, it might have been
			// a random packet from localhost or something.
			console.warn(`Failed to parse packet: ${err}`);
		}
	}

	private async startEngine(
		instanceDir: string,
		startRequest: BattleStartRequest,
		spawnFunc: typeof spawn,
	): Promise<void> {
		const engineDir = path.resolve('engines', startRequest.engineVersion);
		if (!(await fs.stat(engineDir).catch(() => null))) {
			throw new Error(`engine version ${startRequest.engineVersion} doesn't exist`);
		}

		if (this.state != State.Starting) return;

		this.engineProcess = spawnFunc(
			path.join(engineDir, 'spring-dedicated'),
			['-isolation', path.join(instanceDir, 'script.txt')],
			{
				cwd: instanceDir,
				stdio: 'ignore',
				env: {
					...process.env,
					'SPRING_WRITEDIR': instanceDir,
				},
			},
		);
		this.engineProcess.on('error', (err) => {
			if (!this.engineSpawned) {
				this.engineProcess = null;
				this.maybeEmitExit();
			}
			this.handleError(err);
		});
		this.engineProcess.on('spawn', () => {
			this.engineSpawned = true;
			if (this.state == State.Stopping) {
				this.killEngine();
			}
		});
		this.engineProcess.on('exit', (code, signal) => {
			this.engineProcess = null;
			if (code !== 0) {
				this.handleError(new Error(`Engine exited with code ${code}, signal ${signal}`));
			} else {
				this.close();
			}
			this.maybeEmitExit();
		});
	}

	/**
	 * Setup the game instance directory for the engine.
	 *
	 * The instance directory is the data write directory for the engine and
	 * contains start script, settings, it's also where the demo and other
	 * files are written.
	 */
	private static async setupInstanceDir(opts: Opts): Promise<string> {
		const game = scriptGameFromStartRequest(opts.startRequest);
		game['IsHost'] = 1;
		game['HostIP'] = opts.hostIP;
		game['HostPort'] = opts.hostPort;
		game['AutohostIP'] = '127.0.0.1';
		game['AutohostPort'] = opts.autohostPort;
		const script = tdf.serialize({ 'GAME': game });

		const instanceDir = path.resolve('instances', opts.startRequest.battleId);
		await fs.mkdir(instanceDir, { recursive: true });
		const scriptPath = path.join(instanceDir, 'script.txt');
		await fs.writeFile(scriptPath, script);

		// TODO: load spring settings from somewhere
		const engineSettings = serializeEngineSettings({
			'NetworkTimeout': '1000',
			'InitialNetworkTimeout': '1000',
		});
		await fs.writeFile(path.join(instanceDir, 'springsettings.cfg'), engineSettings);

		return instanceDir;
	}
}

/**
 * Run the engine with the given options
 *
 * @param opts Options for the engine runner
 * @returns The engine runner instance
 * @throws {never} `error` event is emitted from returned object if an error occurs
 */
export function runEngine(opts: Opts): EngineRunner {
	const runner = new EngineRunner();
	runner._run(opts);
	return runner;
}
