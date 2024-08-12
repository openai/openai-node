// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';
import { Response } from 'node-fetch';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource threads', () => {
  test('create', async () => {
    const responsePromise = client.beta.threads.create();
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('create: request options instead of params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(client.beta.threads.create({ path: '/_stainless_unknown_path' })).rejects.toThrow(
      OpenAI.NotFoundError,
    );
  });

  test('create: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.beta.threads.create(
        {
          messages: [
            {
              content: 'string',
              role: 'user',
              attachments: [
                {
                  file_id: 'file_id',
                  tools: [
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                  ],
                },
                {
                  file_id: 'file_id',
                  tools: [
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                  ],
                },
                {
                  file_id: 'file_id',
                  tools: [
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                  ],
                },
              ],
              metadata: {},
            },
            {
              content: 'string',
              role: 'user',
              attachments: [
                {
                  file_id: 'file_id',
                  tools: [
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                  ],
                },
                {
                  file_id: 'file_id',
                  tools: [
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                  ],
                },
                {
                  file_id: 'file_id',
                  tools: [
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                  ],
                },
              ],
              metadata: {},
            },
            {
              content: 'string',
              role: 'user',
              attachments: [
                {
                  file_id: 'file_id',
                  tools: [
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                  ],
                },
                {
                  file_id: 'file_id',
                  tools: [
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                  ],
                },
                {
                  file_id: 'file_id',
                  tools: [
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                    { type: 'code_interpreter' },
                  ],
                },
              ],
              metadata: {},
            },
          ],
          metadata: {},
          tool_resources: {
            code_interpreter: { file_ids: ['string', 'string', 'string'] },
            file_search: {
              vector_store_ids: ['string'],
              vector_stores: [
                {
                  chunking_strategy: { type: 'auto' },
                  file_ids: ['string', 'string', 'string'],
                  metadata: {},
                },
              ],
            },
          },
        },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('retrieve', async () => {
    const responsePromise = client.beta.threads.retrieve('thread_id');
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
      client.beta.threads.retrieve('thread_id', { path: '/_stainless_unknown_path' }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('update', async () => {
    const responsePromise = client.beta.threads.update('thread_id', {});
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('del', async () => {
    const responsePromise = client.beta.threads.del('thread_id');
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
    await expect(client.beta.threads.del('thread_id', { path: '/_stainless_unknown_path' })).rejects.toThrow(
      OpenAI.NotFoundError,
    );
  });

  test('createAndRun: only required params', async () => {
    const responsePromise = client.beta.threads.createAndRun({ assistant_id: 'assistant_id' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('createAndRun: required and optional params', async () => {
    const response = await client.beta.threads.createAndRun({
      assistant_id: 'assistant_id',
      instructions: 'instructions',
      max_completion_tokens: 256,
      max_prompt_tokens: 256,
      metadata: {},
      model: 'gpt-4o',
      parallel_tool_calls: true,
      response_format: 'auto',
      stream: false,
      temperature: 1,
      thread: {
        messages: [
          {
            content: 'string',
            role: 'user',
            attachments: [
              {
                file_id: 'file_id',
                tools: [
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                ],
              },
              {
                file_id: 'file_id',
                tools: [
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                ],
              },
              {
                file_id: 'file_id',
                tools: [
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                ],
              },
            ],
            metadata: {},
          },
          {
            content: 'string',
            role: 'user',
            attachments: [
              {
                file_id: 'file_id',
                tools: [
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                ],
              },
              {
                file_id: 'file_id',
                tools: [
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                ],
              },
              {
                file_id: 'file_id',
                tools: [
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                ],
              },
            ],
            metadata: {},
          },
          {
            content: 'string',
            role: 'user',
            attachments: [
              {
                file_id: 'file_id',
                tools: [
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                ],
              },
              {
                file_id: 'file_id',
                tools: [
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                ],
              },
              {
                file_id: 'file_id',
                tools: [
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                  { type: 'code_interpreter' },
                ],
              },
            ],
            metadata: {},
          },
        ],
        metadata: {},
        tool_resources: {
          code_interpreter: { file_ids: ['string', 'string', 'string'] },
          file_search: {
            vector_store_ids: ['string'],
            vector_stores: [
              { chunking_strategy: { type: 'auto' }, file_ids: ['string', 'string', 'string'], metadata: {} },
            ],
          },
        },
      },
      tool_choice: 'none',
      tool_resources: {
        code_interpreter: { file_ids: ['string', 'string', 'string'] },
        file_search: { vector_store_ids: ['string'] },
      },
      tools: [{ type: 'code_interpreter' }, { type: 'code_interpreter' }, { type: 'code_interpreter' }],
      top_p: 1,
      truncation_strategy: { type: 'auto', last_messages: 1 },
    });
  });
});
