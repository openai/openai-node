// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource roles', () => {
  test('create: only required params', async () => {
    const responsePromise = client.admin.organization.projects.groups.roles.create('group_id', {
      project_id: 'project_id',
      role_id: 'role_id',
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
    const response = await client.admin.organization.projects.groups.roles.create('group_id', {
      project_id: 'project_id',
      role_id: 'role_id',
    });
  });

  test('list: only required params', async () => {
    const responsePromise = client.admin.organization.projects.groups.roles.list('group_id', {
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

  test('list: required and optional params', async () => {
    const response = await client.admin.organization.projects.groups.roles.list('group_id', {
      project_id: 'project_id',
      after: 'after',
      limit: 0,
      order: 'asc',
    });
  });

  test('delete: only required params', async () => {
    const responsePromise = client.admin.organization.projects.groups.roles.delete('role_id', {
      project_id: 'project_id',
      group_id: 'group_id',
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
    const response = await client.admin.organization.projects.groups.roles.delete('role_id', {
      project_id: 'project_id',
      group_id: 'group_id',
    });
  });
});
