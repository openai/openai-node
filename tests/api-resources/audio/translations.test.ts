// File generated from our OpenAPI spec by Stainless.

import { fileFromPath } from 'formdata-node/file-from-path';
import OpenAI from '~/index';

const openAI = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010' });

describe('resource translations', () => {
  // Prism choked, idk
  test.skip('create: only required params', async () => {
    const response = await openAI.audio.translations.create({
      file: await fileFromPath('README.md'),
      model: 'string',
    });
  });

  // Prism choked, idk
  test.skip('create: required and optional params', async () => {
    const response = await openAI.audio.translations.create({
      file: await fileFromPath('README.md'),
      model: 'string',
      prompt: 'string',
      response_format: 'string',
      temperature: 0,
    });
  });
});
