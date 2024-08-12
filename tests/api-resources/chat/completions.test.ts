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
      messages: [{ content: 'string', role: 'system' }],
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
      messages: [{ content: 'string', role: 'system', name: 'name' }],
      model: 'gpt-4o',
      frequency_penalty: -2,
      function_call: 'none',
      functions: [{ name: 'name', description: 'description', parameters: { foo: 'bar' } }],
      logit_bias: { foo: 0 },
      logprobs: true,
      max_tokens: 0,
      n: 1,
      parallel_tool_calls: true,
      presence_penalty: -2,
      response_format: { type: 'text' },
      seed: -9007199254740991,
      service_tier: 'auto',
      stop: 'string',
      stream: false,
      stream_options: { include_usage: true },
      temperature: 1,
      tool_choice: 'none',
      tools: [
        {
          function: { name: 'name', description: 'description', parameters: { foo: 'bar' }, strict: true },
          type: 'function',
        },
        {
          function: { name: 'name', description: 'description', parameters: { foo: 'bar' }, strict: true },
          type: 'function',
        },
        {
          function: { name: 'name', description: 'description', parameters: { foo: 'bar' }, strict: true },
          type: 'function',
        },
      ],
      top_logprobs: 0,
      top_p: 1,
      user: 'user-1234',
    });
  });
});
