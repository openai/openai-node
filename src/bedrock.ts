import * as Errors from './error';
import { OpenAI } from './client';
import type { ApiKeySetter, ClientOptions } from './client';
import type { NullableHeaders } from './internal/headers';
import { buildHeaders } from './internal/headers';
import type { FinalRequestOptions, RequestOptions } from './internal/request-options';
import { readEnv } from './internal/utils';
import { addOutputText } from './lib/ResponsesParser';
import type { ResponseStreamParams } from './lib/responses/ResponseStream';
import * as API from './resources/index';
import type * as ResponsesAPI from './resources/responses/responses';

export interface AwsCredentialIdentity {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

export type AwsCredentialsProvider = () => AwsCredentialIdentity | Promise<AwsCredentialIdentity>;
type AsyncAwsCredentialsProvider = () => Promise<AwsCredentialIdentity>;

type BedrockBearerDependencies = {
  authSchemePreference: typeof import('@aws-sdk/core/httpAuthSchemes').NODE_AUTH_SCHEME_PREFERENCE_OPTIONS;
  fromEnvSigningName: typeof import('@aws-sdk/token-providers').fromEnvSigningName;
  HttpBearerAuthSigner: typeof import('@smithy/core').HttpBearerAuthSigner;
  HttpRequest: typeof import('@smithy/protocol-http').HttpRequest;
};

type BedrockSigV4Dependencies = {
  defaultProvider: typeof import('@aws-sdk/credential-provider-node').defaultProvider;
  Hash: typeof import('@smithy/hash-node').Hash;
  HttpRequest: typeof import('@smithy/protocol-http').HttpRequest;
  SignatureV4: typeof import('@smithy/signature-v4').SignatureV4;
};

let bedrockBearerDependencies: Promise<BedrockBearerDependencies | undefined> | undefined;
let bedrockSigV4Dependencies: Promise<BedrockSigV4Dependencies> | undefined;

function loadBedrockBearerDependencies(): Promise<BedrockBearerDependencies | undefined> {
  return (bedrockBearerDependencies ??= Promise.all([
    import('@aws-sdk/core/httpAuthSchemes'),
    import('@aws-sdk/token-providers'),
    import('@smithy/core'),
    import('@smithy/protocol-http'),
  ])
    .then(([awsCore, tokenProviders, smithyCore, protocolHttp]) => ({
      authSchemePreference: awsCore.NODE_AUTH_SCHEME_PREFERENCE_OPTIONS,
      fromEnvSigningName: tokenProviders.fromEnvSigningName,
      HttpBearerAuthSigner: smithyCore.HttpBearerAuthSigner,
      HttpRequest: protocolHttp.HttpRequest,
    }))
    .catch(() => undefined));
}

function loadBedrockSigV4Dependencies(): Promise<BedrockSigV4Dependencies> {
  return (bedrockSigV4Dependencies ??= Promise.all([
    import('@aws-sdk/credential-provider-node'),
    import('@smithy/hash-node'),
    import('@smithy/protocol-http'),
    import('@smithy/signature-v4'),
  ]).then(([credentialProvider, hashNode, protocolHttp, signatureV4]) => ({
    defaultProvider: credentialProvider.defaultProvider,
    Hash: hashNode.Hash,
    HttpRequest: protocolHttp.HttpRequest,
    SignatureV4: signatureV4.SignatureV4,
  })));
}

function bedrockAwsRequestTarget(parsedURL: URL): {
  path: string;
  query: Record<string, string | string[]>;
} {
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

class BedrockAwsBearerAuth {
  constructor(private readonly fromEnvironment: boolean) {}

  async sign(url: string, request: RequestInit, token: string | null): Promise<void> {
    const dependencies = await loadBedrockBearerDependencies();
    if (!dependencies) return;

    let identity = token ? { token } : undefined;
    if (this.fromEnvironment) {
      dependencies.authSchemePreference.environmentVariableSelector(process.env, {
        signingName: 'bedrock',
      });
      identity = await dependencies.fromEnvSigningName({ signingName: 'bedrock' })();
    }
    if (!identity) return;

    const parsedURL = new URL(url);
    const target = bedrockAwsRequestTarget(parsedURL);
    const headers = Object.fromEntries(new Headers(request.headers).entries());
    delete headers['authorization'];
    const signed = await new dependencies.HttpBearerAuthSigner().sign(
      new dependencies.HttpRequest({
        protocol: parsedURL.protocol,
        hostname: parsedURL.hostname,
        ...(parsedURL.port ? { port: Number(parsedURL.port) } : {}),
        method: (request.method ?? 'GET').toUpperCase(),
        ...target,
        headers,
        ...(request.body !== undefined && request.body !== null ? { body: request.body } : {}),
      }),
      identity,
      {},
    );
    request.headers = new Headers(signed.headers);
  }
}

class BedrockAwsAuth {
  private readonly region: string;
  private readonly profile: string | undefined;
  private readonly credentials: AwsCredentialIdentity | AwsCredentialsProvider | undefined;
  private defaultCredentialsProvider: AsyncAwsCredentialsProvider | undefined;
  private signer: InstanceType<BedrockSigV4Dependencies['SignatureV4']> | undefined;

  constructor({
    region,
    profile,
    credentials,
  }: {
    region: string;
    profile?: string | undefined;
    credentials?: AwsCredentialIdentity | AwsCredentialsProvider | undefined;
  }) {
    this.region = region;
    this.profile = profile;
    this.credentials = credentials;
  }

  async sign(url: string, request: RequestInit): Promise<void> {
    let dependencies: BedrockSigV4Dependencies;
    try {
      dependencies = await loadBedrockSigV4Dependencies();
    } catch (error) {
      throw new Errors.OpenAIError(
        `AWS credential authentication requires the optional AWS SDK dependencies. Install the Bedrock peer dependencies listed by the openai package. ${String(
          error,
        )}`,
      );
    }

    const configuredCredentials = this.credentials;
    const credentials =
      typeof configuredCredentials === 'function' ?
        async () => configuredCredentials()
      : configuredCredentials ??
        (this.defaultCredentialsProvider ??= dependencies.defaultProvider(
          this.profile ? { profile: this.profile } : {},
        ));
    const signer = (this.signer ??= new dependencies.SignatureV4({
      credentials,
      region: this.region,
      service: 'bedrock-mantle',
      sha256: dependencies.Hash.bind(null, 'sha256'),
    }));
    const parsedURL = new URL(url);
    const target = bedrockAwsRequestTarget(parsedURL);
    const headers = Object.fromEntries(new Headers(request.headers).entries());
    delete headers['authorization'];
    headers['host'] = parsedURL.host;
    const signed = await signer.sign(
      new dependencies.HttpRequest({
        protocol: parsedURL.protocol,
        hostname: parsedURL.hostname,
        ...(parsedURL.port ? { port: Number(parsedURL.port) } : {}),
        method: (request.method ?? 'GET').toUpperCase(),
        ...target,
        headers,
        ...(request.body !== undefined && request.body !== null ? { body: request.body } : {}),
      }),
    );
    request.headers = new Headers(signed.headers);
  }
}

function hasExplicitAwsAuth(options: {
  awsProfile?: string | undefined;
  awsAccessKeyId?: string | undefined;
  awsSecretAccessKey?: string | undefined;
  awsSessionToken?: string | undefined;
  awsCredentialsProvider?: AwsCredentialsProvider | undefined;
}): boolean {
  return [
    options.awsProfile,
    options.awsAccessKeyId,
    options.awsSecretAccessKey,
    options.awsSessionToken,
    options.awsCredentialsProvider,
  ].some((value) => value !== undefined);
}

function validateExplicitAwsAuth(options: {
  awsProfile?: string | undefined;
  awsAccessKeyId?: string | undefined;
  awsSecretAccessKey?: string | undefined;
  awsSessionToken?: string | undefined;
  awsCredentialsProvider?: AwsCredentialsProvider | undefined;
}): void {
  if ((options.awsAccessKeyId === undefined) !== (options.awsSecretAccessKey === undefined)) {
    throw new Errors.OpenAIError(
      'The `awsAccessKeyId` and `awsSecretAccessKey` arguments must be provided together.',
    );
  }
  const sources = [
    options.awsProfile !== undefined,
    options.awsAccessKeyId !== undefined,
    options.awsCredentialsProvider !== undefined,
  ].filter(Boolean).length;
  if (sources > 1) {
    throw new Errors.OpenAIError(
      'The `awsProfile`, explicit AWS credentials, and `awsCredentialsProvider` arguments are mutually exclusive.',
    );
  }
  if (options.awsSessionToken !== undefined && options.awsAccessKeyId === undefined) {
    throw new Errors.OpenAIError(
      'The `awsSessionToken` argument requires explicit AWS access key credentials.',
    );
  }
}

export interface BedrockClientOptions
  extends Omit<ClientOptions, 'apiKey' | 'adminAPIKey' | 'baseURL' | 'workloadIdentity'> {
  /**
   * Bedrock bearer token used for authentication.
   *
   * Defaults to process.env['AWS_BEARER_TOKEN_BEDROCK'].
   */
  apiKey?: string | null | undefined;

  /**
   * Bedrock API root.
   *
   * Defaults to process.env['AWS_BEDROCK_BASE_URL'], or derives
   * `https://bedrock-mantle.<region>.api.aws/openai/v1` from `awsRegion`,
   * process.env['AWS_REGION'], or process.env['AWS_DEFAULT_REGION'].
   */
  baseURL?: string | null | undefined;

  /**
   * BedrockOpenAI only supports Bedrock bearer token or AWS credential authentication.
   */
  adminAPIKey?: never;

  /**
   * BedrockOpenAI only supports Bedrock bearer token or AWS credential authentication.
   */
  workloadIdentity?: never;

  /**
   * AWS region used to derive the default Bedrock Mantle endpoint.
   *
   * Defaults to process.env['AWS_REGION'] or process.env['AWS_DEFAULT_REGION'].
   */
  awsRegion?: string | undefined;

  /** AWS shared-config profile used by the standard credential chain. */
  awsProfile?: string | undefined;

  /** Explicit AWS access key ID. Must be provided with `awsSecretAccessKey`. */
  awsAccessKeyId?: string | undefined;

  /** Explicit AWS secret access key. Must be provided with `awsAccessKeyId`. */
  awsSecretAccessKey?: string | undefined;

  /** Optional session token for explicit temporary AWS credentials. */
  awsSessionToken?: string | undefined;

  /** Provider returning AWS SDK-compatible credentials. */
  awsCredentialsProvider?: AwsCredentialsProvider | undefined;

  /**
   * A function that returns a Bedrock bearer token and is invoked before each request.
   */
  bedrockTokenProvider?: ApiKeySetter | undefined;
}

/** Resolve the default Bedrock Mantle API root from the configured AWS region. */
function deriveBedrockBaseURL(awsRegion: string | undefined): string {
  const region = awsRegion?.trim();
  if (!region) {
    throw new Errors.OpenAIError(
      'Must provide one of the `baseURL` or `awsRegion` arguments, or set the `AWS_BEDROCK_BASE_URL`, `AWS_REGION`, or `AWS_DEFAULT_REGION` environment variable.',
    );
  }

  return `https://bedrock-mantle.${region}.api.aws/openai/v1`;
}

/** Normalize a Bedrock Responses URL variant back to the provider API root. */
function normalizeBedrockBaseURL(baseURL: string): string {
  const url = new URL(baseURL);
  const responsesMatch = url.pathname.match(/\/responses(?:\/.*)?$/);
  if (responsesMatch?.index !== undefined) {
    url.pathname = url.pathname.slice(0, responsesMatch.index) || '/';
  }

  return url.toString().replace(/\/$/, '');
}

/** Restore the SDK convenience property when Bedrock omits it from a streamed final response. */
function addBedrockOutputText<ResponseT extends ResponsesAPI.Response>(response: ResponseT): ResponseT {
  if (!Object.getOwnPropertyDescriptor(response, 'output_text')) {
    addOutputText(response);
  }

  return response;
}

/** Keep the standard Responses surface while repairing Bedrock streamed final responses. */
function restoreBedrockStreamOutputText(responses: API.Responses): API.Responses {
  const stream = responses.stream.bind(responses);

  responses.stream = ((body: ResponseStreamParams, options?: RequestOptions) => {
    const responseStream = stream(body, options);
    const finalResponse = responseStream.finalResponse.bind(responseStream);
    responseStream.finalResponse = async () => addBedrockOutputText(await finalResponse());

    return responseStream;
  }) as API.Responses['stream'];

  return responses;
}

/** API Client for interfacing with Amazon Bedrock's OpenAI-compatible endpoint. */
export class BedrockOpenAI extends OpenAI {
  private readonly bedrockTokenProvider: ApiKeySetter | undefined;
  private readonly bedrockAwsBearerAuth: BedrockAwsBearerAuth | undefined;
  private readonly bedrockAwsAuth: BedrockAwsAuth | undefined;
  private readonly awsRegion: string | undefined;
  private readonly awsProfile: string | undefined;
  private readonly awsAccessKeyId: string | undefined;
  private readonly awsSecretAccessKey: string | undefined;
  private readonly awsSessionToken: string | undefined;
  private readonly awsCredentialsProvider: AwsCredentialsProvider | undefined;
  private readonly usesRegionDerivedBaseURL: boolean;

  /**
   * API Client for interfacing with Amazon Bedrock's OpenAI-compatible endpoint.
   *
   * @param {string | null | undefined} [opts.apiKey=process.env['AWS_BEARER_TOKEN_BEDROCK'] ?? null]
   * @param {string | null | undefined} [opts.baseURL=process.env['AWS_BEDROCK_BASE_URL'] ?? derived from opts.awsRegion or AWS_REGION/AWS_DEFAULT_REGION]
   * @param {string | undefined} [opts.awsRegion=process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'] ?? undefined]
   * @param {ApiKeySetter | undefined} opts.bedrockTokenProvider - A function that returns a Bedrock bearer token and is invoked before each request.
   */
  constructor({
    baseURL = readEnv('AWS_BEDROCK_BASE_URL'),
    apiKey,
    awsRegion = readEnv('AWS_REGION') ?? readEnv('AWS_DEFAULT_REGION'),
    awsProfile,
    awsAccessKeyId,
    awsSecretAccessKey,
    awsSessionToken,
    awsCredentialsProvider,
    bedrockTokenProvider,
    adminAPIKey,
    workloadIdentity,
    ...opts
  }: BedrockClientOptions = {}) {
    if (adminAPIKey || workloadIdentity) {
      throw new Errors.OpenAIError(
        'BedrockOpenAI only supports Bedrock bearer token or AWS credential authentication.',
      );
    }

    const explicitBearerAuth = apiKey != null || bedrockTokenProvider !== undefined;
    const explicitAwsAuth = hasExplicitAwsAuth({
      awsProfile,
      awsAccessKeyId,
      awsSecretAccessKey,
      awsSessionToken,
      awsCredentialsProvider,
    });
    if (explicitBearerAuth && explicitAwsAuth) {
      throw new Errors.OpenAIError(
        'Bearer token and AWS credential authentication arguments are mutually exclusive.',
      );
    }
    validateExplicitAwsAuth({
      awsProfile,
      awsAccessKeyId,
      awsSecretAccessKey,
      awsSessionToken,
      awsCredentialsProvider,
    });

    const ambientBearerAuth = !explicitBearerAuth && !explicitAwsAuth;
    if (ambientBearerAuth) {
      apiKey = readEnv('AWS_BEARER_TOKEN_BEDROCK') ?? null;
    }

    if (typeof (apiKey as unknown) === 'function') {
      throw new Errors.OpenAIError(
        'Pass refreshable Bedrock credentials via `bedrockTokenProvider`, not `apiKey`.',
      );
    }

    if (apiKey === '') {
      throw new Errors.OpenAIError('The `apiKey` argument must not be empty.');
    }

    if (apiKey && bedrockTokenProvider) {
      throw new Errors.OpenAIError(
        'The `apiKey` and `bedrockTokenProvider` arguments are mutually exclusive; only one can be passed at a time.',
      );
    }

    const useAwsAuth = !apiKey && !bedrockTokenProvider;
    if (useAwsAuth && !awsRegion?.trim()) {
      throw new Errors.OpenAIError(
        'AWS credential authentication requires `awsRegion`, `AWS_REGION`, or `AWS_DEFAULT_REGION`.',
      );
    }

    const explicitBaseURL = baseURL?.trim() ? baseURL : undefined;
    const usesRegionDerivedBaseURL = explicitBaseURL === undefined;
    const configuredBaseURL = explicitBaseURL ?? deriveBedrockBaseURL(awsRegion);

    super({
      apiKey: useAwsAuth ? 'bedrock-aws-auth' : bedrockTokenProvider ?? apiKey,
      adminAPIKey: null,
      baseURL: normalizeBedrockBaseURL(configuredBaseURL),
      ...opts,
    });

    this.bedrockTokenProvider = bedrockTokenProvider;
    this.bedrockAwsBearerAuth = useAwsAuth ? undefined : new BedrockAwsBearerAuth(ambientBearerAuth);
    this.bedrockAwsAuth =
      useAwsAuth ?
        new BedrockAwsAuth({
          region: awsRegion!,
          profile: awsProfile,
          credentials:
            awsCredentialsProvider ??
            (awsAccessKeyId && awsSecretAccessKey ?
              {
                accessKeyId: awsAccessKeyId,
                secretAccessKey: awsSecretAccessKey,
                ...(awsSessionToken ? { sessionToken: awsSessionToken } : {}),
              }
            : undefined),
        })
      : undefined;
    if (useAwsAuth) this.apiKey = null;
    this.awsRegion = awsRegion;
    this.awsProfile = awsProfile;
    this.awsAccessKeyId = awsAccessKeyId;
    this.awsSecretAccessKey = awsSecretAccessKey;
    this.awsSessionToken = awsSessionToken;
    this.awsCredentialsProvider = awsCredentialsProvider;
    this.usesRegionDerivedBaseURL = usesRegionDerivedBaseURL;
    this.responses = restoreBedrockStreamOutputText(new API.Responses(this));
  }

  protected override async prepareOptions(options: FinalRequestOptions): Promise<void> {
    const security = options.__security ?? { bearerAuth: true };
    if (security.adminAPIKeyAuth && !security.bearerAuth) {
      await this._callApiKey();
    }

    await super.prepareOptions(options);
  }

  protected override async authHeaders(
    opts: FinalRequestOptions,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): Promise<NullableHeaders | undefined> {
    if (this.bedrockAwsAuth) return undefined;

    const security = schemes ?? { bearerAuth: true, adminAPIKeyAuth: true };
    if ((security.bearerAuth || security.adminAPIKeyAuth) && this.apiKey !== null) {
      return buildHeaders([{ Authorization: `Bearer ${this.apiKey}` }]);
    }

    return super.authHeaders(opts, security);
  }

  protected override validateHeaders(
    headers: NullableHeaders,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ): void {
    if (this.bedrockAwsAuth) return;
    super.validateHeaders(headers, schemes);
  }

  protected override async prepareRequest(
    request: RequestInit,
    context: { url: string; options: FinalRequestOptions },
  ): Promise<void> {
    await super.prepareRequest(request, context);
    if (this.bedrockAwsAuth) {
      await this.bedrockAwsAuth.sign(context.url, request);
    } else {
      await this.bedrockAwsBearerAuth?.sign(context.url, request, this.apiKey);
    }
  }

  override withOptions(options: Partial<BedrockClientOptions>): this {
    const awsAuthOverride = hasExplicitAwsAuth(options);
    const bedrockTokenProvider =
      options.apiKey !== undefined || awsAuthOverride ?
        undefined
      : options.bedrockTokenProvider ?? this.bedrockTokenProvider;
    const preserveAwsAuth =
      this.bedrockAwsAuth !== undefined &&
      !awsAuthOverride &&
      options.apiKey === undefined &&
      !bedrockTokenProvider;
    const baseURL =
      options.baseURL !== undefined ? options.baseURL
      : options.awsRegion !== undefined && this.usesRegionDerivedBaseURL ? undefined
      : this.baseURL;

    return super.withOptions({
      ...options,
      awsRegion: options.awsRegion ?? this.awsRegion,
      awsProfile: options.awsProfile ?? (preserveAwsAuth ? this.awsProfile : undefined),
      awsAccessKeyId: options.awsAccessKeyId ?? (preserveAwsAuth ? this.awsAccessKeyId : undefined),
      awsSecretAccessKey:
        options.awsSecretAccessKey ?? (preserveAwsAuth ? this.awsSecretAccessKey : undefined),
      awsSessionToken: options.awsSessionToken ?? (preserveAwsAuth ? this.awsSessionToken : undefined),
      awsCredentialsProvider:
        options.awsCredentialsProvider ?? (preserveAwsAuth ? this.awsCredentialsProvider : undefined),
      baseURL,
      ...(bedrockTokenProvider || preserveAwsAuth || awsAuthOverride ?
        { apiKey: undefined, bedrockTokenProvider }
      : {}),
    } as Partial<ClientOptions>);
  }
}
