// File generated from our OpenAPI spec by Stainless.

import OpenAI from '~/index';

const openAI = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010' });

describe('resource classifications', () => {
  test('create: only required params', async () => {
    const response = await openAI.classifications.create({
      model: 'string',
      query: 'The plot is not very attractive.',
    });
  });

  test('create: required and optional params', async () => {
    const response = await openAI.classifications.create({
      model: 'string',
      query: 'The plot is not very attractive.',
      examples: [
        ['x', 'x'],
        ['x', 'x'],
      ],
      expand: [{}, {}, {}],
      file: 'string',
      labels: ['string', 'string'],
      logit_bias: {},
      logprobs: 0,
      max_examples: 0,
      return_metadata: true,
      return_prompt: true,
      search_model: 'string',
      temperature: 0,
      user: 'user-1234',
    });
  });
});
