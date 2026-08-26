import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  OAuthError,
  OpenAIError,
} from '../../core/error';
import { hasOwn } from '../utils/values';
import { sendX509Request } from './x509-transport-capability';
import { isRetryableX509TransportFailure } from './x509-transport-registry';
import {
  isTransientX509ConnectionError,
  markRetryableX509IssuerError,
  markTransientX509ConnectionError,
  rememberX509OAuthError,
} from '#x509-transport-state';
import type { X509ExchangedToken, X509Transport } from './x509-transport-registry';

export type { X509ExchangedToken } from './x509-transport-registry';

const TOKEN_EXCHANGE_URL = new URL('https://mtls.auth.openai.com/oauth/token');
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const X509_SUBJECT_TOKEN = 'urn:openai:params:oauth:token-type:x509';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const SAFE_ACCESS_TOKEN = /^[A-Za-z0-9._~+/-]+=*$/u;
const SAFE_OAUTH_ERRORS = new Set(['invalid_grant', 'invalid_subject_token', 'token_exchange_server_error']);
const SAFE_RESPONSE_HEADERS = ['retry-after', 'retry-after-ms', 'x-should-retry', 'x-request-id'];
const MAX_TOKEN_EXCHANGE_DURATION_MS = 5000;

function transientConnectionError(message: string, failure: unknown): APIConnectionError {
  const error = new APIConnectionError({ message });
  if (isRetryableX509TransportFailure(failure)) {
    markTransientX509ConnectionError(error);
  }
  return error;
}

/** Parameters for one certificate-authenticated OAuth exchange. */
export interface X509TokenExchangeOptions {
  /** Frozen, caller-owned certificate transport shared with the eventual API request. */
  transport: X509Transport;

  /** Identity provider enrolled for the workload certificate. */
  identityProviderId: string;

  /** OpenAI service account selected for the verified certificate identity. */
  serviceAccountId: string;

  /** Optional caller cancellation propagated through request and response consumption. */
  signal?: AbortSignal | undefined;
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason?: unknown,
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // Response retirement is best-effort and must never replace the sanitized exchange result.
  }
}

function cancelResponseBody(response: Response): void {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  try {
    void cancelReader(reader);
  } finally {
    reader.releaseLock();
  }
}

async function readResponseBody(response: Response, signal?: AbortSignal): Promise<unknown> {
  if (!response.body) {
    throw new OpenAIError('X.509 workload identity token exchange returned invalid JSON.');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const cancel = () => {
    void cancelReader(reader, signal?.reason);
  };
  signal?.addEventListener('abort', cancel, { once: true });

  try {
    while (true) {
      signal?.throwIfAborted();
      // oxlint-disable-next-line no-await-in-loop -- Token-response chunks must be consumed in wire order.
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) {
        break;
      }
      chunks.push(chunk.value);
      totalBytes += chunk.value.byteLength;
    }
  } catch (error) {
    cancel();
    if (signal?.aborted) {
      signal.throwIfAborted();
    }
    throw transientConnectionError('X.509 workload identity token response could not be read.', error);
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new OpenAIError('X.509 workload identity token exchange returned invalid JSON.');
  }
}

function validateTokenResponse(value: unknown): X509ExchangedToken {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OpenAIError('X.509 workload identity token exchange returned an invalid token response.');
  }

  const response = value as Record<string, unknown>;
  if (
    !hasOwn(response, 'access_token') ||
    typeof response['access_token'] !== 'string' ||
    !SAFE_ACCESS_TOKEN.test(response['access_token'])
  ) {
    throw new OpenAIError('X.509 workload identity token exchange returned an invalid access token.');
  }
  if (!hasOwn(response, 'token_type') || !hasOwn(response, 'issued_token_type')) {
    throw new OpenAIError('X.509 workload identity token exchange returned an invalid token type.');
  }
  const tokenType = response['token_type'];
  if (
    typeof tokenType !== 'string' ||
    tokenType.toLowerCase() !== 'bearer' ||
    response['issued_token_type'] !== ACCESS_TOKEN_TYPE
  ) {
    throw new OpenAIError('X.509 workload identity token exchange returned an invalid token type.');
  }

  if (!hasOwn(response, 'expires_in')) {
    throw new OpenAIError('X.509 workload identity token exchange returned an invalid token lifetime.');
  }
  const expiresIn = response['expires_in'];
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 3600) {
    throw new OpenAIError('X.509 workload identity token exchange returned an invalid token lifetime.');
  }

  return { accessToken: response['access_token'], expiresIn };
}

