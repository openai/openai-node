// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI, { toFile } from 'openai';
import { mockFetch } from '../../utils/mock-fetch';

const client = new OpenAI({
  apiKey: 'My API Key',
  adminAPIKey: 'My Admin API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource skills', () => {
  test('create', async () => {
    const responsePromise = client.skills.create();
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
      client.skills.create(
        { files: [await toFile(Buffer.from('Example data'), 'README.md')] },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('create: preserves directory paths in uploaded filenames', async () => {
    const { fetch, handleRequest } = mockFetch();
    const client = new OpenAI({
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
      fetch,
    });

    const formDataProbe = handleRequest(async () => new Response('ok'));
    const request = handleRequest(async (_req, init) => {
      const form = init!.body as FormData;
      expect((form.get('files[]') as File).name).toBe('my-skill/SKILL.md');

      return new Response(
        JSON.stringify({
          id: 'skill_123',
          created_at: 0,
          default_version: 'v1',
          description: 'Test skill',
          latest_version: 'v1',
          name: 'my-skill',
          object: 'skill',
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });

    const response = await client.skills.create({
      files: [new File(['# Skill'], 'my-skill/SKILL.md')],
    });
    await formDataProbe;
    await request;

    expect(response.id).toBe('skill_123');
  });

  test('retrieve', async () => {
    const responsePromise = client.skills.retrieve('skill_123');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('update: only required params', async () => {
    const responsePromise = client.skills.update('skill_123', { default_version: 'default_version' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('update: required and optional params', async () => {
    const response = await client.skills.update('skill_123', { default_version: 'default_version' });
  });

  test('list', async () => {
    const responsePromise = client.skills.list();
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
      client.skills.list(
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
    const responsePromise = client.skills.delete('skill_123');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });
});
