// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource runs', () => {
  test('create: only required params', async () => {
    const responsePromise = client.beta.threads.runs.create('thread_id', { assistant_id: 'assistant_id' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('create: required and optional params', async () => {
    const response = await client.beta.threads.runs.create('thread_id', {
      assistant_id: 'assistant_id',
      include: ['step_details.tool_calls[*].file_search.results[*].content'],
      additional_instructions: 'additional_instructions',
      additional_messages: [
        {
          content: 'string',
          role: 'user',
          attachments: [{ file_id: 'file_id', tools: [{ type: 'code_interpreter' }] }],
          metadata: { foo: 'string' },
        },
      ],
      instructions: 'instructions',
      max_completion_tokens: 256,
      max_prompt_tokens: 256,
      metadata: { foo: 'string' },
      model: 'string',
      parallel_tool_calls: true,
      reasoning_effort: 'none',
      response_format: 'auto',
      stream: false,
      temperature: 1,
      tool_choice: 'none',
      tools: [{ type: 'code_interpreter' }],
      top_p: 1,
      truncation_strategy: { type: 'auto', last_messages: 1 },
    });
  });

  test('retrieve: only required params', async () => {
    const responsePromise = client.beta.threads.runs.retrieve('run_id', { thread_id: 'thread_id' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('retrieve: required and optional params', async () => {
    const response = await client.beta.threads.runs.retrieve('run_id', { thread_id: 'thread_id' });
  });

  test('update: only required params', async () => {
    const responsePromise = client.beta.threads.runs.update('run_id', { thread_id: 'thread_id' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('update: required and optional params', async () => {
    const response = await client.beta.threads.runs.update('run_id', {
      thread_id: 'thread_id',
      metadata: { foo: 'string' },
    });
  });

  test('list', async () => {
    const responsePromise = client.beta.threads.runs.list('thread_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('list: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.beta.threads.runs.list(
        'thread_id',
        { after: 'after', before: 'before', limit: 0, order: 'asc' },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('cancel: only required params', async () => {
    const responsePromise = client.beta.threads.runs.cancel('run_id', { thread_id: 'thread_id' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('cancel: required and optional params', async () => {
    const response = await client.beta.threads.runs.cancel('run_id', { thread_id: 'thread_id' });
  });

  test('submitToolOutputs: only required params', async () => {
    const responsePromise = client.beta.threads.runs.submitToolOutputs('run_id', {
      thread_id: 'thread_id',
      tool_outputs: [{}],
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('submitToolOutputs: required and optional params', async () => {
    const response = await client.beta.threads.runs.submitToolOutputs('run_id', {
      thread_id: 'thread_id',
      tool_outputs: [{ output: 'output', tool_call_id: 'tool_call_id' }],
      stream: false,
    });
  });
});
