// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';
import { Response } from 'node-fetch';

const openai = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource steps', () => {
  test('retrieve', async () => {
    const responsePromise = openai.beta.threads.runs.steps.retrieve('string', 'string', 'string');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('retrieve: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      openai.beta.threads.runs.steps.retrieve('string', 'string', 'string', {
        path: '/_stainless_unknown_path',
      }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('list', async () => {
    const responsePromise = openai.beta.threads.runs.steps.list('string', 'string');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('list: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      openai.beta.threads.runs.steps.list('string', 'string', { path: '/_stainless_unknown_path' }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('list: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      openai.beta.threads.runs.steps.list(
        'string',
        'string',
        { after: 'string', before: 'string', limit: 0, order: 'asc' },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });
});
