import * as Errors from '../error';
import type { ApiKeySetter } from '../client';
import type { BodyInit } from '../internal/builtin-types';
import type { FinalizedRequestInit } from '../internal/types';
import { createProvider, type Provider, type ProviderRequestContext } from '../internal/provider';
import { readEnv } from '../internal/utils';

const BEDROCK_SERVICE = 'bedrock-mantle';
const BEDROCK_AWS_DEPENDENCIES =
  'npm install @aws-sdk/credential-provider-node @smithy/hash-node @smithy/signature-v4';

export interface AwsCredentialIdentity {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

export type AwsCredentialsProvider = () => AwsCredentialIdentity | Promise<AwsCredentialIdentity>;

export interface BedrockProviderOptions {
  /** AWS region used for SigV4 and to derive the default Mantle endpoint. */
  region?: string | undefined;

  /** Bedrock API root. Defaults to AWS_BEDROCK_BASE_URL or the regional Mantle endpoint. */
  baseURL?: string | null | undefined;

  /** Explicit Bedrock bearer credential. Set to null to skip the environment bearer fallback. */
  apiKey?: string | null | undefined;

  /** A function that resolves a Bedrock bearer credential before every request attempt. */
  tokenProvider?: ApiKeySetter | undefined;

  /** Explicit AWS access key ID. Must be paired with secretAccessKey. */
  accessKeyId?: string | undefined;

  /** Explicit AWS secret access key. Must be paired with accessKeyId. */
  secretAccessKey?: string | undefined;

  /** Optional session token for explicit temporary AWS credentials. */
  sessionToken?: string | undefined;

  /** Explicit AWS shared-config profile. */
  profile?: string | undefined;

