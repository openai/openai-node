// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource roles', () => {
  test('create: only required params', async () => {
    const responsePromise = client.admin.organization.projects.roles.create('project_id', {
      permissions: ['string'],
      role_name: 'role_name',
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
    const response = await client.admin.organization.projects.roles.create('project_id', {
      permissions: ['string'],
      role_name: 'role_name',
      description: 'description',
    });
  });

  test('update: only required params', async () => {
    const responsePromise = client.admin.organization.projects.roles.update('role_id', {
      project_id: 'project_id',
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('update: required and optional params', async () => {
    const response = await client.admin.organization.projects.roles.update('role_id', {
      project_id: 'project_id',
      description: 'description',
      permissions: ['string'],
      role_name: 'role_name',
    });
  });

  test('list', async () => {
    const responsePromise = client.admin.organization.projects.roles.list('project_id');
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
      client.admin.organization.projects.roles.list(
        'project_id',
        {
          after: 'after',
          limit: 0,
          order: 'asc',
        },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('delete: only required params', async () => {
    const responsePromise = client.admin.organization.projects.roles.delete('role_id', {
      project_id: 'project_id',
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('delete: required and optional params', async () => {
    const response = await client.admin.organization.projects.roles.delete('role_id', {
      project_id: 'project_id',
    });
  });
});
