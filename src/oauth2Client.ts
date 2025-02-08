/**
 * A very simple OAuth2 client that can fetch access tokens using the client credentials grant.
 *
 * This client is designed to be used in a server-to-server context where the client is a server
 * application that needs to authenticate with another server application using OAuth2.
 */
import { Ajv, JSONSchemaType } from 'ajv';

// Let's define different OAuth2 schemas so we can use automatic and strict validation of the
// OAuth2 metadata, errors and access tokens, instead of using conditions. The schemas are very
// small and simple, so it's not a big deal to just define them inline here. With the help of
// JSONSchemaType, the interface and schema statically checked to match.

interface OAuth2Metadata {
	issuer: string;
	token_endpoint: string | null;
	response_types_supported: string[];
}

const OAuth2MetadataSchema: JSONSchemaType<OAuth2Metadata> = {
	$id: 'OAuth2Metadata',
	type: 'object',
	properties: {
		issuer: { type: 'string' },
		token_endpoint: { type: 'string' },
		response_types_supported: { type: 'array', items: { type: 'string' } },
	},
	required: ['issuer', 'response_types_supported'],
	additionalProperties: true,
};

interface OAuth2Error {
	error: string;
	error_description: string | null;
	error_uri: string | null;
	state: string | null;
}

const OAuth2ErrorSchema: JSONSchemaType<OAuth2Error> = {
	$id: 'OAuth2Error',
	type: 'object',
	properties: {
		error: { type: 'string' },
		error_description: { type: 'string' },
		error_uri: { type: 'string' },
		state: { type: 'string' },
	},
	required: ['error'],
	additionalProperties: true,
};

interface OAuth2AccessToken {
	access_token: string;
	token_type: string;
	expires_in: number | null;
	scope: string | null;
}

const OAuth2AccessTokenSchema: JSONSchemaType<OAuth2AccessToken> = {
	$id: 'OAuthAccessToken',
	type: 'object',
	properties: {
		access_token: { type: 'string' },
		token_type: { type: 'string' },
		expires_in: { type: 'number' },
		scope: { type: 'string' },
	},
	required: ['access_token', 'token_type'],
};

const ajv = new Ajv({ strict: true });
const validateOAuth2Metadata = ajv.compile(OAuth2MetadataSchema);
const validateOAuth2Error = ajv.compile(OAuth2ErrorSchema);
const validateOAuth2AccessToken = ajv.compile(OAuth2AccessTokenSchema);

/**
 * Fetches a new OAuth2 access token from the OAuth2 server. The only grant type supported
 * is `client_credentials` and the only token type supported is `Bearer`.
 *
 * @param baseUrl The base url of the OAuth2 server, e.g. `https://example.com:8132`
 * @param clientId The client id to use for authentication
 * @param clientSecret The client secret to use for authentication
 * @param scope The scope to request, or none to use the default scope
 * @returns The Bearer access token to use for further requests
 */
export async function getAccessToken(
	baseUrl: string,
	clientId: string,
	clientSecret: string,
	scope?: string,
): Promise<string> {
	// Fetch the metadata to find the token endpoint.
	//
	// TODO: Add caching of the metadata according to caching parameters from server
	// so we don't fetch it every single time.
	const oauth2metaResp = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
	if (!oauth2metaResp.ok) {
		throw new Error(`Failed to fetch OAuth2 metadata (${oauth2metaResp.status})`);
	}
	const oauth2meta = await oauth2metaResp.json();
	if (!validateOAuth2Metadata(oauth2meta)) {
		const errs = ajv.errorsText(validateOAuth2Metadata.errors);
		throw new Error(`Invalid OAuth2 Authorization Server Metadata object: ${errs}`);
	}
	if (!oauth2meta.response_types_supported.includes('token') || !oauth2meta.token_endpoint) {
		throw new Error('OAuth2 server does not support token endpoint');
	}

	// Now let's try to get a new access token
	const basicToken = Buffer.from(
		`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
	).toString('base64');
	const tokenParams = new URLSearchParams({
		grant_type: 'client_credentials',
	});
	if (scope) {
		tokenParams.append('scope', scope);
	}
	const tokenResp = await fetch(oauth2meta.token_endpoint, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			'authorization': `Basic ${basicToken}`,
		},
		body: tokenParams,
	});
	if (!tokenResp.ok) {
		let tokenRespBody: unknown;
		try {
			tokenRespBody = await tokenResp.json();
		} catch {
			throw new Error(`Failed to fetch OAuth2 token (${tokenResp.status})`);
		}
		if (validateOAuth2Error(tokenRespBody)) {
			let msg = `Failed to fetch OAuth2 token (${tokenResp.status}): ${tokenRespBody.error}`;
			if (tokenRespBody.error_description) {
				msg += `: ${tokenRespBody.error_description}`;
			}
			throw new Error(msg);
		}
	}

	let tokenRespBody: unknown;
	try {
		tokenRespBody = await tokenResp.json();
	} catch {
		throw new Error(`Failed to parse OAuth2 token response body as json`);
	}
	if (!validateOAuth2AccessToken(tokenRespBody)) {
		const errs = ajv.errorsText(validateOAuth2AccessToken.errors);
		throw new Error(`Invalid OAuth2 Access Token object: ${errs}`);
	}
	if (tokenRespBody.token_type !== 'Bearer') {
		throw new Error(
			`Unsupported OAuth2 Access Token type: ${tokenRespBody.token_type}, expected Bearer`,
		);
	}

	// TODO: Add caching of the access token so we don't fetch a fresh one every single time.

	return tokenRespBody.access_token;
}
