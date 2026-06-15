import * as Errors from './error';
import { OpenAI } from './client';
import type { ApiKeySetter, ClientOptions } from './client';
import type { Provider } from './internal/provider';
import { readEnv } from './internal/utils';
import { bedrock, type AwsCredentialsProvider } from './providers/bedrock';

export type { AwsCredentialIdentity, AwsCredentialsProvider } from './providers/bedrock';

export interface BedrockClientOptions
  extends Omit<ClientOptions, 'apiKey' | 'adminAPIKey' | 'baseURL' | 'provider' | 'workloadIdentity'> {
  /**
   * Bedrock bearer credential used for authentication.
   *
   * Defaults to process.env['AWS_BEARER_TOKEN_BEDROCK'].
   * Pass null to skip the environment bearer fallback and use AWS credentials.
   */
  apiKey?: string | null | undefined;

  /**
   * Bedrock API root.
   *
   * Defaults to process.env['AWS_BEDROCK_BASE_URL'], or derives the canonical
   * `https://bedrock-mantle.<region>.api.aws/v1` endpoint.
   */
  baseURL?: string | null | undefined;

  /** BedrockOpenAI only supports Bedrock bearer or AWS credential authentication. */
  adminAPIKey?: never;

  /** BedrockOpenAI only supports Bedrock bearer or AWS credential authentication. */
  workloadIdentity?: never;

  /** AWS region used for SigV4 and to derive the default Bedrock Mantle endpoint. */
  awsRegion?: string | undefined;

  /** AWS shared-config profile used by the standard credential chain. */
  awsProfile?: string | undefined;

  /** Explicit AWS access key ID. Must be provided with awsSecretAccessKey. */
  awsAccessKeyId?: string | undefined;

  /** Explicit AWS secret access key. Must be provided with awsAccessKeyId. */
  awsSecretAccessKey?: string | undefined;

  /** Optional session token for explicit temporary AWS credentials. */
  awsSessionToken?: string | undefined;

  /** Provider returning refreshable AWS credentials. */
  awsCredentialProvider?: AwsCredentialsProvider | undefined;

  /** A function that resolves a Bedrock bearer credential before every request attempt. */
  bedrockTokenProvider?: ApiKeySetter | undefined;
}

type BedrockProviderState = {
  provider?: Provider | undefined;
  publicAPIKey: string | null;
  usesEnvironmentBearerAuth: boolean;
};

const bedrockProviderState = Symbol('bedrockProviderState');

type InternalBedrockClientOptions = BedrockClientOptions & {
  provider?: Provider | undefined;
  [bedrockProviderState]?: BedrockProviderState | undefined;
};

