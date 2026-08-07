// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI, { toFile } from 'openai';
import { mockFetch } from '../../utils/mock-fetch';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource fileBatches', () => {
  test('create', async () => {
    const responsePromise = client.vectorStores.fileBatches.create('vs_abc123', {});
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('retrieve: only required params', async () => {
    const responsePromise = client.vectorStores.fileBatches.retrieve('vsfb_abc123', {
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
    const response = await client.vectorStores.fileBatches.retrieve('vsfb_abc123', {
      vector_store_id: 'vs_abc123',
    });
  });

  test('cancel: only required params', async () => {
    const responsePromise = client.vectorStores.fileBatches.cancel('batch_id', {
      vector_store_id: 'vector_store_id',
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
    const response = await client.vectorStores.fileBatches.cancel('batch_id', {
      vector_store_id: 'vector_store_id',
    });
  });

  test('listFiles: only required params', async () => {
    const responsePromise = client.vectorStores.fileBatches.listFiles('batch_id', {
      vector_store_id: 'vector_store_id',
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
    const response = await client.vectorStores.fileBatches.listFiles('batch_id', {
      vector_store_id: 'vector_store_id',
      after: 'after',
      before: 'before',
      filter: 'in_progress',
      limit: 0,
      order: 'asc',
    });
  });

  test('uploadAndPoll returns the completed file batch', async () => {
    const { fetch, handleRequest } = mockFetch();
    const client = new OpenAI({ apiKey: 'My API Key', fetch });

    const responsePromise = client.vectorStores.fileBatches.uploadAndPoll(
      'vs_abc123',
      { files: [await toFile(Buffer.from('Example data'), 'README.md')] },
      { pollIntervalMs: 1 },
    );

    await handleRequest(async (req) => {
      expect(req.toString()).toBe('data:,');
      return new Response();
    });

    await handleRequest(async (req) => {
      expect(req.toString()).toContain('/files');
      return new Response(JSON.stringify({ id: 'file_abc123', object: 'file' }), {
        headers: { 'content-type': 'application/json' },
      });
    });

    await handleRequest(async (req) => {
      expect(req.toString()).toContain('/vector_stores/vs_abc123/file_batches');
      return new Response(
        JSON.stringify({
          id: 'vsfb_abc123',
          object: 'vector_store.files_batch',
          created_at: 0,
          file_counts: { cancelled: 0, completed: 0, failed: 0, in_progress: 1, total: 1 },
          status: 'in_progress',
          vector_store_id: 'vs_abc123',
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });

    await handleRequest(async (req) => {
      expect(req.toString()).toContain('/vector_stores/vs_abc123/file_batches/vsfb_abc123');
      return new Response(
        JSON.stringify({
          id: 'vsfb_abc123',
          object: 'vector_store.files_batch',
          created_at: 0,
          file_counts: { cancelled: 0, completed: 1, failed: 0, in_progress: 0, total: 1 },
          status: 'completed',
          vector_store_id: 'vs_abc123',
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });

    const response = await responsePromise;
    expect(response.id).toBe('vsfb_abc123');
    expect(response.object).toBe('vector_store.files_batch');
  });
});
