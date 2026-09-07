import OpenAI from 'openai';
import { test, vi } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each([
  ['prototype', 'headers'],
  ['descriptor', 'headers'],
  ['prototype', 'tuples'],
  ['descriptor', 'tuples'],
] as const)('header membranes blocking %s inspection of %s', (blocked, source) => {
  beforeEach(() => {
    // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined removes inherited credentials.
    vi.stubEnv('OPENAI_API_KEY', undefined);
    // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined removes inherited credentials.
    vi.stubEnv('OPENAI_ADMIN_KEY', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test.each([
    ['get', false],
    ['get', true],
    ['post', false],
    ['post', true],
  ] as const)('dispatches valid iterable input for %s (workload identity: %s)', async (method, workload) => {
    const rows: [string, string][] = [
      ['Authorization', 'Bearer independent'],
      ['X-Synthetic', 'retained'],
    ];
    const backing = source === 'headers' ? new Headers(rows) : rows;
    const iterator = vi.fn(() => backing[Symbol.iterator]());
    const headers = new Proxy(backing, {
      get(target, key) {
        if (key === Symbol.iterator) {
          return iterator;
        }
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      getPrototypeOf(target) {
        if (blocked === 'prototype') {
          throw new Error('Synthetic membrane blocks prototype inspection');
        }
        return Reflect.getPrototypeOf(target);
      },
      getOwnPropertyDescriptor(target, key) {
        if (blocked === 'descriptor') {
          throw new Error('Synthetic membrane blocks descriptor inspection');
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const dispatched = new Headers(init?.headers);
      sent.push(dispatched.get('Authorization'));
      expect(dispatched.get('X-Synthetic')).toBe('retained');
      return Response.json({ data: [] });
    });
    const client = new OpenAI({
      ...(workload ? createTestClientOptions() : { apiKey: 'synthetic-key' }),
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.request({ method, path: '/synthetic', headers, ...(method === 'post' ? { body: {} } : {}) });

    expect(sent).toEqual(['Bearer independent']);
    expect(transport.exchanges).toBe(0);
    expect(iterator).toHaveBeenCalledTimes(!workload && method === 'post' ? 2 : 1);
  });
});
