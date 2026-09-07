import OpenAI from 'openai';
import { test, vi } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['native', 'foreign'] as const)('%s build-result Headers accessors', (realm) => {
  beforeEach(() => {
    // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined removes inherited credentials.
    vi.stubEnv('OPENAI_API_KEY', undefined);
    // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined removes inherited credentials.
    vi.stubEnv('OPENAI_ADMIN_KEY', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test.skipIf(realm === 'foreign' && Number(process.versions.node.split('.')[0]) < 24).each([
    ['own', 'throwing', false],
    ['own', 'throwing', true],
    ['own', 'stateful', true],
    ['inherited', 'throwing', false],
    ['inherited', 'throwing', true],
    ['inherited', 'stateful', true],
  ] as const)('bypasses a %s %s get override (workload identity: %s)', async (location, kind, workload) => {
    const foreign = realm === 'foreign' ? await import('undici') : undefined;
    const HeadersClass = foreign?.Headers ?? Headers;
    const intrinsicGet = HeadersClass.prototype.get;
    const intrinsicIterator = HeadersClass.prototype[Symbol.iterator];
    const shadowGet = vi.fn(() => {
      if (kind === 'throwing') {
        throw new Error('The Headers.get shadow must not be evaluated');
      }
      return 'Bearer synthetic-shadow';
    });
    const builtHeaders: object[] = [];
    class HookClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        const built = await super.buildRequest(...args);
        const headers = new HeadersClass([...built.req.headers]);
        if (location === 'own') {
          Object.defineProperty(headers, 'get', { value: shadowGet });
        } else {
          const prototype = Object.create(HeadersClass.prototype);
          Object.defineProperty(prototype, 'get', { value: shadowGet });
          Object.setPrototypeOf(headers, prototype);
        }
        builtHeaders.push(headers);
        built.req.headers = headers as Headers;
        return built;
      }
    }
    const authorizations: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      if (!init?.headers) {
        throw new Error('Expected the built headers at dispatch');
      }
      if (realm === 'foreign' && workload) {
        expect(init.headers).not.toBe(builtHeaders[authorizations.length]);
        expect(init.headers).toBeInstanceOf(Headers);
        authorizations.push(new Headers(init.headers).get('Authorization'));
      } else {
        expect(init.headers).toBe(builtHeaders[authorizations.length]);
        expect(Reflect.get(init.headers, Symbol.iterator)).toBe(intrinsicIterator);
        authorizations.push(Reflect.apply(intrinsicGet, init.headers, ['Authorization']));
      }
      return workload && authorizations.length === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...(workload ? createTestClientOptions() : { apiKey: 'synthetic-key' }),
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.models.list();

    expect(shadowGet).not.toHaveBeenCalled();
    expect(authorizations).toEqual(
      workload ? ['Bearer access-token-1', 'Bearer access-token-2'] : ['Bearer synthetic-key'],
    );
    expect(transport.exchanges).toBe(workload ? 2 : 0);
  });
});
