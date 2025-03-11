// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';
import { Response } from 'node-fetch';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource responses', () => {
  test('create: only required params', async () => {
    const responsePromise = client.responses.create({ input: 'string', model: 'gpt-4o' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('create: required and optional params', async () => {
    const response = await client.responses.create({
      input: 'string',
      model: 'gpt-4o',
      include: ['file_search_call.results'],
      instructions: 'instructions',
      max_output_tokens: 0,
      metadata: { foo: 'string' },
      parallel_tool_calls: true,
      previous_response_id: 'previous_response_id',
      reasoning: { effort: 'low', generate_summary: 'concise' },
      store: true,
      stream: false,
      temperature: 1,
      text: { format: { type: 'text' } },
      tool_choice: 'none',
      tools: [
        {
          type: 'file_search',
          vector_store_ids: ['string'],
          filters: { key: 'key', type: 'eq', value: 'string' },
          max_num_results: 0,
          ranking_options: { ranker: 'auto', score_threshold: 0 },
        },
      ],
      top_p: 1,
      truncation: 'auto',
      user: 'user-1234',
    });
  });

  test('retrieve', async () => {
    const responsePromise = client.responses.retrieve('resp_677efb5139a88190b512bc3fef8e535d');
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
      client.responses.retrieve('resp_677efb5139a88190b512bc3fef8e535d', {
        path: '/_stainless_unknown_path',
      }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('retrieve: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.responses.retrieve(
        'resp_677efb5139a88190b512bc3fef8e535d',
        { include: ['file_search_call.results'] },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('del', async () => {
    const responsePromise = client.responses.del('resp_677efb5139a88190b512bc3fef8e535d');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('del: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.responses.del('resp_677efb5139a88190b512bc3fef8e535d', { path: '/_stainless_unknown_path' }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });
});
