// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource environments', () => {
  test('create: only required params', async () => {
    const responsePromise = client.beta.agents.environments.create({
      environment: { type: 'openai_hosted' },
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
    await client.beta.agents.environments.create({
      environment: {
        type: 'openai_hosted',
        capability_directories: ['string'],
        desktop: { enabled: true },
        env: { foo: 'string' },
        environment_template_id: 'environment_template_id',
        files: [
          {
            file_id: 'x',
            path: 'x',
            type: 'file_id',
          },
        ],
        network: {
          access: 'enabled',
          allowed_domains: ['string'],
          blocked_domains: ['string'],
        },
        packages: {
          npm: ['string'],
          python: ['string'],
          system: ['string'],
        },
        plugins: [
          {
            description: 'description',
            name: 'x',
            source: {
              data: 'x',
              media_type: 'application/zip',
              type: 'base64',
            },
            type: 'inline',
          },
        ],
        setup_commands: [{ command: 'command', cwd: 'cwd' }],
        skills: [
          {
            skill_id: 'x',
            type: 'skill_reference',
            version: 'version',
          },
        ],
      },
      vault_ids: ['string'],
      'Idempotency-Key': 'x',
    });
  });

  test('retrieve', async () => {
    const responsePromise = client.beta.agents.environments.retrieve('environment_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('list', async () => {
    const responsePromise = client.beta.agents.environments.list();
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
      client.beta.agents.environments.list(
        {
          after: 'after',
          limit: 1,
          order: 'asc',
          type: 'openai_hosted',
        },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });
});