function hasOwn(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function hasExplicitAwsAuth(options: Partial<BedrockClientOptions>): boolean {
  return (
    hasOwn(options, 'awsProfile') ||
    hasOwn(options, 'awsAccessKeyId') ||
    hasOwn(options, 'awsSecretAccessKey') ||
    hasOwn(options, 'awsSessionToken') ||
    hasOwn(options, 'awsCredentialProvider')
  );
}

function hasBearerAuthOverride(options: Partial<BedrockClientOptions>): boolean {
  return hasOwn(options, 'apiKey') || hasOwn(options, 'bedrockTokenProvider');
}

async function environmentBearerToken(): Promise<string> {
  const token = readEnv('AWS_BEARER_TOKEN_BEDROCK');
  if (!token) {
    throw new Errors.OpenAIError(
      'Could not find credentials for Bedrock. Set `AWS_BEARER_TOKEN_BEDROCK` or configure the default AWS credential chain.',
    );
  }
  return token;
}

/** Resolve the Bedrock OpenAI-compatible endpoint from a region. */
function deriveBedrockBaseURL(awsRegion: string | undefined): string {
  const region = awsRegion?.trim();
  if (!region) {
    throw new Errors.OpenAIError(
      'Must provide one of the `baseURL` or `awsRegion` arguments, or set the `AWS_BEDROCK_BASE_URL`, `AWS_REGION`, or `AWS_DEFAULT_REGION` environment variable.',
    );
  }
  return `https://bedrock-mantle.${region}.api.aws/v1`;
}

/** API Client for interfacing with Amazon Bedrock's OpenAI-compatible endpoint. */
export class BedrockOpenAI extends OpenAI {
  private readonly bedrockProvider: Provider;
  private readonly bedrockTokenProvider: ApiKeySetter | undefined;
  private readonly awsRegion: string | undefined;
  private readonly awsProfile: string | undefined;
  private readonly awsAccessKeyId: string | undefined;
  private readonly awsSecretAccessKey: string | undefined;
  private readonly awsSessionToken: string | undefined;
  private readonly awsCredentialProvider: AwsCredentialsProvider | undefined;
  private readonly usesRegionDerivedBaseURL: boolean;
  private readonly usesEnvironmentBearerAuth: boolean;

  constructor(options?: BedrockClientOptions);
  constructor(options: InternalBedrockClientOptions = {}) {
    const {
      [bedrockProviderState]: inheritedState,
      provider: _inheritedProvider,
      baseURL = readEnv('AWS_BEDROCK_BASE_URL'),
      apiKey,
      awsRegion = readEnv('AWS_REGION') ?? readEnv('AWS_DEFAULT_REGION'),
      awsProfile,
      awsAccessKeyId,
      awsSecretAccessKey,
      awsSessionToken,
      awsCredentialProvider,
      bedrockTokenProvider,
      adminAPIKey,
      workloadIdentity,
      ...opts
    } = options;

    if (adminAPIKey != null || workloadIdentity != null) {
      throw new Errors.OpenAIError(
        'BedrockOpenAI only supports Bedrock bearer token or AWS credential authentication.',
      );
    }
    if (typeof (apiKey as unknown) === 'function') {
      throw new Errors.OpenAIError(
        'Pass refreshable Bedrock credentials via `bedrockTokenProvider`, not `apiKey`.',
      );
    }

    const explicitBaseURL = baseURL?.trim() ? baseURL : undefined;
    const usesRegionDerivedBaseURL = explicitBaseURL === undefined;
    const configuredBaseURL = explicitBaseURL ?? deriveBedrockBaseURL(awsRegion);
    const explicitAwsAuth =
      awsProfile !== undefined ||
      awsAccessKeyId !== undefined ||
      awsSecretAccessKey !== undefined ||
      awsSessionToken !== undefined ||
      awsCredentialProvider !== undefined;
    const usesEnvironmentBearerAuth =
      inheritedState?.usesEnvironmentBearerAuth ??
      (!explicitAwsAuth &&
        !bedrockTokenProvider &&
        apiKey === undefined &&
        !!readEnv('AWS_BEARER_TOKEN_BEDROCK'));
    const forceEnvironmentBearerAuth =
      inheritedState !== undefined && usesEnvironmentBearerAuth && !inheritedState.provider;
    const configuredProvider =
      inheritedState?.provider ??
      bedrock({
        region: awsRegion,
        baseURL: configuredBaseURL,
        apiKey,
        tokenProvider: forceEnvironmentBearerAuth ? environmentBearerToken : bedrockTokenProvider,
        profile: awsProfile,
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
        sessionToken: awsSessionToken,
        credentialProvider: awsCredentialProvider,
      });

    super({
      ...opts,
      provider: configuredProvider,
    });

    const publicAPIKey =
      inheritedState?.publicAPIKey ??
      (typeof apiKey === 'string' ? apiKey
      : !explicitAwsAuth && !bedrockTokenProvider && apiKey !== null ?
        readEnv('AWS_BEARER_TOKEN_BEDROCK') ?? null
      : null);

    this.apiKey = publicAPIKey;
    this.bedrockProvider = configuredProvider;
    this.bedrockTokenProvider = bedrockTokenProvider;
    this.awsRegion = awsRegion;
    this.awsProfile = awsProfile;
    this.awsAccessKeyId = awsAccessKeyId;
    this.awsSecretAccessKey = awsSecretAccessKey;
    this.awsSessionToken = awsSessionToken;
    this.awsCredentialProvider = awsCredentialProvider;
    this.usesRegionDerivedBaseURL = usesRegionDerivedBaseURL;
    this.usesEnvironmentBearerAuth = usesEnvironmentBearerAuth;
  }

  override withOptions(options: Partial<BedrockClientOptions>): this {
    const bearerOverride = hasBearerAuthOverride(options);
    const awsOverride = hasExplicitAwsAuth(options);
    const routingOverride = hasOwn(options, 'baseURL') || hasOwn(options, 'awsRegion');
    const providerChanged = bearerOverride || awsOverride || routingOverride;

    const preserveBearer = !bearerOverride && !awsOverride;
    const preserveAws = !bearerOverride && !awsOverride;
    const baseURL =
      hasOwn(options, 'baseURL') ? options.baseURL
      : hasOwn(options, 'awsRegion') && this.usesRegionDerivedBaseURL ? undefined
      : this.baseURL;

    const nextOptions: InternalBedrockClientOptions = {
      ...options,
      baseURL,
      awsRegion: options.awsRegion ?? this.awsRegion,
      apiKey:
        bearerOverride ? options.apiKey
        : preserveBearer && !this.bedrockTokenProvider && !this.usesEnvironmentBearerAuth ? this.apiKey
        : undefined,
      bedrockTokenProvider:
        bearerOverride ? options.bedrockTokenProvider
        : preserveBearer ? this.bedrockTokenProvider
        : undefined,
      awsProfile:
        awsOverride ? options.awsProfile
        : preserveAws ? this.awsProfile
        : undefined,
      awsAccessKeyId:
        awsOverride ? options.awsAccessKeyId
        : preserveAws ? this.awsAccessKeyId
        : undefined,
      awsSecretAccessKey:
        awsOverride ? options.awsSecretAccessKey
        : preserveAws ? this.awsSecretAccessKey
        : undefined,
      awsSessionToken:
        awsOverride ? options.awsSessionToken
        : preserveAws ? this.awsSessionToken
        : undefined,
      awsCredentialProvider:
        awsOverride ? options.awsCredentialProvider
        : preserveAws ? this.awsCredentialProvider
        : undefined,
      ...(!providerChanged || (routingOverride && preserveBearer && this.usesEnvironmentBearerAuth) ?
        {
          [bedrockProviderState]: {
            provider: providerChanged ? undefined : this.bedrockProvider,
            publicAPIKey: this.apiKey,
            usesEnvironmentBearerAuth: this.usesEnvironmentBearerAuth,
          },
        }
      : {}),
    };

    return super.withOptions(nextOptions as Partial<ClientOptions>);
  }
}