  /** A refreshable provider returning AWS credentials. */
  credentialProvider?: AwsCredentialsProvider | undefined;
}

type SmithyRequest = {
  protocol: string;
  hostname: string;
  port?: number;
  method: string;
  path: string;
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
  body?: string | ArrayBuffer | ArrayBufferView;
};

type SignatureV4 = {
  sign(
    request: SmithyRequest,
    options?: { signingDate?: Date },
  ): Promise<{ headers: Record<string, string> }>;
};

type SignatureV4Constructor = new (options: {
  credentials: AwsCredentialIdentity | (() => Promise<AwsCredentialIdentity>);
  region: string;
  service: string;
  sha256: new (...args: any[]) => unknown;
}) => SignatureV4;

type SigningDependencies = {
  Hash: new (...args: any[]) => unknown;
  SignatureV4: SignatureV4Constructor;
};

type DefaultProvider = (options?: { profile?: string }) => () => Promise<AwsCredentialIdentity>;

let signingDependencies: Promise<SigningDependencies> | undefined;
let defaultProviderDependency: Promise<DefaultProvider> | undefined;

/**
 * Keep optional AWS imports lazy and opaque to browser bundlers. TypeScript emits
 * these as module-relative requires for CommonJS and preserves native dynamic
 * imports for ESM, so resolution does not depend on the process working directory.
 */
async function importOptionalDependency(specifier: string): Promise<Record<string, any>> {
  return import(/* webpackIgnore: true */ specifier);
}

function loadSigningDependencies(): Promise<SigningDependencies> {
  return (signingDependencies ??= Promise.all([
    importOptionalDependency('@smithy/hash-node'),
    importOptionalDependency('@smithy/signature-v4'),
  ]).then(([hashNode, signatureV4]) => ({
    Hash: hashNode['Hash'],
    SignatureV4: signatureV4['SignatureV4'],
  })));
}

function loadDefaultProvider(): Promise<DefaultProvider> {
  return (defaultProviderDependency ??= importOptionalDependency('@aws-sdk/credential-provider-node').then(
    (credentialProvider) => credentialProvider['defaultProvider'] as DefaultProvider,
  ));
}

function errorWithCause(message: string, cause: unknown): Errors.OpenAIError {
  const error = new Errors.OpenAIError(message) as Errors.OpenAIError & { cause?: unknown };
  error.cause = cause;
  return error;
}

function isNodeLikeRuntime(): boolean {
  return Object.prototype.toString.call((globalThis as any).process) === '[object process]';
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : undefined;
  return normalized ? normalized : undefined;
}

function normalizeBaseURL(baseURL: string): string {
  const url = new URL(baseURL);
  const responsesMatch = url.pathname.match(/\/responses(?:\/.*)?$/);
  if (responsesMatch?.index !== undefined) {
    url.pathname = url.pathname.slice(0, responsesMatch.index) || '/';
  }
  return url.toString().replace(/\/$/, '');
}

function resolveRegion(region: string | undefined): string | undefined {
  return (
    normalizeOptionalString(region) ??
    normalizeOptionalString(readEnv('AWS_REGION')) ??
    normalizeOptionalString(readEnv('AWS_DEFAULT_REGION'))
  );
}

function resolveBaseURL(baseURL: string | null | undefined, region: string | undefined): string {
  const configured =
    baseURL === undefined ? normalizeOptionalString(readEnv('AWS_BEDROCK_BASE_URL'))
    : baseURL === null ? undefined
    : normalizeOptionalString(baseURL);
  if (configured) return normalizeBaseURL(configured);
  if (!region) {
    throw new Errors.OpenAIError(
      'Bedrock requires an AWS region. Pass `region` to `bedrock(...)`, or set `AWS_REGION` or `AWS_DEFAULT_REGION`.',
    );
  }
  return `https://bedrock-mantle.${region}.api.aws/v1`;
}

function validateStaticCredentials(options: BedrockProviderOptions): AwsCredentialIdentity | undefined {
  const hasAccessKey = options.accessKeyId !== undefined;
  const hasSecretKey = options.secretAccessKey !== undefined;
  if (hasAccessKey !== hasSecretKey || (options.sessionToken !== undefined && !hasAccessKey)) {
    throw new Errors.OpenAIError(
      'The `accessKeyId` and `secretAccessKey` options must be provided together. A `sessionToken` may only be used with both.',
    );
  }
  if (!hasAccessKey) return undefined;

  if (
    typeof options.accessKeyId !== 'string' ||
    !options.accessKeyId.trim() ||
    typeof options.secretAccessKey !== 'string' ||
    !options.secretAccessKey.trim()
  ) {
    throw new Errors.OpenAIError(
      'Static AWS credentials require non-empty `accessKeyId` and `secretAccessKey` values.',
    );
  }
  if (
    options.sessionToken !== undefined &&
    (typeof options.sessionToken !== 'string' || !options.sessionToken.trim())
  ) {
    throw new Errors.OpenAIError('A static AWS `sessionToken` must not be empty when provided.');
  }

  return {
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    ...(options.sessionToken ? { sessionToken: options.sessionToken } : {}),
  };
}

function validateOptions(options: BedrockProviderOptions): {
  staticCredentials: AwsCredentialIdentity | undefined;
  explicitAwsAuth: boolean;
  explicitBearerAuth: boolean;
} {
  if (options.region !== undefined && !normalizeOptionalString(options.region)) {
    throw new Errors.OpenAIError('The Bedrock AWS `region` must not be empty.');
  }
  if (
    options.baseURL !== undefined &&
    options.baseURL !== null &&
    !normalizeOptionalString(options.baseURL)
  ) {
    throw new Errors.OpenAIError('The Bedrock `baseURL` must not be empty.');
  }

  const staticCredentials = validateStaticCredentials(options);
  const profile = normalizeOptionalString(options.profile);
  if (options.profile !== undefined && !profile) {
    throw new Errors.OpenAIError('The Bedrock AWS `profile` must not be empty.');
  }
  if (
    options.apiKey !== undefined &&
    options.apiKey !== null &&
    (typeof options.apiKey !== 'string' || !options.apiKey.trim())
  ) {
    throw new Errors.OpenAIError('The Bedrock bearer credential must not be empty.');
  }

  const explicitBearerAuth =
    (options.apiKey !== undefined && options.apiKey !== null) || !!options.tokenProvider;
  const awsModes = [!!staticCredentials, !!profile, !!options.credentialProvider].filter(Boolean).length;
  if (awsModes > 1) {
    throw new Errors.OpenAIError(
      'Bedrock authentication is ambiguous. Configure exactly one explicit AWS mode: static credentials, profile, or credential provider.',
    );
  }
  const explicitAwsAuth = awsModes === 1;
  if (explicitBearerAuth && explicitAwsAuth) {
    throw new Errors.OpenAIError(
      'Bearer and AWS credential authentication are mutually exclusive. Configure exactly one explicit mode: bearer credential, static AWS credentials, profile, or credential provider.',
    );
  }
  if (options.apiKey && options.tokenProvider) {
    throw new Errors.OpenAIError(
      'The `apiKey` and `tokenProvider` options are mutually exclusive. Configure only one.',
    );
  }

  return { staticCredentials, explicitAwsAuth, explicitBearerAuth };
}

function requestTarget(parsedURL: URL): { path: string; query: Record<string, string | string[]> } {
  const query: Record<string, string | string[]> = {};
  for (const [name, value] of parsedURL.searchParams) {
    const existing = query[name];
    query[name] =
      existing === undefined ? value
      : typeof existing === 'string' ? [existing, value]
      : [...existing, value];
  }
  return { path: parsedURL.pathname, query };
}

function signableBody(body: BodyInit | null | undefined): string | ArrayBuffer | ArrayBufferView | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string' || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body;
  throw new Errors.OpenAIError(
    "The SDK's Bedrock SigV4 mode requires a replayable request body. Buffer the body before sending or use bearer authentication.",
  );
}

