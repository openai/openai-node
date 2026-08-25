import type { WorkloadIdentity, TokenExchangeResponse } from './types';
import type { Fetch } from '../internal/builtin-types';
import * as Shims from '../internal/shims';
import { APIError, OAuthError, OpenAIError } from '../core/error';

interface CachedToken {
  token: string;
  expiresAt: number;
}

const SUBJECT_TOKEN_TYPES: Record<WorkloadIdentity['provider']['tokenType'], string> = {
  jwt: 'urn:ietf:params:oauth:token-type:jwt',
  id: 'urn:ietf:params:oauth:token-type:id_token',
};

const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';

const MAX_OAUTH_JSON_ERROR_CAUSES = 32;
const getOAuthErrorDescriptor = Object.getOwnPropertyDescriptor;
const getOAuthErrorPrototype = Object.getPrototypeOf;
const oauthErrorObjectSource = Object.prototype.toString;
const oauthErrorFunctionSource = Function.prototype.toString;
const nativeOAuthErrorSource = oauthErrorFunctionSource.call(Error);
const nativeOAuthSyntaxErrorSource = oauthErrorFunctionSource.call(SyntaxError);
const nativeOAuthErrorBrandDescriptor = getOAuthErrorDescriptor(Error, 'isError');

interface OAuthRuntimeErrorTypes {
  isNativeError?: (error: object) => boolean;
  isProxy?: (error: object) => boolean;
}

function getOAuthRuntimeErrorIntrinsic(
  types: object,
  name: 'isNativeError' | 'isProxy',
): ((error: object) => boolean) | undefined {
  const descriptor = getOAuthErrorDescriptor(types, name);
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
    return undefined;
  }
  return descriptor.value.bind(types) as (error: object) => boolean;
}

function getOAuthRuntimeErrorTypes(): OAuthRuntimeErrorTypes | undefined {
  try {
    const runtime = globalThis as { process?: object };
    const runtimeProcess = runtime.process;
    if (!runtimeProcess) {
      return undefined;
    }

    const loader = getOAuthErrorDescriptor(runtimeProcess, 'getBuiltinModule');
    if (!loader || !('value' in loader) || typeof loader.value !== 'function') {
      return undefined;
    }

    const utility: unknown = loader.value.call(runtimeProcess, 'node:util');
    if (typeof utility !== 'object' || utility === null) {
      return undefined;
    }

    const types = getOAuthErrorDescriptor(utility, 'types');
    if (!types || !('value' in types) || typeof types.value !== 'object' || types.value === null) {
      return undefined;
    }

    return {
      isNativeError: getOAuthRuntimeErrorIntrinsic(types.value, 'isNativeError'),
      isProxy: getOAuthRuntimeErrorIntrinsic(types.value, 'isProxy'),
    };
  } catch {
    return undefined;
  }
}

const oauthRuntimeErrorTypes = getOAuthRuntimeErrorTypes();
const nativeOAuthErrorBrand =
  nativeOAuthErrorBrandDescriptor &&
  'value' in nativeOAuthErrorBrandDescriptor &&
  typeof nativeOAuthErrorBrandDescriptor.value === 'function'
    ? (nativeOAuthErrorBrandDescriptor.value.bind(Error) as (error: object) => boolean)
    : oauthRuntimeErrorTypes?.isNativeError;
const nativeOAuthProxyBrand = oauthRuntimeErrorTypes?.isProxy;

type OAuthJSONErrorKind = 'error' | 'syntax' | 'unknown' | 'unsafe';

function classifyOAuthErrorBrand(error: object): 'native' | 'unknown' | 'unsafe' {
  try {
    if (nativeOAuthErrorBrand) {
      if (nativeOAuthErrorBrand(error)) {
        return 'native';
      }
      return nativeOAuthProxyBrand?.(error) ? 'unsafe' : 'unknown';
    }

    let prototype: object | null = error;
    for (let depth = 0; prototype !== null; depth += 1) {
      if (depth >= MAX_OAUTH_JSON_ERROR_CAUSES) {
        return 'unsafe';
      }
      if (getOAuthErrorDescriptor(prototype, Symbol.toStringTag)) {
        return 'unknown';
      }
      prototype = getOAuthErrorPrototype(prototype) as object | null;
    }

    return oauthErrorObjectSource.call(error) === '[object Error]' ? 'native' : 'unknown';
  } catch {
    return 'unsafe';
  }
}

