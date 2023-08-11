// File generated from our OpenAPI spec by Stainless.

import OpenAI from 'openai';
import { Response } from 'node-fetch';

const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010' });

describe('resource moderations', () => {
  test('create: only required params', async () => {
    const responsePromise = openai.moderations.create({ input: 'I want to kill them.' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('create: required and optional params', async () => {
    const response = await openai.moderations.create({
      input: 'I want to kill them.',
      model: 'text-moderation-stable',
    });
  });
});
