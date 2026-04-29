// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
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

  test('uploadAndPoll passes options through to batch creation and polling', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const batch = {
      id: 'vsfb_abc123',
      object: 'vector_store.files_batch',
      created_at: 0,
      vector_store_id: 'vs_abc123',
      status: 'completed',
      file_counts: { in_progress: 0, completed: 1, failed: 0, cancelled: 0, total: 1 },
    };
    const testClient = new OpenAI({
      apiKey: 'My API Key',
      baseURL: 'http://127.0.0.1:4010',
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        const pathname = new URL(String(url)).pathname;
        const body =
          pathname === '/files' ?
            {
              id: 'file_abc123',
              object: 'file',
              bytes: 0,
              created_at: 0,
              filename: 'README.md',
              purpose: 'assistants',
            }
          : batch;

        return new Response(JSON.stringify(body), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    const response = await testClient.vectorStores.fileBatches.uploadAndPoll(
      'vs_abc123',
      { files: [new File(['Example data'], 'README.md')] },
      { pollIntervalMs: 1, headers: { 'X-Test-Header': 'present' } },
    );

    const apiRequests = requests.filter(({ url }) => url.startsWith('http://127.0.0.1'));

    expect(response.id).toBe('vsfb_abc123');
    expect(apiRequests.map(({ url }) => new URL(url).pathname)).toEqual([
      '/files',
      '/vector_stores/vs_abc123/file_batches',
      '/vector_stores/vs_abc123/file_batches/vsfb_abc123',
    ]);
    expect(new Headers(apiRequests[1]?.init?.headers).get('x-test-header')).toBe('present');
    expect(new Headers(apiRequests[2]?.init?.headers).get('x-test-header')).toBe('present');
    expect(new Headers(apiRequests[2]?.init?.headers).get('x-stainless-custom-poll-interval')).toBe('1');
  });
});
