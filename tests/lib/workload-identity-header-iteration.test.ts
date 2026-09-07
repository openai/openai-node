import OpenAI from 'openai';
import type { HeadersLike } from 'openai/internal/headers';
import { vi } from 'vitest';

const createClient = (getToken: () => Promise<string>, receive: (headers: Headers) => void) =>
  new OpenAI({
    apiKey: null,
    adminAPIKey: null,
    workloadIdentity: {
      identityProviderId: 'test-identity-provider-id',
      serviceAccountId: 'test-service-account-id',
      provider: { tokenType: 'jwt', getToken },
    },
    organization: 'test-org-id',
    project: 'test-project-id',
    maxRetries: 0,
    fetch: async (url, init) => {
      if (url.toString().endsWith('/oauth/token')) {
        return Response.json({
          access_token: 'access-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      receive(new Headers(init?.headers));
      return Response.json({ data: [] });
    },
  });

describe('workload identity header iteration', () => {
  describe.each(['array', 'Headers'] as const)('%s inputs', (kind) => {
    test.each(['own', 'inherited', 'getter'] as const)(
      'consumes a one-use iterator once (%s protocol)',
      async (location) => {
        const headers = kind === 'array' ? [['X-Custom', 'test']] : new Headers({ 'X-Custom': 'test' });
        const iterator = headers[Symbol.iterator]();
        const iterate = vi.fn(() => iterator);
        const readIterator = vi.fn(() => iterate);
        const target = location === 'inherited' ? Object.create(Object.getPrototypeOf(headers)) : headers;
        Object.defineProperty(
          target,
          Symbol.iterator,
          location === 'getter' ? { get: readIterator } : { value: iterate },
        );
        if (location === 'inherited') {
          Object.setPrototypeOf(headers, target);
        }
        const client = createClient(
          async () => 'subject-token',
          (sent) => {
            expect(sent.get('X-Custom')).toBe('test');
            expect(sent.get('Authorization')).toBe('Bearer access-token');
          },
        );

        await client.models.list({ headers });

        expect(iterate).toHaveBeenCalledTimes(1);
        expect(readIterator).toHaveBeenCalledTimes(location === 'getter' ? 1 : 0);
      },
    );
  });

  test.each(['own', 'inherited'] as const)(
    'consumes iterable Authorization overrides once without exchanging credentials (%s protocol)',
    async (location) => {
      const headers = [
        ['aUtHoRiZaTiOn', null],
        ['X-Custom', 'test'],
      ];
      const iterator = headers.values();
      const iterate = vi.fn(() => iterator);
      const target = location === 'own' ? headers : Object.create(Array.prototype);
      Object.defineProperty(target, Symbol.iterator, { value: iterate });
      if (location === 'inherited') {
        Object.setPrototypeOf(headers, target);
      }
      const getToken = vi.fn(async () => {
        throw new Error('Unused subject token provider is unavailable');
      });
      const client = createClient(getToken, (sent) => {
        expect(sent.has('Authorization')).toBe(false);
        expect(sent.get('X-Custom')).toBe('test');
      });

      await client.models.list({ headers });

      expect(iterate).toHaveBeenCalledTimes(1);
      expect(getToken).not.toHaveBeenCalled();
    },
  );

  test('shares a one-use Authorization removal between body encoding and authentication', async () => {
    const headers = [
      ['Authorization', null],
      ['X-Custom', 'test'],
    ];
    const iterator = headers.values();
    const iterate = vi.fn(() => iterator);
    Object.defineProperty(headers, Symbol.iterator, { value: iterate });
    const getToken = vi.fn(async () => {
      throw new Error('Unused subject token provider is unavailable');
    });
    const client = createClient(getToken, (sent) => {
      expect(sent.has('Authorization')).toBe(false);
      expect(sent.get('X-Custom')).toBe('test');
    });

    await client.post('/synthetic', { body: { synthetic: true }, headers });

    expect(iterate).toHaveBeenCalledTimes(1);
    expect(getToken).not.toHaveBeenCalled();
  });

  test('refreshes a foreign Headers implementation after credential acquisition', async () => {
    if (Number(process.versions.node.split('.')[0]) < 24) {
      return;
    }
    const { Headers: ForeignHeaders } = await import('undici');
    const headers = new ForeignHeaders({ 'X-Credential-Context': 'before' });
    const client = createClient(
      async () => {
        await Promise.resolve();
        headers.set('X-Credential-Context', 'after');
        headers.set('Authorization', 'Bearer independent');
        return 'subject-token';
      },
      (sent) => {
        expect(sent.get('X-Credential-Context')).toBe('after');
        expect(sent.get('Authorization')).toBe('Bearer independent');
      },
    );

    await client.models.list({ headers: headers as unknown as Headers });
  });

  test.each(['record', 'array', 'Headers'] as const)(
    'preserves reusable %s changes during async subject-token acquisition',
    async (kind) => {
      const record: Record<string, string | null> = { 'X-Credential-Context': 'before' };
      const pairs: (string | null)[][] = [['X-Credential-Context', 'before']];
      const native = new Headers({ 'X-Credential-Context': 'before' });
      const headers: HeadersLike = { record, array: pairs, Headers: native }[kind];
      const client = createClient(
        async () => {
          await Promise.resolve();
          record['X-Credential-Context'] = 'after';
          record['Authorization'] = null;
          pairs.splice(0, 1, ['X-Credential-Context', 'after'], ['Authorization', null]);
          native.set('X-Credential-Context', 'after');
          native.set('Authorization', '');
          return 'subject-token';
        },
        (sent) => {
          expect(sent.get('X-Credential-Context')).toBe('after');
          expect(sent.get('Authorization')).toBe(kind === 'Headers' ? '' : null);
        },
      );

      await client.models.list({ headers });
    },
  );
});
