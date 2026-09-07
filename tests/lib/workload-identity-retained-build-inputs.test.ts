/* oxlint-disable max-classes-per-file -- Independent fixtures cover ignored and retained custom build inputs. */
import OpenAI from 'openai';
import { beforeEach, test } from 'vitest';
import type { HeadersInit } from 'openai/internal/builtin-types';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

beforeEach(() => {
  delete process.env['OPENAI_API_KEY'];
  delete process.env['OPENAI_ADMIN_KEY'];
});

test.each([500, 401])('retries a build hook that ignores a one-shot input after %s', async (status) => {
  let reads = 0;
  const rows = [['Authorization', 'Bearer unused'] as const][Symbol.iterator]();
  const headers = {
    [Symbol.iterator]() {
      reads += 1;
      return rows;
    },
  } as unknown as Headers;
  const options: FinalRequestOptions = { method: 'get', path: '/synthetic', headers };
  let builds = 0;
  class IgnoringClient extends OpenAI {
    override async buildRequest(
      received: FinalRequestOptions,
      settings: Parameters<OpenAI['buildRequest']>[1] = {},
    ) {
      if (!received.__metadata?.['workloadIdentityTokenRefreshed']) {
        expect(received).toBe(options);
      }
      expect(received.headers).toBe(headers);
      builds += 1;
      const replacement =
        status === 401 ? { 'X-Custom': 'replacement' } : { Authorization: 'Bearer independent' };
      return super.buildRequest({ ...received, headers: replacement }, settings);
    }
  }
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('Authorization'));
    return sent.length === 1
      ? Response.json({ error: 'synthetic retry' }, { status, headers: { 'retry-after-ms': '0' } })
      : Response.json({ data: [] });
  });
  const client = new IgnoringClient({
    ...createTestClientOptions(),
    fetch: transport.fetch,
    maxRetries: status === 401 ? 0 : 1,
  });

  await client.request(options);

  expect(sent).toEqual(
    status === 401
      ? ['Bearer access-token-1', 'Bearer access-token-2']
      : ['Bearer independent', 'Bearer independent'],
  );
  expect(transport.exchanges).toBe(status === 401 ? 2 : 0);
  expect(builds).toBe(2);
  expect(reads).toBe(0);
  expect(options.headers).toBe(headers);
  expect(Reflect.ownKeys(options)).toEqual(['method', 'path', 'headers']);
});

test.skipIf(Number(process.versions.node.split('.')[0]) < 24)(
  'retries a build hook that copies genuine foreign Headers on each attempt',
  async () => {
    const { Headers: ForeignHeaders } = await import('undici');
    const headers = new ForeignHeaders({ Authorization: 'Bearer independent' });
    const options: FinalRequestOptions = { method: 'get', path: '/synthetic', headers };
    let builds = 0;
    class CopyClient extends OpenAI {
      override async buildRequest(
        received: FinalRequestOptions,
        settings: Parameters<OpenAI['buildRequest']>[1] = {},
      ) {
        expect(received).toBe(options);
        builds += 1;
        return super.buildRequest(
          { ...received, headers: new Headers(received.headers as HeadersInit) },
          settings,
        );
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return sent.length === 1
        ? Response.json({ error: 'synthetic retry' }, { status: 500, headers: { 'retry-after-ms': '0' } })
        : Response.json({ data: [] });
    });
    const client = new CopyClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 1 });

    await client.request(options);

    expect(sent).toEqual(['Bearer independent', 'Bearer independent']);
    expect(transport.exchanges).toBe(0);
    expect(builds).toBe(2);
    expect(options.headers).toBe(headers);
  },
);

test.each([
  'record',
  'Headers',
  'array',
  'one-shot object',
  'one-shot array',
  'hook-retained one-shot',
] as const)('retries live or explicitly retained copied build inputs: %s', async (kind) => {
  class OneShotHeaders extends Array<[string, string]> {
    private iterator = super[Symbol.iterator]();
    override [Symbol.iterator]() {
      return this.iterator;
    }
  }
  const retainedHeaders = new WeakMap<FinalRequestOptions, Headers>();
  class CopyClient extends OpenAI {
    override async buildRequest(
      options: FinalRequestOptions,
      settings: { retryCount?: number; credentialContext?: object } = {},
    ) {
      const headers = retainedHeaders.get(options) ?? new Headers(options.headers as HeadersInit);
      if (kind === 'hook-retained one-shot') {
        retainedHeaders.set(options, headers);
      } else if (kind === 'one-shot object' || kind === 'one-shot array') {
        options.headers = headers;
      }
      return super.buildRequest({ ...options, headers }, settings);
    }
  }
  const rows: [string, string][] = [['Authorization', '']];
  const iterator = rows[Symbol.iterator]();
  let headers: HeadersInit;
  if (kind === 'record') {
    headers = { Authorization: '' };
  } else if (kind === 'Headers') {
    headers = new Headers(rows);
  } else if (kind === 'array') {
    headers = rows;
  } else if (kind === 'one-shot array') {
    headers = new OneShotHeaders(...rows);
  } else {
    headers = { [Symbol.iterator]: () => iterator } as unknown as Headers;
  }
  let calls = 0;
  const transport = createWorkloadIdentityTransport((_url, init) => {
    calls += 1;
    expect(new Headers(init?.headers).get('Authorization')).toBe('');
    return calls === 1
      ? Response.json({ error: 'synthetic retry' }, { status: 500, headers: { 'retry-after-ms': '0' } })
      : Response.json({ data: [] });
  });
  const client = new CopyClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 1 });
  await client.get('https://independent.example.test/synthetic', { headers });
  expect(calls).toBe(2);
  expect(transport.exchanges).toBe(0);
});