function assertProviderOwnsAuthorization(headers: Headers): void {
  if (headers.has('authorization')) {
    throw new Errors.OpenAIError(
      'Bedrock provider authentication cannot be combined with a custom `Authorization` header.',
    );
  }
}

function validateCredentialIdentity(identity: AwsCredentialIdentity): AwsCredentialIdentity {
  if (
    typeof identity?.accessKeyId !== 'string' ||
    !identity.accessKeyId.trim() ||
    typeof identity.secretAccessKey !== 'string' ||
    !identity.secretAccessKey.trim() ||
    (identity.sessionToken !== undefined &&
      (typeof identity.sessionToken !== 'string' || !identity.sessionToken.trim()))
  ) {
    throw new Errors.OpenAIError(
      'Failed to resolve AWS credentials for Bedrock. Verify your AWS profile, environment variables, or runtime identity configuration and try again.',
    );
  }
  return identity;
}

class BedrockBearerAuth {
  constructor(private readonly tokenProvider: ApiKeySetter) {}

  async prepareRequest(request: FinalizedRequestInit): Promise<void> {
    const headers = new Headers(request.headers);
    assertProviderOwnsAuthorization(headers);

    let token: unknown;
    try {
      token = await this.tokenProvider();
    } catch (cause) {
      throw errorWithCause('Failed to resolve a bearer credential for Bedrock.', cause);
    }
    if (typeof token !== 'string' || !token.trim()) {
      throw new Errors.OpenAIError('The Bedrock bearer credential provider must return a non-empty string.');
    }
    headers.set('authorization', `Bearer ${token}`);
    request.headers = headers;
  }
}

class BedrockSigV4Auth {
  private signer: SignatureV4 | undefined;
  private resolvedCredentialsProvider: (() => Promise<AwsCredentialIdentity>) | undefined;

  constructor(
    private readonly options: {
      region: string;
      staticCredentials?: AwsCredentialIdentity | undefined;
      profile?: string | undefined;
      credentialProvider?: AwsCredentialsProvider | undefined;
      usesDefaultChain: boolean;
    },
  ) {}

  private async credentialsProvider(): Promise<() => Promise<AwsCredentialIdentity>> {
    if (this.resolvedCredentialsProvider) return this.resolvedCredentialsProvider;

    if (this.options.staticCredentials) {
      const credentials = this.options.staticCredentials;
      return (this.resolvedCredentialsProvider = async () => credentials);
    }
    if (this.options.credentialProvider) {
      const provider = this.options.credentialProvider;
      return (this.resolvedCredentialsProvider = async () => validateCredentialIdentity(await provider()));
    }

    let defaultProvider: DefaultProvider;
    try {
      defaultProvider = await loadDefaultProvider();
    } catch (cause) {
      throw errorWithCause(
        `Bedrock AWS authentication requires optional AWS dependencies. Run \`${BEDROCK_AWS_DEPENDENCIES}\` and try again.`,
        cause,
      );
    }
    const provider = defaultProvider(this.options.profile ? { profile: this.options.profile } : {});
    return (this.resolvedCredentialsProvider = async () => validateCredentialIdentity(await provider()));
  }

  private async signatureV4(): Promise<SignatureV4> {
    if (this.signer) return this.signer;

    let dependencies: SigningDependencies;
    try {
      dependencies = await loadSigningDependencies();
    } catch (cause) {
      throw errorWithCause(
        `Bedrock AWS authentication requires optional AWS dependencies. Run \`${BEDROCK_AWS_DEPENDENCIES}\` and try again.`,
        cause,
      );
    }
    const credentials = await this.credentialsProvider();
    return (this.signer = new dependencies.SignatureV4({
      credentials,
      region: this.options.region,
      service: BEDROCK_SERVICE,
      sha256: dependencies.Hash.bind(null, 'sha256'),
    }));
  }

