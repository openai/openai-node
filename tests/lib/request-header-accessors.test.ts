import OpenAI from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { test, vi } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['native', 'foreign'] as const)('%s Request header accessors', (realm) => {
  beforeEach(() => {
    // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined removes inherited credentials.
    vi.stubEnv('OPENAI_API_KEY', undefined);
    // oxlint-disable-next-line unicorn/no-useless-undefined -- Explicit undefined removes inherited credentials.
    vi.stubEnv('OPENAI_ADMIN_KEY', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test.skipIf(realm === 'foreign' && Number(process.versions.node.split('.')[0]) < 24).each([
    ['throwing', false],
    ['throwing', true],
    ['stateful', false],
    ['stateful', true],
  ] as const)(
    'uses internal headers despite a %s own getter (workload identity: %s)',
    async (kind, workloadIdentity) => {
      const foreign = realm === 'foreign' ? await import('undici') : undefined;
      const RequestClass = foreign?.Request ?? Request;
      const intrinsicHeaders = Object.getOwnPropertyDescriptor(RequestClass.prototype, 'headers')?.get;
      if (!intrinsicHeaders) {
        throw new Error('Expected the Request implementation to expose its headers accessor');
      }
      let shadowReads = 0;
      const readShadowHeaders = vi.fn(() => {
        shadowReads += 1;
        if (kind === 'throwing') {
          throw new Error('The Request headers shadow must not be evaluated');
        }
        return new Headers({ Authorization: `Bearer shadow-${shadowReads}` });
      });
      const requests: object[] = [];
      class HookClient extends OpenAI {
        override async fetchWithTimeout(
          url: RequestInfo,
          init: RequestInit | undefined,
          timeout: number,
          controller: AbortController,
          context?: object,
        ) {
          const request = new RequestClass(String(url), {
            method: init?.method ?? 'GET',
            headers: new Headers(init?.headers),
            signal: init?.signal ?? null,
          });
          Object.defineProperty(request, 'headers', { get: readShadowHeaders });
          requests.push(request);
          return super.fetchWithTimeout(
            request as unknown as RequestInfo,
            undefined,
            timeout,
            controller,
            context,
          );
        }
      }
      const authorizations: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((url, init) => {
        expect(url).toBe(requests[authorizations.length]);
        // Model the transport's Request-internal view, independent of public property shadows.
        let headers: Headers = intrinsicHeaders.call(url);
        if (realm === 'foreign' && workloadIdentity) {
          expect(init?.headers).toBeInstanceOf(Headers);
          const dispatched = new Headers(init?.headers);
          expect([...dispatched]).toEqual([...headers]);
          headers = dispatched;
        } else {
          expect(init?.headers).toBeUndefined();
        }
        authorizations.push(headers.get('Authorization'));
        return workloadIdentity && authorizations.length === 1
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      });
      const client = new HookClient({
        ...(workloadIdentity ? createTestClientOptions() : { apiKey: 'synthetic-key' }),
        fetch: transport.fetch,
        maxRetries: 0,
      });

      await client.models.list();

      expect(readShadowHeaders).not.toHaveBeenCalled();
      expect(authorizations).toEqual(
        workloadIdentity ? ['Bearer access-token-1', 'Bearer access-token-2'] : ['Bearer synthetic-key'],
      );
      expect(transport.exchanges).toBe(workloadIdentity ? 2 : 0);
    },
  );
});
