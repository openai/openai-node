// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource sessions', () => {
  test('accept: only required params', async () => {
    const responsePromise = client.live.sessions.accept('session_id', {
      session: { model: 'gpt-live-1', type: 'live' },
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('accept: required and optional params', async () => {
    await client.live.sessions.accept('session_id', {
      session: {
        model: 'gpt-live-1',
        type: 'live',
        audio: { output: { voice: 'string' } },
        delegation: { type: 'client' },
        input: [
          {
            content: [{ text: 'text', type: 'input_text' }],
            role: 'developer',
            id: 'id',
            status: 'incomplete',
            type: 'message',
          },
        ],
        instructions: 'instructions',
        store: true,
      },
    });
  });

  test('fork: only required params', async () => {
    const responsePromise = client.live.sessions.fork('session_id', {
      transport: { sdp: 'x', type: 'webrtc' },
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('fork: required and optional params', async () => {
    await client.live.sessions.fork('session_id', {
      transport: { sdp: 'x', type: 'webrtc' },
      session: {
        client: { data_channel: { allowed_client_events: 'all', allowed_server_events: 'all' } },
        delegation: {
          type: 'responses',
          responses: {
            instructions: 'instructions',
            max_output_tokens: 16,
            model: 'model',
            parallel_tool_calls: true,
            reasoning: { effort: 'none', summary: 'concise' },
            service_tier: 'auto',
            text: { verbosity: 'low' },
            tool_choice: 'auto',
            tools: [
              {
                name: 'name',
                type: 'function',
                description: 'description',
                parameters: { foo: 'bar' },
                strict: true,
              },
            ],
          },
        },
        store: true,
      },
    });
  });

  test('hangup', async () => {
    const responsePromise = client.live.sessions.hangup('session_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('refer: only required params', async () => {
    const responsePromise = client.live.sessions.refer('session_id', { target_uri: 'tel:+14155550123' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('refer: required and optional params', async () => {
    await client.live.sessions.refer('session_id', { target_uri: 'tel:+14155550123' });
  });

  test('reject: only required params', async () => {
    const responsePromise = client.live.sessions.reject('session_id', { status_code: 486 });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('reject: required and optional params', async () => {
    await client.live.sessions.reject('session_id', { status_code: 486 });
  });
});
