import type * as FsPromises from 'node:fs/promises';
import type { SubjectTokenProvider } from './types';
import type { Fetch } from '../internal/builtin-types';
import * as Shims from '../internal/shims';
import { SubjectTokenProviderError } from '../core/error';

const DEFAULT_RESOURCE = 'https://management.azure.com/';
const DEFAULT_AZURE_API_VERSION = '2018-02-01';
const AZURE_IMDS_BASE_URL = 'http://169.254.169.254/metadata/identity/oauth2/token';

/** Reads the UTF-8 contents of a Kubernetes service-account token file. */
type ReadFile = (path: string) => Promise<string>;

let fsPromisesModule: Promise<typeof FsPromises> | undefined;

async function defaultReadFile(path: string): Promise<string> {
  fsPromisesModule ??= import('node:fs/promises').catch((error) => {
    fsPromisesModule = undefined;
    throw error;
  });

  const { readFile } = await fsPromisesModule;
  return readFile(path, 'utf-8');
}

/**
 * Reads a Kubernetes service-account JWT from its mounted token file.
 *
 * The file is read again for each token exchange so projected or rotated tokens
 * are picked up automatically. The default reader requires Node.js filesystem
 * access; provide `config.readFile` when using another compatible runtime.
 *
 * @param tokenPath Path to the token file; defaults to
 * `/var/run/secrets/kubernetes.io/serviceaccount/token`.
 * @param config Optional replacement for the default UTF-8 file reader.
 * @returns A JWT subject-token provider suitable for `workloadIdentity.provider`.
 * @throws {SubjectTokenProviderError} When the returned provider cannot read the
 * token file or the file contains no token.
 */
export function k8sServiceAccountTokenProvider(
  tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token',
  config?: {
    /** Reads token-file contents; defaults to Node.js `fs/promises.readFile`. */
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

/**
 * Retrieves an Azure managed-identity access token from the Instance Metadata Service.
 *
 * Run this provider in an Azure-hosted workload that can reach the link-local
 * metadata endpoint. Select a user-assigned identity with `objectId`, `clientId`,
 * or `msiResId`; otherwise Azure selects the available managed identity.
 *
 * @param resource Azure resource identifier; defaults to
 * `https://management.azure.com/`.
 * @param config Managed-identity selection, metadata API version, request
 * timeout, and optional `fetch` implementation.
 * @returns A JWT subject-token provider suitable for `workloadIdentity.provider`.
 * @throws {SubjectTokenProviderError} When the returned provider cannot retrieve
 * an access token, the metadata response is invalid, or the request times out.
 */
export function azureManagedIdentityTokenProvider(
  resource: string = DEFAULT_RESOURCE,
  config?: {
    /** Object ID of the user-assigned managed identity to request. */
    objectId?: string;

    /** Client ID of the user-assigned managed identity to request. */
    clientId?: string;

    /** Azure resource ID of the user-assigned managed identity to request. */
    msiResId?: string;

    /** Azure Instance Metadata Service API version; defaults to `2018-02-01`. */
    apiVersion?: string;

    /** Metadata request timeout in milliseconds; defaults to 10,000. */
    timeout?: number;

    /** Fetch implementation used for metadata requests; defaults to the runtime fetch. */
    fetch?: Fetch;
  },
): SubjectTokenProvider {
  const apiVersion = config?.apiVersion ?? DEFAULT_AZURE_API_VERSION;
  const timeout = config?.timeout ?? 10_000;

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

/**
 * Retrieves a Google Cloud identity token from the default service account's metadata endpoint.
 *
 * Run this provider in a Google Cloud workload with access to its Compute Engine
 * metadata server. A fresh identity token is requested for each token exchange.
 *
 * @param audience Intended identity-token audience; defaults to
 * `https://api.openai.com/v1`.
 * @param config Optional metadata request timeout and `fetch` implementation.
 * @returns An identity-token subject-token provider for `workloadIdentity.provider`.
 * @throws {SubjectTokenProviderError} When the returned provider cannot retrieve
 * a nonempty identity token or the metadata request times out.
 */
export function gcpIDTokenProvider(
  audience = 'https://api.openai.com/v1',
  config?: {
    /** Metadata request timeout in milliseconds; defaults to 10,000. */
    timeout?: number;

    /** Fetch implementation used for metadata requests; defaults to the runtime fetch. */
    fetch?: Fetch;
  },
): SubjectTokenProvider {
  const timeout = config?.timeout || 10_000;

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

        const tokenText = await response.text();
        const token = tokenText.trim();
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
