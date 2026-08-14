import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Hash } from '@smithy/hash-node';
import { SignatureV4 } from '@smithy/signature-v4';

import * as Errors from '../../error';
import type { BodyInit } from '../../internal/builtin-types';
import {
  assertBedrockRequestOrigin,
  assertProviderOwnsAuthorization,
  errorWithCause,
  normalizeOptionalString,
  resolveBedrockBearerAuth,
  resolveBedrockEndpoint,
} from '../../internal/bedrock';
import type {
  BedrockBearerOptions,
  BedrockEndpointOptions,
  BedrockRequestAuth,
} from '../../internal/bedrock';
import { createProvider } from '../../internal/provider';
import type { Provider, ProviderRequestContext } from '../../internal/provider';
import type { FinalizedRequestInit } from '../../internal/types';

const BEDROCK_SERVICE = 'bedrock-mantle';

/** AWS credentials used to sign an Amazon Bedrock request with Signature Version 4. */
export interface AwsCredentialIdentity {
  /** AWS access-key identifier associated with the signing identity. */
  accessKeyId: string;

  /** Secret access key paired with the AWS access-key identifier. */
  secretAccessKey: string;

  /** Session token required by temporary AWS credentials, when present. */
  sessionToken?: string;

  /** Expiration timestamp supplied by a refreshable temporary-credential provider. */
  expiration?: Date;
}

/** Resolves current AWS signing credentials before a Bedrock request attempt. */
export type AwsCredentialsProvider = () => AwsCredentialIdentity | Promise<AwsCredentialIdentity>;

/**
 * Configures a Bedrock endpoint and exactly one explicit bearer or AWS credential mode.
 *
 * When no explicit credential mode is supplied, `AWS_BEARER_TOKEN_BEDROCK` is
 * preferred, followed by the default AWS credential-provider chain.
 */
export interface BedrockProviderOptions extends BedrockEndpointOptions, BedrockBearerOptions {
  /** Explicit AWS access-key identifier; must be paired with `secretAccessKey`. */
  accessKeyId?: string | undefined;

  /** Explicit AWS secret access key; must be paired with `accessKeyId`. */
  secretAccessKey?: string | undefined;

  /** Session token for explicit temporary AWS credentials; requires both access-key fields. */
  sessionToken?: string | undefined;

  /** AWS shared-config profile; cannot be combined with another explicit credential mode. */
  profile?: string | undefined;

  /** Refreshable signing-credential provider invoked for each request attempt, including retries. */
  credentialProvider?: AwsCredentialsProvider | undefined;
}

function validateStaticCredentials(options: BedrockProviderOptions): AwsCredentialIdentity | undefined {
  const hasAccessKey = options.accessKeyId !== undefined;
  const hasSecretKey = options.secretAccessKey !== undefined;
  if (hasAccessKey !== hasSecretKey || (options.sessionToken !== undefined && !hasAccessKey)) {
    throw new Errors.OpenAIError(
      'The `accessKeyId` and `secretAccessKey` options must be provided together. A `sessionToken` may only be used with both.',
    );
  }
  if (!hasAccessKey) {
    return undefined;
  }

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

function requestTarget(parsedURL: URL): { path: string; query: Record<string, string | string[]> } {
  const query: Record<string, string | string[]> = {};
  for (const [name, value] of parsedURL.searchParams) {
    const existing = query[name];
    if (existing === undefined) {
      query[name] = value;
    } else if (typeof existing === 'string') {
      query[name] = [existing, value];
    } else {
      query[name] = [...existing, value];
    }
  }
  return { path: parsedURL.pathname, query };
}

function signableBody(body: BodyInit | null | undefined): string | ArrayBuffer | ArrayBufferView | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === 'string' || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return body;
  }
  throw new Errors.OpenAIError(
    "The SDK's Bedrock SigV4 mode requires a replayable request body. Buffer the body before sending or use bearer authentication.",
  );
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

type BedrockSigV4AuthOptions = {
  region: string;
  staticCredentials?: AwsCredentialIdentity | undefined;
  profile?: string | undefined;
  credentialProvider?: AwsCredentialsProvider | undefined;
  usesDefaultChain: boolean;
};

class BedrockSigV4Auth implements BedrockRequestAuth {
  private signer: SignatureV4 | undefined;
  private resolvedCredentialsProvider: (() => Promise<AwsCredentialIdentity>) | undefined;
  private readonly options: BedrockSigV4AuthOptions;

  constructor(options: BedrockSigV4AuthOptions) {
    this.options = options;
  }

