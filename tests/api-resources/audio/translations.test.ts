// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI, { toFile } from 'openai';
import { Response } from 'node-fetch';

const openai = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource translations', () => {
  test('create: only required params', async () => {
    const responsePromise = openai.audio.translations.create({
      file: await toFile(Buffer.from('# my file contents'), 'README.md'),
      model: 'whisper-1',
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
    const response = await openai.audio.translations.create({
      file: await toFile(Buffer.from('# my file contents'), 'README.md'),
      model: 'whisper-1',
      prompt: 'prompt',
      response_format: 'response_format',
      temperature: 0,
    });
  });
});
