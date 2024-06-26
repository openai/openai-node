// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';
import { Response } from 'undici';

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

  test('retrieve: only required params', async () => {
    const responsePromise = openai.beta.vectorStores.fileBatches.retrieve('vsfb_abc123', {
      vector_store_id: 'vs_abc123',
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('retrieve: required and optional params', async () => {
    const response = await openai.beta.vectorStores.fileBatches.retrieve('vsfb_abc123', {
      vector_store_id: 'vs_abc123',
    });
  });

  test('cancel: only required params', async () => {
    const responsePromise = openai.beta.vectorStores.fileBatches.cancel('string', {
      vector_store_id: 'string',
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('cancel: required and optional params', async () => {
    const response = await openai.beta.vectorStores.fileBatches.cancel('string', {
      vector_store_id: 'string',
    });
  });

  test('listFiles: only required params', async () => {
    const responsePromise = openai.beta.vectorStores.fileBatches.listFiles('string', {
      vector_store_id: 'string',
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('listFiles: required and optional params', async () => {
    const response = await openai.beta.vectorStores.fileBatches.listFiles('string', {
      vector_store_id: 'string',
      after: 'string',
      before: 'string',
      filter: 'in_progress',
      limit: 0,
      order: 'asc',
    });
  });
});