function safeResponseHeaders(response: Response, includeRetryHints = false): Headers {
  const headers = new Headers();
  for (const name of SAFE_RESPONSE_HEADERS) {
    if (name !== 'x-request-id' && !includeRetryHints) {
      continue;
    }
    const value = response.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  return headers;
}

function readOAuthErrorCode(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && value !== null && hasOwn(value, 'code')) {
    const code: unknown = Object.getOwnPropertyDescriptor(value, 'code')?.value;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

async function oauthError(
  response: Response,
  signal?: AbortSignal,
  callerSignal?: AbortSignal,
): Promise<OAuthError> {
  let errorCode: { error: string } | undefined;

  try {
    const parsed = await readResponseBody(response, signal);
    if (typeof parsed === 'object' && parsed !== null && hasOwn(parsed, 'error')) {
      const code = readOAuthErrorCode(Object.getOwnPropertyDescriptor(parsed, 'error')?.value);
      if (code !== undefined && SAFE_OAUTH_ERRORS.has(code)) {
        errorCode = { error: code };
      }
    }
  } catch {
    callerSignal?.throwIfAborted();
    if (
      signal?.aborted &&
      !(signal.reason instanceof APIConnectionTimeoutError && isTransientX509ConnectionError(signal.reason))
    ) {
      signal.throwIfAborted();
    }
  }

  const { status } = response;
  if (status !== 400 && status !== 401 && status !== 403) {
    throw new OpenAIError('X.509 workload identity received an invalid OAuth error status.');
  }
  const headers = safeResponseHeaders(response);
  const error = new OAuthError(status, errorCode, headers);
  rememberX509OAuthError(error, { status, error: errorCode, headers });
  return error;
}

/** Exchanges one enrolled client certificate for a validated OpenAI workload access token. */
export async function exchangeX509Token(options: X509TokenExchangeOptions): Promise<X509ExchangedToken> {
  const { signal: callerSignal } = options;
  callerSignal?.throwIfAborted();
  const { identityProviderId, serviceAccountId, transport } = options;
  if (
    typeof identityProviderId !== 'string' ||
    identityProviderId.trim().length === 0 ||
    typeof serviceAccountId !== 'string' ||
    serviceAccountId.trim().length === 0
  ) {
    throw new OpenAIError(
      'X.509 workload identity requires nonempty provider and service-account identifiers.',
    );
  }

  const timeoutController = new AbortController();
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutController.signal])
    : timeoutController.signal;
  const timeout = setTimeout(() => {
    const error = new APIConnectionTimeoutError({
      message: 'X.509 workload identity token exchange timed out.',
    });
    markTransientX509ConnectionError(error);
    timeoutController.abort(error);
  }, MAX_TOKEN_EXCHANGE_DURATION_MS);
  timeout.unref();

  try {
    const body = JSON.stringify({
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token_type: X509_SUBJECT_TOKEN,
      identity_provider_id: identityProviderId,
      service_account_id: serviceAccountId,
    });

    let response: Response;
    try {
      response = await sendX509Request(transport, TOKEN_EXCHANGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        redirect: 'manual',
        signal,
      });
    } catch (error) {
      signal.throwIfAborted();
      throw transientConnectionError('X.509 workload identity token exchange connection failed.', error);
    }
    signal.throwIfAborted();

    if (response.ok) {
      try {
        return validateTokenResponse(await readResponseBody(response, signal));
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof APIConnectionError) {
          throw error;
        }
        if (error instanceof OpenAIError) {
          throw APIError.generate(response.status, undefined, error.message, safeResponseHeaders(response));
        }
        throw error;
      }
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw await oauthError(response, signal, callerSignal);
    }

    cancelResponseBody(response);
    const retryableStatus =
      response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
    const headers = safeResponseHeaders(response, retryableStatus);
    const error = APIError.generate(
      response.status,
      undefined,
      'X.509 workload identity token exchange failed.',
      headers,
    );
    if (retryableStatus && headers.get('x-should-retry') !== 'false') {
      markRetryableX509IssuerError(error);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
