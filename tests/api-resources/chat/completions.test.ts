// File generated from our OpenAPI spec by Stainless.

import OpenAI from 'openai';
import { Response } from 'node-fetch';

const openai = new OpenAI({
  apiKey: 'something1234',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource completions', () => {
  test('create: only required params', async () => {
    const responsePromise = openai.chat.completions.create({
      messages: [{ role: 'system', content: 'string' }],
      model: 'gpt-3.5-turbo',
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
      messages: [
        {
          role: 'system',
          content: 'string',
          name: 'string',
          function_call: { name: 'string', arguments: 'string' },
        },
      ],
      model: 'gpt-3.5-turbo',
      frequency_penalty: -2,
      function_call: 'none',
      functions: [{ name: 'string', description: 'string', parameters: { foo: 'bar' } }],
      logit_bias: { foo: 0 },
      max_tokens: 0,
      n: 1,
      presence_penalty: -2,
      stop: 'string',
      stream: false,
      temperature: 1,
      top_p: 1,
      user: 'user-1234',
    });
  });
});
