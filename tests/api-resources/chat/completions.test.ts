// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';
import { Response } from 'node-fetch';

const openai = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource completions', () => {
  test('create: only required params', async () => {
    const responsePromise = openai.chat.completions.create({
      messages: [{ content: 'string', role: 'system' }],
      model: 'gpt-4-turbo',
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
    const response = await openai.chat.completions.create({
      messages: [{ content: 'string', role: 'system', name: 'string' }],
      model: 'gpt-4-turbo',
      frequency_penalty: -2,
      function_call: 'none',
      functions: [{ description: 'string', name: 'string', parameters: { foo: 'bar' } }],
      logit_bias: { foo: 0 },
      logprobs: true,
      max_tokens: 0,
      n: 1,
      presence_penalty: -2,
      response_format: { type: 'json_object' },
      seed: -9223372036854776000,
      stop: 'string',
      stream: false,
      stream_options: { include_usage: true },
      temperature: 1,
      tool_choice: 'none',
      tools: [
        { type: 'function', function: { description: 'string', name: 'string', parameters: { foo: 'bar' } } },
        { type: 'function', function: { description: 'string', name: 'string', parameters: { foo: 'bar' } } },
        { type: 'function', function: { description: 'string', name: 'string', parameters: { foo: 'bar' } } },
      ],
      top_logprobs: 0,
      top_p: 1,
      user: 'user-1234',
    });
  });
});
