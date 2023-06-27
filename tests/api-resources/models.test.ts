// File generated from our OpenAPI spec by Stainless.

import OpenAI from '~/index';

const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010' });

describe('resource models', () => {
  test('retrieve', async () => {
    const response = await openai.models.retrieve('text-davinci-001');
  });

  test('retrieve: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      openai.models.retrieve('text-davinci-001', { path: '/_stainless_unknown_path' }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('list', async () => {
    const response = await openai.models.list();
  });

  test('list: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(openai.models.list({ path: '/_stainless_unknown_path' })).rejects.toThrow(
      OpenAI.NotFoundError,
    );
  });

  test('del', async () => {
    const response = await openai.models.del('curie:ft-acmeco-2021-03-03-21-44-20');
  });

  test('del: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      openai.models.del('curie:ft-acmeco-2021-03-03-21-44-20', { path: '/_stainless_unknown_path' }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });
});
