import { APIError, OAuthError, OpenAIError } from '../../core/error';
import type { SubjectTokenWorkloadIdentity, TokenExchangeResponse } from '../../auth/types';
import type { Fetch } from '../builtin-types';

interface CachedToken {
  token: string;
  expiresAt: number;
}

const SUBJECT_TOKEN_TYPES: Record<SubjectTokenWorkloadIdentity['provider']['tokenType'], string> = {
  jwt: 'urn:ietf:params:oauth:token-type:jwt',
  id: 'urn:ietf:params:oauth:token-type:id_token',
};

const SUBJECT_TOKEN_EXCHANGE_URL = 'https://auth.openai.com/oauth/token';
const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';

function tokenExchangeBody(config: SubjectTokenWorkloadIdentity, subjectToken: string): string {
  return JSON.stringify({
    grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
    subject_token: subjectToken,
    subject_token_type: SUBJECT_TOKEN_TYPES[config.provider.tokenType],
    identity_provider_id: config.identityProviderId,
    service_account_id: config.serviceAccountId,
    ...(config.clientId ? { client_id: config.clientId } : {}),
  });
}

/** The original JWT/ID-token lifecycle, isolated from X.509 transport state. */
export class SubjectTokenWorkloadIdentityAuth {
  private cachedToken: CachedToken | null = null;
  private refreshPromise: Promise<string> | null = null;
  private tokenGeneration = 0;
  private readonly config: SubjectTokenWorkloadIdentity;
  private readonly fetch: Fetch;

  constructor(config: SubjectTokenWorkloadIdentity, fetch: Fetch) {
    this.config = config;
    this.fetch = fetch;
  }

  async getToken(): Promise<string> {
    if (!this.cachedToken || SubjectTokenWorkloadIdentityAuth.isTokenExpired(this.cachedToken)) {
      if (this.refreshPromise) {
        return await this.refreshPromise;
      }

      const refreshPromise = this.refreshToken(this.tokenGeneration);
      this.refreshPromise = refreshPromise;

      try {
        return await refreshPromise;
      } finally {
        // Promise identity prevents an older refresh from clearing a newer replacement.
        if (this.refreshPromise === refreshPromise) {
          this.refreshPromise = null;
        }
      }
    }

    if (this.needsRefresh(this.cachedToken) && !this.refreshPromise) {
      // oxlint-disable-next-line promise/prefer-await-to-then -- Background refresh cleanup must be attached to the shared promise.
      const refreshPromise = this.refreshToken(this.tokenGeneration).finally(() => {
        if (this.refreshPromise === refreshPromise) {
          this.refreshPromise = null;
        }
      });
      this.refreshPromise = refreshPromise;
      // oxlint-disable-next-line promise/prefer-await-to-then -- Observe the intentionally detached background refresh.
      void refreshPromise.catch(() => null);
    }

    return this.cachedToken.token;
  }

  private async refreshToken(generation: number): Promise<string> {
    const subjectToken = await this.config.provider.getToken();

    const response = await this.fetch(SUBJECT_TOKEN_EXCHANGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: tokenExchangeBody(this.config, subjectToken),
      redirect: 'manual',
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorBody: object | undefined;

      try {
        const parsed: unknown = JSON.parse(errorText);
        if (typeof parsed === 'object' && parsed !== null) {
          errorBody = parsed;
        }
      } catch {
        // Ignore non-JSON error bodies.
      }

      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new OAuthError(response.status, errorBody, response.headers);
      }
      throw APIError.generate(
        response.status,
        errorBody,
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
      this.cachedToken = { token: accessToken, expiresAt };
    }

    return accessToken;
  }

  private static isTokenExpired(cachedToken: CachedToken): boolean {
    return Date.now() >= cachedToken.expiresAt;
  }

  private needsRefresh(cachedToken: CachedToken): boolean {
    return Date.now() >= cachedToken.expiresAt - (this.config.refreshBufferSeconds ?? 1200) * 1000;
  }

  invalidateToken(rejectedToken?: string): void {
    if (rejectedToken !== undefined && this.cachedToken?.token !== rejectedToken) {
      return;
    }
    this.tokenGeneration += 1;
    this.cachedToken = null;
    this.refreshPromise = null;
  }
}
