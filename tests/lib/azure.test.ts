import { vi } from 'vitest';
import { AzureOpenAI, APIUserAbortError, OpenAIError, toStreamingFile } from 'openai';
import type { AzureClientOptions } from 'openai';
import type { RequestInit, RequestInfo, Response } from 'openai/internal/builtin-types';

const defaultFetch = fetch;

const apiVersion = '2024-02-15-preview';
const deployment = 'deployment';
const model = 'unused model';

describe('instantiate azure client', () => {
  const env = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...env };

    console.warn = vi.fn();
  });

  afterEach(() => {
    process.env = env;
  });

  test('exports AzureClientOptions from the package root', () => {
    const options: AzureClientOptions = {
      baseURL: 'https://example.com',
      apiKey: 'My API Key',
      apiVersion,
    };

    const client = new AzureOpenAI(options);
    expect(client.baseURL).toEqual('https://example.com');
  });

  describe('defaultHeaders', () => {
    const client = new AzureOpenAI({
      baseURL: 'http://localhost:5000/',
      defaultHeaders: { 'X-My-Default-Header': '2' },
      apiKey: 'My API Key',
      apiVersion,
    });

    test('they are used in the request', async () => {
      const { req } = await client.buildRequest({ path: '/foo', method: 'post' });
      expect(req.headers.get('x-my-default-header')).toEqual('2');
    });

    test('can ignore `undefined` and leave the default', async () => {
      const { req } = await client.buildRequest({
        path: '/foo',
        method: 'post',
        headers: { 'X-My-Default-Header': undefined },
      });
      expect(req.headers.get('x-my-default-header')).toEqual('2');
    });

    test('can be removed with `null`', async () => {
      const { req } = await client.buildRequest({
        path: '/foo',
        method: 'post',
        headers: { 'X-My-Default-Header': null },
      });
      expect(req.headers.has('x-my-default-header')).toBe(false);
    });

    test('can explicitly omit api-key with `null`', async () => {
      const { req } = await client.buildRequest({
        path: '/foo',
        method: 'post',
        headers: { 'api-key': null },
      });
      expect(req.headers.has('api-key')).toBe(false);
    });

    test('includes retry count', async () => {
      const { req } = await client.buildRequest(
        {
          path: '/foo',
          method: 'post',
          headers: { 'X-My-Default-Header': null },
        },
        { retryCount: 1 },
      );
      expect(req.headers.get('x-stainless-retry-count')).toEqual('1');
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
      fetch: (url) =>
        Promise.resolve(
          Response.json(
            { url, custom: true },
            {
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        ),
    });

    const response = await client.get('/foo');
    expect(response).toEqual({ url: `http://localhost:5000/foo?api-version=${apiVersion}`, custom: true });
  });

  test('custom signal', async () => {
    const client = new AzureOpenAI({
      baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
      apiKey: 'My API Key',
      apiVersion,
      fetch: (...args) =>
        new Promise((resolve, reject) =>
          setTimeout(
            () =>
              defaultFetch(...args)
                .then(resolve)
                .catch(reject),
            300,
          ),
        ),
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);

    const spy = vi.spyOn(client, 'request');

    await expect(client.get('/foo', { signal: controller.signal })).rejects.toThrow(APIUserAbortError);
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
    describe('browser credential safety', () => {
      beforeEach(() => {
        delete process.env['AZURE_OPENAI_API_KEY'];
        vi.stubGlobal('window', { document: {} });
        vi.stubGlobal('navigator', {});
      });

      afterEach(() => {
        vi.unstubAllGlobals();
      });

      test('honors explicit browser denial before obtaining credentials or sending requests', () => {
        const azureADTokenProvider = vi.fn(async () => 'AZURE_ENTRA_BEARER_SECRET');
        const customFetch = vi.fn();
        const createClient = () =>
          new AzureOpenAI({
            baseURL: 'https://example.com',
            apiVersion,
            azureADTokenProvider,
            dangerouslyAllowBrowser: false,
            fetch: customFetch,
          });

        expect(createClient).toThrow(OpenAIError);
        expect(createClient).toThrow(/running in a browser-like environment/);
        expect(azureADTokenProvider).not.toHaveBeenCalled();
        expect(customFetch).not.toHaveBeenCalled();
      });

      test.each([undefined, true])(
        'preserves Microsoft Entra browser access when dangerouslyAllowBrowser is %s',
        async (dangerouslyAllowBrowser) => {
          const azureADTokenProvider = vi.fn(async () => 'AZURE_ENTRA_BEARER_SECRET');
          const customFetch = vi.fn(
            async (_url: RequestInfo, { headers }: RequestInit = {}): Promise<Response> =>
              new globalThis.Response(JSON.stringify({ ok: true }), { headers: headers ?? [] }),
          );
          const client = new AzureOpenAI({
            baseURL: 'https://example.com',
            apiVersion,
            azureADTokenProvider,
            dangerouslyAllowBrowser,
            fetch: customFetch,
          });

          expect(client).toHaveProperty('_options.dangerouslyAllowBrowser', true);

          const response = await client.request({ method: 'get', path: '/foo' }).asResponse();

          expect(response.headers.get('authorization')).toBe('Bearer AZURE_ENTRA_BEARER_SECRET');
          expect(azureADTokenProvider).toHaveBeenCalledTimes(1);
          expect(customFetch).toHaveBeenCalledTimes(1);
        },
      );

      test('continues to reject static Azure API keys in browsers', () => {
        const customFetch = vi.fn();

        expect(
          () =>
            new AzureOpenAI({
              baseURL: 'https://example.com',
              apiVersion,
              apiKey: 'My API Key',
              fetch: customFetch,
            }),
        ).toThrow(OpenAIError);
        expect(customFetch).not.toHaveBeenCalled();
      });
    });

    test('preserves explicit browser denial outside browser environments', () => {
      delete process.env['AZURE_OPENAI_API_KEY'];

      const azureADTokenProvider = vi.fn(async () => 'AZURE_ENTRA_BEARER_SECRET');
      const client = new AzureOpenAI({
        baseURL: 'https://example.com',
        apiVersion,
        azureADTokenProvider,
        dangerouslyAllowBrowser: false,
      });

      expect(client).toHaveProperty('_options.dangerouslyAllowBrowser', false);
      expect(azureADTokenProvider).not.toHaveBeenCalled();
    });

    test('with azureADTokenProvider', async () => {
      const testFetch = async (url: RequestInfo, { headers }: RequestInit = {}): Promise<Response> =>
        Response.json({ a: 1 }, { headers: headers ?? [] });
      const client = new AzureOpenAI({
        baseURL: 'http://localhost:5000/',
        azureADTokenProvider: async () => 'my token',
        apiVersion,
        fetch: testFetch,
      });
      const response = await client.request({ method: 'post', path: 'https://example.com' }).asResponse();
      expect(response.headers.get('authorization')).toEqual('Bearer my token');
    });

    test('apiKey and azureADTokenProvider cant be combined', () => {
      expect(
        () =>
          new AzureOpenAI({
            baseURL: 'http://localhost:5000/',
            azureADTokenProvider: async () => 'my token',
            apiKey: 'My API Key',
            apiVersion,
          }),
      ).toThrow(
        /The `apiKey` and `azureADTokenProvider` arguments are mutually exclusive; only one can be passed at a time./,
      );
    });

    test('AAD token is refreshed', async () => {
      let fail = true;
      const testFetch = async (url: RequestInfo, { headers }: RequestInit = {}): Promise<Response> => {
        if (fail) {
          fail = false;
          return new Response(undefined, {
            status: 429,
            headers: {
              'Retry-After': '0.1',
            },
          });
        }
        return Response.json(
          {},
          {
            headers: headers ?? [],
          },
        );
      };
      let counter = 0;
      async function azureADTokenProvider() {
        return `token-${counter++}`;
      }
      const client = new AzureOpenAI({
        baseURL: 'http://localhost:5000/',
        azureADTokenProvider,
        apiVersion,
        fetch: testFetch,
      });
      const response = await client.chat.completions
        .create({
          model,
          messages: [{ role: 'system', content: 'Hello' }],
        })
        .asResponse();
      expect(response.headers.get('authorization')).toEqual('Bearer token-1');
    });
  });

  test('uses api-key header when apiKey is provided', async () => {
    const testFetch = async (url: RequestInfo, { headers }: RequestInit = {}): Promise<Response> =>
      Response.json({ a: 1 }, { headers: headers ?? [] });
    const client = new AzureOpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      apiVersion,
      fetch: testFetch,
    });

    const res = await client.request({ method: 'post', path: 'https://example.com' }).asResponse();
    expect(res.headers.get('api-key')).toEqual('My API Key');
    expect(res.headers.get('authorization')).toEqual(null);
  });

  test('with endpoint', () => {
    const client = new AzureOpenAI({ endpoint: 'https://example.com', apiKey: 'My API Key', apiVersion });
    expect(client.baseURL).toEqual('https://example.com/openai');
  });

  test.each(['https://example.com/', 'https://example.com///'])(
    'with endpoint trailing slashes',
    (endpoint) => {
      const client = new AzureOpenAI({ endpoint, apiKey: 'My API Key', apiVersion });
      expect(client.baseURL).toEqual('https://example.com/openai');
    },
  );

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

  describe('model to deployment mapping', () => {
    const testFetch = async (url: RequestInfo): Promise<Response> =>
      Response.json({ url }, { headers: { 'content-type': 'application/json' } });
    describe('with client-level deployment', () => {
      const client = new AzureOpenAI({
        endpoint: 'https://example.com',
        apiKey: 'My API Key',
        apiVersion,
        deployment,
        fetch: testFetch,
      });

      test('handles Batch', async () => {
        expect(
          await client.batches.create({
            completion_window: '24h',
            endpoint: '/v1/chat/completions',
            input_file_id: 'file-id',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/batches?api-version=${apiVersion}`,
        });
      });

      test('handles completions', async () => {
        expect(
          await client.completions.create({
            model,
            prompt: 'prompt',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/completions?api-version=${apiVersion}`,
        });
      });

      test('handles chat completions', async () => {
        expect(
          await client.chat.completions.create({
            model,
            messages: [{ role: 'system', content: 'Hello' }],
          }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
        });
      });

      test('handles embeddings', async () => {
        expect(
          await client.embeddings.create({
            model,
            input: 'input',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/embeddings?api-version=${apiVersion}`,
        });
      });

      test('handles audio translations', async () => {
        expect(
          await client.audio.translations.create({
            model,
            file: new File([], ''),
          }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/audio/translations?api-version=${apiVersion}`,
        });
      });

      test('handles audio transcriptions', async () => {
        expect(
          await client.audio.transcriptions.create({
            model,
            file: new File([], ''),
          }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/audio/transcriptions?api-version=${apiVersion}`,
        });
      });

      test('handles text to speech', async () => {
        const response = await client.audio.speech.create({
          model,
          input: '',
          voice: 'alloy',
        });
        expect(await response.json()).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/audio/speech?api-version=${apiVersion}`,
        });
      });

      test('handles image generation', async () => {
        expect(
          await client.images.generate({
            model,
            prompt: 'prompt',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/images/generations?api-version=${apiVersion}`,
        });
      });

      test('uses the client-level deployment for image edits', async () => {
        expect(
          await client.images.edit({
            model: 'request-model',
            image: new File([], 'image.png'),
            prompt: 'prompt',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/images/edits?api-version=${apiVersion}`,
        });
      });

      test('handles assistants', async () => {
        expect(
          await client.beta.assistants.create({
            model,
          }),
        ).toMatchObject({
          url: `https://example.com/openai/assistants?api-version=${apiVersion}`,
        });
      });

      test('handles files', async () => {
        expect(
          await client.files.create({
            file: new File([], ''),
            purpose: 'assistants',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/files?api-version=${apiVersion}`,
        });
      });

      test('handles fine tuning', async () => {
        expect(
          await client.fineTuning.jobs.create({
            model,
            training_file: '',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/fine_tuning/jobs?api-version=${apiVersion}`,
        });
      });
    });

    describe('with no client-level deployment', () => {
      const client = new AzureOpenAI({
        endpoint: 'https://example.com',
        apiKey: 'My API Key',
        apiVersion,
        fetch: testFetch,
      });

      test('Batch is not handled', async () => {
        expect(
          await client.batches.create({
            completion_window: '24h',
            endpoint: '/v1/chat/completions',
            input_file_id: 'file-id',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/batches?api-version=${apiVersion}`,
        });
      });

      test('handles completions', async () => {
        expect(
          await client.completions.create({
            model: deployment,
            prompt: 'prompt',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/completions?api-version=${apiVersion}`,
        });
      });

      test('handles chat completions', async () => {
        expect(
          await client.chat.completions.create({
            model: deployment,
            messages: [{ role: 'system', content: 'Hello' }],
          }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
        });
      });

      test('handles embeddings', async () => {
        expect(
          await client.embeddings.create({
            model: deployment,
            input: 'input',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/embeddings?api-version=${apiVersion}`,
        });
      });

      test('handles audio translations', async () => {
        expect(
          await client.audio.translations.create({ model: deployment, file: new File([], '') }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/audio/translations?api-version=${apiVersion}`,
        });
      });

      test('handles audio transcriptions', async () => {
        expect(
          await client.audio.transcriptions.create({ model: deployment, file: new File([], '') }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/audio/transcriptions?api-version=${apiVersion}`,
        });
      });

      test('handles text to speech', async () => {
        const response = await client.audio.speech.create({
          model: deployment,
          input: '',
          voice: 'alloy',
        });
        expect(await response.json()).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/audio/speech?api-version=${apiVersion}`,
        });
      });

      test('handles image generation', async () => {
        expect(
          await client.images.generate({
            model: deployment,
            prompt: 'prompt',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/images/generations?api-version=${apiVersion}`,
        });
      });

      test('handles image edit', async () => {
        expect(
          await client.images.edit({
            model: deployment,
            image: new File([], ''),
            prompt: 'prompt',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/images/edits?api-version=${apiVersion}`,
        });
      });

      test('routes streaming image uploads to the request model deployment', async () => {
        async function* imageBytes(): AsyncGenerator<Uint8Array> {
          yield new Uint8Array([1, 2, 3]);
        }

        expect(
          await client.images.edit({
            model: deployment,
            image: toStreamingFile(imageBytes(), 'image.png', { type: 'image/png' }),
            prompt: 'prompt',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/images/edits?api-version=${apiVersion}`,
        });
      });

      test('preserves existing request metadata when setting the image deployment', async () => {
        const buildRequest = vi.spyOn(client, 'buildRequest');

        try {
          await client.images.edit(
            { model: deployment, image: new File([], 'image.png'), prompt: 'prompt' },
            { __metadata: { requestID: 'request_123', model: 'stale-deployment' } },
          );

          expect(buildRequest).toHaveBeenCalledWith(
            expect.objectContaining({ __metadata: { requestID: 'request_123', model: deployment } }),
            expect.objectContaining({ retryCount: 0 }),
          );
        } finally {
          buildRequest.mockRestore();
        }
      });

      test('preserves a metadata deployment when the image request omits its model', async () => {
        expect(
          await client.images.edit(
            { image: new File([], 'image.png'), prompt: 'prompt' },
            { __metadata: { model: deployment } },
          ),
        ).toMatchObject({
          url: `https://example.com/openai/deployments/${deployment}/images/edits?api-version=${apiVersion}`,
        });
      });

      test('does not invent a deployment when the image request omits its model', async () => {
        expect(
          await client.images.edit({ image: new File([], 'image.png'), prompt: 'prompt' }),
        ).toMatchObject({
          url: `https://example.com/openai/images/edits?api-version=${apiVersion}`,
        });
      });

      test('does not route a nullable streaming image model to a null deployment', async () => {
        async function* imageBytes(): AsyncGenerator<Uint8Array> {
          yield new Uint8Array([1, 2, 3]);
        }

        expect(
          await client.images.edit({
            model: null,
            image: toStreamingFile(imageBytes(), 'image.png', { type: 'image/png' }),
            prompt: 'prompt',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/images/edits?api-version=${apiVersion}`,
        });
      });

      test('handles assistants', async () => {
        expect(
          await client.beta.assistants.create({
            model,
          }),
        ).toMatchObject({
          url: `https://example.com/openai/assistants?api-version=${apiVersion}`,
        });
      });

      test('handles files', async () => {
        expect(
          await client.files.create({
            file: new File([], ''),
            purpose: 'assistants',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/files?api-version=${apiVersion}`,
        });
      });

      test('handles fine tuning', async () => {
        expect(
          await client.fineTuning.jobs.create({
            model,
            training_file: '',
          }),
        ).toMatchObject({
          url: `https://example.com/openai/fine_tuning/jobs?api-version=${apiVersion}`,
        });
      });
    });
  });

  describe('custom headers', () => {
    test('handles undefined', async () => {
      const { req } = await client.buildRequest({
        path: '/foo',
        method: 'post',
        body: { value: 'hello' },
        headers: { 'X-Foo': 'baz', 'x-foo': 'bar', 'x-Foo': undefined, 'x-baz': 'bam', 'X-Baz': null },
      });
      expect(req.headers.get('x-foo')).toEqual('bar');
      expect(req.headers.get('x-Foo')).toEqual('bar');
      expect(req.headers.get('X-Foo')).toEqual('bar');
      expect(req.headers.get('x-baz')).toEqual(null);
    });
  });
});

describe('retries', () => {
  test('retry on timeout', async () => {
    let count = 0;
    const testFetch = async (url: RequestInfo, { signal }: RequestInit = {}): Promise<Response> => {
      if (count++ === 0) {
        return new Promise((resolve, reject) =>
          signal?.addEventListener('abort', () => reject(new Error('timed out'))),
        );
      }
      return Response.json({ a: 1 }, { headers: { 'Content-Type': 'application/json' } });
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
      return Response.json({ a: 1 }, { headers: { 'Content-Type': 'application/json' } });
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
      return Response.json({ a: 1 }, { headers: { 'Content-Type': 'application/json' } });
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
