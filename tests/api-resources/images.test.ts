// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI, { toFile } from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource images', () => {
  test('createVariation: only required params', async () => {
    const responsePromise = client.images.createVariation({
      image: await toFile(Buffer.from('# my file contents'), 'README.md'),
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('createVariation: required and optional params', async () => {
    const response = await client.images.createVariation({
      image: await toFile(Buffer.from('# my file contents'), 'README.md'),
      model: 'string',
      n: 1,
      response_format: 'url',
      size: '1024x1024',
      user: 'user-1234',
    });
  });

  test('edit: only required params', async () => {
    const responsePromise = client.images.edit({
      image: await toFile(Buffer.from('# my file contents'), 'README.md'),
      prompt: 'A cute baby sea otter wearing a beret',
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('edit: required and optional params', async () => {
    const response = await client.images.edit({
      image: await toFile(Buffer.from('# my file contents'), 'README.md'),
      prompt: 'A cute baby sea otter wearing a beret',
      background: 'transparent',
      input_fidelity: 'high',
      mask: await toFile(Buffer.from('# my file contents'), 'README.md'),
      model: 'string',
      n: 1,
      output_compression: 100,
      output_format: 'png',
      partial_images: 1,
      quality: 'high',
      response_format: 'url',
      size: '1024x1024',
      stream: false,
      user: 'user-1234',
    });
  });

  test('generate: only required params', async () => {
    const responsePromise = client.images.generate({ prompt: 'A cute baby sea otter' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('generate: required and optional params', async () => {
    const response = await client.images.generate({
      prompt: 'A cute baby sea otter',
      background: 'transparent',
      model: 'string',
      moderation: 'low',
      n: 1,
      output_compression: 100,
      output_format: 'png',
      partial_images: 1,
      quality: 'medium',
      response_format: 'url',
      size: '1024x1024',
      stream: false,
      style: 'vivid',
      user: 'user-1234',
    });
  });
});
