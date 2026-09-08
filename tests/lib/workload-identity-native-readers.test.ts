/* oxlint-disable max-classes-per-file -- Fixtures cover separate protected header-reading boundaries. */
import OpenAI from 'openai';
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
  'bypasses %s get overrides on cloned authentication values',
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
  'recovers workload provenance from a native %s forwarding iterator',
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