function classifyCrossRealmOAuthError(error: object): OAuthJSONErrorKind {
  try {
    let prototype: object | null = getOAuthErrorPrototype(error) as object | null;

    for (let depth = 0; prototype !== null; depth += 1) {
      if (depth >= MAX_OAUTH_JSON_ERROR_CAUSES) {
        return 'unsafe';
      }

      const name = getOAuthErrorDescriptor(prototype, 'name');
      const constructor = getOAuthErrorDescriptor(prototype, 'constructor');
      if (
        name &&
        'value' in name &&
        (name.value === 'Error' || name.value === 'SyntaxError') &&
        constructor &&
        'value' in constructor &&
        typeof constructor.value === 'function'
      ) {
        const originalPrototype = getOAuthErrorDescriptor(constructor.value, 'prototype');
        const nativeSource =
          name.value === 'SyntaxError' ? nativeOAuthSyntaxErrorSource : nativeOAuthErrorSource;
        if (
          originalPrototype &&
          'value' in originalPrototype &&
          originalPrototype.value === prototype &&
          oauthErrorFunctionSource.call(constructor.value) === nativeSource
        ) {
          return name.value === 'SyntaxError' ? 'syntax' : 'error';
        }
      }

      prototype = getOAuthErrorPrototype(prototype) as object | null;
    }

    return 'unknown';
  } catch {
    return 'unsafe';
  }
}

function isMalformedOAuthJSONError(error: unknown): boolean {
  try {
    const visited = new Set<object>();
    let current = error;

    for (let depth = 0; depth < MAX_OAUTH_JSON_ERROR_CAUSES; depth += 1) {
      if (typeof current !== 'object' || current === null) {
        return false;
      }
      const brand = classifyOAuthErrorBrand(current);
      if (brand === 'unsafe') {
        return true;
      }
      if (brand !== 'native') {
        return false;
      }
      if (current instanceof SyntaxError) {
        return true;
      }
      if (visited.has(current)) {
        return true;
      }
      visited.add(current);

      const kind = current instanceof Error ? 'error' : classifyCrossRealmOAuthError(current);
      if (kind === 'syntax' || kind === 'unsafe') {
        return true;
      }
      if (kind !== 'error') {
        return false;
      }

      const parserType = getOAuthErrorDescriptor(current, 'type');
      if (parserType && (!('value' in parserType) || parserType.value === 'invalid-json')) {
        return true;
      }

      const cause = getOAuthErrorDescriptor(current, 'cause');
      if (!cause) {
        return false;
      }
      if (!('value' in cause)) {
        return true;
      }
      current = cause.value;
    }

    return true;
  } catch {
    return true;
  }
}

async function parseOAuthTokenResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (isMalformedOAuthJSONError(error)) {
      throw new SyntaxError('Token exchange response contains invalid JSON');
    }
    throw error;
  }
}

function isUnsafeAccessToken(accessToken: string): boolean {
  const scope = globalThis as typeof globalThis & { Bun?: { version?: unknown } };
  if (typeof scope.Bun?.version === 'string') {
    return /[^\t\u0020-\u007E]|^[\t ]|[\t ]$/u.test(accessToken);
  }
  return /[^\t\u0020-\u007E\u0080-\u00FF]|^[\t ]|[\t ]$/u.test(accessToken);
}

/**
 * Exchanges external workload-identity tokens for cached OpenAI access tokens.
 *
 * Concurrent token exchanges are shared. Valid cached tokens are returned while
 * a proactive refresh runs in the background; expired or missing tokens wait
 * for a successful exchange before they are returned.
 */
export class WorkloadIdentityAuth {
  private cachedToken: CachedToken | null = null;
  private refreshPromise: Promise<string> | null = null;
  private tokenGeneration = 0;
  private readonly config: WorkloadIdentity;
  private readonly tokenExchangeUrl: string = 'https://auth.openai.com/oauth/token';
  private readonly fetch: Fetch;

