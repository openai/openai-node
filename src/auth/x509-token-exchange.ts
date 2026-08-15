import { APIConnectionError, APIError, OAuthError, OpenAIError } from '../core/error';
import type { Fetch } from '../internal/builtin-types';
import * as Shims from '../internal/shims';
import type { MergedRequestInit } from '../internal/types';
import { parseRetryAfterMillis } from '../internal/utils/retries';
import { sleep } from '../internal/utils/sleep';
import type { X509WorkloadIdentity } from './types';

const X509_TOKEN_EXCHANGE_URL = 'https://mtls.auth.openai.com/oauth/token';
const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const X509_SUBJECT_TOKEN_TYPE = 'urn:openai:params:oauth:token-type:x509';
const MAX_RETRY_DELAY_MS = 60_000;

interface X509TokenExchangeOptions {
  config: X509WorkloadIdentity;
  fetch: Fetch;
  fetchOptions?: MergedRequestInit | undefined;
  maxRetries: number;
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

async function exchangeAttempt(
  options: X509TokenExchangeOptions,
  body: string,
  attempt: number,
): Promise<unknown> {
  let response: Response;
  try {
    const controller = new AbortController();
    response = await options.fetch(X509_TOKEN_EXCHANGE_URL, {
      ...(options.fetchOptions as RequestInit | undefined),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch {
    if (attempt >= options.maxRetries) {
      throw new APIConnectionError({
        message: 'X.509 workload identity token exchange failed due to a connection error.',
      });
    }
    await sleep(defaultRetryDelayMillis(attempt));
    return await exchangeAttempt(options, body, attempt + 1);
  }

  if (response.ok) {
    try {
      return await response.json();
    } catch {
      throw new OpenAIError('X.509 workload identity token exchange returned invalid JSON.');
    }
  }

  if (attempt < options.maxRetries && isRetryable(response.status)) {
    await Shims.CancelReadableStream(response.body);
    await sleep(retryDelayMillis(response.headers, attempt));
    return await exchangeAttempt(options, body, attempt + 1);
  }

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new OAuthError(response.status, await readOAuthErrorCode(response), response.headers);
  }

  await Shims.CancelReadableStream(response.body);
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
  return await exchangeAttempt(options, body, 0);
}
