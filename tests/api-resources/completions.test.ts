// File generated from our OpenAPI spec by Stainless.

import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010' });

describe('resource completions', () => {
  test('create: only required params', async () => {
    const response = await openai.completions.create({ model: 'string', prompt: 'This is a test.' });
  });

  test('create: required and optional params', async () => {
    const response = await openai.completions.create({
      model: 'string',
      prompt: 'This is a test.',
      best_of: 0,
      echo: true,
      frequency_penalty: -2,
      logit_bias: { foo: 0 },
      logprobs: 0,
      max_tokens: 16,
      n: 1,
      presence_penalty: -2,
      stop: '\n',
      stream: false,
      suffix: 'test.',
      temperature: 1,
      top_p: 1,
      user: 'user-1234',
    });
  });
});
