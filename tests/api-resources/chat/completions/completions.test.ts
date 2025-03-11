// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';
import { Response } from 'node-fetch';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource completions', () => {
  test('create: only required params', async () => {
    const responsePromise = client.chat.completions.create({
      messages: [{ content: 'string', role: 'developer' }],
      model: 'gpt-4o',
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
    const response = await client.chat.completions.create({
      messages: [{ content: 'string', role: 'developer', name: 'name' }],
      model: 'gpt-4o',
      audio: { format: 'wav', voice: 'alloy' },
      frequency_penalty: -2,
      function_call: 'none',
      functions: [{ name: 'name', description: 'description', parameters: { foo: 'bar' } }],
      logit_bias: { foo: 0 },
      logprobs: true,
      max_completion_tokens: 0,
      max_tokens: 0,
      metadata: { foo: 'string' },
      modalities: ['text'],
      n: 1,
      parallel_tool_calls: true,
      prediction: { content: 'string', type: 'content' },
      presence_penalty: -2,
      reasoning_effort: 'low',
      response_format: { type: 'text' },
      seed: -9007199254740991,
      service_tier: 'auto',
      stop: '\n',
      store: true,
      stream: false,
      stream_options: { include_usage: true },
      temperature: 1,
      tool_choice: 'none',
      tools: [
        {
          function: { name: 'name', description: 'description', parameters: { foo: 'bar' }, strict: true },
          type: 'function',
        },
      ],
      top_logprobs: 0,
      top_p: 1,
      user: 'user-1234',
      web_search_options: {
        search_context_size: 'low',
        user_location: {
          approximate: { city: 'city', country: 'country', region: 'region', timezone: 'timezone' },
          type: 'approximate',
        },
      },
    });
  });

  test('retrieve', async () => {
    const responsePromise = client.chat.completions.retrieve('completion_id');
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
      client.chat.completions.retrieve('completion_id', { path: '/_stainless_unknown_path' }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('update: only required params', async () => {
    const responsePromise = client.chat.completions.update('completion_id', { metadata: { foo: 'string' } });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('update: required and optional params', async () => {
    const response = await client.chat.completions.update('completion_id', { metadata: { foo: 'string' } });
  });

  test('list', async () => {
    const responsePromise = client.chat.completions.list();
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
    await expect(client.chat.completions.list({ path: '/_stainless_unknown_path' })).rejects.toThrow(
      OpenAI.NotFoundError,
    );
  });

  test('list: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.chat.completions.list(
        { after: 'after', limit: 0, metadata: { foo: 'string' }, model: 'model', order: 'asc' },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('del', async () => {
    const responsePromise = client.chat.completions.del('completion_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('del: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.chat.completions.del('completion_id', { path: '/_stainless_unknown_path' }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });
});
