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

    const tokenResponse: unknown = await response.json();
    if (
      typeof tokenResponse !== 'object' ||
      tokenResponse === null ||
      !('access_token' in tokenResponse) ||
      typeof tokenResponse.access_token !== 'string' ||
      tokenResponse.access_token.trim().length === 0
    ) {
      throw new OpenAIError("Token exchange response missing 'access_token' field");
    }

    const accessToken = tokenResponse.access_token;
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
