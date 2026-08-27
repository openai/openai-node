import { vi } from 'vitest';

import type { ClientOptions } from 'openai/index';
import OpenAI from 'openai/index';
import type { RequestOptions } from 'openai/internal/request-options';
import { formatRequestDetails } from 'openai/internal/utils/log';

const opts: ClientOptions = {
  apiKey: 'example-api-key',
  baseURL: 'http://localhost:5000/',
  logLevel: 'debug',
  fetch: (url) =>
    Promise.resolve(
      Response.json(
        { url, custom: true },
        {
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    ),
};

describe('formatRequestDetails()', () => {
  test('omits header accessors while preserving own enumerable request options', () => {
    const metadata = Symbol('request metadata');
    const options = Object.create({ inherited: 'omitted' }) as RequestOptions;
    let visibleReads = 0;

    Object.defineProperties(options, {
      headers: {
        enumerable: true,
        get() {
          throw new Error('Request header diagnostics must never access the original headers.');
        },
      },
      visible: {
        enumerable: true,
        get() {
          visibleReads += 1;
          return 'preserved';
        },
      },
      hidden: { enumerable: false, value: 'omitted' },
      [metadata]: { enumerable: true, value: 'symbol metadata' },
      [String('__proto__')]: { enumerable: true, value: 'safe data property' },
    });

    const details = formatRequestDetails({ options });
    const loggedOptions = details.options ?? {};
    const expectedOptions = Object.fromEntries([
      ['visible', 'preserved'],
      [metadata, 'symbol metadata'],
      [String('__proto__'), 'safe data property'],
    ]);

    expect(visibleReads).toBe(1);
    expect(loggedOptions).toEqual(expectedOptions);
    expect(Object.getPrototypeOf(loggedOptions)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(loggedOptions, 'headers')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(loggedOptions, 'hidden')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(loggedOptions, 'inherited')).toBeUndefined();
  });

  test('redacts request paths, queries, and URLs without invoking original header accessors', () => {
    const readHeaders = vi.fn(() => {
      throw new Error('synthetic-private-header-credential');
    });
    const query = {
      X_Access_Token: 'synthetic-query-secret',
      visible: 'preserved',
    };
    const options = Object.defineProperty(
      {
        path: '/models?api_key=synthetic-path-secret&visible=preserved#synthetic-private-fragment',
        query,
      },
      'headers',
      { enumerable: true, get: readHeaders },
    ) as RequestOptions;

    const details = formatRequestDetails({
      options,
      url: 'https://synthetic-user:synthetic-password@example.test/models?client_secret=synthetic-url-secret&visible=preserved#synthetic-private-fragment',
    });

    expect(details.options).toEqual({
      path: '/models?api_key=***&visible=preserved',
      query: { X_Access_Token: '***', visible: 'preserved' },
    });
    expect(details.url).toBe('https://example.test/models?client_secret=***&visible=preserved');
    expect(readHeaders).not.toHaveBeenCalled();
    expect(query.X_Access_Token).toBe('synthetic-query-secret');
  });

  test.each([
    'Authorization',
    'Proxy-Authorization',
    'API-Key',
    'X-API-Key',
    'X-Amz-Security-Token',
    'X-Session-Token',
    'X-Session-Id',
    'X-Auth-Token',
    'X-ID-Token',
    'Client-Secret',
    'X_Access_Token',
    'Password',
    'Cookie',
    'Set-Cookie',
  ])('redacts the %s header without invoking its accessor', (name) => {
    const secret = 'private-header-credential';
    const readSecret = vi.fn(() => {
      throw new Error(secret);
    });
    const readVisible = vi.fn(() => 'preserved');
    const headers: Record<string, string> = {};
    Object.defineProperties(headers, {
      [name]: { enumerable: true, get: readSecret },
      'x-visible': { enumerable: true, get: readVisible },
    });

    expect(formatRequestDetails({ headers }).headers).toEqual({ [name]: '***', 'x-visible': 'preserved' });
    expect(readSecret).not.toHaveBeenCalled();
    expect(readVisible).toHaveBeenCalledTimes(1);
  });

  test('formats Headers subclasses without invoking an overridden iterator', () => {
    const iterate = vi.fn(() => {
      throw new Error('private-header-credential');
    });
    class HostileHeaders extends Headers {}
    Object.defineProperty(HostileHeaders.prototype, Symbol.iterator, { configurable: true, value: iterate });
    const headers = new HostileHeaders({ authorization: 'private-header-credential', 'x-visible': 'safe' });

    expect(formatRequestDetails({ headers }).headers).toEqual({ authorization: '***', 'x-visible': 'safe' });
    expect(iterate).not.toHaveBeenCalled();
  });

  test.each([
    'Authorization',
    'Proxy-Authorization',
    'API-Key',
    'X-API-Key',
    'X-Amz-Security-Token',
    'X-Session-Token',
    'X-Session-Id',
    'X-Auth-Token',
    'X-ID-Token',
    'Client-Secret',
    'X_Access_Token',
    'Password',
    'Cookie',
    'Set-Cookie',
  ])('redacts tuple-array %s headers without invoking their value accessors', (name) => {
    const readSecret = vi.fn(() => {
      throw new Error('private-header-credential');
    });
    const sensitive: [string, string] = [name, 'unused'];
    Object.defineProperty(sensitive, 1, { get: readSecret });
    const headers: [string, string][] = [sensitive, ['x-visible', 'preserved']];

    expect(formatRequestDetails({ headers }).headers).toEqual({ [name]: '***', 'x-visible': 'preserved' });
    expect(readSecret).not.toHaveBeenCalled();
  });

  test.each(['ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf'] as const)(
    'omits headers when a hostile proxy %s trap prevents safe inspection',
    (operation) => {
      const inspect = vi.fn(() => {
        throw Object.assign(new Error('private-header-credential'), {
          cause: new Error('private-header-credential'),
        });
      });
      const handler: ProxyHandler<Record<string, string>> = {};
      Object.defineProperty(handler, operation, { value: inspect });
      const headers = new Proxy({ 'api-key': 'private-header-credential' }, handler);

      expect(formatRequestDetails({ headers }).headers).toEqual({});
      expect(inspect).toHaveBeenCalledTimes(1);
    },
  );
});

describe('debug()', () => {
  const env = process.env;
  const spy = vi.spyOn(console, 'debug');

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...env };
    process.env['DEBUG'] = 'true';
  });

  afterEach(() => {
    process.env = env;
  });

  test('body request object with Authorization header', async () => {
    const client = new OpenAI(opts);
    await client.post('/example', {});

    // Check that console.debug was called with the redacted authorization header
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[log_'),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: '***',
        }),
      }),
    );
  });

  test('header object with Authorization header', async () => {
    // Test headers object with authorization header
    const client = new OpenAI({
      ...opts,
      defaultHeaders: {
        authorization: 'fakeValue',
      },
    });
    await client.post('/example', {});

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[log_'),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: '***',
        }),
      }),
    );
  });

  test('input args are not mutated', async () => {
    const authorizationTest = {
      authorization: 'fakeValue',
    };
    const client = new OpenAI({
      ...opts,
      defaultHeaders: authorizationTest,
    });

    const { req } = await client.buildRequest({ path: '/foo', method: 'post' });
    await client.post('/foo', {});

    // Verify that the original headers weren't mutated
    expect(authorizationTest.authorization).toEqual('fakeValue');
    expect((req.headers as Headers).get('authorization')).toEqual('fakeValue');

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[log_'),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: '***',
        }),
      }),
    );
  });

  test('input headers are not mutated', async () => {
    const authorizationTest = {
      authorization: 'fakeValue',
    };
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      defaultHeaders: authorizationTest,
      apiKey: 'api-key',
      logLevel: 'debug',
      fetch: opts.fetch,
    });

    const { req } = await client.buildRequest({ path: '/foo', method: 'post' });
    await client.post('/foo', {});

    // Verify that the original headers weren't mutated
    expect(authorizationTest.authorization).toEqual('fakeValue');
    expect((req.headers as Headers).get('authorization')).toEqual('fakeValue');

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[log_'),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: '***',
        }),
      }),
    );
  });
});
