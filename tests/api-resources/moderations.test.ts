// File generated from our OpenAPI spec by Stainless.

import OpenAI from '~/index';

const openAI = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010' });

describe('resource moderations', () => {
  test('create: only required params', async () => {
    const response = await openAI.moderations.create({ input: 'I want to kill them.' });
  });

  test('create: required and optional params', async () => {
    const response = await openAI.moderations.create({
      input: 'I want to kill them.',
      model: 'text-moderation-stable',
    });
  });
});
