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

  test('create: should handle null embedding objects gracefully', async () => {
    const client = makeClientWithCustomResponse({
      object: 'list',
      data: [
        { object: 'embedding', index: 0, embedding: [-0.1, 0.2, 0.3] },
        null as any, // null embedding object
        { object: 'embedding', index: 2, embedding: [0.4, 0.5, 0.6] },
      ],
      model: 'test-model',
      usage: { prompt_tokens: 1, total_tokens: 1 },
    });

    const response = await client.embeddings.create({
      input: 'test',
      model: 'test-model',
    });

    // Should skip null items and process valid ones
    expect(response.data.length).toBe(3);
    expect(Array.isArray(response.data[0]?.embedding)).toBe(true);
    expect(response.data[1]).toBe(null);
    expect(Array.isArray(response.data[2]?.embedding)).toBe(true);
  });

  test('create: should throw error for missing embedding data', async () => {
    const client = makeClientWithCustomResponse({
      object: 'list',
      data: [
        { object: 'embedding', index: 0, embedding: null as any }, // missing embedding data
      ],
      model: 'test-model',
      usage: { prompt_tokens: 1, total_tokens: 1 },
    });

    await expect(
      client.embeddings.create({
        input: 'test',
        model: 'test-model',
      }),
    ).rejects.toThrow('Missing embedding data for item at index 0');
  });

  test('create: should throw error for undefined embedding data', async () => {
    const client = makeClientWithCustomResponse({
      object: 'list',
      data: [
        { object: 'embedding', index: 1, embedding: undefined as any }, // undefined embedding data
      ],
      model: 'test-model',
      usage: { prompt_tokens: 1, total_tokens: 1 },
    });

    await expect(
      client.embeddings.create({
        input: 'test',
        model: 'test-model',
      }),
    ).rejects.toThrow('Missing embedding data for item at index 1');
  });

  test('create: should throw error for missing embedding data without index', async () => {
    const client = makeClientWithCustomResponse({
      object: 'list',
      data: [
        { object: 'embedding', embedding: null as any }, // missing embedding data and index
      ],
      model: 'test-model',
      usage: { prompt_tokens: 1, total_tokens: 1 },
    });

    await expect(
      client.embeddings.create({
        input: 'test',
        model: 'test-model',
      }),
    ).rejects.toThrow('Missing embedding data for item at index unknown');
  });

  test('create: should handle mixed valid and invalid embedding objects', async () => {
    const client = makeClientWithCustomResponse({
      object: 'list',
      data: [
        { object: 'embedding', index: 0, embedding: [0.1, 0.2] }, // valid
        null as any, // null object
        { object: 'embedding', index: 2, embedding: [0.3, 0.4] }, // valid
        undefined as any, // undefined object
        { object: 'embedding', index: 4, embedding: [0.5, 0.6] }, // valid
      ],
      model: 'test-model',
      usage: { prompt_tokens: 1, total_tokens: 1 },
    });

    const response = await client.embeddings.create({
      input: ['test1', 'test2', 'test3', 'test4', 'test5'],
      model: 'test-model',
    });

    // Should process valid items and skip null/undefined ones
    expect(response.data.length).toBe(5);
    expect(Array.isArray(response.data[0]?.embedding)).toBe(true);
    expect(response.data[1]).toBe(null);
    expect(Array.isArray(response.data[2]?.embedding)).toBe(true);
    expect(response.data[3]).toBe(null); // undefined becomes null when serialized to JSON
    expect(Array.isArray(response.data[4]?.embedding)).toBe(true);
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

function makeClientWithCustomResponse(responseBody: any): OpenAI {
  const { fetch, handleRequest } = mockFetch();

  handleRequest(async () => {
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  });

  return new OpenAI({
    fetch,
    apiKey: 'My API Key',
    baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
  });
}
