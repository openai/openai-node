import OpenAI from 'openai';
import { test, vi } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['Headers', 'array'] as const)('%s behind an inspection-restricting proxy', (kind) => {
  test.each(
    (['getPrototypeOf', 'getOwnPropertyDescriptor'] as const).flatMap((trap) =>
      (['static', 'workload', 'independent'] as const).map((credential) => ({ trap, credential })),
    ),
  )(
    'consumes a bound iterator with $trap denied and $credential credentials',
    async ({ trap, credential }) => {
      const entries: [string, string][] = [['X-Custom', 'preserved']];
      if (credential === 'independent') {
        entries.push(['Authorization', 'Bearer independent']);
      }
      const target = kind === 'Headers' ? new Headers(entries) : entries;
      const iterate = vi.fn(target[Symbol.iterator].bind(target));
      const inspect = vi.fn(() => {
        throw new Error('Proxy inspection is unavailable');
      });
      const headers = new Proxy(target, {
        get(object, key) {
          return key === Symbol.iterator ? iterate : Reflect.get(object, key, object);
        },
        [trap]: inspect,
      });
      const sent: Headers[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers));
        return Response.json({ data: [] });
      });
      const client = new OpenAI({
        ...(credential === 'static' ? { apiKey: 'static-key' } : createTestClientOptions()),
        ...(credential === 'static' ? {} : { apiKey: null }),
        adminAPIKey: null,
        maxRetries: 0,
        fetch: transport.fetch,
      });

      await client.models.list({ headers });

      expect(sent).toHaveLength(1);
      expect(sent[0]?.get('X-Custom')).toBe('preserved');
      expect(sent[0]?.get('Authorization')).toBe(
        { static: 'Bearer static-key', workload: 'Bearer access-token-1', independent: 'Bearer independent' }[
          credential
        ],
      );
      expect(transport.exchanges).toBe(credential === 'workload' ? 1 : 0);
      expect(iterate).toHaveBeenCalledTimes(1);
    },
  );
});

test.each(['static', 'workload'] as const)(
  'preserves actual iterator failures with %s credentials',
  async (credential) => {
    const failure = new Error('Header iterator failed');
    const headers = new Proxy(new Headers({ 'X-Custom': 'preserved' }), {
      get(target, key) {
        if (key === Symbol.iterator) {
          return () => {
            throw failure;
          };
        }
        return Reflect.get(target, key, target);
      },
      getPrototypeOf() {
        throw new Error('Proxy inspection is unavailable');
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new OpenAI({
      ...(credential === 'static' ? { apiKey: 'static-key' } : createTestClientOptions()),
      ...(credential === 'static' ? {} : { apiKey: null }),
      adminAPIKey: null,
      maxRetries: 0,
      fetch,
    });

    await expect(client.models.list({ headers })).rejects.toBe(failure);

    expect(fetch).not.toHaveBeenCalled();
  },
);