  /**
   * Creates a workload-identity token cache and OAuth token-exchange client.
   *
   * @param config External identity provider, OpenAI service account, and refresh settings.
   * @param fetch Optional fetch implementation for calls to the OpenAI token endpoint.
   */
  constructor(config: WorkloadIdentity, fetch?: Fetch) {
    this.config = config;
    this.fetch = fetch ?? Shims.getDefaultFetch();
  }

  /**
   * Returns a valid OpenAI access token, exchanging or refreshing credentials as needed.
   *
   * Cached tokens nearing expiration are returned immediately while a background
   * refresh runs. Concurrent callers share the same in-flight token exchange.
   *
   * @throws {OAuthError} When the token endpoint rejects the subject token or identity.
   * @throws {APIError} When another unsuccessful HTTP response prevents token exchange.
   * @throws {OpenAIError} When a successful exchange has an invalid access token or expiration.
   */
  async getToken(): Promise<string> {
    if (!this.cachedToken || WorkloadIdentityAuth.isTokenExpired(this.cachedToken)) {
      if (this.refreshPromise) {
        return await this.refreshPromise;
      }

      const refreshPromise = this.refreshToken(this.tokenGeneration);
      this.refreshPromise = refreshPromise;

      try {
        return await refreshPromise;
      } finally {
        if (this.refreshPromise === refreshPromise) {
          this.refreshPromise = null;
        }
      }
    }

    if (this.needsRefresh(this.cachedToken) && !this.refreshPromise) {
      const refreshPromise = this.refreshToken(this.tokenGeneration).finally(() => {
        if (this.refreshPromise === refreshPromise) {
          this.refreshPromise = null;
        }
      });
      this.refreshPromise = refreshPromise;
      void refreshPromise.catch(() => null);
    }

    return this.cachedToken.token;
  }

  private async refreshToken(generation: number): Promise<string> {
    const subjectToken = await this.config.provider.getToken();
    const body: Record<string, string> = {
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      subject_token: subjectToken,
      subject_token_type: SUBJECT_TOKEN_TYPES[this.config.provider.tokenType],
      identity_provider_id: this.config.identityProviderId,
      service_account_id: this.config.serviceAccountId,
    };

    if (this.config.clientId) {
      body['client_id'] = this.config.clientId;
    }

    const response = await this.fetch(this.tokenExchangeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    });

    if (!response.ok) {
      const errorText = await response.text();
      let body: any = undefined;

      try {
        body = JSON.parse(errorText);
      } catch {
        // Ignore non-JSON error bodies.
      }

      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new OAuthError(response.status as 400 | 401 | 403, body, response.headers);
      }
      throw APIError.generate(
        response.status,
        body,
        `Token exchange failed with status ${response.status}`,
        response.headers,
      );
    }

    const tokenResponse: unknown = await parseOAuthTokenResponse(response);
    const accessToken =
      typeof tokenResponse === 'object' && tokenResponse !== null && 'access_token' in tokenResponse
        ? tokenResponse.access_token
        : undefined;
    if (
      typeof accessToken !== 'string' ||
      accessToken.trim().length === 0 ||
      isUnsafeAccessToken(accessToken)
    ) {
      throw new OpenAIError("Token exchange response missing 'access_token' field");
    }

    const expiresIn = (tokenResponse as Partial<TokenExchangeResponse>).expires_in ?? 3600;
    if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new OpenAIError("Token exchange response has invalid 'expires_in' field");
    }

    const now = Date.now();
    const expiresAt = now + expiresIn * 1000;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
      throw new OpenAIError("Token exchange response has invalid 'expires_in' field");
    }

    if (this.tokenGeneration === generation) {
      this.cachedToken = {
        token: accessToken,
        expiresAt,
      };
    }

    return accessToken;
  }

  private static isTokenExpired(cachedToken: CachedToken): boolean {
    return Date.now() >= cachedToken.expiresAt;
  }

  private needsRefresh(cachedToken: CachedToken): boolean {
    const bufferSeconds = this.config.refreshBufferSeconds ?? 1200;
    const bufferMs = bufferSeconds * 1000;
    return Date.now() >= cachedToken.expiresAt - bufferMs;
  }

  /** Discards the cached access token so the next request performs a fresh exchange. */
  invalidateToken(): void {
    this.tokenGeneration += 1;
    this.cachedToken = null;
    this.refreshPromise = null;
  }
}
