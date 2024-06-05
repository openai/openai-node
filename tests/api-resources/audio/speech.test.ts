// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource speech', () => {
  // binary tests are currently broken
  test.skip('create: required and optional params', async () => {
    const response = await openai.audio.speech.create({
      input: 'string',
      model: 'tts-1',
      voice: 'alloy',
      response_format: 'mp3',
      speed: 0.25,
    });
  });
});
