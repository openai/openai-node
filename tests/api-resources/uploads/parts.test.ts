// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI, { toFile } from 'openai';
import { Response } from 'node-fetch';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource parts', () => {
  test('create: only required params', async () => {
    const responsePromise = client.uploads.parts.create('upload_abc123', {
      data: await toFile(Buffer.from('# my file contents'), 'README.md'),
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
    const response = await client.uploads.parts.create('upload_abc123', {
      data: await toFile(Buffer.from('# my file contents'), 'README.md'),
    });
  });
});
