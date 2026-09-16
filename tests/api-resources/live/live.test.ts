// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource live', () => {
  test('create: only required params', async () => {
    const responsePromise = client.live.create({
      session: { model: 'gpt-live-1' },
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

  test('create: required and optional params', async () => {
    await client.live.create({
      session: {
        model: 'gpt-live-1',
        audio: { output: { voice: 'string' } },
        client: { data_channel: { allowed_client_events: 'all', allowed_server_events: 'all' } },
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
      transport: { sdp: 'x', type: 'webrtc' },
    });
  });
});
