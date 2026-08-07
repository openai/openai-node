import { APIError, UnprocessableEntityError } from 'openai/error';

describe('APIError.generate()', () => {
  test('falls back to the full response body when the error field is absent', () => {
    const body = { detail: '422: The model gpt-5-gibberish does not exist.' };
    const error = APIError.generate(422, body, undefined, new Headers());

    expect(error).toBeInstanceOf(UnprocessableEntityError);
    expect(error.error).toEqual(body);
    expect(error.message).toBe(`422 ${JSON.stringify(body)}`);
  });

  test('continues to prefer the nested error object when present', () => {
    const nested = {
      message: 'The model `gpt-5-gibberish` does not exist.',
      type: 'invalid_request_error',
      code: 'model_not_found',
    };
    const error = APIError.generate(422, { error: nested }, undefined, new Headers());

    expect(error.error).toEqual(nested);
    expect(error.message).toBe(`422 ${nested.message}`);
    expect(error.type).toBe(nested.type);
    expect(error.code).toBe(nested.code);
  });
});
