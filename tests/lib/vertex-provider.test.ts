import { setTimeout as delay } from 'node:timers/promises';
import { vi } from 'vitest';
import OpenAI, { APIError, APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import { vertex } from 'openai/providers/vertex';
import { OAuth2Client } from 'google-auth-library';
import type { GetTokenResponse } from 'google-auth-library/build/src/auth/oauth2client';

afterEach(() => vi.unstubAllEnvs());

test('Vertex constructor and copies reject OpenAI residency before asking for a token or fetching', () => {
  const tokenProvider = vi.fn(() => 'fake');
  const fetch = vi.fn(async () => Response.json({ id: 'resp_test', output: [] }));
  const provider = vertex({ project: 'test', location: 'global', tokenProvider });
  expect(() => new OpenAI({ provider, dataResidency: 'eu', fetch })).toThrow('dataResidency');
  const client = new OpenAI({ provider, fetch });
  expect(() => client.withOptions({ dataResidency: 'eu' })).toThrow('dataResidency');
  expect(tokenProvider).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  ['global', 'aiplatform.googleapis.com'],
  ['us-east5', 'us-east5-aiplatform.googleapis.com'],
])('routes %s Responses with Google environment defaults', async (location, host) => {
  vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'env-project');
  vi.stubEnv('GOOGLE_CLOUD_LOCATION', location);
  const requests: { method: string | undefined; url: URL }[] = [];
  const client = new OpenAI({
    provider: vertex({ tokenProvider: () => 'fake' }),
    fetch: async (url, init) => {
      requests.push({ method: init?.method, url: new URL(String(url)) });
      return Response.json({ id: 'resp_test', object: 'response', output: [] });
    },
  });
  await client.responses.create({ model: 'model', input: 'hi', store: false });
  await client.responses.retrieve('resp_test');
  await client.responses.delete('resp_test');
  await client.responses.compact({ model: 'model', input: 'hi' });
  const prefix = `/projects/env-project/locations/${location}/publishers/openai/v1/responses`;
  expect(requests.map(({ method, url }) => [url.host, method, url.pathname])).toEqual([
    [host, 'POST', `/v1${prefix}`],
    [host, 'GET', `/v1${prefix}/resp_test`],
    [host, 'DELETE', `/v1${prefix}/resp_test`],
    [host, 'POST', `/v1${prefix}/compact`],
  ]);
});

test.each([
  { source: 'explicit', project: 'example.com:my-project', envProject: 'unused-project' },
  { source: 'environment', project: undefined, envProject: 'example.com:my-project' },
])('routes a domain-scoped $source project as one path segment', async ({ project, envProject }) => {
  vi.stubEnv('GOOGLE_CLOUD_PROJECT', envProject);
  const client = new OpenAI({
    provider: vertex({ project, location: 'global', tokenProvider: () => 'fake' }),
    fetch: async (url) => {
      expect(String(url)).toBe(
        'https://aiplatform.googleapis.com/v1/projects/example.com:my-project/locations/global/publishers/openai/v1/responses/resp_test',
      );
      return Response.json({ id: 'resp_test', object: 'response', output: [] });
    },
  });
  await client.responses.retrieve('resp_test');
});

test.each(['.', '..'])('rejects the %s project path segment', (project) => {
  expect(() => vertex({ project, location: 'global' })).toThrow('project ID');
});

test('custom HTTP publisher root overrides a global project', async () => {
  const send = vi.fn<typeof fetch>(async (_url, init) => {
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fake');
    return Response.json({ id: 'resp_test', object: 'response', output: [] });
  });
  const client = new OpenAI({
    provider: vertex({
      baseURL: 'http://gateway.invalid/publisher/v1',
      project: 'unused',
      location: 'global',
      tokenProvider: () => 'fake',
    }),
    fetch: send,
  });
  await client.responses.create({ model: 'model', input: 'hi', store: false });
  expect(send).toHaveBeenCalledWith('http://gateway.invalid/publisher/v1/responses', expect.anything());
});

