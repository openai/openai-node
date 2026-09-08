/* oxlint-disable max-classes-per-file -- Fixtures cover separate protected header-reading boundaries. */
import OpenAI from 'openai';
import { buildHeaders } from 'openai/internal/headers';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

const forwardNativeHeadersIterator: Headers[typeof Symbol.iterator] = function forwardNativeHeadersIterator(
  this: Headers,
) {
  return Headers.prototype.entries.call(this);
};

test.each(['ordinary subclass', 'Headers-shaped subclass', 'custom iterator'] as const)(
  'reads the serialized credential from a native %s',
  async (kind) => {
    let reads = 0;
    const DiagnosticHeaders = class Headers extends globalThis.Headers {};
    Object.defineProperty(DiagnosticHeaders.prototype, 'get', {
      value() {
        reads += 1;
        return 'Bearer access-token-1';
      },
    });
    if (kind === 'Headers-shaped subclass') {
      Object.defineProperties(DiagnosticHeaders.prototype, {
        entries: { value: globalThis.Headers.prototype.entries },
        [Symbol.iterator]: { value: globalThis.Headers.prototype[Symbol.iterator] },
        [Symbol.toStringTag]: { value: 'Headers' },
      });
    } else if (kind === 'custom iterator') {
      Object.defineProperty(DiagnosticHeaders.prototype, Symbol.iterator, {
        value() {
          return [['Authorization', 'Bearer independent']].values();
        },
      });
    }
    class HookClient extends OpenAI {
      // oxlint-disable-next-line class-methods-use-this -- The fixture replaces request credentials in the hook.
      protected override async prepareRequest(...[request]: Parameters<OpenAI['prepareRequest']>) {
        request.headers = new DiagnosticHeaders({
          Authorization: kind === 'custom iterator' ? 'Bearer access-token-1' : 'Bearer independent',
        });
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((url, init) => {
      sent.push(new Request(url, init as globalThis.RequestInit).headers.get('Authorization'));
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      maxRetries: 0,
      fetch: transport.fetch,
    });

    await expect(client.post('/models', { body: { synthetic: true } })).rejects.toMatchObject({
      status: 401,
    });

    expect(sent).toEqual(['Bearer independent']);
    expect(transport.exchanges).toBe(1);
    expect(reads).toBe(0);
  },
);

test.each(['own', 'inherited'] as const)(
  'bypasses %s get overrides while refreshing immediate native authentication copies',
  async (kind) => {
    let reads = 0;
    class HookClient extends OpenAI {
      protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
        const headers = await super.authHeaders(...args);
        if (!headers) {
          return headers;
        }
        const values = new Headers(headers.values);
        const target = kind === 'own' ? values : Object.create(Headers.prototype);
        Object.defineProperty(target, 'get', {
          get() {
            reads += 1;
            throw new Error('Synthetic diagnostic getter must not run');
          },
        });
        if (kind === 'inherited') {
          Object.setPrototypeOf(values, target);
        }
        return { ...headers, values };
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((url, init) => {
      sent.push(new Request(url, init as globalThis.RequestInit).headers.get('Authorization'));
      return sent.length === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      maxRetries: 0,
      fetch: transport.fetch,
    });

    await client.models.list();

    expect(reads).toBe(0);
    expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(transport.exchanges).toBe(2);
  },
);

test.each(['instance', 'subclass'] as const)(
  'refreshes an immediate native %s copy with a forwarding iterator',
  async (kind) => {
    class ForwardingHeaders extends Headers {}
    Object.defineProperty(ForwardingHeaders.prototype, Symbol.iterator, {
      value: forwardNativeHeadersIterator,
    });
    class HookClient extends OpenAI {
      protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
        const result = await super.authHeaders(...args);
        if (!result) {
          return result;
        }
        const values =
          kind === 'subclass' ? new ForwardingHeaders(result.values) : new Headers(result.values);
        if (kind === 'instance') {
          Object.defineProperty(values, Symbol.iterator, {
            value: forwardNativeHeadersIterator,
          });
        }
        return { ...result, values };
      }
    }
    let calls = 0;
    const transport = createWorkloadIdentityTransport(() => {
      calls += 1;
      return calls === 1
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

    expect(calls).toBe(2);
    expect(transport.exchanges).toBe(2);
  },
);

describe.each(['native', 'transparent iterator', 'one-shot iterator'] as const)(
  'recovering cloned authentication values with a %s',
  (kind) => {
    test.each([
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ] as const)(
      'retains marked values and immediate scoped copies (frozen: %s, marked: %s)',
      async (frozen, marked) => {
        let iterations = 0;
        class HookClient extends OpenAI {
          protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
            const headers = await super.authHeaders(...args);
            if (!headers) {
              return headers;
            }
            const values = marked ? headers.values : new Headers(headers.values);
            if (kind !== 'native') {
              const iterator = Headers.prototype.entries.call(values);
              Object.defineProperty(values, Symbol.iterator, {
                value() {
                  iterations += 1;
                  return kind === 'one-shot iterator' ? iterator : Headers.prototype.entries.call(values);
                },
              });
            }
            Object.defineProperty(values, 'get', {
              get() {
                throw new Error('Synthetic diagnostic getter must not run');
              },
            });
            const result = { ...headers, values };
            return frozen ? Object.freeze(result) : result;
          }
        }
        const sent: (string | null)[] = [];
        const transport = createWorkloadIdentityTransport((url, init) => {
          sent.push(new Request(url, init as globalThis.RequestInit).headers.get('Authorization'));
          return sent.length === 1
            ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
            : Response.json({ data: [] });
        });
        const client = new HookClient({
          ...createTestClientOptions(),
          apiKey: null,
          maxRetries: 0,
          fetch: transport.fetch,
        });

        await client.models.list();

        expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
        expect(transport.exchanges).toBe(2);
        expect(iterations).toBe(kind === 'native' ? 0 : sent.length);
      },
    );
  },
);

test.each(['unmarked', 'unmarked equal-byte', 'SDK-owned', 'explicitly independent'] as const)(
  'preserves the accepted immediate-copy ambiguity for a %s custom iterator replacement',
  async (kind) => {
    let iterations = 0;
    const authorization =
      kind === 'explicitly independent' || kind === 'unmarked equal-byte'
        ? 'Bearer access-token-1'
        : 'Bearer independent';
    class HookClient extends OpenAI {
      protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
        const headers = await super.authHeaders(...args);
        if (!headers) {
          return headers;
        }
        let values = new Headers(headers.values);
        if (kind === 'SDK-owned') {
          ({ values } = headers);
        } else if (kind === 'explicitly independent') {
          ({ values } = buildHeaders([{ Authorization: authorization }]));
        }
        const iterator = [['Authorization', authorization]].values();
        Object.defineProperty(values, Symbol.iterator, {
          value() {
            iterations += 1;
            return iterator;
          },
        });
        return Object.freeze({ ...headers, values });
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((url, init) => {
      sent.push(new Request(url, init as globalThis.RequestInit).headers.get('Authorization'));
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      maxRetries: 0,
      fetch: transport.fetch,
    });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    const attempts = kind === 'unmarked equal-byte' ? 2 : 1;
    expect(sent).toEqual(Array.from({ length: attempts }, () => authorization));
    expect(transport.exchanges).toBe(attempts);
    expect(iterations).toBe(attempts);
  },
);
