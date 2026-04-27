// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';
import { mockFetch } from '../utils/mock-fetch';
import fs from 'fs/promises';
import Path from 'path';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource embeddings', () => {
  test('create: only required params', async () => {
    const responsePromise = client.embeddings.create({
      input: 'The quick brown fox jumped over the lazy dog',
      model: 'text-embedding-3-small',
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
    const response = await client.embeddings.create({
      input: 'The quick brown fox jumped over the lazy dog',
      model: 'text-embedding-3-small',
      dimensions: 1,
      encoding_format: 'float',
      user: 'user-1234',
    });
  });

  test('create: encoding_format=default should create float32 embeddings', async () => {
    const client = makeClient();
    const response = await client.embeddings.create({
      input: 'The quick brown fox jumped over the lazy dog',
      model: 'text-embedding-3-small',
    });

    expect(Array.isArray(response.data?.at(0)?.embedding)).toBe(true);
    expect(response.data?.at(0)?.embedding.at(0)).toBe(-0.09928705543279648);
  });

  test('create: encoding_format=float should create float32 embeddings', async () => {
    const client = makeClient();
    const response = await client.embeddings.create({
      input: 'The quick brown fox jumped over the lazy dog',
      model: 'text-embedding-3-small',
      encoding_format: 'float',
    });

    expect(Array.isArray(response.data?.at(0)?.embedding)).toBe(true);
    expect(response.data?.at(0)?.embedding.at(0)).toBe(-0.099287055);
  });

  test('create: encoding_format=base64 should return base64 embeddings', async () => {
    const client = makeClient();
    const response = await client.embeddings.create({
      input: 'The quick brown fox jumped over the lazy dog',
      model: 'text-embedding-3-small',
      encoding_format: 'base64',
    });

    expect(typeof response.data?.at(0)?.embedding).toBe('string');
  });
});

function makeClient(): OpenAI {
  const { fetch, handleRequest } = mockFetch();

  handleRequest(async (_, init) => {
    const format = (JSON.parse(init!.body as string) as OpenAI.EmbeddingCreateParams).encoding_format;
    return new Response(
      await fs.readFile(
        Path.join(
          __dirname,

          // these responses were taken from the live API with:
          //
          // model: 'text-embedding-3-large',
          // input: 'h',
          // dimensions: 256,

          format === 'base64' ? 'embeddings-base64-response.json' : 'embeddings-float-response.json',
        ),
      ),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  });

  return new OpenAI({
    fetch,
    apiKey: 'My API Key',
    baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
  });
}