test.each([
  'http://aiplatform.googleapis.com/v1',
  'http://aiplatform.googleapis.com./v1',
  'http://googleapis.com/v1',
  'http://googleapis.com./v1',
])('rejects HTTP Google endpoint %s before resolving credentials', (baseURL) => {
  const tokenProvider = vi.fn(() => 'fake-google');
  expect(() => vertex({ baseURL, tokenProvider })).toThrow('HTTPS');
  expect(tokenProvider).not.toHaveBeenCalled();
});

test('ordinary Responses route, refresh on retry and ignore ambient OpenAI credentials', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'fake-openai');
  vi.stubEnv('OPENAI_BASE_URL', 'https://wrong.invalid/v1');
  let count = 0;
  const requests: { method: string | undefined; url: string; authorization: string | null }[] = [];
  const client = new OpenAI({
    provider: vertex({
      project: 'test-project',
      location: 'us-east5',
      tokenProvider: () => {
        count += 1;
        return `fake-${count}`;
      },
    }),
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        authorization: new Headers(init?.headers).get('authorization'),
      });
      if (requests.length === 1) {
        return Response.json(
          { error: { message: 'try again' } },
          { status: 429, headers: { 'retry-after-ms': '1' } },
        );
      }
      return Response.json({ id: 'resp_123', object: 'response', output: [] });
    },
  });
  await client.responses.create({ model: 'enabled-model', input: 'hi' });
  await client.responses.retrieve('resp_123');
  await client.responses.delete('resp_123');
  await client.responses.compact({ model: 'enabled-model', input: 'hi' });
  const root = '/projects/test-project/locations/us-east5/publishers/openai/v1/responses';
  expect(requests.map(({ method, url }) => [method, new URL(url).pathname])).toEqual([
    ['POST', `/v1${root}`],
    ['POST', `/v1${root}`],
    ['GET', `/v1${root}/resp_123`],
    ['DELETE', `/v1${root}/resp_123`],
    ['POST', `/v1${root}/compact`],
  ]);
  expect(requests.map(({ authorization }) => authorization)).toEqual([
    'Bearer fake-1',
    'Bearer fake-2',
    'Bearer fake-3',
    'Bearer fake-4',
    'Bearer fake-5',
  ]);
  expect(requests.every(({ url }) => new URL(url).hostname === 'us-east5-aiplatform.googleapis.com')).toBe(
    true,
  );
});

test('reject changed origins and caller auth before asking for credentials; disable redirects', async () => {
  const tokenProvider = vi.fn(async () => 'fake-google');
  const send = vi.fn(async (_input, init) => {
    expect(init.redirect).toBe('manual');
    return new Response(null, { status: 302, headers: { location: 'https://wrong.invalid/stolen' } });
  });
  const client = new OpenAI({
    provider: vertex({ baseURL: 'https://trusted.invalid/v1', tokenProvider }),
    fetch: send,
  });
  await expect(client.get('https://wrong.invalid/stolen')).rejects.toThrow('configured origin');
  await expect(
    client.get('/responses', { headers: { Authorization: 'Bearer fake-caller' } }),
  ).rejects.toThrow('owns authentication');
  expect(tokenProvider).not.toHaveBeenCalled();
  await expect(client.get('/responses')).rejects.toMatchObject({ status: 302 });
  expect(send).toHaveBeenCalledTimes(1);
  expect(tokenProvider).toHaveBeenCalledTimes(1);
});

