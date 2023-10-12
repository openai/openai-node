// File generated from our OpenAPI spec by Stainless.

import OpenAI from 'openai';
import { APIUserAbortError } from 'openai';
import { Headers } from 'openai/core';
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
      expect((req.headers as Headers)['X-My-Default-Header']).toEqual('2');
    });

    test('can be overriden with `undefined`', () => {
      const { req } = client.buildRequest({
        path: '/foo',
        method: 'post',
        headers: { 'X-My-Default-Header': undefined },
      });
      expect((req.headers as Headers)['X-My-Default-Header']).toBeUndefined();
    });

    test('can be overriden with `null`', () => {
      const { req } = client.buildRequest({
        path: '/foo',
        method: 'post',
        headers: { 'X-My-Default-Header': null },
      });
      expect((req.headers as Headers)['X-My-Default-Header']).toBeUndefined();
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

  describe('baseUrl', () => {
    test('trailing slash', () => {
      const client = new OpenAI({ baseURL: 'http://localhost:5000/custom/path/', apiKey: 'My API Key' });
      expect(client.buildURL('/foo', null)).toEqual('http://localhost:5000/custom/path/foo');
    });

    test('no trailing slash', () => {
      const client = new OpenAI({ baseURL: 'http://localhost:5000/custom/path', apiKey: 'My API Key' });
      expect(client.buildURL('/foo', null)).toEqual('http://localhost:5000/custom/path/foo');
    });
  });

  test('maxRetries option is correctly set', () => {
    const client = new OpenAI({ maxRetries: 1, apiKey: 'My API Key' });
    expect(client.maxRetries).toEqual(1);

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

  test('with overriden environment variable arguments', () => {
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
      expect((req.headers as Record<string, string>)['Content-Length']).toEqual('20');
    });

    test('handles standard characters', () => {
      const { req } = client.buildRequest({ path: '/foo', method: 'post', body: { value: 'hello' } });
      expect((req.headers as Record<string, string>)['Content-Length']).toEqual('22');
    });
  });
});

describe('retries', () => {
  test('single retry', async () => {
    let count = 0;
    const testFetch = async (url: RequestInfo, { signal }: RequestInit = {}): Promise<Response> => {
      if (!count++)
        return new Promise((resolve, reject) =>
          signal?.addEventListener('abort', () => reject(new Error('timed out'))),
        );
      return new Response(JSON.stringify({ a: 1 }), { headers: { 'Content-Type': 'application/json' } });
    };

    const client = new OpenAI({ apiKey: 'My API Key', timeout: 2000, fetch: testFetch });

    expect(await client.request({ path: '/foo', method: 'get' })).toEqual({ a: 1 });
    expect(count).toEqual(2);
    expect(
      await client
        .request({ path: '/foo', method: 'get' })
        .asResponse()
        .then((r) => r.text()),
    ).toEqual(JSON.stringify({ a: 1 }));
    expect(count).toEqual(3);
  }, 10000);
});
