import { APIError, BadRequestError, UnprocessableEntityError } from 'openai/core/error';

describe('APIError.generate', () => {
  const headers = new Headers({ 'x-request-id': 'req_123' });

  test('extracts error from standard OpenAI error response', () => {
    const err = APIError.generate(
      422,
      { error: { message: 'Invalid model', type: 'invalid_request_error', code: 'model_not_found' } },
      undefined,
      headers,
    );
    expect(err).toBeInstanceOf(UnprocessableEntityError);
    expect(err.message).toContain('Invalid model');
    expect(err.code).toBe('model_not_found');
    expect(err.type).toBe('invalid_request_error');
  });

  test('falls back to entire response body when "error" field is missing', () => {
    const err = APIError.generate(
      422,
      { detail: '422: The model gpt-5-gibberish does not exist.' },
      undefined,
      headers,
    );
    expect(err).toBeInstanceOf(UnprocessableEntityError);
    expect(err.message).not.toContain('(no body)');
    expect(err.message).toContain('gpt-5-gibberish');
  });

  test('falls back to response body with message field (non-standard)', () => {
    const err = APIError.generate(
      400,
      { message: 'Something went wrong', code: 'bad_request' },
      undefined,
      headers,
    );
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.message).toContain('Something went wrong');
  });

  test('still shows "(no body)" when response is truly empty', () => {
    const err = APIError.generate(422, undefined, undefined, headers);
    expect(err.message).toContain('(no body)');
  });

  test('uses errMessage string fallback when JSON parsing fails', () => {
    const err = APIError.generate(422, undefined, 'raw error text', headers);
    expect(err.message).toContain('raw error text');
  });
});