test('stream events flow through the existing Responses decoder', async () => {
  const client = new OpenAI({
    provider: vertex({ baseURL: 'https://trusted.invalid/v1', tokenProvider: async () => 'fake-stream' }),
    fetch: async (_input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fake-stream');
      return new Response(
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const stream = await client.responses.create({ model: 'enabled-model', input: 'hi', stream: true });
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  expect(events).toMatchObject([{ type: 'response.output_text.delta', delta: 'hi' }]);
});

test('abort while awaiting credentials never dispatches a request', async () => {
  const controller = new AbortController();
  const send = vi.fn();
  const client = new OpenAI({
    provider: vertex({
      baseURL: 'https://trusted.invalid/v1',
      tokenProvider: async () => {
        controller.abort();
        return 'fake-cancelled';
      },
    }),
    fetch: send,
  });
  await expect(
    client.responses.create({ model: 'enabled-model', input: 'hi' }, { signal: controller.signal }),
  ).rejects.toBeInstanceOf(APIUserAbortError);
  expect(send).not.toHaveBeenCalled();
});

describe('without AbortSignal.any', () => {
  const nativeAny = AbortSignal.any;
  beforeEach(() => {
    Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(AbortSignal, 'any', { value: nativeAny, configurable: true });
  });

  test.each(['success', 'abort', 'timeout'] as const)(
    'preserves %s while resolving credentials',
    async (outcome) => {
      const controller = new AbortController();
      const reason = new Error('caller cancelled');
      const send = vi.fn(async () => Response.json({ id: 'resp_test', output: [] }));
      const tokenProvider = vi.fn(async () => {
        if (outcome === 'abort') {
          controller.abort(reason);
        }
        if (outcome === 'timeout') {
          await delay(50);
        }
        return 'fake';
      });
      const client = new OpenAI({
        provider: vertex({ baseURL: 'https://trusted.invalid/v1', tokenProvider }),
        fetch: send,
        timeout: outcome === 'timeout' ? 10 : 1000,
        maxRetries: 0,
      });
      const response = client.responses.create(
        { model: 'model', input: 'hi' },
        { signal: controller.signal },
      );
      if (outcome === 'success') {
        await expect(response).resolves.toMatchObject({ id: 'resp_test' });
        expect(send).toHaveBeenCalledTimes(1);
      } else {
        await expect(response).rejects.toBeInstanceOf(
          outcome === 'abort' ? APIUserAbortError : APIConnectionTimeoutError,
        );
        if (outcome === 'abort') {
          await expect(response).rejects.toHaveProperty('cause', reason);
        }
        expect(send).not.toHaveBeenCalled();
      }
      expect(tokenProvider).toHaveBeenCalledTimes(1);
    },
  );
});

class FakeGoogleClient extends OAuth2Client {
  refreshes = 0;
  constructor() {
    super();
    this.quotaProjectId = 'fake-quota';
    this.setCredentials({ refresh_token: 'fake-refresh-token', expiry_date: 0 });
  }
  protected override async refreshTokenNoCache(): Promise<GetTokenResponse> {
    this.refreshes += 1;
    await Promise.resolve();
    return {
      tokens: { access_token: `fake-refresh-${this.refreshes}`, expiry_date: Date.now() + 3_600_000 },
      res: null,
    };
  }
}

test('Google credential expiry, concurrent refresh and quota project use the real auth client', async () => {
  const credentials = new FakeGoogleClient();
  const seen: Headers[] = [];
  const client = new OpenAI({
    provider: vertex({ baseURL: 'https://trusted.invalid/v1', credentials }),
    fetch: async (_input, init) => {
      seen.push(new Headers(init?.headers));
      return Response.json({ id: 'resp_fake', object: 'response', output: [] });
    },
  });
  await Promise.all(
    Array.from({ length: 8 }, () => client.responses.create({ model: 'customer-model', input: 'hello' })),
  );
  credentials.credentials.expiry_date = Date.now() - 3_600_000;
  await client.responses.create({ model: 'customer-model', input: 'hello' });
  expect(credentials.refreshes).toBe(2);
  expect(seen.every((headers) => headers.get('x-goog-user-project') === 'fake-quota')).toBe(true);
  expect(seen.pop()?.get('authorization')).toBe('Bearer fake-refresh-2');
  expect(() => vertex({ credentials, tokenProvider: async () => 'fake' })).toThrow('only one');
});

test('auth deadline and explicit OpenAI headers prevent dispatch', async () => {
  const send = vi.fn();
  const client = new OpenAI({
    provider: vertex({
      baseURL: 'https://trusted.invalid/v1',
      // oxlint-disable-next-line promise/avoid-new -- An unresolved credential models a stalled upstream auth service.
      tokenProvider: () => new Promise<string>(() => {}),
    }),
    timeout: 10,
    fetch: send,
  });
  await expect(client.responses.create({ model: 'customer-model', input: 'hi' })).rejects.toBeInstanceOf(
    APIConnectionTimeoutError,
  );
  await expect(
    client.responses.create(
      { model: 'customer-model', input: 'hi' },
      { headers: { 'OpenAI-Organization': 'explicit' } },
    ),
  ).rejects.toThrow('OpenAI project');
  expect(send).not.toHaveBeenCalled();
});

test.each(['recover', 'exhaust', 'cancel', 'failure'] as const)(
  'authentication timeout retries: %s',
  async (outcome) => {
    const controller = new AbortController();
    const send = vi.fn(async () => Response.json({ id: 'resp_test', output: [] }));
    let attempts = 0;
    const tokenProvider = vi.fn(async () => {
      attempts += 1;
      if (outcome === 'failure') {
        throw new Error('synthetic auth failure');
      }
      if (attempts === 1 || outcome === 'exhaust') {
        await delay(50);
        if (outcome === 'cancel') {
          controller.abort();
        }
      }
      return 'fake';
    });
    const client = new OpenAI({
      provider: vertex({ baseURL: 'https://trusted.invalid/v1', tokenProvider }),
      fetch: send,
      maxRetries: 0,
    });
    const response = client.responses.create(
      { model: 'model', input: 'hi' },
      { timeout: 10, maxRetries: 1, signal: controller.signal },
    );
    if (outcome === 'recover') {
      await expect(response).resolves.toMatchObject({ id: 'resp_test' });
      expect(send).toHaveBeenCalledTimes(1);
    } else {
      const expectedError = outcome === 'cancel' ? APIUserAbortError : APIConnectionTimeoutError;
      await expect(response).rejects.toThrow(
        outcome === 'failure' ? 'Vertex authentication failed' : expectedError,
      );
      expect(send).not.toHaveBeenCalled();
    }
    expect(tokenProvider).toHaveBeenCalledTimes(outcome === 'recover' || outcome === 'exhaust' ? 2 : 1);
  },
);

test('authentication and HTTP dispatch share one attempt timeout', async () => {
  const send = vi.fn<typeof fetch>((_input, init) =>
    delay(300, Response.json({ id: 'resp_test', object: 'response', output: [] }), {
      signal: init?.signal ?? undefined,
    }),
  );
  const client = new OpenAI({
    provider: vertex({ baseURL: 'https://trusted.invalid/v1', tokenProvider: () => delay(300, 'fake') }),
    fetch: send,
    timeout: 500,
    maxRetries: 0,
  });
  await expect(client.responses.create({ model: 'model', input: 'hi' })).rejects.toBeInstanceOf(
    APIConnectionTimeoutError,
  );
  expect(send).toHaveBeenCalledTimes(1);
});

test('client function calls and SSE errors use normal Responses semantics without replay', async () => {
  const bodies: Record<string, any>[] = [];
  const client = new OpenAI({
    provider: vertex({ baseURL: 'https://trusted.invalid/v1', tokenProvider: async () => 'fake' }),
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.stream) {
        return new Response(
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\nevent: error\ndata: {"error":{"code":"unsupported_feature","message":"fake-error"}}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }
      if (bodies.length === 1) {
        return Response.json({
          id: 'resp_fake',
          object: 'response',
          output: [
            {
              type: 'function_call',
              id: 'fc_fake',
              call_id: 'call_fake',
              name: 'get_temperature',
              arguments: '{}',
            },
          ],
        });
      }
      return Response.json({ id: 'resp_final', object: 'response', output: [] });
    },
  });
  const response = await client.responses.create({
    model: 'customer-model',
    input: 'temperature?',
    tools: [
      {
        type: 'function',
        name: 'get_temperature',
        parameters: { type: 'object', properties: {} },
        strict: false,
      },
    ],
  });
  const [tool] = response.output;
  if (tool?.type !== 'function_call') {
    throw new Error('Expected function call');
  }
  await client.responses.create({
    model: 'customer-model',
    input: [{ type: 'function_call_output', call_id: tool.call_id, output: '21' }],
  });
  expect(bodies[1]?.['input'][0]).toEqual({
    type: 'function_call_output',
    call_id: 'call_fake',
    output: '21',
  });
  const stream = await client.responses.create({ model: 'customer-model', input: 'hello', stream: true });
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  expect(first.value).toMatchObject({ type: 'response.output_text.delta', delta: 'ok' });
  await expect(iterator.next()).rejects.toBeInstanceOf(APIError);
  expect(bodies).toHaveLength(3);
});
