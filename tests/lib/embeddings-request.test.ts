import { vi } from 'vitest';
import OpenAI, { BadRequestError } from 'openai';
import { APIPromise } from 'openai/api-promise';
import type { Fetch } from 'openai/internal/builtin-types';
import type { RequestOptions } from 'openai/internal/request-options';
import type { PromiseOrValue } from 'openai/internal/types';

const vector = [1.25, -2.5];
const encodedVector = Buffer.from(new Float32Array(vector).buffer).toString('base64');
const request = { input: 'hello', model: 'text-embedding-3-small' };

class RecordingClient extends OpenAI {
  readonly requests: {
    path: string;
    options: PromiseOrValue<RequestOptions> | undefined;
    response: APIPromise<unknown>;
  }[] = [];

  override post<Rsp>(path: string, options?: PromiseOrValue<RequestOptions>): APIPromise<Rsp> {
    const response = super.post<Rsp>(path, options);
    this.requests.push({ path, options, response });
    return response;
  }
}

function embeddingResponse(embedding: number[] | string): Response {
  return Response.json(
    {
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding }],
      model: request.model,
      usage: { prompt_tokens: 1, total_tokens: 1 },
    },
    { headers: { 'x-request-id': 'req_embeddings' } },
  );
}

describe('embedding request compatibility', () => {
  test.each([
    { name: 'omitted', present: false, format: undefined, explicit: false },
    { name: 'undefined', present: true, format: undefined, explicit: false },
    { name: 'null from JavaScript', present: true, format: null, explicit: false },
    { name: 'empty string from JavaScript', present: true, format: '', explicit: false },
    { name: 'float', present: true, format: 'float', explicit: true },
    { name: 'base64', present: true, format: 'base64', explicit: true },
  ])('preserves $name encoding and response accessors', async ({ present, format, explicit }) => {
    const debug = vi.fn();
    const fetch = vi.fn<Fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { encoding_format: string };
      return embeddingResponse(body.encoding_format === 'base64' ? encodedVector : vector);
    });
    const client = new RecordingClient({
      apiKey: 'test-key',
      fetch,
      logLevel: 'debug',
      logger: { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const body = { ...request };
    if (present) {
      Object.assign(body, { encoding_format: format });
    }
    const originalBody = { ...body };
    const promise = client.embeddings.create(body);
    const [call] = client.requests;
    const rawPromise = call?.response;

    expect(promise).toBeInstanceOf(APIPromise);
    expect(promise === rawPromise).toBe(explicit);
    expect(body).toEqual(originalBody);
    expect(client.requests).toHaveLength(1);
    expect(call?.path).toBe('/embeddings');
    expect(await call?.options).toEqual({
      body: { ...body, encoding_format: explicit ? format : 'base64' },
      __security: { bearerAuth: true },
    });

    const rawResponse = await promise.asResponse();
    expect(await rawResponse.clone().json()).toMatchObject({
      data: [{ embedding: format === 'float' ? vector : encodedVector }],
    });
    const response = await promise;
    const dataAndResponse = await promise.withResponse();
    expect(response.data[0]?.embedding).toEqual(format === 'base64' ? encodedVector : vector);
    expect(await rawPromise?.asResponse()).toBe(rawResponse);
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
    expect(dataAndResponse.request_id).toBe('req_embeddings');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(debug.mock.calls.filter(([message]) => String(message).startsWith('embeddings/'))).toEqual(
      explicit
        ? [['embeddings/user defined encoding_format:', format]]
        : [['embeddings/decoding base64 embeddings from base64']],
    );
  });

  test('preserves request-option precedence without mutating caller objects', async () => {
    const overrideBody = { ...request, input: 'overridden', encoding_format: 'base64' };
    const fetch = vi.fn<Fetch>(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toEqual(overrideBody);
      expect(new Headers(init?.headers).get('X-Custom')).toBe('kept');
      return embeddingResponse(encodedVector);
    });
    const client = new RecordingClient({ apiKey: 'test-key', fetch });
    const body = { ...request, encoding_format: 'float' as const };
    const headers = { 'X-Custom': 'kept' };
    const options: RequestOptions = {
      body: overrideBody,
      headers,
      __security: { adminAPIKeyAuth: true },
    };
    const originalOptions = { ...options };
    const promise = client.embeddings.create(body, options);

    const [call] = client.requests;
    const sentOptions = await call?.options;
    expect(promise).toBe(call?.response);
    expect(call?.path).toBe('/embeddings');
    expect(sentOptions).toEqual({
      ...options,
      __security: { bearerAuth: true },
    });
    expect(sentOptions?.body).toBe(overrideBody);
    expect(sentOptions?.headers).toBe(headers);
    const response = await promise;
    expect(response.data[0]?.embedding).toBe(encodedVector);
    expect(body).toEqual({ ...request, encoding_format: 'float' });
    expect(options).toEqual(originalOptions);
  });

  test('preserves response identity and sparse entries from custom parsers', async () => {
    const client = new OpenAI({ apiKey: 'test-key' });
    const entries: OpenAI.Embedding[] = [];
    const entry = {
      object: 'embedding' as const,
      index: 1,
      // The existing raw parser types the wire value as numeric before decoding.
      embedding: encodedVector as unknown as number[],
    };
    entries[1] = entry;
    const data: OpenAI.CreateEmbeddingResponse = {
      object: 'list',
      data: entries,
      model: request.model,
      usage: { prompt_tokens: 1, total_tokens: 1 },
    };
    const rawPromise = new APIPromise(
      client,
      Promise.resolve({
        response: new Response(null),
        options: { method: 'post', path: '/embeddings' },
        controller: new AbortController(),
        requestLogID: 'synthetic',
        retryOfRequestLogID: undefined,
        startTime: 0,
      }),
      () => data,
    );
    vi.spyOn(client, 'post').mockReturnValue(rawPromise);

    const result = await client.embeddings.create(request);
    expect(result).toBe(data);
    expect(result.data).toBe(entries);
    expect(result.data[1]).toBe(entry);
    expect(0 in result.data).toBe(false);
    expect(entry.embedding).toEqual(vector);
  });

  test('preserves the API error object through the decoding wrapper', async () => {
    const client = new RecordingClient({
      apiKey: 'test-key',
      maxRetries: 0,
      fetch: async () => Response.json({ error: { message: 'synthetic failure' } }, { status: 400 }),
    });
    const promise = client.embeddings.create(request);
    const [raw, wrapped] = await Promise.allSettled([client.requests[0]?.response, promise]);

    expect(raw.status).toBe('rejected');
    expect(wrapped.status).toBe('rejected');
    if (raw.status === 'rejected' && wrapped.status === 'rejected') {
      expect(wrapped.reason).toBe(raw.reason);
      expect(wrapped.reason).toBeInstanceOf(BadRequestError);
      expect(wrapped.reason.message).toContain('synthetic failure');
    }
  });
});
