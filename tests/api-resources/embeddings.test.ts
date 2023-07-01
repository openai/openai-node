// File generated from our OpenAPI spec by Stainless.

import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010' });

describe('resource embeddings', () => {
  test('create: only required params', async () => {
    const response = await openai.embeddings.create({
      input: 'The quick brown fox jumped over the lazy dog',
      model: 'text-embedding-ada-002',
    });
  });

  test('create: required and optional params', async () => {
    const response = await openai.embeddings.create({
      input: 'The quick brown fox jumped over the lazy dog',
      model: 'text-embedding-ada-002',
      user: 'user-1234',
    });
  });
});
