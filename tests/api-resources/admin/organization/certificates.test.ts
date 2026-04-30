// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource certificates', () => {
  test('create: only required params', async () => {
    const responsePromise = client.admin.organization.certificates.create({ content: 'content' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('create: required and optional params', async () => {
    const response = await client.admin.organization.certificates.create({
      content: 'content',
      name: 'name',
    });
  });

  test('retrieve', async () => {
    const responsePromise = client.admin.organization.certificates.retrieve('certificate_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('retrieve: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.admin.organization.certificates.retrieve(
        'certificate_id',
        { include: ['content'] },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('update: only required params', async () => {
    const responsePromise = client.admin.organization.certificates.update('certificate_id', { name: 'name' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('update: required and optional params', async () => {
    const response = await client.admin.organization.certificates.update('certificate_id', { name: 'name' });
  });

  test('list', async () => {
    const responsePromise = client.admin.organization.certificates.list();
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
      client.admin.organization.certificates.list(
        {
          after: 'after',
          limit: 0,
          order: 'asc',
        },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('delete', async () => {
    const responsePromise = client.admin.organization.certificates.delete('certificate_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('activate: only required params', async () => {
    const responsePromise = client.admin.organization.certificates.activate({
      certificate_ids: ['cert_abc'],
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('activate: required and optional params', async () => {
    const response = await client.admin.organization.certificates.activate({ certificate_ids: ['cert_abc'] });
  });

  test('deactivate: only required params', async () => {
    const responsePromise = client.admin.organization.certificates.deactivate({
      certificate_ids: ['cert_abc'],
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('deactivate: required and optional params', async () => {
    const response = await client.admin.organization.certificates.deactivate({
      certificate_ids: ['cert_abc'],
    });
  });
});
