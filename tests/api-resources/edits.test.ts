// File generated from our OpenAPI spec by Stainless.

import OpenAI from '~/index';

const openAI = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010' });

describe('resource edits', () => {
  test('create: only required params', async () => {
    const response = await openAI.edits.create({
      instruction: 'Fix the spelling mistakes.',
      model: 'string',
    });
  });

  test('create: required and optional params', async () => {
    const response = await openAI.edits.create({
      instruction: 'Fix the spelling mistakes.',
      model: 'string',
      input: 'What day of the wek is it?',
      n: 1,
      temperature: 1,
      top_p: 1,
    });
  });
});
