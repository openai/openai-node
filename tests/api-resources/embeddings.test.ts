// File generated from our OpenAPI spec by Stainless.

import OpenAI from '~/index';

const openAI = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010' });

describe('resource embeddings', () => {
  test('create: only required params', async () => {
    const response = await openAI.embeddings.create({
      input: 'The quick brown fox jumped over the lazy dog',
      model: 'string',
    });
  });

  test('create: required and optional params', async () => {
    const response = await openAI.embeddings.create({
      input: 'The quick brown fox jumped over the lazy dog',
      model: 'string',
      user: 'user-1234',
    });
  });
});
