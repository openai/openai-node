// File generated from our OpenAPI spec by Stainless.

import { fileFromPath } from 'formdata-node/file-from-path';
import OpenAI from '~/index';

const openAI = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010' });

describe('resource files', () => {
  // Prism tests are broken
  test.skip('create: only required params', async () => {
    const response = await openAI.files.create({ file: await fileFromPath('README.md'), purpose: 'string' });
  });

  // Prism tests are broken
  test.skip('create: required and optional params', async () => {
    const response = await openAI.files.create({ file: await fileFromPath('README.md'), purpose: 'string' });
  });

  test('retrieve', async () => {
    const response = await openAI.files.retrieve('string');
  });

  test('retrieve: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(openAI.files.retrieve('string', { path: '/_stainless_unknown_path' })).rejects.toThrow(
      OpenAI.NotFoundError,
    );
  });

  test('list', async () => {
    const response = await openAI.files.list();
  });

  test('list: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(openAI.files.list({ path: '/_stainless_unknown_path' })).rejects.toThrow(
      OpenAI.NotFoundError,
    );
  });

  test('del', async () => {
    const response = await openAI.files.del('string');
  });

  test('del: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(openAI.files.del('string', { path: '/_stainless_unknown_path' })).rejects.toThrow(
      OpenAI.NotFoundError,
    );
  });

  // Prism tests are broken
  test.skip('retrieveFileContent', async () => {
    const response = await openAI.files.retrieveFileContent('string');
  });

  // Prism tests are broken
  test.skip('retrieveFileContent: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      openAI.files.retrieveFileContent('string', { path: '/_stainless_unknown_path' }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });
});
