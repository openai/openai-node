import OpenAI, { ClientOptions } from 'openai/index';

const opts: ClientOptions = {
  apiKey: 'example-api-key',
  baseURL: 'http://localhost:5000/',
  logLevel: 'debug',
  fetch: (url) => {
    return Promise.resolve(
      new Response(JSON.stringify({ url, custom: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  },
};

describe('debug()', () => {
  const env = process.env;
  const spy = jest.spyOn(console, 'debug');

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...env };
    process.env['DEBUG'] = 'true';
  });

  afterEach(() => {
    process.env = env;
  });

  test('body request object with Authorization header', async function () {
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

  test('header object with Authorization header', async function () {
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

  test('input args are not mutated', async function () {
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

  test('input headers are not mutated', async function () {
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
