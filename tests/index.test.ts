// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';
import { APIUserAbortError } from 'openai';
import { debug, Headers } from 'openai/core';
import defaultFetch, { Response, type RequestInit, type RequestInfo } from 'node-fetch';

describe('instantiate client', () => {
  const env = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...env };

    console.warn = jest.fn();
  });

  afterEach(() => {
    process.env = env;
  });

  describe('defaultHeaders', () => {
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      defaultHeaders: { 'X-My-Default-Header': '2' },
      apiKey: 'My API Key',
    });

    test('they are used in the request', () => {
      const { req } = client.buildRequest({ path: '/foo', method: 'post' });
      expect((req.headers as Headers)['x-my-default-header']).toEqual('2');
    });

    test('can ignore `undefined` and leave the default', () => {
      const { req } = client.buildRequest({
        path: '/foo',
        method: 'post',
        headers: { 'X-My-Default-Header': undefined },
      });
      expect((req.headers as Headers)['x-my-default-header']).toEqual('2');
    });

    test('can be removed with `null`', () => {
      const { req } = client.buildRequest({
        path: '/foo',
        method: 'post',
        headers: { 'X-My-Default-Header': null },
      });
      expect(req.headers as Headers).not.toHaveProperty('x-my-default-header');
    });
  });

  describe('defaultQuery', () => {
    test('with null query params given', () => {
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        defaultQuery: { apiVersion: 'foo' },
        apiKey: 'My API Key',
      });
      expect(client.buildURL('/foo', null)).toEqual('http://localhost:5000/foo?apiVersion=foo');
    });

    test('multiple default query params', () => {
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        defaultQuery: { apiVersion: 'foo', hello: 'world' },
        apiKey: 'My API Key',
      });
      expect(client.buildURL('/foo', null)).toEqual('http://localhost:5000/foo?apiVersion=foo&hello=world');
    });

    test('overriding with `undefined`', () => {
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        defaultQuery: { hello: 'world' },
        apiKey: 'My API Key',
      });
      expect(client.buildURL('/foo', { hello: undefined })).toEqual('http://localhost:5000/foo');
    });
  });

  test('custom fetch', async () => {
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      fetch: (url) => {
        return Promise.resolve(
          new Response(JSON.stringify({ url, custom: true }), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      },
    });

    const response = await client.get('/foo');
    expect(response).toEqual({ url: 'http://localhost:5000/foo', custom: true });
  });

  test('explicit global fetch', async () => {
    // make sure the global fetch type is assignable to our Fetch type
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      fetch: defaultFetch,
    });
  });

  test('custom signal', async () => {
    const client = new OpenAI({
      baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
      apiKey: 'My API Key',
      fetch: (...args) => {
        return new Promise((resolve, reject) =>
          setTimeout(
            () =>
              defaultFetch(...args)
                .then(resolve)
                .catch(reject),
            300,
          ),
        );
      },
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);

    const spy = jest.spyOn(client, 'request');

    await expect(client.get('/foo', { signal: controller.signal })).rejects.toThrowError(APIUserAbortError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('normalized method', async () => {
    let capturedRequest: RequestInit | undefined;
    const testFetch = async (url: RequestInfo, init: RequestInit = {}): Promise<Response> => {
      capturedRequest = init;
      return new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } });
    };

    const client = new OpenAI({ baseURL: 'http://localhost:5000/', apiKey: 'My API Key', fetch: testFetch });

    await client.patch('/foo');
    expect(capturedRequest?.method).toEqual('PATCH');
  });

  describe('baseUrl', () => {
    test('trailing slash', () => {
      const client = new OpenAI({ baseURL: 'http://localhost:5000/custom/path/', apiKey: 'My API Key' });
      expect(client.buildURL('/foo', null)).toEqual('http://localhost:5000/custom/path/foo');
    });

    test('no trailing slash', () => {
      const client = new OpenAI({ baseURL: 'http://localhost:5000/custom/path', apiKey: 'My API Key' });
      expect(client.buildURL('/foo', null)).toEqual('http://localhost:5000/custom/path/foo');
    });

    afterEach(() => {
      process.env['OPENAI_BASE_URL'] = undefined;
    });

    test('explicit option', () => {
      const client = new OpenAI({ baseURL: 'https://example.com', apiKey: 'My API Key' });
      expect(client.baseURL).toEqual('https://example.com');
    });

    test('env variable', () => {
      process.env['OPENAI_BASE_URL'] = 'https://example.com/from_env';
      const client = new OpenAI({ apiKey: 'My API Key' });
      expect(client.baseURL).toEqual('https://example.com/from_env');
    });

    test('empty env variable', () => {
      process.env['OPENAI_BASE_URL'] = ''; // empty
      const client = new OpenAI({ apiKey: 'My API Key' });
      expect(client.baseURL).toEqual('https://api.openai.com/v1');
    });

    test('blank env variable', () => {
      process.env['OPENAI_BASE_URL'] = '  '; // blank
      const client = new OpenAI({ apiKey: 'My API Key' });
      expect(client.baseURL).toEqual('https://api.openai.com/v1');
    });
  });

  test('maxRetries option is correctly set', () => {
    const client = new OpenAI({ maxRetries: 4, apiKey: 'My API Key' });
    expect(client.maxRetries).toEqual(4);

    // default
    const client2 = new OpenAI({ apiKey: 'My API Key' });
    expect(client2.maxRetries).toEqual(2);
  });

  test('with environment variable arguments', () => {
    // set options via env var
    process.env['OPENAI_API_KEY'] = 'My API Key';
    const client = new OpenAI();
    expect(client.apiKey).toBe('My API Key');
  });

  test('with overridden environment variable arguments', () => {
    // set options via env var
    process.env['OPENAI_API_KEY'] = 'another My API Key';
    const client = new OpenAI({ apiKey: 'My API Key' });
    expect(client.apiKey).toBe('My API Key');
  });
});

