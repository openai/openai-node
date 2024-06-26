// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';
import { Response } from 'undici';

const openai = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource messages', () => {
  test('create: only required params', async () => {
    const responsePromise = openai.beta.threads.messages.create('string', {
      content: 'string',
      role: 'user',
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('create: required and optional params', async () => {
    const response = await openai.beta.threads.messages.create('string', {
      content: 'string',
      role: 'user',
      attachments: [
        {
          file_id: 'string',
          tools: [{ type: 'code_interpreter' }, { type: 'code_interpreter' }, { type: 'code_interpreter' }],
        },
        {
          file_id: 'string',
          tools: [{ type: 'code_interpreter' }, { type: 'code_interpreter' }, { type: 'code_interpreter' }],
        },
        {
          file_id: 'string',
          tools: [{ type: 'code_interpreter' }, { type: 'code_interpreter' }, { type: 'code_interpreter' }],
        },
      ],
      metadata: {},
    });
  });

  test('retrieve: only required params', async () => {
    const responsePromise = openai.beta.threads.messages.retrieve('string', { thread_id: 'string' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('retrieve: required and optional params', async () => {
    const response = await openai.beta.threads.messages.retrieve('string', { thread_id: 'string' });
  });

  test('update: only required params', async () => {
    const responsePromise = openai.beta.threads.messages.update('string', { thread_id: 'string' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('update: required and optional params', async () => {
    const response = await openai.beta.threads.messages.update('string', {
      thread_id: 'string',
      metadata: {},
    });
  });

  test('list', async () => {
    const responsePromise = openai.beta.threads.messages.list('string');
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
      openai.beta.threads.messages.list(
        'string',
        { after: 'string', before: 'string', limit: 0, order: 'asc', run_id: 'string' },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('delete: only required params', async () => {
    const responsePromise = openai.beta.threads.messages.delete('string', { thread_id: 'string' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('delete: required and optional params', async () => {
    const response = await openai.beta.threads.messages.delete('string', { thread_id: 'string' });
  });
});
