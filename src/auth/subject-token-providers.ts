import type { SubjectTokenProvider } from './types';
import type { Fetch } from '../internal/builtin-types';
import * as Shims from '../internal/shims';
import { SubjectTokenProviderError } from '../core/error';
import { toBase64 } from '../internal/utils/base64';
import { readEnv } from '../internal/utils/env';

const DEFAULT_RESOURCE = 'https://management.azure.com/';
const DEFAULT_AZURE_API_VERSION = '2018-02-01';
const AZURE_IMDS_BASE_URL = 'http://169.254.169.254/metadata/identity/oauth2/token';

type ReadFile = (path: string) => Promise<string>;

let fsPromisesModule: Promise<typeof import('node:fs/promises')> | undefined;

async function defaultReadFile(path: string): Promise<string> {
  fsPromisesModule ??= import('fs/promises').catch((error) => {
    fsPromisesModule = undefined;
    throw error;
  });

  const { readFile } = await fsPromisesModule;
  return readFile(path, 'utf8');
}

export function k8sServiceAccountTokenProvider(
  tokenPath: string = '/var/run/secrets/kubernetes.io/serviceaccount/token',
  config?: {
    readFile?: ReadFile;
  },
): SubjectTokenProvider {
  const readFile = config?.readFile ?? defaultReadFile;

  return {
    tokenType: 'jwt',
    getToken: async (): Promise<string> => {
      let rawToken: string;

      try {
        rawToken = await readFile(tokenPath);
      } catch (error) {
        if (error instanceof SubjectTokenProviderError) {
          throw error;
        }

        throw new SubjectTokenProviderError(
          `Failed to read Kubernetes service account token from ${tokenPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'kubernetes',
          error instanceof Error ? error : undefined,
        );
      }

      const token = rawToken.trim();

      if (token.length === 0) {
        throw new SubjectTokenProviderError(`The token file at ${tokenPath} is empty.`, 'kubernetes');
      }

      return token;
    },
  };
}

export function azureManagedIdentityTokenProvider(
  resource: string = DEFAULT_RESOURCE,
  config?: {
    objectId?: string;
    clientId?: string;
    msiResId?: string;
    apiVersion?: string;
    timeout?: number;
    fetch?: Fetch;
  },
): SubjectTokenProvider {
  const apiVersion = config?.apiVersion ?? DEFAULT_AZURE_API_VERSION;
  const timeout = config?.timeout ?? 10000;

  return {
    tokenType: 'jwt',
    getToken: async (): Promise<string> => {
      const url = new URL(AZURE_IMDS_BASE_URL);
      url.searchParams.set('api-version', apiVersion);
      url.searchParams.set('resource', resource);

      if (config?.objectId) {
        url.searchParams.set('object_id', config.objectId);
      }
      if (config?.clientId) {
        url.searchParams.set('client_id', config.clientId);
      }
      if (config?.msiResId) {
        url.searchParams.set('msi_res_id', config.msiResId);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await (config?.fetch ?? Shims.getDefaultFetch())(url.toString(), {
          headers: {
            Metadata: 'true',
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new SubjectTokenProviderError(
            `Failed to fetch token from Azure IMDS: status ${response.status}`,
            'azure-imds',
          );
        }

        const data = (await response.json()) as { access_token?: string };

        if (!data.access_token) {
          throw new SubjectTokenProviderError("IMDS response missing 'access_token' field", 'azure-imds');
        }

        return data.access_token;
      } catch (error) {
        if (error instanceof SubjectTokenProviderError) {
          throw error;
        }
        throw new SubjectTokenProviderError(
          'failed to fetch token from IMDS',
          'azure-imds',
          error instanceof Error ? error : undefined,
        );
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}

export function gcpIDTokenProvider(
  audience: string = 'https://api.openai.com/v1',
  config?: { timeout?: number; fetch?: Fetch },
): SubjectTokenProvider {
  const timeout = config?.timeout || 10000;

  return {
    tokenType: 'id',
    getToken: async (): Promise<string> => {
      const url = new URL(
        `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity`,
      );
      url.searchParams.set('audience', audience);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await (config?.fetch ?? Shims.getDefaultFetch())(url.toString(), {
          headers: {
            'Metadata-Flavor': 'Google',
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`GCP Metadata Server returned ${response.status}: ${errorText}`);
        }

        const token = (await response.text()).trim();
        if (!token) {
          throw new Error('GCP metadata server returned an empty token');
        }

        return token;
      } catch (error) {
        throw new SubjectTokenProviderError(
          `Failed to fetch token from GCP Metadata Server: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'gcp-metadata',
          error instanceof Error ? error : undefined,
        );
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}

/**
 * Get a token provider for AWS Bedrock using IAM credentials.
 *
 * Returns an async callable that generates a bearer token from a SigV4 presigned URL.
 * Pass it directly to `apiKey` when creating an OpenAI client pointed at a
 * Bedrock runtime endpoint. Credentials are resolved from the standard AWS credential chain:
 * https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html
 *
 * The AWS SDK modules are cached so import resolution is efficient, while the token
 * itself is regenerated on each call to ensure it always reflects the latest valid
 * credentials (important for short-lived STS/assumed-role sessions).
 *
 * @param config.region - AWS region. Defaults to `AWS_REGION` or `AWS_DEFAULT_REGION` environment variable.
 * @param config.profile - AWS profile name. If not set, credentials are resolved from the standard chain.
 * @param config.tokenDuration - Presigned URL expiry in seconds. Defaults to 3600 (1 hour).
 */
export function awsBedrockTokenProvider(config?: {
  region?: string;
  profile?: string;
  tokenDuration?: number;
}): () => Promise<string> {
  const tokenDuration = config?.tokenDuration ?? 3600;

  let cachedModules: { credProviders: any; SignatureV4Cls: any; Sha256Cls: any } | null = null;

  async function getAwsModules() {
    if (cachedModules) return cachedModules;

    try {
      const [credModule, sigV4Module, sha256Module] = await Promise.all([
        import('@aws-sdk/credential-providers' as any),
        import('@smithy/signature-v4' as any),
        import('@aws-crypto/sha256-js' as any),
      ]);
      cachedModules = {
        credProviders: credModule,
        SignatureV4Cls: sigV4Module.SignatureV4,
        Sha256Cls: sha256Module.Sha256,
      };
      return cachedModules;
    } catch (e) {
      throw new Error(
        '@aws-sdk/credential-providers, @smithy/signature-v4, and @aws-crypto/sha256-js are required ' +
          'for AWS Bedrock token generation. Install them with: ' +
          'npm install @aws-sdk/credential-providers @smithy/signature-v4 @aws-crypto/sha256-js',
      );
    }
  }

  return async (): Promise<string> => {
    const { credProviders, SignatureV4Cls, Sha256Cls } = await getAwsModules();

    try {
      const resolvedRegion = config?.region || readEnv('AWS_REGION') || readEnv('AWS_DEFAULT_REGION');
      if (!resolvedRegion) {
        throw new SubjectTokenProviderError(
          "AWS region must be provided via the 'region' parameter, " +
            'or the AWS_REGION / AWS_DEFAULT_REGION environment variable.',
          'aws-bedrock',
        );
      }

      const credentialProvider =
        config?.profile ?
          credProviders.fromIni({ profile: config.profile })
        : credProviders.fromNodeProviderChain();

      const credentials = await credentialProvider();

      const signer = new SignatureV4Cls({
        service: 'bedrock',
        region: resolvedRegion,
        credentials,
        sha256: Sha256Cls,
      });

      const request = {
        method: 'POST',
        hostname: 'bedrock.amazonaws.com',
        path: '/',
        query: { Action: 'CallWithBearerToken' },
        headers: {
          host: 'bedrock.amazonaws.com',
        },
        protocol: 'https:',
      };

      const presigned = await signer.presign(request, {
        expiresIn: tokenDuration,
      });

      // Reconstruct the signed URL from the presigned request
      const queryParams = presigned.query as Record<string, string>;
      const queryString = Object.entries(queryParams)
        .map(([k, v]: [string, string]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
      const signedUrl = `https://bedrock.amazonaws.com/?${queryString}`;

      // Strip https:// prefix, append Version=1, and base64-encode
      const urlWithoutScheme = signedUrl.slice('https://'.length);
      const encodedToken = toBase64(`${urlWithoutScheme}&Version=1`);

      return `bedrock-api-key-${encodedToken}`;
    } catch (e) {
      if (e instanceof SubjectTokenProviderError) {
        throw e;
      }
      throw new SubjectTokenProviderError(
        `Failed to generate AWS Bedrock token: ${e instanceof Error ? e.message : String(e)}`,
        'aws-bedrock',
        e instanceof Error ? e : undefined,
      );
    }
  };
}
