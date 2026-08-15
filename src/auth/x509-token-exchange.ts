import { APIConnectionError, APIError, OAuthError, OpenAIError } from '../core/error';
import type { Fetch } from '../internal/builtin-types';
import * as Shims from '../internal/shims';
import type { MergedRequestInit } from '../internal/types';
import { parseRetryAfterMillis } from '../internal/utils/retries';
import type { X509WorkloadIdentity } from './types';

const X509_TOKEN_EXCHANGE_URL = 'https://mtls.auth.openai.com/oauth/token';
const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const X509_SUBJECT_TOKEN_TYPE = 'urn:openai:params:oauth:token-type:x509';
const MAX_RETRY_DELAY_MS = 60_000;

interface X509TokenExchangeOptions {
  config: X509WorkloadIdentity;
  fetch: Fetch;
  fetchOptions?: MergedRequestInit | undefined;
  retryCount: number;
}

/** Internal signal that a caller may retry a sanitized exchange failure. */
export class X509TokenExchangeRetryableError extends Error {
  readonly error: APIError;
  readonly retryDelayMs: number;

  constructor(error: APIError, retryDelayMs: number) {
    super('X.509 workload identity token exchange may be retried.');
    this.name = 'X509TokenExchangeRetryableError';
    this.error = error;
    this.retryDelayMs = retryDelayMs;
  }
}

function defaultRetryDelayMillis(attempt: number): number {
  const exponentialDelay = Math.min(500 * 2 ** attempt, 8000);
  return exponentialDelay * (1 - Math.random() * 0.25);
}

function retryDelayMillis(headers: Headers, attempt: number): number {
  const retryAfter = parseRetryAfterMillis(headers);
  if (
    retryAfter !== undefined &&
    Number.isFinite(retryAfter) &&
    retryAfter >= 0 &&
    retryAfter <= MAX_RETRY_DELAY_MS
  ) {
    return retryAfter;
  }
  return defaultRetryDelayMillis(attempt);
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function retryableConnectionError(retryCount: number): X509TokenExchangeRetryableError {
  return new X509TokenExchangeRetryableError(
    new APIConnectionError({
      message: 'X.509 workload identity token exchange failed due to a connection error.',
    }),
    defaultRetryDelayMillis(retryCount),
  );
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await Shims.CancelReadableStream(response.body);
  } catch {
    // Cleanup is best-effort and must not replace the sanitized status error.
  }
}

async function readSuccessBody(response: Response, retryCount: number): Promise<unknown> {
  let responseText: string;
  try {
    responseText = await response.text();
  } catch {
    throw retryableConnectionError(retryCount);
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new OpenAIError('X.509 workload identity token exchange returned invalid JSON.');
  }
}

async function readOAuthErrorCode(response: Response): Promise<{ error: string } | undefined> {
  const parsed: unknown = await response.json().catch((): undefined => undefined);
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'error' in parsed &&
    (parsed.error === 'invalid_grant' || parsed.error === 'invalid_subject_token')
  ) {
    return { error: parsed.error };
  }
  return undefined;
}

async function exchangeAttempt(options: X509TokenExchangeOptions, body: string): Promise<unknown> {
  let response: Response;
  try {
    const controller = new AbortController();
    response = await options.fetch.call(undefined, X509_TOKEN_EXCHANGE_URL, {
      ...(options.fetchOptions as RequestInit | undefined),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch {
    throw retryableConnectionError(options.retryCount);
  }

  if (response.ok) {
    return await readSuccessBody(response, options.retryCount);
  }

  if (isRetryable(response.status)) {
    const error = APIError.generate(
      response.status,
      undefined,
      `X.509 workload identity token exchange failed with status ${response.status}`,
      response.headers,
    );
    const retryDelayMs = retryDelayMillis(response.headers, options.retryCount);
    await cancelResponseBody(response);
    throw new X509TokenExchangeRetryableError(error, retryDelayMs);
  }

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new OAuthError(response.status, await readOAuthErrorCode(response), response.headers);
  }

  await cancelResponseBody(response);
  throw APIError.generate(
    response.status,
    undefined,
    `X.509 workload identity token exchange failed with status ${response.status}`,
    response.headers,
  );
}

/** Performs the pinned, certificate-authenticated X.509 token exchange. */
export async function exchangeX509Token(options: X509TokenExchangeOptions): Promise<unknown> {
  const body = JSON.stringify({
    grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
    subject_token_type: X509_SUBJECT_TOKEN_TYPE,
    identity_provider_id: options.config.identityProviderId,
    service_account_id: options.config.serviceAccountId,
  });
  return await exchangeAttempt(options, body);
}
