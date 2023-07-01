// File generated from our OpenAPI spec by Stainless.

import OpenAI, { toFile } from 'openai';

const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010' });

describe('resource images', () => {
  // Prism doesn't support multipart/form-data
  test.skip('createVariation: only required params', async () => {
    const response = await openai.images.createVariation({
      image: await toFile(Buffer.from('# my file contents'), 'README.md'),
    });
  });

  // Prism doesn't support multipart/form-data
  test.skip('createVariation: required and optional params', async () => {
    const response = await openai.images.createVariation({
      image: await toFile(Buffer.from('# my file contents'), 'README.md'),
      n: 1,
      response_format: 'url',
      size: '1024x1024',
      user: 'user-1234',
    });
  });

  // Prism doesn't support multipart/form-data
  test.skip('edit: only required params', async () => {
    const response = await openai.images.edit({
      image: await toFile(Buffer.from('# my file contents'), 'README.md'),
      prompt: 'A cute baby sea otter wearing a beret',
    });
  });

  // Prism doesn't support multipart/form-data
  test.skip('edit: required and optional params', async () => {
    const response = await openai.images.edit({
      image: await toFile(Buffer.from('# my file contents'), 'README.md'),
      prompt: 'A cute baby sea otter wearing a beret',
      mask: await toFile(Buffer.from('# my file contents'), 'README.md'),
      n: 1,
      response_format: 'url',
      size: '1024x1024',
      user: 'user-1234',
    });
  });

  // Prism doesn't support multipart/form-data
  test.skip('generate: only required params', async () => {
    const response = await openai.images.generate({ prompt: 'A cute baby sea otter' });
  });

  // Prism doesn't support multipart/form-data
  test.skip('generate: required and optional params', async () => {
    const response = await openai.images.generate({
      prompt: 'A cute baby sea otter',
      n: 1,
      response_format: 'url',
      size: '1024x1024',
      user: 'user-1234',
    });
  });
});
