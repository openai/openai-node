import OpenAI from 'openai';

import base64EmbeddingFixture from '../api-resources/embeddings-base64-response.json';
import floatEmbeddingFixture from '../api-resources/embeddings-float-response.json';
import { compareType, expectType } from '../utils/typing';

const vector = [1.25, -2.5];
const encodedVector = Buffer.from(new Float32Array(vector).buffer).toString('base64');
const incompleteVectors = [1, 2, 3, 5, 6, 7].map((byteLength) => ({
  byteLength,
  encoded: Buffer.alloc(byteLength).toString('base64'),
}));
const request = { input: 'hello', model: 'text-embedding-3-small' } as const;

function createClient(base64Embedding = encodedVector): OpenAI {
  return new OpenAI({
    apiKey: 'test-key',
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { encoding_format: 'float' | 'base64' };

      return Response.json({
        object: 'list',
        data: [
          {
            object: 'embedding',
            index: 0,
            embedding: body.encoding_format === 'base64' ? base64Embedding : vector,
          },
        ],
        model: request.model,
        usage: { prompt_tokens: 1, total_tokens: 1 },
      });
    },
  });
}

function makeFixtureClient(): OpenAI {
  return new OpenAI({
    apiKey: 'My API Key',
    baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
    fetch: async (_, init) => {
      const format = (JSON.parse(String(init?.body)) as OpenAI.EmbeddingCreateParams).encoding_format;
      // These existing responses were taken from the live API with:
      // model: 'text-embedding-3-large', input: 'h', dimensions: 256.
      return Response.json(format === 'base64' ? base64EmbeddingFixture : floatEmbeddingFixture);
    },
  });
}

describe('resource embeddings', () => {
  test.each(incompleteVectors)('default rejects $byteLength decoded embedding bytes', async ({ encoded }) => {
    await expect(createClient(encoded).embeddings.create(request)).rejects.toBeInstanceOf(RangeError);
  });

  test.each(incompleteVectors)(
    'explicit base64 preserves $byteLength decoded embedding bytes',
    async ({ encoded }) => {
      const response = await createClient(encoded).embeddings.create({
        ...request,
        encoding_format: 'base64',
      });
      expect(response.data[0]?.embedding).toBe(encoded);
    },
  );

  test('create: encoding_format=default should create float32 embeddings', async () => {
    const client = makeFixtureClient();
    const response = await client.embeddings.create({
      input: 'The quick brown fox jumped over the lazy dog',
      model: 'text-embedding-3-small',
    });

    expect(Array.isArray(response.data?.[0]?.embedding)).toBe(true);
    expect(response.data?.[0]?.embedding[0]).toBe(-0.09928705543279648);
  });

  test('create: encoding_format=float should create float32 embeddings', async () => {
    const client = makeFixtureClient();
    const response = await client.embeddings.create({
      input: 'The quick brown fox jumped over the lazy dog',
      model: 'text-embedding-3-small',
      encoding_format: 'float',
    });

    expect(Array.isArray(response.data?.[0]?.embedding)).toBe(true);
    expect(response.data?.[0]?.embedding[0]).toBe(-0.099287055);
  });

  test('create: encoding_format=base64 should return base64 embeddings', async () => {
    const client = makeFixtureClient();
    const response = await client.embeddings.create({
      input: 'The quick brown fox jumped over the lazy dog',
      model: 'text-embedding-3-small',
      encoding_format: 'base64',
    });

    expect(typeof response.data?.[0]?.embedding).toBe('string');
  });
});

describe('embedding response types', () => {
  test('preserves numeric embedding types for default and float requests', async () => {
    const client = createClient();
    const defaultResponse = await client.embeddings.create(request);
    const floatResponse = await client.embeddings.create({ ...request, encoding_format: 'float' });

    compareType<(typeof defaultResponse.data)[number]['embedding'], number[]>(true);
    compareType<(typeof floatResponse.data)[number]['embedding'], number[]>(true);
    expectType<OpenAI.CreateEmbeddingResponse>(defaultResponse);
    expectType<OpenAI.CreateEmbeddingResponse>(floatResponse);
    expect(defaultResponse.data[0]?.embedding).toEqual(vector);
    expect(floatResponse.data[0]?.embedding).toEqual(vector);
  });

  test('returns string embeddings for explicit base64 requests', async () => {
    const client = createClient();
    const response = await client.embeddings.create({ ...request, encoding_format: 'base64' });

    compareType<(typeof response.data)[number]['embedding'], string>(true);
    expect(response.data[0]?.embedding).toBe(encodedVector);
  });

  test('preserves base64 response types with request options and response helpers', async () => {
    const client = createClient();
    const promise = client.embeddings.create(
      { ...request, encoding_format: 'base64' },
      { headers: { 'X-Test': 'yes' } },
    );
    const { data, response } = await promise.withResponse();

    compareType<(typeof data.data)[number]['embedding'], string>(true);
    expect(data.data[0]?.embedding).toBe(encodedVector);
    expect(response.status).toBe(200);
  });

  test('keeps existing broadly typed requests and shared embedding interfaces compatible', async () => {
    const params: OpenAI.EmbeddingCreateParams = { ...request, encoding_format: 'float' };
    const response = await createClient().embeddings.create(params);
    const embedding: OpenAI.Embedding = { object: 'embedding', index: 0, embedding: vector };

    compareType<(typeof response.data)[number]['embedding'], number[]>(true);
    compareType<typeof embedding.embedding, number[]>(true);
    expectType<OpenAI.CreateEmbeddingResponse>(response);
    expect(embedding.embedding.map((value) => value * 2)).toEqual([2.5, -5]);
  });
});
