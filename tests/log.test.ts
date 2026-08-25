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
    });
    Object.defineProperty(options, '__proto__', { enumerable: true, value: 'safe data property' });

    const details = formatRequestDetails({ options });
    const loggedOptions = details.options ?? {};

    expect(visibleReads).toBe(1);
    expect(loggedOptions).toEqual({
      visible: 'preserved',
      [metadata]: 'symbol metadata',
      ['__proto__']: 'safe data property',
    });
    expect(Object.getPrototypeOf(loggedOptions)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(loggedOptions, 'headers')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(loggedOptions, 'hidden')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(loggedOptions, 'inherited')).toBeUndefined();
  });
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