  async prepareRequest(request: FinalizedRequestInit, { url }: ProviderRequestContext): Promise<void> {
    if (!isNodeLikeRuntime()) {
      throw new Errors.OpenAIError(
        'Bedrock AWS credential authentication is only supported in Node.js and compatible server runtimes. Use bearer authentication in this runtime.',
      );
    }

    const parsedURL = new URL(url);
    const canonicalRegion = /^bedrock-mantle\.([a-z0-9-]+)\.api\.aws$/i.exec(parsedURL.hostname)?.[1];
    if (canonicalRegion && canonicalRegion !== this.options.region) {
      throw new Errors.OpenAIError(
        `The Bedrock endpoint region \`${canonicalRegion}\` does not match the SigV4 region \`${this.options.region}\`.`,
      );
    }

    const headers = new Headers(request.headers);
    assertProviderOwnsAuthorization(headers);
    headers.delete('x-amz-date');
    headers.delete('x-amz-security-token');
    headers.delete('x-amz-content-sha256');
    headers.set('host', parsedURL.host);

    const method = (request.method ?? 'GET').toUpperCase();
    const body = signableBody(request.body);
    const signer = await this.signatureV4();

    let signed: { headers: Record<string, string> };
    try {
      signed = await signer.sign(
        {
          protocol: parsedURL.protocol,
          hostname: parsedURL.hostname,
          ...(parsedURL.port ? { port: Number(parsedURL.port) } : {}),
          method,
          ...requestTarget(parsedURL),
          headers: Object.fromEntries(headers.entries()),
          ...(body !== undefined ? { body } : {}),
        },
        { signingDate: new Date() },
      );
    } catch (cause) {
      const message =
        this.options.usesDefaultChain ?
          'Could not find credentials for Bedrock. Pass a bearer credential or AWS credentials to `bedrock(...)`, set `AWS_BEARER_TOKEN_BEDROCK`, or configure the default AWS credential chain.'
        : 'Failed to resolve AWS credentials for Bedrock. Verify your AWS profile, environment variables, or runtime identity configuration and try again.';
      throw errorWithCause(message, cause);
    }

    request.method = method;
    request.redirect = 'manual';
    request.headers = new Headers(signed.headers);
  }
}

/** Configure the standard OpenAI client for Amazon Bedrock Mantle. */
export function bedrock(options: BedrockProviderOptions = {}): Provider {
  const { staticCredentials, explicitAwsAuth, explicitBearerAuth } = validateOptions(options);
  const region = resolveRegion(options.region);
  const baseURL = resolveBaseURL(options.baseURL, region);
  const explicitAPIKey = options.apiKey;
  const explicitTokenProvider = options.tokenProvider;
  const profile = normalizeOptionalString(options.profile);
  const credentialProvider = options.credentialProvider;
  const environmentBearerAuth =
    !explicitBearerAuth &&
    !explicitAwsAuth &&
    options.apiKey !== null &&
    !!readEnv('AWS_BEARER_TOKEN_BEDROCK');

  return createProvider({
    configure() {
      let auth: BedrockBearerAuth | BedrockSigV4Auth;
      if (explicitBearerAuth) {
        const tokenProvider =
          explicitTokenProvider ??
          (async () => {
            if (!explicitAPIKey)
              throw new Errors.OpenAIError('The Bedrock bearer credential must not be empty.');
            return explicitAPIKey;
          });
        auth = new BedrockBearerAuth(tokenProvider);
      } else if (environmentBearerAuth) {
        auth = new BedrockBearerAuth(async () => {
          const token = readEnv('AWS_BEARER_TOKEN_BEDROCK');
          if (!token) {
            throw new Errors.OpenAIError(
              'Could not find credentials for Bedrock. Set `AWS_BEARER_TOKEN_BEDROCK` or configure the default AWS credential chain.',
            );
          }
          return token;
        });
      } else {
        if (!region) {
          throw new Errors.OpenAIError(
            'Bedrock requires an AWS region. Pass `region` to `bedrock(...)`, or set `AWS_REGION` or `AWS_DEFAULT_REGION`.',
          );
        }
        auth = new BedrockSigV4Auth({
          region,
          staticCredentials,
          profile,
          credentialProvider,
          usesDefaultChain: !explicitAwsAuth,
        });
      }

      return {
        name: 'bedrock',
        baseURL,
        prepareRequest: auth.prepareRequest.bind(auth),
      };
    },
  });
}
