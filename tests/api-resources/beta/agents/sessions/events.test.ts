// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource events', () => {
  test('create: only required params', async () => {
    const responsePromise = client.beta.agents.sessions.events.create('session_id', {
      events: [
        {
          request_id: 'request_id',
          response: { decision: 'approve', type: 'mcp_tool_call' },
          type: 'agent.session.input.mcp_approval_request_result',
        },
      ],
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
    await client.beta.agents.sessions.events.create('session_id', {
      events: [
        {
          request_id: 'request_id',
          response: { decision: 'approve', type: 'mcp_tool_call' },
          type: 'agent.session.input.mcp_approval_request_result',
        },
      ],
      'Idempotency-Key': 'x',
    });
  });

  test('stream', async () => {
    const responsePromise = client.beta.agents.sessions.events.stream('session_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('stream: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.beta.agents.sessions.events.stream(
        'session_id',
        { include_obfuscation: true },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });
});
