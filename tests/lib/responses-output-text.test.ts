import OpenAI from 'openai';
import { APIPromise } from 'openai/api-promise';
import type { RequestOptions } from 'openai/internal/request-options';
import type { PromiseOrValue } from 'openai/internal/types';
import { Stream } from 'openai/streaming';
import { vi } from 'vitest';

function mockResponseParser(client: OpenAI, method: 'create' | 'retrieve', parse: () => unknown) {
  const rawResponse = new Response(null, { headers: { 'x-request-id': 'req_output_text' } });
  const parser = vi.fn(parse);
  const rawPromise = new APIPromise(
    client,
    Promise.resolve({
      response: rawResponse,
      options: { method: method === 'create' ? 'post' : 'get', path: '/responses' },
      controller: new AbortController(),
      requestLogID: 'synthetic',
      retryOfRequestLogID: undefined,
      startTime: 0,
    }),
    parser,
  );
  const requests: { path: string; options: PromiseOrValue<RequestOptions> | undefined }[] = [];
  // A promise-returning spy observes settlement and would eagerly invoke the parser.
  client[method === 'create' ? 'post' : 'get'] = function request<Rsp>(
    path: string,
    options?: PromiseOrValue<RequestOptions>,
  ): APIPromise<Rsp> {
    requests.push({ path, options });
    return rawPromise as APIPromise<Rsp>;
  };
  return { rawResponse, rawPromise, parser, requests };
}

