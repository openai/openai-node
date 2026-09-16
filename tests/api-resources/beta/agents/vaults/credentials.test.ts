// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource credentials', () => {
  test('create: only required params', async () => {
    const responsePromise = client.beta.agents.vaults.credentials.create('vault_id', {
      auth: {
        access_token: 'access_token',
        mcp_server_url: 'mcp_server_url',
        type: 'mcp_oauth',
      },
      name: 'x',
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
    await client.beta.agents.vaults.credentials.create('vault_id', {
      auth: {
        access_token: 'access_token',
        mcp_server_url: 'mcp_server_url',
        type: 'mcp_oauth',
        expires_at: 'expires_at',
        refresh: {
          client_id: 'client_id',
          refresh_token: 'refresh_token',
          token_endpoint: 'token_endpoint',
          token_endpoint_auth: { type: 'none' },
          resource: 'resource',
          scope: 'scope',
        },
      },
      name: 'x',
    });
  });

  test('retrieve: only required params', async () => {
    const responsePromise = client.beta.agents.vaults.credentials.retrieve('credential_id', {
      vault_id: 'vault_id',
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('retrieve: required and optional params', async () => {
    await client.beta.agents.vaults.credentials.retrieve('credential_id', {
      vault_id: 'vault_id',
    });
  });

  test('update: only required params', async () => {
    const responsePromise = client.beta.agents.vaults.credentials.update('credential_id', {
      vault_id: 'vault_id',
      auth: { type: 'mcp_oauth' },
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
    await client.beta.agents.vaults.credentials.update('credential_id', {
      vault_id: 'vault_id',
      auth: {
        type: 'mcp_oauth',
        access_token: 'access_token',
        expires_at: 'expires_at',
        refresh: {
          refresh_token: 'refresh_token',
          scope: 'scope',
          token_endpoint_auth: { type: 'client_secret_basic', client_secret: 'client_secret' },
        },
      },
    });
  });

  test('list', async () => {
    const responsePromise = client.beta.agents.vaults.credentials.list('vault_id');
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
      client.beta.agents.vaults.credentials.list(
        'vault_id',
        {
          after: 'after',
          limit: 0,
          order: 'asc',
          status: 'active',
        },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('delete: only required params', async () => {
    const responsePromise = client.beta.agents.vaults.credentials.delete('credential_id', {
      vault_id: 'vault_id',
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
    await client.beta.agents.vaults.credentials.delete('credential_id', {
      vault_id: 'vault_id',
    });
  });
});