describe('request building', () => {
  const client = new OpenAI({ apiKey: 'My API Key' });

  describe('Content-Length', () => {
    test('handles multi-byte characters', () => {
      const { req } = client.buildRequest({ path: '/foo', method: 'post', body: { value: '—' } });
      expect((req.headers as Record<string, string>)['content-length']).toEqual('20');
    });

    test('handles standard characters', () => {
      const { req } = client.buildRequest({ path: '/foo', method: 'post', body: { value: 'hello' } });
      expect((req.headers as Record<string, string>)['content-length']).toEqual('22');
    });
  });

  describe('custom headers', () => {
    test('handles undefined', () => {
      const { req } = client.buildRequest({
        path: '/foo',
        method: 'post',
        body: { value: 'hello' },
        headers: { 'X-Foo': 'baz', 'x-foo': 'bar', 'x-Foo': undefined, 'x-baz': 'bam', 'X-Baz': null },
      });
      expect((req.headers as Record<string, string>)['x-foo']).toEqual('bar');
      expect((req.headers as Record<string, string>)['x-Foo']).toEqual(undefined);
      expect((req.headers as Record<string, string>)['X-Foo']).toEqual(undefined);
      expect((req.headers as Record<string, string>)['x-baz']).toEqual(undefined);
    });
  });
});

