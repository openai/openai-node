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
