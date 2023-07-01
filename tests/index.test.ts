// File generated from our OpenAPI spec by Stainless.

import { Headers } from 'openai/core';
import OpenAI from 'openai';

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

  test('defaultHeaders are passed through', () => {
    const client = new OpenAI({ defaultHeaders: { 'X-My-Default-Header': '2' }, apiKey: 'my api key' });

    const { req } = client.buildRequest({ path: '/foo', method: 'post' });
    expect((req.headers as Headers)['X-My-Default-Header']).toEqual('2');
  });

  describe('baseUrl', () => {
    test('trailing slash', () => {
      const client = new OpenAI({ baseURL: 'http://localhost:5000/custom/path/', apiKey: 'my api key' });
      expect(client.buildURL('/foo', null)).toEqual('http://localhost:5000/custom/path/foo');
    });

    test('no trailing slash', () => {
      const client = new OpenAI({ baseURL: 'http://localhost:5000/custom/path', apiKey: 'my api key' });
      expect(client.buildURL('/foo', null)).toEqual('http://localhost:5000/custom/path/foo');
    });
  });

  test('maxRetries option is correctly set', () => {
    const client = new OpenAI({ maxRetries: 1, apiKey: 'my api key' });
    expect(client.maxRetries).toEqual(1);

    // default
    const client2 = new OpenAI({ apiKey: 'my api key' });
    expect(client2.maxRetries).toEqual(2);
  });

  test('with minimal arguments', () => {
    // set API Key via env var
    process.env['OPENAI_API_KEY'] = 'env var api key';
    const client = new OpenAI();
    expect(client.apiKey).toBe('env var api key');
  });

  test('with apiKey argument', () => {
    process.env['OPENAI_API_KEY'] = 'env var api key';

    const client = new OpenAI({ apiKey: 'another api key' });
    expect(client.apiKey).toBe('another api key');
  });

  test('with options argument', () => {
    process.env['OPENAI_API_KEY'] = 'env var api key';

    // apiKey
    const client = new OpenAI({ apiKey: 'my api key' });
    expect(client.apiKey).toBe('my api key');
  });

  test('with disabled authentication', () => {
    // fails if no API Key provided
    expect(() => {
      new OpenAI();
    }).toThrow();
  });
});
