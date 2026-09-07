import OpenAI from 'openai';
import { buildHeaders, snapshotHeaders } from 'openai/internal/headers';
import { vi } from 'vitest';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

type CaptureHook = 'prepareOptions' | 'authHeaders' | 'bearerAuth';

class CapturingClient extends OpenAI {
  capture(hook: CaptureHook, headers: Record<string, unknown>) {
    const original = this[hook];
    Object.defineProperty(this, hook, {
      value: (...args: unknown[]) => {
        buildHeaders([headers as Record<string, string>]);
        return Reflect.apply(original, this, args);
      },
    });
  }
}

describe.each(['standard', 'prepareOptions', 'authHeaders', 'bearerAuth'] as const)(
  '%s property replacement',
  (hook) => {
    describe.each(['request', 'default'] as const)('%s headers', (layer) => {
      test.each([null, 'Bearer independent'] as const)(
        'observes a retained accessor replaced with data %j during token acquisition',
        async (authorization) => {
          const read = vi.fn<() => undefined>();
          const headers = {};
          Object.defineProperty(headers, 'Authorization', {
            configurable: true,
            enumerable: true,
            get: read,
          });
          const identity = createTestWorkloadIdentity();
          identity.provider.getToken = async () => {
            Object.defineProperty(headers, 'Authorization', { value: authorization });
            return 'subject-token';
          };
          const sent: (string | null)[] = [];
          const transport = createWorkloadIdentityTransport((_url, init) => {
            sent.push(new Headers(init?.headers).get('Authorization'));
            return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
          });
          const client = new CapturingClient({
            ...createTestClientOptions(),
            apiKey: null,
            adminAPIKey: null,
            workloadIdentity: identity,
            ...(layer === 'default' ? { defaultHeaders: headers } : {}),
            fetch: transport.fetch,
            maxRetries: 0,
          });
          if (hook !== 'standard') {
            client.capture(hook, headers);
          }

          await expect(
            client.get('https://independent.example.test/synthetic', layer === 'request' ? { headers } : {}),
          ).rejects.toMatchObject({ status: 401 });

          expect(sent).toEqual([authorization]);
          expect(transport.exchanges).toBe(1);
          expect(read).toHaveBeenCalledTimes(1);
        },
      );
    });
  },
);

test.each(['request', 'default'] as const)(
  'observes replacement of a nested stateful %s Authorization value',
  async (layer) => {
    const read = vi.fn<() => undefined>();
    const values: (string | undefined)[] = [undefined];
    Object.defineProperty(values, 0, { get: read });
    const headers: Record<string, string | null | (string | undefined)[]> = { Authorization: values };
    const identity = createTestWorkloadIdentity();
    identity.provider.getToken = async () => {
      headers['Authorization'] = 'Bearer independent';
      return 'subject-token';
    };
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new OpenAI({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      workloadIdentity: identity,
      ...(layer === 'default' ? { defaultHeaders: headers } : {}),
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await expect(
      client.get('https://independent.example.test/synthetic', layer === 'request' ? { headers } : {}),
    ).rejects.toMatchObject({ status: 401 });

    expect(sent).toEqual(['Bearer independent']);
    expect(transport.exchanges).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
  },
);

describe.each(['accessor', 'nested', 'coercion'] as const)('replacing a retained %s', (kind) => {
  test.each(['data', 'accessor'] as const)(
    'accepts a new %s property and retains it only as needed',
    (next) => {
      const read = vi.fn(() => 'Bearer original');
      const headers: Record<string, unknown> = {};
      if (kind === 'accessor') {
        Object.defineProperty(headers, 'Authorization', { configurable: true, enumerable: true, get: read });
      } else if (kind === 'nested') {
        const values = ['Bearer original'];
        Object.defineProperty(values, 0, { get: read });
        headers['Authorization'] = values;
      } else {
        headers['Authorization'] = { toString: read };
      }
      const snapshot = snapshotHeaders(headers as Record<string, string>);
      expect(snapshot.refresh().values.get('Authorization')).toBe('Bearer original');
      const replacement = vi.fn(() => 'Bearer replacement');
      Object.defineProperty(headers, 'Authorization', {
        configurable: true,
        enumerable: true,
        ...(next === 'data' ? { value: null, writable: true } : { get: replacement }),
      });

      expect(snapshot.refresh().values.get('Authorization')).toBe(
        next === 'data' ? null : 'Bearer replacement',
      );
      expect(snapshot.refresh().values.get('Authorization')).toBe(
        next === 'data' ? null : 'Bearer replacement',
      );
      expect(read).toHaveBeenCalledTimes(1);
      expect(replacement).toHaveBeenCalledTimes(next === 'data' ? 0 : 1);
      if (next === 'data') {
        headers['Authorization'] = 'Bearer live';
        expect(snapshot.refresh().values.get('Authorization')).toBe('Bearer live');
      }
    },
  );
});

test('retains a self-deleting getter until a new own property replaces it', () => {
  const headers: Record<string, string | null> = {};
  const read = vi.fn(() => {
    delete headers['Authorization'];
    return 'Bearer original';
  });
  Object.defineProperty(headers, 'Authorization', { configurable: true, enumerable: true, get: read });
  const snapshot = snapshotHeaders(headers);
  expect(snapshot.refresh().values.get('Authorization')).toBe('Bearer original');
  headers['Authorization'] = null;
  expect(snapshot.refresh().nulls.has('authorization')).toBe(true);
  expect(read).toHaveBeenCalledTimes(1);
});

test('honors replacement with a non-enumerable data property', () => {
  const headers = {
    get Authorization() {
      return 'Bearer original';
    },
  };
  const snapshot = snapshotHeaders(headers);
  Object.defineProperty(headers, 'Authorization', { enumerable: false, value: null });

  expect(snapshot.refresh().values.has('Authorization')).toBe(false);
});

test('retains a getter that hides itself during its first read', () => {
  const headers = {};
  const read = vi.fn(() => {
    Object.defineProperty(headers, 'Authorization', { enumerable: false });
    return null;
  });
  Object.defineProperty(headers, 'Authorization', { configurable: true, enumerable: true, get: read });
  const snapshot = snapshotHeaders(headers);

  expect(snapshot.refresh().nulls.has('authorization')).toBe(true);
  expect(read).toHaveBeenCalledTimes(1);
});

test('preserves descriptor and Get ordering with the original proxy receiver', () => {
  const events: string[] = [];
  const receivers: unknown[] = [];
  const target = {
    get Authorization() {
      receivers.push(this);
      return 'Bearer original';
    },
    'X-After': 'after',
  };
  const headers = new Proxy(target, {
    getOwnPropertyDescriptor(object, key) {
      if (typeof key === 'string') {
        events.push(`descriptor:${key}`);
      }
      return Reflect.getOwnPropertyDescriptor(object, key);
    },
    get(object, key, receiver) {
      if (typeof key === 'string') {
        events.push(`get:${key}`);
      }
      return Reflect.get(object, key, receiver);
    },
  });
  const snapshot = snapshotHeaders(headers);
  expect(receivers[0]).toBe(headers);
  expect(events).toEqual([
    'descriptor:Authorization',
    'get:Authorization',
    'descriptor:X-After',
    'get:X-After',
  ]);
  events.length = 0;
  Object.defineProperty(target, 'Authorization', { value: null });

  expect(snapshot.refresh().nulls.has('authorization')).toBe(true);
  expect(receivers).toHaveLength(1);
  expect(events).toEqual([
    'descriptor:Authorization',
    'get:Authorization',
    'descriptor:X-After',
    'get:X-After',
  ]);
});
