// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource inputTokens', () => {
  test('count', async () => {
    const responsePromise = client.responses.inputTokens.count();
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('count: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.responses.inputTokens.count(
        {
          conversation: 'string',
          input: 'string',
          instructions: 'instructions',
          model: 'model',
          parallel_tool_calls: true,
          previous_response_id: 'resp_123',
          reasoning: { effort: 'none', generate_summary: 'auto', summary: 'auto' },
          text: { format: { type: 'text' }, verbosity: 'low' },
          tool_choice: 'none',
          tools: [
            {
              name: 'name',
              parameters: { foo: 'bar' },
              strict: true,
              type: 'function',
              description: 'description',
            },
          ],
          truncation: 'auto',
        },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });
});
