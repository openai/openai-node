// File generated from our OpenAPI spec by Stainless.

import { fileFromPath } from 'formdata-node/file-from-path';
import OpenAI from '~/index';

const openAI = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010' });

describe('resource images', () => {
  // Prism choked, idk
  test.skip('createVariation: only required params', async () => {
    const response = await openAI.images.createVariation({ image: await fileFromPath('README.md') });
  });

  // Prism choked, idk
  test.skip('createVariation: required and optional params', async () => {
    const response = await openAI.images.createVariation({
      image: await fileFromPath('README.md'),
      n: 1,
      response_format: 'url',
      size: '1024x1024',
      user: 'user-1234',
    });
  });

  // Prism choked, idk
  test.skip('edit: only required params', async () => {
    const response = await openAI.images.edit({
      image: await fileFromPath('README.md'),
      prompt: 'A cute baby sea otter wearing a beret',
    });
  });

  // Prism choked, idk
  test.skip('edit: required and optional params', async () => {
    const response = await openAI.images.edit({
      image: await fileFromPath('README.md'),
      prompt: 'A cute baby sea otter wearing a beret',
      mask: await fileFromPath('README.md'),
      n: 1,
      response_format: 'url',
      size: '1024x1024',
      user: 'user-1234',
    });
  });

  // Prism choked, idk
  test.skip('generate: only required params', async () => {
    const response = await openAI.images.generate({ prompt: 'A cute baby sea otter' });
  });

  // Prism choked, idk
  test.skip('generate: required and optional params', async () => {
    const response = await openAI.images.generate({
      prompt: 'A cute baby sea otter',
      n: 1,
      response_format: 'url',
      size: '1024x1024',
      user: 'user-1234',
    });
  });
});
