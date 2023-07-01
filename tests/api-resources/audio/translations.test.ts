// File generated from our OpenAPI spec by Stainless.

import OpenAI, { toFile } from 'openai';

const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010' });

describe('resource translations', () => {
  // Prism doesn't support multipart/form-data
  test.skip('create: only required params', async () => {
    const response = await openai.audio.translations.create({
      file: await toFile(Buffer.from('# my file contents'), 'README.md'),
      model: 'whisper-1',
    });
  });

  // Prism doesn't support multipart/form-data
  test.skip('create: required and optional params', async () => {
    const response = await openai.audio.translations.create({
      file: await toFile(Buffer.from('# my file contents'), 'README.md'),
      model: 'whisper-1',
      prompt: 'string',
      response_format: 'string',
      temperature: 0,
    });
  });
});
