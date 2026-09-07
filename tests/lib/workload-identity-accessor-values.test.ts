/* oxlint-disable max-classes-per-file -- Independent fixtures cover parsed accessors and reused proxies. */
import OpenAI from 'openai';
import { buildHeaders } from 'openai/internal/headers';
import { vi } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['own', 'inherited'] as const)('%s parsed values accessor', (placement) => {
  test.each(
    [false, true].flatMap((independent) => [false, true].map((reparse) => ({ independent, reparse }))),
  )('retains the selected values authority: %j', async ({ independent, reparse }) => {
    let reads = 0;
    class HookClient extends OpenAI {
      protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
        const headers = await super.authHeaders(...args);
        if (!headers) {
          throw new Error('Expected authentication headers');
        }
        const values = independent
          ? buildHeaders([{ Authorization: headers.values.get('Authorization') }]).values
          : headers.values;
        const target = placement === 'own' ? headers : Object.create(Object.getPrototypeOf(headers));
        let materializations = 0;
        Object.defineProperty(target, 'values', {
          get() {
            reads += 1;
            materializations += 1;
            if (materializations > 1) {
              throw new Error('The selected values accessor was read twice');
            }
            return values;
          },
        });
        if (placement === 'inherited') {
          Reflect.deleteProperty(headers, 'values');
          Object.setPrototypeOf(headers, target);
        }
        const parsed = buildHeaders([headers]);
        return reparse ? buildHeaders([parsed]) : parsed;
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

    await (independent
      ? expect(client.models.list()).rejects.toMatchObject({ status: 401 })
      : client.models.list());

    expect(sent).toEqual(
      independent ? ['Bearer access-token-1'] : ['Bearer access-token-1', 'Bearer access-token-2'],
    );
    expect(transport.exchanges).toBe(independent ? 1 : 2);
    expect(reads).toBe(sent.length);
  });
});

test('preserves a values accessor error before reading nulls', () => {
  const headers = buildHeaders([]);
  const failure = new Error('Synthetic values accessor failure');
  const values = vi.fn(() => {
    throw failure;
  });
  const nulls = vi.fn(() => new Set<string>());
  Object.defineProperties(headers, { values: { get: values }, nulls: { get: nulls } });

  expect(() => buildHeaders([headers])).toThrow(failure);

  expect(values).toHaveBeenCalledTimes(1);
  expect(nulls).not.toHaveBeenCalled();
});

test('preserves readable values when a registered wrapper denies descriptor inspection', async () => {
  let cached: ReturnType<typeof buildHeaders> | undefined;
  class HookClient extends OpenAI {
    protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
      if (cached) {
        return cached;
      }
      const headers = await super.authHeaders(...args);
      if (!headers) {
        throw new Error('Expected authentication headers');
      }
      cached = new Proxy(headers, {
        getOwnPropertyDescriptor(target, key) {
          if (key === 'values') {
            throw new Error('Synthetic descriptor membrane');
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      return cached;
    }
  }
  let sends = 0;
  const transport = createWorkloadIdentityTransport(() => {
    sends += 1;
    return Response.json({ data: [] });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
  });

  await client.models.list();
  await client.models.list();

  expect(sends).toBe(2);
  expect(transport.exchanges).toBe(1);
});
