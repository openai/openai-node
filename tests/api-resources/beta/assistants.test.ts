// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';
import { Response } from 'undici';

const openai = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource assistants', () => {
  test('create: only required params', async () => {
    const responsePromise = openai.beta.assistants.create({ model: 'gpt-4-turbo' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('create: required and optional params', async () => {
    const response = await openai.beta.assistants.create({
      model: 'gpt-4-turbo',
      description: 'string',
      instructions: 'string',
      metadata: {},
      name: 'string',
      response_format: 'none',
      temperature: 1,
      tool_resources: {
        code_interpreter: { file_ids: ['string', 'string', 'string'] },
        file_search: {
          vector_store_ids: ['string'],
          vector_stores: [
            { file_ids: ['string', 'string', 'string'], chunking_strategy: { type: 'auto' }, metadata: {} },
          ],
        },
      },
      tools: [{ type: 'code_interpreter' }, { type: 'code_interpreter' }, { type: 'code_interpreter' }],
      top_p: 1,
    });
  });

  test('retrieve', async () => {
    const responsePromise = openai.beta.assistants.retrieve('string');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('update', async () => {
    const responsePromise = openai.beta.assistants.update('string', {});
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('list', async () => {
    const responsePromise = openai.beta.assistants.list();
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('list: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      openai.beta.assistants.list(
        { after: 'string', before: 'string', limit: 0, order: 'asc' },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('delete', async () => {
    const responsePromise = openai.beta.assistants.delete('string');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });
});
