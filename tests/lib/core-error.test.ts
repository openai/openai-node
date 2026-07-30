import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  ContentFilterFinishReasonError,
  InternalServerError,
  InvalidWebhookSignatureError,
  LengthFinishReasonError,
  NotFoundError,
  OAuthError,
  OpenAIError,
  PermissionDeniedError,
  RateLimitError,
  SubjectTokenProviderError,
  UnprocessableEntityError,
} from 'openai/core/error';

describe('APIError', () => {
  const headers = new Headers({ 'x-request-id': 'req_123' });

  test.each([
    [400, BadRequestError],
    [401, AuthenticationError],
    [403, PermissionDeniedError],
    [404, NotFoundError],
    [409, ConflictError],
    [422, UnprocessableEntityError],
    [429, RateLimitError],
    [500, InternalServerError],
    [503, InternalServerError],
    [418, APIError],
  ] as const)('maps HTTP status %i to its typed error', (status, ExpectedError) => {
    const error = APIError.generate(
      status,
      { error: { message: 'request failed', code: 'bad_request', param: 'model', type: 'invalid_request' } },
      undefined,
      headers,
    );

    expect(error).toBeInstanceOf(ExpectedError);
    expect(error.status).toBe(status);
    expect(error.requestID).toBe('req_123');
    expect(error.code).toBe('bad_request');
    expect(error.param).toBe('model');
    expect(error.type).toBe('invalid_request');
    expect(error.message).toBe(`${status} request failed`);
  });

  test('classifies responses without a status or headers as connection errors', () => {
    const cause = new Error('socket closed');
    const withoutStatus = APIError.generate(undefined, cause, 'network unavailable', undefined);
    const withoutHeaders = APIError.generate(503, cause, 'network unavailable', undefined);

    expect(withoutStatus).toBeInstanceOf(APIConnectionError);
    expect(withoutStatus.message).toBe('network unavailable');
    expect(withoutStatus).toHaveProperty('cause', cause);
    expect(withoutHeaders).toBeInstanceOf(APIConnectionError);
  });

  test.each([
    [418, { message: { reason: 'structured' } }, undefined, '418 {"reason":"structured"}'],
    [418, { reason: 'body only' }, undefined, '418 {"reason":"body only"}'],
    [418, undefined, undefined, '418 status code (no body)'],
    [undefined, undefined, 'fallback', 'fallback'],
    [undefined, undefined, undefined, '(no status code or body)'],
  ] as const)('formats errors without assuming a string response body', (status, body, message, expected) => {
    expect(new APIError(status, body, message, headers).message).toBe(expected);
  });
});

describe('specialized SDK errors', () => {
  test('provides default and custom messages for aborts, connections, and timeouts', () => {
    expect(new APIUserAbortError().message).toBe('Request was aborted.');
    expect(new APIUserAbortError({ message: 'cancelled' }).message).toBe('cancelled');
    expect(new APIConnectionError({}).message).toBe('Connection error.');
    expect(new APIConnectionTimeoutError().message).toBe('Request timed out.');
    expect(new APIConnectionTimeoutError({ message: 'deadline exceeded' }).message).toBe('deadline exceeded');
  });

  test('preserves OAuth error metadata and falls back when the response is empty', () => {
    const headers = new Headers();
    const invalidClient = new OAuthError(
      401,
      { error: 'invalid_client', error_description: 'bad client' },
      headers,
    );
    const missingDetails = new OAuthError(400, undefined, headers);

    expect(invalidClient.error_code).toBe('invalid_client');
    expect(invalidClient.status).toBe(401);
    expect(missingDetails.error_code).toBeUndefined();
    expect(missingDetails.message).toBe('400 OAuth2 authentication error');
  });

  test('preserves subject-token provider details and their original cause', () => {
    const cause = new Error('metadata server unavailable');
    const error = new SubjectTokenProviderError('could not fetch a token', 'gcp', cause);

    expect(error).toBeInstanceOf(OpenAIError);
    expect(error.provider).toBe('gcp');
    expect(error.cause).toBe(cause);
  });

  test('describes completion finish and webhook signature errors', () => {
    expect(new LengthFinishReasonError().message).toContain('length limit');
    expect(new ContentFilterFinishReasonError().message).toContain('content filter');
    expect(new InvalidWebhookSignatureError('signature mismatch').message).toBe('signature mismatch');
  });
});
