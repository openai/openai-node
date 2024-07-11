// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';
import { Response } from 'node-fetch';

const openai = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource fileBatches', () => {
  test('create: only required params', async () => {
    const responsePromise = openai.beta.vectorStores.fileBatches.create('vs_abc123', {
      file_ids: ['string'],
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
    const response = await openai.beta.vectorStores.fileBatches.create('vs_abc123', {
      file_ids: ['string'],
      chunking_strategy: { type: 'auto' },
    });
  });

  test('retrieve', async () => {
    const responsePromise = openai.beta.vectorStores.fileBatches.retrieve('vs_abc123', 'vsfb_abc123');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('retrieve: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      openai.beta.vectorStores.fileBatches.retrieve('vs_abc123', 'vsfb_abc123', {
        path: '/_stainless_unknown_path',
      }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('cancel', async () => {
    const responsePromise = openai.beta.vectorStores.fileBatches.cancel('vector_store_id', 'batch_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('cancel: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      openai.beta.vectorStores.fileBatches.cancel('vector_store_id', 'batch_id', {
        path: '/_stainless_unknown_path',
      }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('listFiles', async () => {
    const responsePromise = openai.beta.vectorStores.fileBatches.listFiles('vector_store_id', 'batch_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('listFiles: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      openai.beta.vectorStores.fileBatches.listFiles('vector_store_id', 'batch_id', {
        path: '/_stainless_unknown_path',
      }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('listFiles: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      openai.beta.vectorStores.fileBatches.listFiles(
        'vector_store_id',
        'batch_id',
        { after: 'after', before: 'before', filter: 'in_progress', limit: 0, order: 'asc' },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });
});
