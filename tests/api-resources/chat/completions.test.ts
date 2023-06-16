// File generated from our OpenAPI spec by Stainless.

import OpenAI from '~/index';

const openAI = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010' });

describe('resource completions', () => {
  test('create: only required params', async () => {
    const response = await openAI.chat.completions.create({
      messages: [{ role: 'system' }],
      model: 'string',
    });
  });

  test('create: required and optional params', async () => {
    const response = await openAI.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'string',
          name: 'string',
          function_call: { name: 'string', arguments: 'string' },
        },
      ],
      model: 'string',
      frequency_penalty: -2,
      function_call: 'none',
      functions: [{ name: 'string', description: 'string', parameters: { foo: 'bar' } }],
      logit_bias: {},
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