describe('retries', () => {
  test('retry on timeout', async () => {
    let count = 0;
    const testFetch = async (url: RequestInfo, { signal }: RequestInit = {}): Promise<Response> => {
      if (count++ === 0) {
        return new Promise(
          (resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('timed out'))),
        );
      }
      return new Response(JSON.stringify({ a: 1 }), { headers: { 'Content-Type': 'application/json' } });
    };

    const client = new OpenAI({ apiKey: 'My API Key', timeout: 10, fetch: testFetch });

    expect(await client.request({ path: '/foo', method: 'get' })).toEqual({ a: 1 });
    expect(count).toEqual(2);
    expect(
      await client
        .request({ path: '/foo', method: 'get' })
        .asResponse()
        .then((r) => r.text()),
    ).toEqual(JSON.stringify({ a: 1 }));
    expect(count).toEqual(3);
  });

  test('retry count header', async () => {
    let count = 0;
    let capturedRequest: RequestInit | undefined;
    const testFetch = async (url: RequestInfo, init: RequestInit = {}): Promise<Response> => {
      count++;
      if (count <= 2) {
        return new Response(undefined, {
          status: 429,
          headers: {
            'Retry-After': '0.1',
          },
        });
      }
      capturedRequest = init;
      return new Response(JSON.stringify({ a: 1 }), { headers: { 'Content-Type': 'application/json' } });
    };

    const client = new OpenAI({ apiKey: 'My API Key', fetch: testFetch, maxRetries: 4 });

    expect(await client.request({ path: '/foo', method: 'get' })).toEqual({ a: 1 });

    expect((capturedRequest!.headers as Headers)['x-stainless-retry-count']).toEqual('2');
    expect(count).toEqual(3);
  });

  test('omit retry count header', async () => {
    let count = 0;
    let capturedRequest: RequestInit | undefined;
    const testFetch = async (url: RequestInfo, init: RequestInit = {}): Promise<Response> => {
      count++;
      if (count <= 2) {
        return new Response(undefined, {
          status: 429,
          headers: {
            'Retry-After': '0.1',
          },
        });
      }
      capturedRequest = init;
      return new Response(JSON.stringify({ a: 1 }), { headers: { 'Content-Type': 'application/json' } });
    };
    const client = new OpenAI({ apiKey: 'My API Key', fetch: testFetch, maxRetries: 4 });

    expect(
      await client.request({
        path: '/foo',
        method: 'get',
        headers: { 'X-Stainless-Retry-Count': null },
      }),
    ).toEqual({ a: 1 });

    expect(capturedRequest!.headers as Headers).not.toHaveProperty('x-stainless-retry-count');
  });

  test('omit retry count header by default', async () => {
    let count = 0;
    let capturedRequest: RequestInit | undefined;
    const testFetch = async (url: RequestInfo, init: RequestInit = {}): Promise<Response> => {
      count++;
      if (count <= 2) {
        return new Response(undefined, {
          status: 429,
          headers: {
            'Retry-After': '0.1',
          },
        });
      }
      capturedRequest = init;
      return new Response(JSON.stringify({ a: 1 }), { headers: { 'Content-Type': 'application/json' } });
    };
    const client = new OpenAI({
      apiKey: 'My API Key',
      fetch: testFetch,
      maxRetries: 4,
      defaultHeaders: { 'X-Stainless-Retry-Count': null },
    });

    expect(
      await client.request({
        path: '/foo',
        method: 'get',
      }),
    ).toEqual({ a: 1 });

    expect(capturedRequest!.headers as Headers).not.toHaveProperty('x-stainless-retry-count');
  });

  test('overwrite retry count header', async () => {
    let count = 0;
    let capturedRequest: RequestInit | undefined;
    const testFetch = async (url: RequestInfo, init: RequestInit = {}): Promise<Response> => {
      count++;
      if (count <= 2) {
        return new Response(undefined, {
          status: 429,
          headers: {
            'Retry-After': '0.1',
          },
        });
      }
      capturedRequest = init;
      return new Response(JSON.stringify({ a: 1 }), { headers: { 'Content-Type': 'application/json' } });
    };
    const client = new OpenAI({ apiKey: 'My API Key', fetch: testFetch, maxRetries: 4 });

    expect(
      await client.request({
        path: '/foo',
        method: 'get',
        headers: { 'X-Stainless-Retry-Count': '42' },
      }),
    ).toEqual({ a: 1 });

    expect((capturedRequest!.headers as Headers)['x-stainless-retry-count']).toBe('42');
  });

  test('retry on 429 with retry-after', async () => {
    let count = 0;
    const testFetch = async (url: RequestInfo, { signal }: RequestInit = {}): Promise<Response> => {
      if (count++ === 0) {
        return new Response(undefined, {
          status: 429,
          headers: {
            'Retry-After': '0.1',
          },
        });
      }
      return new Response(JSON.stringify({ a: 1 }), { headers: { 'Content-Type': 'application/json' } });
    };

    const client = new OpenAI({ apiKey: 'My API Key', fetch: testFetch });

    expect(await client.request({ path: '/foo', method: 'get' })).toEqual({ a: 1 });
    expect(count).toEqual(2);
    expect(
      await client
        .request({ path: '/foo', method: 'get' })
        .asResponse()
        .then((r) => r.text()),
    ).toEqual(JSON.stringify({ a: 1 }));
    expect(count).toEqual(3);
  });

  test('retry on 429 with retry-after-ms', async () => {
    let count = 0;
    const testFetch = async (url: RequestInfo, { signal }: RequestInit = {}): Promise<Response> => {
      if (count++ === 0) {
        return new Response(undefined, {
          status: 429,
          headers: {
            'Retry-After-Ms': '10',
          },
        });
      }
      return new Response(JSON.stringify({ a: 1 }), { headers: { 'Content-Type': 'application/json' } });
    };

    const client = new OpenAI({ apiKey: 'My API Key', fetch: testFetch });

    expect(await client.request({ path: '/foo', method: 'get' })).toEqual({ a: 1 });
    expect(count).toEqual(2);
    expect(
      await client
        .request({ path: '/foo', method: 'get' })
        .asResponse()
        .then((r) => r.text()),
    ).toEqual(JSON.stringify({ a: 1 }));
    expect(count).toEqual(3);
  });
});

