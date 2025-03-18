import { readFile } from 'node:fs/promises';
import { Ajv, JSONSchemaType } from 'ajv';
import ajvFormats from 'ajv-formats';

export interface Config {
	tachyonServer: string;
	tachyonServerPort: number | null;
	useSecureConnection: boolean | null;
	authClientId: string;
	authClientSecret: string;
	hostingIP: string;
	maxReconnectDelaySeconds: number;
	engineSettings: { [k: string]: string };
	maxBattles: number;
	maxUpdatesSubscriptionAgeSeconds: number;
	engineStartPort: number;
	engineAutohostStartPort: number;
	maxPortsUsed: number;
	engineInstallTimeoutSeconds: number;
}

const ConfigSchema = {
	$id: 'Config',
	type: 'object',
	properties: {
		tachyonServer: {
			type: 'string',
			description: 'Hostname of the tachyon server to connect to.',
		},
		tachyonServerPort: {
			type: ['number', 'null'],
			description:
				'Optional port of the tachyon server, by default standard HTTPS port will be used.',
		},
		useSecureConnection: {
			type: ['boolean', 'null'],
			description:
				'Whatever to use HTTPS/WSS to connect to tachyon server. Defaults to true, except for localhost.',
		},
		authClientId: {
			type: 'string',
			description: 'OAuth2 client id for authentication.',
		},
		authClientSecret: {
			type: 'string',
			description: 'OAuth2 client secret for authentication',
		},
		hostingIP: {
			type: 'string',
			description: 'The IP used by engine to hosting the battle.',
			format: 'ipv4',
		},
		maxReconnectDelaySeconds: {
			type: 'number',
			description: 'Maximum delay for reconnects to tachyon server.',
			default: 30,
			minimum: 1,
		},
		engineSettings: {
			type: 'object',
			description: 'Engine settings to be serialized into springsettings.cfg',
			additionalProperties: { type: 'string' },
			default: {},
			required: [],
		},
		maxBattles: {
			type: 'integer',
			description: 'Maximum number of battler that can be hosted.',
			default: 50,
			minimum: 1,
		},
		maxUpdatesSubscriptionAgeSeconds: {
			type: 'number',
			description:
				'For how long autohost will keep engine updates. This determines the max time used in subscribeUpdates.',
			default: 10 * 60,
		},
		engineStartPort: {
			type: 'integer',
			description: 'Start of the port range used by engine instances.',
			default: 20000,
			minimum: 1025,
			maximum: 65535,
		},
		engineAutohostStartPort: {
			type: 'integer',
			description:
				'Start of the port range used by engine for autohost interface on localhost.',
			default: 22000,
			minimum: 1025,
			maximum: 65535,
		},
		maxPortsUsed: {
			type: 'integer',
			description:
				'Maximum number of ports that can be used by the service, this +StartPorts define the port range.',
			default: 1000,
			minimum: 1,
		},
		engineInstallTimeoutSeconds: {
			type: 'integer',
			description: 'Hard timeout for engine installation by engine manager',
			default: 10 * 60,
			minimum: 5,
		},
	},
	required: ['tachyonServer', 'authClientId', 'authClientSecret', 'hostingIP'],
	additionalProperties: true,
} as const;

const ajv = new Ajv({ strict: true, useDefaults: true });
(ajvFormats as any)(ajv);
const validateConfig = ajv.compile(ConfigSchema);

export async function loadConfig(path?: string): Promise<Config> {
	const isContainer = process.env.CONTAINERENV === 'true';
	
	if (isContainer) {
		// Container mode - only use environment variables
		const config: Config = {
			tachyonServer: process.env.TACHYON_SERVER!,
			tachyonServerPort: process.env.TACHYON_SERVER_PORT ? parseInt(process.env.TACHYON_SERVER_PORT, 10) : null,
			useSecureConnection: process.env.USE_SECURE_CONNECTION ? process.env.USE_SECURE_CONNECTION === 'true' : null,
			authClientId: process.env.AUTH_CLIENT_ID!,
			authClientSecret: process.env.AUTH_CLIENT_SECRET!,
			hostingIP: process.env.HOSTING_IP!,
			maxReconnectDelaySeconds: process.env.MAX_RECONNECT_DELAY_SECONDS ? 
				parseInt(process.env.MAX_RECONNECT_DELAY_SECONDS, 10) : 30,
			engineSettings: process.env.ENGINE_SETTINGS ? 
				JSON.parse(process.env.ENGINE_SETTINGS) : {},
			maxBattles: process.env.MAX_BATTLES ? 
				parseInt(process.env.MAX_BATTLES, 10) : 50,
			maxUpdatesSubscriptionAgeSeconds: process.env.MAX_UPDATES_SUBSCRIPTION_AGE_SECONDS ? 
				parseInt(process.env.MAX_UPDATES_SUBSCRIPTION_AGE_SECONDS, 10) : 600,
			engineStartPort: process.env.ENGINE_START_PORT ? 
				parseInt(process.env.ENGINE_START_PORT, 10) : 20000,
			engineAutohostStartPort: process.env.ENGINE_AUTOHOST_START_PORT ? 
				parseInt(process.env.ENGINE_AUTOHOST_START_PORT, 10) : 22000,
			maxPortsUsed: process.env.MAX_PORTS_USED ? 
				parseInt(process.env.MAX_PORTS_USED, 10) : 1000,
			engineInstallTimeoutSeconds: process.env.ENGINE_INSTALL_TIMEOUT_SECONDS ? 
				parseInt(process.env.ENGINE_INSTALL_TIMEOUT_SECONDS, 10) : 600
		};

		if (!validateConfig(config)) {
			throw new Error('Invalid environment configuration: ' + ajv.errorsText(validateConfig.errors));
		}
		
		return config;
	} else {
		// Traditional mode - use config file
		if (!path) {
			throw new Error('Config file path required when not in container mode');
		}

		try {
			const fileConfig = JSON.parse(await readFile(path, 'utf-8')) as Config;
			if (!validateConfig(fileConfig)) {
				throw new Error('Invalid file configuration: ' + ajv.errorsText(validateConfig.errors));
			}
			return fileConfig;
		} catch (err: any) {
			throw new Error(`Failed to load config file: ${err.message}`);
		}
	}
}
