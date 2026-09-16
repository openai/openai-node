// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource templates', () => {
  test('create', async () => {
    const responsePromise = client.beta.agents.environments.templates.create();
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('create: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.beta.agents.environments.templates.create(
        {
          capability_directories: ['string'],
          env: { foo: 'string' },
          files: [
            {
              file_id: 'x',
              path: 'x',
              type: 'file_id',
            },
          ],
          name: 'x',
          network: { access: 'enabled', allowed_domains: ['string'] },
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
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('retrieve', async () => {
    const responsePromise = client.beta.agents.environments.templates.retrieve('environment_template_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('update', async () => {
    const responsePromise = client.beta.agents.environments.templates.update('environment_template_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('update: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.beta.agents.environments.templates.update(
        'environment_template_id',
        {
          capability_directories: ['string'],
          env: { foo: 'string' },
          files: [
            {
              file_id: 'x',
              path: 'x',
              type: 'file_id',
            },
          ],
          name: 'x',
          network: { access: 'enabled', allowed_domains: ['string'] },
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
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('list', async () => {
    const responsePromise = client.beta.agents.environments.templates.list();
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
      client.beta.agents.environments.templates.list(
        {
          after: 'after',
          limit: 1,
          order: 'asc',
        },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('delete', async () => {
    const responsePromise = client.beta.agents.environments.templates.delete('environment_template_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });
});
