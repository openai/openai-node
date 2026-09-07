/* oxlint-disable max-classes-per-file -- Independent fixtures exercise protected hook boundaries. */
import OpenAI from 'openai';
import { inspect } from 'node:util';
import { buildHeaders } from 'openai/internal/headers';
import type { RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

const scratch = (headers: Headers) => {
  const copy = buildHeaders([headers]);
  copy.values.set('Authorization', headers.get('Authorization') ?? '');
  copy.values.delete('Authorization');
};

const reflect = (value: object) =>
  Object.getOwnPropertySymbols(value).map((key) => Object.getOwnPropertyDescriptor(value, key)?.value);

test.each(['authHeaders', 'bearerAuth', 'buildRequest', 'prepareRequest', 'fetchWithTimeout'] as const)(
  'keeps an unused %s sibling mutation separate from the selected headers',
  async (hook) => {
    class HookClient extends OpenAI {
      protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
        const headers = await super.authHeaders(...args);
        if (hook === 'authHeaders' && headers) {
          scratch(headers.values);
        }
        return headers;
      }
      protected override async bearerAuth(...args: Parameters<OpenAI['bearerAuth']>) {
        const headers = await super.bearerAuth(...args);
        if (hook === 'bearerAuth' && headers) {
          scratch(headers.values);
        }
        return headers;
      }
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        const built = await super.buildRequest(...args);
        if (hook === 'buildRequest') {
          scratch(built.req.headers);
        }
        return built;
      }
      // oxlint-disable-next-line class-methods-use-this -- This fixture overrides an SDK instance hook.
      protected override async prepareRequest(request: RequestInit) {
        if (hook === 'prepareRequest') {
          scratch(request.headers as Headers);
        }
      }
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        if (hook === 'fetchWithTimeout' && args[1]) {
          scratch(args[1].headers as Headers);
        }
        return super.fetchWithTimeout(...args);
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return sent.length === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });
    await client.models.list();
    expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(transport.exchanges).toBe(2);
  },
);

test.each([false, true])(
  'does not let a stale wrapper restore replaced values, parsed=%s',
  async (parsed) => {
    class HookClient extends OpenAI {
      protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
        const headers = await super.authHeaders(...args);
        if (headers) {
          headers.values = buildHeaders([{ Authorization: 'Bearer access-token-1' }]).values;
        }
        return headers && parsed ? buildHeaders([headers]) : headers;
      }
    }
    let sends = 0;
    const transport = createWorkloadIdentityTransport(() => {
      sends += 1;
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });
    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
    expect(sends).toBe(1);
    expect(transport.exchanges).toBe(1);
  },
);

test('keeps credential metadata private after removing the actual header', async () => {
  const reflected: unknown[] = [];
  class HookClient extends OpenAI {
    protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
      const headers = await super.authHeaders(...args);
      if (headers) {
        const parsed = buildHeaders([headers]);
        parsed.values.delete('Authorization');
        reflected.push(reflect(parsed), reflect(parsed.values), { ...parsed, values: { ...parsed.values } });
      }
      return headers;
    }
    // oxlint-disable-next-line class-methods-use-this -- This fixture overrides an SDK instance hook.
    protected override async prepareRequest(request: RequestInit) {
      (request.headers as Headers).delete('Authorization');
      reflected.push(reflect(request), reflect(request.headers as Headers), { ...request.headers });
    }
  }
  const transport = createWorkloadIdentityTransport(() => Response.json({ data: [] }));
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });
  await client.models.list();
  expect(inspect(reflected, { depth: 8 })).not.toContain('access-token-1');
});
