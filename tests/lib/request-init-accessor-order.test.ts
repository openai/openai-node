/* oxlint-disable max-classes-per-file -- Independent fixtures exercise distinct request accessor lifetimes. */
import OpenAI from 'openai';
import type { RequestInit } from 'openai/internal/builtin-types';

test.each([
  { fields: ['headers', 'body'], placement: 'enumerable', omitted: false },
  { fields: ['body', 'headers'], placement: 'enumerable', omitted: false },
  { fields: ['headers', 'body'], placement: 'enumerable', omitted: true },
  { fields: ['body', 'headers'], placement: 'inherited', omitted: false },
  { fields: ['body', 'headers'], placement: 'non-enumerable', omitted: false },
] as const)(
  'preserves RequestInit reads for $placement $fields fields (omitted: $omitted)',
  async ({ fields, placement, omitted }) => {
    const reads: string[] = [];
    const expectedReads = [...fields, 'cache'];
    const headers = { 'X-Synthetic-State': 'ready' };
    const body = 'synthetic-request';
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [url, init, timeout, controller, context] = args;
        const hookRequest: RequestInit = { signal: init?.signal ?? null, method: 'post' };
        const target = placement === 'inherited' ? {} : hookRequest;
        if (placement === 'inherited') {
          Object.setPrototypeOf(hookRequest, target);
        }
        for (const field of fields) {
          Object.defineProperty(target, field, {
            enumerable: placement !== 'non-enumerable',
            get(this: RequestInit) {
              expect(this).toBe(hookRequest);
              if (placement === 'enumerable') {
                expect(reads).toEqual(expectedReads.slice(0, expectedReads.indexOf(field)));
              }
              reads.push(field);
              const value = field === 'headers' ? headers : body;
              return omitted ? undefined : value;
            },
          });
        }
        Object.defineProperty(hookRequest, 'cache', {
          enumerable: true,
          get() {
            reads.push('cache');
            return 'no-store';
          },
        });
        return super.fetchWithTimeout(url, hookRequest, timeout, controller, context);
      }
    }
    let sends = 0;
    const client = new HookClient({
      apiKey: 'synthetic-key',
      maxRetries: 0,
      fetch: async (_url, init) => {
        sends += 1;
        expect(reads).toHaveLength(expectedReads.length);
        expect(reads).toEqual(
          placement === 'enumerable' ? expectedReads : expect.arrayContaining(expectedReads),
        );
        expect(init?.headers).toBe(omitted ? undefined : headers);
        expect(init?.body).toBe(omitted ? undefined : body);
        expect(init?.method).toBe('POST');
        expect(init?.cache).toBe('no-store');
        return Response.json({ ok: true });
      },
    });

    await expect(client.post('/synthetic')).resolves.toEqual({ ok: true });
    expect(sends).toBe(1);
  },
);

test.each(
  [false, true].flatMap((deferredDescriptors) =>
    (['body', 'headers'] as const).map((field) => ({ field, deferredDescriptors })),
  ),
)(
  'does not restore inherited $field deleted during copying (deferred descriptors: $deferredDescriptors)',
  async ({ field, deferredDescriptors }) => {
    let inheritedReads = 0;
    let removals = 0;
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [url, init, timeout, controller, context] = args;
        const request: RequestInit = { signal: init?.signal ?? null, method: 'post' };
        const prototype = {};
        Object.defineProperty(prototype, field, {
          get() {
            inheritedReads += 1;
            return field === 'body' ? 'synthetic-inherited-body' : { Authorization: 'Bearer inherited' };
          },
        });
        Object.setPrototypeOf(request, prototype);
        Object.defineProperty(request, 'cache', {
          enumerable: true,
          get() {
            removals += 1;
            Reflect.deleteProperty(request, field);
            return 'no-store';
          },
        });
        Object.defineProperty(request, field, {
          value: field === 'body' ? 'synthetic-own-body' : { 'X-Synthetic': 'own' },
          enumerable: true,
          configurable: true,
        });
        let copyStarted = false;
        const supplied = deferredDescriptors
          ? new Proxy(request, {
              ownKeys(target) {
                copyStarted = true;
                return Reflect.ownKeys(target);
              },
              getOwnPropertyDescriptor(target, property) {
                if (!copyStarted) {
                  throw new TypeError('Descriptors require key enumeration');
                }
                return Reflect.getOwnPropertyDescriptor(target, property);
              },
            })
          : request;
        return super.fetchWithTimeout(url, supplied, timeout, controller, context);
      }
    }
    let sends = 0;
    const client = new HookClient({
      apiKey: 'synthetic-key',
      maxRetries: 0,
      fetch: async (_url, init) => {
        sends += 1;
        expect(init?.method).toBe('POST');
        expect(init?.cache).toBe('no-store');
        expect(init && Object.getOwnPropertyDescriptor(init, field)).toBeUndefined();
        expect(init?.[field]).toBeUndefined();
        return Response.json({ ok: true });
      },
    });

    await expect(client.post('/synthetic')).resolves.toEqual({ ok: true });
    expect({ inheritedReads, removals, sends }).toEqual({ inheritedReads: 0, removals: 1, sends: 1 });
  },
);

test.each(['one-shot keys', 'deferred descriptors'] as const)(
  'preserves a RequestInit proxy with %s',
  async (mode) => {
    const reads: string[] = [];
    let enumerations = 0;
    const headers = { 'X-Synthetic': 'proxy' };
    const marker = Symbol('synthetic-request-marker');
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [url, init, timeout, controller, context] = args;
        const backing: RequestInit = {
          signal: init?.signal ?? null,
          method: 'post',
        };
        const request = new Proxy(backing, {
          ownKeys(target) {
            enumerations += 1;
            if (enumerations > 1) {
              throw new Error('RequestInit keys were enumerated twice');
            }
            return Reflect.ownKeys(target);
          },
          getOwnPropertyDescriptor(target, property) {
            if (mode === 'deferred descriptors' && enumerations === 0) {
              throw new TypeError('Descriptors require key enumeration');
            }
            return Reflect.getOwnPropertyDescriptor(target, property);
          },
        });
        Object.defineProperties(backing, {
          headers: {
            enumerable: true,
            get() {
              expect(this).toBe(request);
              reads.push('headers');
              return headers;
            },
          },
          body: {
            enumerable: true,
            get() {
              expect(this).toBe(request);
              reads.push('body');
              return 'synthetic-proxy-body';
            },
          },
          ['__proto__']: { enumerable: true, value: 'synthetic-prototype-property' },
          [marker]: { enumerable: true, value: 'synthetic-symbol-property' },
        });
        return super.fetchWithTimeout(url, request, timeout, controller, context);
      }
    }
    let sends = 0;
    const client = new HookClient({
      apiKey: 'synthetic-key',
      maxRetries: 0,
      fetch: async (_url, init) => {
        sends += 1;
        expect(init?.headers).toBe(headers);
        expect(init?.body).toBe('synthetic-proxy-body');
        expect(init?.method).toBe('POST');
        expect(init && Object.getOwnPropertyDescriptor(init, '__proto__')?.value).toBe(
          'synthetic-prototype-property',
        );
        expect(init && Reflect.get(init, marker)).toBe('synthetic-symbol-property');
        expect(init && Object.getPrototypeOf(init)).toBe(Object.prototype);
        return Response.json({ ok: true });
      },
    });

    await expect(client.post('/synthetic')).resolves.toEqual({ ok: true });
    expect(reads).toEqual(['headers', 'body']);
    expect({ sends, enumerations }).toEqual({ sends: 1, enumerations: 1 });
  },
);
