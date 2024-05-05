import { AzureOpenAI } from 'openai';
import { APIUserAbortError } from 'openai';
import { Headers } from 'openai/core';
import defaultFetch, { Response, type RequestInit, type RequestInfo } from 'node-fetch';

const apiVersion = '2024-02-15-preview';

describe('instantiate azure client', () => {
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
    const client = new AzureOpenAI({
      baseURL: 'http://localhost:5000/',
      defaultHeaders: { 'X-My-Default-Header': '2' },
      apiKey: 'My API Key',
      apiVersion,
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
      const client = new AzureOpenAI({
        baseURL: 'http://localhost:5000/',
        defaultQuery: { apiVersion: 'foo' },
        apiKey: 'My API Key',
        apiVersion,
      });
      expect(client.buildURL('/foo', null)).toEqual(
        `http://localhost:5000/foo?apiVersion=foo&api-version=${apiVersion}`,
      );
    });

    test('multiple default query params', () => {
      const client = new AzureOpenAI({
        baseURL: 'http://localhost:5000/',
        defaultQuery: { apiVersion: 'foo', hello: 'world' },
        apiKey: 'My API Key',
        apiVersion,
      });
      expect(client.buildURL('/foo', null)).toEqual(
        `http://localhost:5000/foo?apiVersion=foo&hello=world&api-version=${apiVersion}`,
      );
    });

    test('overriding with `undefined`', () => {
      const client = new AzureOpenAI({
        baseURL: 'http://localhost:5000/',
        defaultQuery: { hello: 'world' },
        apiKey: 'My API Key',
        apiVersion,
      });
      expect(client.buildURL('/foo', { hello: undefined })).toEqual(
        `http://localhost:5000/foo?api-version=${apiVersion}`,
      );
    });
  });

  test('custom fetch', async () => {
    const client = new AzureOpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      apiVersion,
      fetch: (url) => {
        return Promise.resolve(
          new Response(JSON.stringify({ url, custom: true }), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      },
    });

    const response = await client.get('/foo');
    expect(response).toEqual({ url: `http://localhost:5000/foo?api-version=${apiVersion}`, custom: true });
  });

  test('custom signal', async () => {
    const client = new AzureOpenAI({
      baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
      apiKey: 'My API Key',
      apiVersion,
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

  describe('baseUrl', () => {
    test('trailing slash', () => {
      const client = new AzureOpenAI({
        baseURL: 'http://localhost:5000/custom/path/',
        apiKey: 'My API Key',
        apiVersion,
      });
      expect(client.buildURL('/foo', null)).toEqual(
        `http://localhost:5000/custom/path/foo?api-version=${apiVersion}`,
      );
    });

    test('no trailing slash', () => {
      const client = new AzureOpenAI({
        baseURL: 'http://localhost:5000/custom/path',
        apiKey: 'My API Key',
        apiVersion,
      });
      expect(client.buildURL('/foo', null)).toEqual(
        `http://localhost:5000/custom/path/foo?api-version=${apiVersion}`,
      );
    });

    afterEach(() => {
      process.env['OPENAI_BASE_URL'] = undefined;
    });

    test('explicit option', () => {
      const client = new AzureOpenAI({ baseURL: 'https://example.com', apiKey: 'My API Key', apiVersion });
      expect(client.baseURL).toEqual('https://example.com');
    });

    test('env variable', () => {
      process.env['OPENAI_BASE_URL'] = 'https://example.com/from_env';
      const client = new AzureOpenAI({ apiKey: 'My API Key', apiVersion });
      expect(client.baseURL).toEqual('https://example.com/from_env');
    });

    test('empty baseUrl/endpoint env variable', () => {
      process.env['OPENAI_BASE_URL'] = ''; // empty
      expect(() => new AzureOpenAI({ apiKey: 'My API Key', apiVersion })).toThrow(
        /Must provide one of the `baseURL` or `endpoint` arguments, or the `AZURE_OPENAI_ENDPOINT` environment variable/,
      );
    });

    test('blank baseUrl/endpoint env variable', () => {
      process.env['OPENAI_BASE_URL'] = '  '; // blank
      expect(() => new AzureOpenAI({ apiKey: 'My API Key', apiVersion })).toThrow(
        /Must provide one of the `baseURL` or `endpoint` arguments, or the `AZURE_OPENAI_ENDPOINT` environment variable/,
      );
    });
  });

  test('maxRetries option is correctly set', () => {
    const client = new AzureOpenAI({
      baseURL: 'https://example.com',
      maxRetries: 4,
      apiKey: 'My API Key',
      apiVersion,
    });
    expect(client.maxRetries).toEqual(4);

    // default
    const client2 = new AzureOpenAI({ baseURL: 'https://example.com', apiKey: 'My API Key', apiVersion });
    expect(client2.maxRetries).toEqual(2);
  });

  test('with environment variable arguments', () => {
    // set options via env var
    process.env['OPENAI_BASE_URL'] = 'https://example.com';
    process.env['AZURE_OPENAI_API_KEY'] = 'My API Key';
    process.env['OPENAI_API_VERSION'] = 'My API Version';
    const client = new AzureOpenAI();
    expect(client.baseURL).toBe('https://example.com');
    expect(client.apiKey).toBe('My API Key');
    expect(client.apiVersion).toBe('My API Version');
  });

  test('with overriden environment variable arguments', () => {
    // set options via env var
    process.env['AZURE_OPENAI_API_KEY'] = 'another My API Key';
    process.env['OPENAI_API_VERSION'] = 'another My API Version';
    const client = new AzureOpenAI({ baseURL: 'https://example.com', apiKey: 'My API Key', apiVersion });
    expect(client.apiKey).toBe('My API Key');
    expect(client.apiVersion).toBe(apiVersion);
  });

  describe('Azure Active Directory (AD)', () => {
    test('with azureADTokenProvider', () => {
      const client = new AzureOpenAI({
        baseURL: 'http://localhost:5000/',
        azureADTokenProvider: () => 'my token',
        apiVersion,
      });
      expect(client.buildRequest({ method: 'post', path: 'https://example.com' }).req.headers).toHaveProperty(
        'authorization',
        'Bearer my token',
      );
    });

    test('apiKey and azureADTokenProvider cant be combined', () => {
      expect(
        () =>
          new AzureOpenAI({
            baseURL: 'http://localhost:5000/',
            azureADTokenProvider: () => 'my token',
            apiKey: 'My API Key',
            apiVersion,
          }),
      ).toThrow(
        /The `apiKey` and `azureADTokenProvider` arguments are mutually exclusive; only one can be passed at a time./,
      );
    });
  });

  test('with endpoint', () => {
    const client = new AzureOpenAI({ endpoint: 'https://example.com', apiKey: 'My API Key', apiVersion });
    expect(client.baseURL).toEqual('https://example.com/openai');
  });

  test('baseURL and endpoint are mutually exclusive', () => {
    expect(
      () =>
        new AzureOpenAI({
          endpoint: 'https://example.com',
          baseURL: 'https://anotherexample.com',
          apiKey: 'My API Key',
          apiVersion,
        }),
    ).toThrow(/baseURL and endpoint are mutually exclusive/);
  });
});

describe('azure request building', () => {
  const client = new AzureOpenAI({ baseURL: 'https://example.com', apiKey: 'My API Key', apiVersion });

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

    const client = new AzureOpenAI({
      baseURL: 'https://example.com',
      apiKey: 'My API Key',
      apiVersion,
      timeout: 10,
      fetch: testFetch,
    });

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

    const client = new AzureOpenAI({
      baseURL: 'https://example.com',
      apiKey: 'My API Key',
      apiVersion,
      fetch: testFetch,
    });

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

    const client = new AzureOpenAI({
      baseURL: 'https://example.com',
      apiKey: 'My API Key',
      apiVersion,
      fetch: testFetch,
    });

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
