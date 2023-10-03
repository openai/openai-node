// File generated from our OpenAPI spec by Stainless.

import OpenAI from 'openai';
import { Response } from 'node-fetch';

const openai = new OpenAI({
  apiKey: 'something1234',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource edits', () => {
  test('create: only required params', async () => {
    const responsePromise = openai.edits.create({
      instruction: 'Fix the spelling mistakes.',
      model: 'text-davinci-edit-001',
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
    const response = await openai.edits.create({
      instruction: 'Fix the spelling mistakes.',
      model: 'text-davinci-edit-001',
      input: 'What day of the wek is it?',
      n: 1,
      temperature: 1,
      top_p: 1,
    });
  });
});
