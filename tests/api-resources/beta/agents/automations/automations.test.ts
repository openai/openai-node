// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource automations', () => {
  test('create: only required params', async () => {
    const responsePromise = client.beta.agents.automations.create({
      expression: 'x',
      name: 'x',
      target: {
        environment: { type: 'none' },
        input: [
          {
            content: [{ text: 'text', type: 'input_text' }],
            role: 'user',
            type: 'message',
          },
        ],
        type: 'new_session',
      },
      timezone: 'x',
      type: 'periodic',
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
    await client.beta.agents.automations.create({
      expression: 'x',
      name: 'x',
      target: {
        environment: { type: 'none' },
        input: [
          {
            content: [{ text: 'text', type: 'input_text' }],
            role: 'user',
            type: 'message',
          },
        ],
        type: 'new_session',
        agent: {
          instructions: 'instructions',
          model: 'model',
          multi_agent: { enabled: true, max_concurrent_subagents: 1 },
          reasoning: { effort: 'none', summary: 'concise' },
          service_tier: 'auto',
          text: {
            format: { type: 'text' },
            verbosity: 'low',
          },
          tools: [
            {
              description: 'description',
              name: 'name',
              parameters: { foo: 'bar' },
              type: 'function',
              defer_loading: true,
            },
          ],
        },
        agent_id: 'agent_id',
        metadata: { foo: 'string' },
        vault_ids: ['string'],
      },
      timezone: 'x',
      type: 'periodic',
      metadata: { foo: 'string' },
    });
  });

  test('retrieve', async () => {
    const responsePromise = client.beta.agents.automations.retrieve('automation_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('update', async () => {
    const responsePromise = client.beta.agents.automations.update('automation_id', {});
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('list', async () => {
    const responsePromise = client.beta.agents.automations.list();
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
      client.beta.agents.automations.list(
        {
          after: 'after',
          limit: 1,
          order: 'asc',
          session_id: 'session_id',
        },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('delete', async () => {
    const responsePromise = client.beta.agents.automations.delete('automation_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('pause', async () => {
    const responsePromise = client.beta.agents.automations.pause('automation_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('resume', async () => {
    const responsePromise = client.beta.agents.automations.resume('automation_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });
});
