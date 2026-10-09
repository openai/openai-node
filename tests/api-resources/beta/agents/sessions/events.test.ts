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
          response: {
            action: 'submit',
            fields: [{ field_id: 'field_id', value: 'value' }],
            type: 'browser_authentication',
          },
          type: 'agent.session.input.computer_use_approval_request_result',
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
          response: {
            action: 'submit',
            fields: [{ field_id: 'field_id', value: 'value' }],
            type: 'browser_authentication',
            selected_option: 'selected_option',
          },
          type: 'agent.session.input.computer_use_approval_request_result',
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
});
