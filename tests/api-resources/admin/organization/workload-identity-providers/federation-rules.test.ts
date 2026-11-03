// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource federationRules', () => {
  test('create: only required params', async () => {
    const responsePromise = client.admin.organization.workloadIdentityProviders.federationRules.create('x', {
      attribute_matchers: { foo: 'string' },
      project_id: 'x',
      service_account_id: 'x',
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
    await client.admin.organization.workloadIdentityProviders.federationRules.create('x', {
      attribute_matchers: { foo: 'string' },
      project_id: 'x',
      service_account_id: 'x',
      description: 'description',
      enabled: true,
      name: 'name',
      permissions: { type: 'service_account_default' },
    });
  });

  test('retrieve: only required params', async () => {
    const responsePromise = client.admin.organization.workloadIdentityProviders.federationRules.retrieve(
      'x',
      { workload_identity_provider_id: 'x' },
    );
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('retrieve: required and optional params', async () => {
    await client.admin.organization.workloadIdentityProviders.federationRules.retrieve('x', {
      workload_identity_provider_id: 'x',
    });
  });

  test('update: only required params', async () => {
    const responsePromise = client.admin.organization.workloadIdentityProviders.federationRules.update('x', {
      workload_identity_provider_id: 'x',
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
    await client.admin.organization.workloadIdentityProviders.federationRules.update('x', {
      workload_identity_provider_id: 'x',
      attribute_matchers: { foo: 'string' },
      description: 'description',
      enabled: true,
      name: 'name',
      permissions: { type: 'service_account_default' },
    });
  });

  test('list', async () => {
    const responsePromise = client.admin.organization.workloadIdentityProviders.federationRules.list('x');
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
      client.admin.organization.workloadIdentityProviders.federationRules.list(
        'x',
        {
          after: 'x',
          limit: 1,
          order: 'asc',
          service_account_id: 'x',
        },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('delete: only required params', async () => {
    const responsePromise = client.admin.organization.workloadIdentityProviders.federationRules.delete('x', {
      workload_identity_provider_id: 'x',
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
    await client.admin.organization.workloadIdentityProviders.federationRules.delete('x', {
      workload_identity_provider_id: 'x',
    });
  });
});
