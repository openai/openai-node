import OpenAI from 'openai';

import { compareType, expectType } from '../utils/typing';

const vector = [1.25, -2.5];
const encodedVector = Buffer.from(new Float32Array(vector).buffer).toString('base64');
const request = { input: 'hello', model: 'text-embedding-3-small' } as const;

function createClient(): OpenAI {
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
            embedding: body.encoding_format === 'base64' ? encodedVector : vector,
          },
        ],
        model: request.model,
        usage: { prompt_tokens: 1, total_tokens: 1 },
      });
    },
  });
}

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
