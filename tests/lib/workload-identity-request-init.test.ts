import OpenAI from 'openai';
import { test } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each(
  [false, true].flatMap((workload) =>
    ['build', 'timeout'].flatMap((hook) =>
      (hook === 'timeout' ? ['absent', 'data', 'self-removing accessor'] : ['absent', 'data']).map(
        (kind) => ({ workload, hook, kind }),
      ),
    ),
  ),
)(
  'preserves $kind request field presence from $hook: workload=$workload',
  async ({ workload, hook, kind }) => {
    const present = kind !== 'absent';
    const reads: string[] = [];
    function replaceFields(init: object) {
      for (const name of ['body', 'headers']) {
        if (kind === 'self-removing accessor') {
          Object.defineProperty(init, name, {
            configurable: true,
            enumerable: true,
            get(this: object) {
              expect(this).toBe(init);
              reads.push(name);
              Reflect.deleteProperty(this, name);
              // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicitly suppress the transport default.
              return undefined;
            },
          });
        } else if (present) {
          Reflect.set(init, name, undefined);
        } else {
          Reflect.deleteProperty(init, name);
        }
      }
    }
    class CustomClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        const built = await super.buildRequest(...args);
        if (hook === 'build') {
          replaceFields(built.req);
        }
        return built;
      }

      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [, init] = args;
        if (hook === 'timeout' && init) {
          replaceFields(init);
        }
        return super.fetchWithTimeout(...args);
      }
    }
    let sends = 0;
    const transport = createWorkloadIdentityTransport(async (url, init) => {
      sends += 1;
      expect(Object.getOwnPropertyDescriptor(init ?? {}, 'body') !== undefined).toBe(present);
      expect(Object.getOwnPropertyDescriptor(init ?? {}, 'headers') !== undefined).toBe(present);
      const request = new Request(url, {
        body: 'synthetic default body',
        headers: { 'X-Default': 'synthetic default header' },
        ...init,
      });
      expect(await request.text()).toBe(present ? '' : 'synthetic default body');
      expect(request.headers.get('X-Default')).toBe(present ? null : 'synthetic default header');
      return Response.json({ ok: true });
    });
    const client = new CustomClient({
      ...(workload ? { ...createTestClientOptions(), apiKey: null } : { apiKey: 'synthetic-api-key' }),
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(client.post('/synthetic', { body: { original: true } })).resolves.toEqual({ ok: true });
    expect(sends).toBe(1);
    for (const name of ['body', 'headers']) {
      expect(reads.filter((value) => value === name)).toHaveLength(kind === 'self-removing accessor' ? 1 : 0);
    }
  },
);
