import type { WorkloadIdentity, TokenExchangeResponse } from './types';
import type { Fetch } from '../internal/builtin-types';
import * as Shims from '../internal/shims';
import { APIError, OAuthError, OpenAIError } from '../core/error';

interface CachedToken {
  token: string;
  expiresAt: number;
  refreshAt: number;
}

const SUBJECT_TOKEN_TYPES: Record<WorkloadIdentity['provider']['tokenType'], string> = {
  jwt: 'urn:ietf:params:oauth:token-type:jwt',
  id: 'urn:ietf:params:oauth:token-type:id_token',
};

const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';
// Cap the refresh buffer at half the actual token lifetime, matching the X.509
// workload-identity path, so short-lived tokens keep a usable cache window.
const MAX_REFRESH_BUFFER_FRACTION = 0.5;

function calculateRefreshAt(
  expiresAt: number,
  now: number,
  refreshBufferSeconds: number | undefined,
): number {
  const configuredBufferMs = (refreshBufferSeconds ?? 1200) * 1000;
  const effectiveBufferMs = Math.min(configuredBufferMs, (expiresAt - now) * MAX_REFRESH_BUFFER_FRACTION);
  return expiresAt - effectiveBufferMs;
}

const NATIVE_RESPONSE_PROTOTYPE = Response.prototype;
const READ_NATIVE_RESPONSE_BODY = NATIVE_RESPONSE_PROTOTYPE.arrayBuffer;

function isResponsePrototype(response: Response, prototype: object): boolean {
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
  if (
    prototype === response ||
    typeof constructor !== 'function' ||
    Object.getOwnPropertyDescriptor(constructor, 'name')?.value !== 'Response' ||
    Object.getOwnPropertyDescriptor(constructor, 'prototype')?.value !== prototype
  ) {
    return false;
  }

  const tag = Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag);
  return (
    (tag?.value === 'Response' || typeof tag?.get === 'function') &&
    typeof Object.getOwnPropertyDescriptor(prototype, 'headers')?.get === 'function' &&
    typeof Object.getOwnPropertyDescriptor(prototype, 'ok')?.get === 'function' &&
    typeof Object.getOwnPropertyDescriptor(prototype, 'status')?.get === 'function'
  );
}

function isResponseBodyPrototype(prototype: object, responsePrototype: object | null): boolean {
  if (prototype === responsePrototype) {
    return true;
  }

  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
  return (
    responsePrototype !== null &&
    Object.getPrototypeOf(responsePrototype) === prototype &&
    typeof constructor === 'function' &&
    Object.getOwnPropertyDescriptor(constructor, 'name')?.value === 'Body' &&
    Object.getOwnPropertyDescriptor(constructor, 'prototype')?.value === prototype
  );
}

function decodeNativeResponseBody(body: ArrayBuffer): string {
  const scope = globalThis as typeof globalThis & { Bun?: { version?: unknown } };
  return new TextDecoder('utf-8', { ignoreBOM: typeof scope.Bun?.version === 'string' }).decode(body);
}

async function parseOAuthTokenResponse(response: Response): Promise<unknown> {
  let readText: ((this: Response) => Promise<string>) | undefined;
  let responsePrototype: object | null = null;
  for (
    let depth = 0, prototype: object | null = response;
    prototype !== null && depth < 16;
    prototype = Object.getPrototypeOf(prototype), depth += 1
  ) {
    if (prototype === NATIVE_RESPONSE_PROTOTYPE) {
      break;
    }

    if (isResponsePrototype(response, prototype)) {
      responsePrototype = prototype;
    }

    const parser = Object.getOwnPropertyDescriptor(prototype, 'json');
    if (!parser) {
      continue;
    }

    if (typeof parser.value !== 'function') {
      break;
    }

    const bodyReader = Object.getOwnPropertyDescriptor(prototype, 'text')?.value;
    if (typeof bodyReader === 'function' && isResponseBodyPrototype(prototype, responsePrototype)) {
      readText = bodyReader;
      break;
    }

    // Custom parsers own their results and failures; rejection provenance cannot be inferred.
    return parser.value.call(response);
  }

  const body =
    readText === undefined
      ? decodeNativeResponseBody(await READ_NATIVE_RESPONSE_BODY.call(response))
      : await readText.call(response);
  try {
    return JSON.parse(body);
  } catch {
    throw new SyntaxError('Token exchange response contains invalid JSON');
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
    const { identityProviderId, serviceAccountId, clientId, refreshBufferSeconds, provider } = config;
    this.config = {
      identityProviderId,
      serviceAccountId,
      ...(clientId === undefined ? {} : { clientId }),
      ...(refreshBufferSeconds === undefined ? {} : { refreshBufferSeconds }),
      provider: {
        tokenType: provider.tokenType,
        getToken: provider.getToken.bind(provider),
      },
    };
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

    if (WorkloadIdentityAuth.needsRefresh(this.cachedToken) && !this.refreshPromise) {
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
        refreshAt: calculateRefreshAt(expiresAt, now, this.config.refreshBufferSeconds),
      };
    }

    return accessToken;
  }

  private static isTokenExpired(cachedToken: CachedToken): boolean {
    return Date.now() >= cachedToken.expiresAt;
  }

  private static needsRefresh(cachedToken: CachedToken): boolean {
    return Date.now() >= cachedToken.refreshAt;
  }

  /** Discards the cached access token so the next request performs a fresh exchange. */
  invalidateToken(): void {
    this.tokenGeneration += 1;
    this.cachedToken = null;
    this.refreshPromise = null;
  }
}
