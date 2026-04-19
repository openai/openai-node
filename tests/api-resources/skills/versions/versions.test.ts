// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI, { toFile } from 'openai';
import { mockFetch } from '../../../utils/mock-fetch';
import { File } from 'node:buffer';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource versions', () => {
  test('create', async () => {
    const responsePromise = client.skills.versions.create('skill_123');
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
      client.skills.versions.create(
        'skill_123',
        { default: true, files: [await toFile(Buffer.from('Example data'), 'README.md')] },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('create: preserves nested skill file paths', async () => {
    const { fetch, handleRequest } = mockFetch();
    const client = new OpenAI({ apiKey: 'My API Key', fetch });

    handleRequest(async (_, init) => {
      const files = (init!.body as FormData).getAll('files[]');
      expect(files).toHaveLength(1);
      expect(files[0]).toBeInstanceOf(File);
      expect((files[0] as File).name).toEqual('my-skill/SKILL.md');

      return new Response(
        JSON.stringify({
          id: 'skillver_123',
          created_at: 0,
          description: '',
          name: 'my-skill',
          object: 'skill.version',
          skill_id: 'skill_123',
          version: '1',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    await client.skills.versions.create('skill_123', { files: [new File(['# skill'], 'my-skill/SKILL.md')] });
  });

  test('retrieve: only required params', async () => {
    const responsePromise = client.skills.versions.retrieve('version', { skill_id: 'skill_123' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('retrieve: required and optional params', async () => {
    const response = await client.skills.versions.retrieve('version', { skill_id: 'skill_123' });
  });

  test('list', async () => {
    const responsePromise = client.skills.versions.list('skill_123');
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
      client.skills.versions.list(
        'skill_123',
        {
          after: 'skillver_123',
          limit: 0,
          order: 'asc',
        },
        { path: '/_stainless_unknown_path' },
      ),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });

  test('delete: only required params', async () => {
    const responsePromise = client.skills.versions.delete('version', { skill_id: 'skill_123' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('delete: required and optional params', async () => {
    const response = await client.skills.versions.delete('version', { skill_id: 'skill_123' });
  });
});