describe('resource responses output_text', () => {
  const responseID = 'resp_677efb5139a88190b512bc3fef8e535d';

  test.each(['create', 'retrieve'] as const)('%s', async (method) => {
    const client = new OpenAI({
      apiKey: 'My API Key',
      fetch: async () => Response.json({ id: responseID, object: 'response', output: [] }),
    });
    const responsePromise =
      method === 'create' ? client.responses.create({}) : client.responses.retrieve(responseID);
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);

    expect(response).toHaveProperty('output_text');
    expect(typeof response.output_text).toBe('string');
  });

  describe.each(['create', 'retrieve'] as const)('%s compatibility', (method) => {
    function start(client: OpenAI, params: { stream?: boolean } = {}, options?: RequestOptions) {
      return method === 'create'
        ? client.responses.create(params, options)
        : client.responses.retrieve(responseID, params, options);
    }

    test('enriches the original response lazily, once, across all output messages', async () => {
      const client = new OpenAI({ apiKey: 'test-key' });
      const data = {
        object: 'response',
        output_text: 'server value',
        output: [
          { type: 'function_call', arguments: '{}' },
          {
            type: 'message',
            content: [
              { type: 'output_text', text: 'Hello' },
              { type: 'refusal', refusal: 'not output text' },
              { type: 'output_text', text: ' ' },
            ],
          },
          { type: 'message', content: [{ type: 'output_text', text: 'world!' }] },
        ],
      };
      const { rawResponse, rawPromise, parser } = mockResponseParser(client, method, () => data);
      const promise = start(client);

      expect(promise).toBeInstanceOf(APIPromise);
      expect(promise).not.toBe(rawPromise);
      expect(await promise.asResponse()).toBe(rawResponse);
      expect(parser).not.toHaveBeenCalled();
      expect(data.output_text).toBe('server value');

      const response = await promise;
      expect(response).toBe(data);
      expect(data.output_text).toBe('Hello world!');
      expect(await promise.withResponse()).toEqual({
        data,
        response: rawResponse,
        request_id: 'req_output_text',
      });
      expect(await promise).toBe(data);
      expect(response._request_id).toBe('req_output_text');
      expect(parser).toHaveBeenCalledTimes(1);
    });

    test.each([
      { name: 'missing', data: { output_text: 'unchanged' } },
      { name: 'different', data: { object: 'other', output_text: 'unchanged' } },
    ])('passes through a $name response discriminator', async ({ data }) => {
      const client = new OpenAI({ apiKey: 'test-key' });
      mockResponseParser(client, method, () => data);
      expect(await start(client)).toBe(data);
      expect(data.output_text).toBe('unchanged');
    });

    test('recognizes an inherited response discriminator', async () => {
      const client = new OpenAI({ apiKey: 'test-key' });
      const data = Object.assign(Object.create({ object: 'response' }) as object, {
        output: [],
        output_text: 'server value',
      });
      mockResponseParser(client, method, () => data);
      expect(await start(client)).toBe(data);
      expect(data.output_text).toBe('');
    });

    test.each([
      { name: 'null', value: null },
      { name: 'undefined', value: undefined },
      { name: 'string', value: 'response' },
      { name: 'number', value: 1 },
      { name: 'missing output', value: { object: 'response' } },
      {
        name: 'read-only output text',
        value: Object.freeze({ object: 'response', output: [], output_text: 'fixed' }),
      },
    ])('retains the TypeError for $name parser output', async ({ value }) => {
      const client = new OpenAI({ apiKey: 'test-key' });
      const { rawResponse, parser } = mockResponseParser(client, method, () => value);
      const promise = start(client);
      expect(await promise.asResponse()).toBe(rawResponse);
      expect(parser).not.toHaveBeenCalled();
      await expect(promise).rejects.toBeInstanceOf(TypeError);
    });

    test('preserves parser errors and raw-response access', async () => {
      const client = new OpenAI({ apiKey: 'test-key' });
      const error = new Error('synthetic parser failure');
      const { rawResponse, parser } = mockResponseParser(client, method, () => {
        throw error;
      });
      const promise = start(client);
      await expect(promise).rejects.toBe(error);
      await expect(promise.withResponse()).rejects.toBe(error);
      expect(await promise.asResponse()).toBe(rawResponse);
      expect(parser).toHaveBeenCalledTimes(1);
    });

    test.each([
      { name: 'omitted', params: {}, expected: false },
      { name: 'undefined', params: { stream: undefined }, expected: false },
      { name: 'null from JavaScript', params: { stream: null }, expected: false },
      { name: 'false', params: { stream: false }, expected: false },
      { name: 'true', params: { stream: true }, expected: true },
    ])('preserves $name streaming and request-option precedence', async ({ params, expected }) => {
      const client = new OpenAI({ apiKey: 'test-key' });
      const { requests } = mockResponseParser(client, method, () => ({ object: 'other' }));
      const body = { input: 'option body' };
      const query = { include: ['message.output_text.logprobs'] };
      const headers = { 'X-Custom': 'kept' };
      const options: RequestOptions = {
        body,
        query,
        headers,
        stream: !expected,
        __security: { adminAPIKeyAuth: true },
      };
      const originalOptions = { ...options };
      const originalParams = { ...params };
      await start(client, params as { stream?: boolean }, options);

      expect(requests).toEqual([
        {
          path: method === 'create' ? '/responses' : `/responses/${responseID}`,
          options: { ...options, stream: expected, __security: { bearerAuth: true } },
        },
      ]);
      const sentOptions = await requests[0]?.options;
      expect(sentOptions?.body).toBe(body);
      expect(sentOptions?.query).toBe(query);
      expect(sentOptions?.headers).toBe(headers);
      expect(options).toEqual(originalOptions);
      expect(params).toEqual(originalParams);
    });

    test('forwards the original input object when options do not override it', async () => {
      const client = new OpenAI({ apiKey: 'test-key' });
      const { requests } = mockResponseParser(client, method, () => ({ object: 'other' }));
      const params = { stream: false };
      await start(client, params);
      const options = await requests[0]?.options;
      expect(method === 'create' ? options?.body : options?.query).toBe(params);
      expect(params).toEqual({ stream: false });
    });

    test('passes through streaming data and keeps response accessors', async () => {
      const event = { type: 'response.output_text.delta', delta: 'hello', sequence_number: 1 };
      const rawResponse = new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
        headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_stream' },
      });
      const client = new OpenAI({ apiKey: 'test-key', fetch: async () => rawResponse });
      const promise =
        method === 'create'
          ? client.responses.create({ stream: true })
          : client.responses.retrieve(responseID, { stream: true });
      expect(await promise.asResponse()).toBe(rawResponse);
      expect(rawResponse.bodyUsed).toBe(false);
      const stream = await promise;
      expect(stream).toBeInstanceOf(Stream);
      expect('output_text' in stream).toBe(false);
      const dataAndResponse = await promise.withResponse();
      expect(dataAndResponse.data).toBe(stream);
      expect(dataAndResponse.response).toBe(rawResponse);
      expect(dataAndResponse.request_id).toBe('req_stream');
      const events = [];
      for await (const item of stream) {
        events.push(item);
      }
      expect(events).toEqual([event]);
    });
  });
});