  private credentialsProvider(): () => Promise<AwsCredentialIdentity> {
    if (this.resolvedCredentialsProvider) {
      return this.resolvedCredentialsProvider;
    }

    if (this.options.staticCredentials) {
      const credentials = this.options.staticCredentials;
      return (this.resolvedCredentialsProvider = async () => credentials);
    }
    if (this.options.credentialProvider) {
      const provider = this.options.credentialProvider;
      return (this.resolvedCredentialsProvider = async () => validateCredentialIdentity(await provider()));
    }

    const provider = defaultProvider(this.options.profile ? { profile: this.options.profile } : {});
    return (this.resolvedCredentialsProvider = async () => validateCredentialIdentity(await provider()));
  }

  private signatureV4(): SignatureV4 {
    return (this.signer ??= new SignatureV4({
      credentials: this.credentialsProvider(),
      region: this.options.region,
      service: BEDROCK_SERVICE,
      sha256: Hash.bind(null, 'sha256'),
    }));
  }

  async prepareRequest(request: FinalizedRequestInit, { url }: ProviderRequestContext): Promise<void> {
    if (Object.prototype.toString.call((globalThis as any).process) !== '[object process]') {
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

    let signed: { headers: Record<string, string> };
    try {
      signed = await this.signatureV4().sign({
        protocol: parsedURL.protocol,
        hostname: parsedURL.hostname,
        ...(parsedURL.port ? { port: Number(parsedURL.port) } : {}),
        method,
        ...requestTarget(parsedURL),
        headers: Object.fromEntries(headers.entries()),
        ...(body === undefined ? {} : { body }),
      });
    } catch (cause) {
      const message = this.options.usesDefaultChain
        ? 'Could not find credentials for Bedrock. Pass AWS credentials to `bedrock(...)` or configure the default AWS credential chain.'
        : 'Failed to resolve AWS credentials for Bedrock. Verify your AWS profile, environment variables, or runtime identity configuration and try again.';
      throw errorWithCause(message, cause);
    }

    request.method = method;
    request.redirect = 'manual';
    request.headers = new Headers(signed.headers);
  }
}

/**
 * Configures the standard OpenAI client for Amazon Bedrock bearer or AWS SigV4 authentication.
 *
 * Explicit bearer credentials, static AWS credentials, a shared-config profile,
 * and a credential provider are mutually exclusive. Without explicit
 * credentials, `AWS_BEARER_TOKEN_BEDROCK` takes precedence over the default AWS
 * credential chain. The region defaults to `AWS_REGION` or `AWS_DEFAULT_REGION`.
 *
 * This entrypoint requires `@aws-sdk/credential-provider-node`,
 * `@smithy/hash-node`, and `@smithy/signature-v4`. AWS signing is available in
 * Node.js-compatible server runtimes and requires replayable request bodies.
 *
 * @param options Bedrock endpoint and optional explicit authentication settings.
 * @returns A provider accepted by `new OpenAI({ provider })`.
 * @throws {OpenAIError} If endpoint settings or credential modes are invalid or ambiguous.
 */
export function bedrock(options: BedrockProviderOptions = {}): Provider {
  const staticCredentials = validateStaticCredentials(options);
  const profile = normalizeOptionalString(options.profile);
  if (options.profile !== undefined && !profile) {
    throw new Errors.OpenAIError('The Bedrock AWS `profile` must not be empty.');
  }

  const awsModes = [!!staticCredentials, !!profile, !!options.credentialProvider].filter(Boolean).length;
  if (awsModes > 1) {
    throw new Errors.OpenAIError(
      'Bedrock authentication is ambiguous. Configure exactly one explicit AWS mode: static credentials, profile, or credential provider.',
    );
  }
  const explicitAwsAuth = awsModes === 1;
  const bearerAuth = resolveBedrockBearerAuth(options, { allowEnvironment: !explicitAwsAuth });
  if (bearerAuth.explicit && explicitAwsAuth) {
    throw new Errors.OpenAIError(
      'Bearer and AWS credential authentication are mutually exclusive. Configure exactly one explicit mode: bearer credential, static AWS credentials, profile, or credential provider.',
    );
  }

  const { region, baseURL } = resolveBedrockEndpoint(options);
  if (!bearerAuth.factory && !region) {
    throw new Errors.OpenAIError(
      'Bedrock requires an AWS region. Pass `region` to `bedrock(...)`, or set `AWS_REGION` or `AWS_DEFAULT_REGION`.',
    );
  }
  const credentialProvider = options.credentialProvider;

  return createProvider({
    configure() {
      const auth =
        bearerAuth.factory?.() ??
        new BedrockSigV4Auth({
          region: region!,
          staticCredentials,
          profile,
          credentialProvider,
          usesDefaultChain: !explicitAwsAuth,
        });
      return {
        name: 'bedrock',
        baseURL,
        async prepareRequest(request, context) {
          assertBedrockRequestOrigin(baseURL, context.url);
          await auth.prepareRequest(request, context);
        },
      };
    },
  });
}