describe('debug()', () => {
  const env = process.env;
  const spy = jest.spyOn(console, 'log');

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...env };
    process.env['DEBUG'] = 'true';
  });

  afterEach(() => {
    process.env = env;
  });

  test('body request object with Authorization header', function () {
    // Test request body includes headers object with Authorization
    const headersTest = {
      headers: {
        Authorization: 'fakeAuthorization',
      },
    };
    debug('request', headersTest);
    expect(spy).toHaveBeenCalledWith('OpenAI:DEBUG:request', {
      headers: {
        Authorization: 'REDACTED',
      },
    });
  });

  test('body request object with api-key header', function () {
    // Test request body includes headers object with api-ley
    const apiKeyTest = {
      headers: {
        'api-key': 'fakeKey',
      },
    };
    debug('request', apiKeyTest);
    expect(spy).toHaveBeenCalledWith('OpenAI:DEBUG:request', {
      headers: {
        'api-key': 'REDACTED',
      },
    });
  });

  test('header object with Authorization header', function () {
    // Test headers object with authorization header
    const authorizationTest = {
      authorization: 'fakeValue',
    };
    debug('request', authorizationTest);
    expect(spy).toHaveBeenCalledWith('OpenAI:DEBUG:request', {
      authorization: 'REDACTED',
    });
  });

  test('input args are not mutated', function () {
    const authorizationTest = {
      authorization: 'fakeValue',
    };
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      defaultHeaders: authorizationTest,
      apiKey: 'api-key',
    });

    const { req } = client.buildRequest({ path: '/foo', method: 'post' });
    debug('request', authorizationTest);
    expect((req.headers as Headers)['authorization']).toEqual('fakeValue');
    expect(spy).toHaveBeenCalledWith('OpenAI:DEBUG:request', {
      authorization: 'REDACTED',
    });
  });

  test('input headers are not mutated', function () {
    const authorizationTest = {
      authorization: 'fakeValue',
    };
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      defaultHeaders: authorizationTest,
      apiKey: 'api-key',
    });

    const { req } = client.buildRequest({ path: '/foo', method: 'post' });
    debug('request', { headers: req.headers });
    expect((req.headers as Headers)['authorization']).toEqual('fakeValue');
    expect(spy).toHaveBeenCalledWith('OpenAI:DEBUG:request', {
      authorization: 'REDACTED',
    });
  });
});
