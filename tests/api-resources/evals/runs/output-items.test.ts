// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource outputItems', () => {
  test('retrieve: only required params', async () => {
    const responsePromise = client.evals.runs.outputItems.retrieve('output_item_id', {
      eval_id: 'eval_id',
      run_id: 'run_id',
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
    const response = await client.evals.runs.outputItems.retrieve('output_item_id', {
      eval_id: 'eval_id',
      run_id: 'run_id',
    });
  });

  test('list: only required params', async () => {
    const responsePromise = client.evals.runs.outputItems.list('run_id', { eval_id: 'eval_id' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('list: required and optional params', async () => {
    const response = await client.evals.runs.outputItems.list('run_id', {
      eval_id: 'eval_id',
      after: 'after',
      limit: 0,
      order: 'asc',
      status: 'fail',
    });
  });
});
