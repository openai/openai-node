import { test, vi } from 'vitest';
import OpenAI from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

interface RequestImplementation {
  create: (url: RequestInfo, init: RequestInit | undefined) => object;
  dispatchedAuthorization: (request: unknown, init: RequestInit | undefined) => string | null;
}

async function requestImplementation(kind: 'native' | 'foreign'): Promise<RequestImplementation> {
  if (kind === 'native') {
    return {
      create: (url, init) => new Request(url, init as globalThis.RequestInit),
      dispatchedAuthorization: (request, init) => {
        if (!(request instanceof Request)) {
          throw new Error('Expected the native Request from the hook');
        }
        return new Request(request, init as globalThis.RequestInit).headers.get('Authorization');
      },
    };
  }
  const { Request: ForeignRequest } = await import('undici');
  return {
    create: (url, init) =>
      new ForeignRequest(String(url), {
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        signal: init?.signal ?? null,
      }),
    dispatchedAuthorization: (request, init) => {
      if (!(request instanceof ForeignRequest)) {
        throw new Error('Expected the foreign Request from the hook');
      }
      // The transport receives no init.headers, so the Request's internal headers are authoritative.
      return new ForeignRequest(request, { method: init?.method ?? 'GET' }).headers.get('Authorization');
    },
  };
}

describe.each(['native', 'foreign'] as const)('%s Request header provenance', (kind) => {
  test.skipIf(kind === 'foreign' && Number(process.versions.node.split('.')[0]) < 24).each([
    ['own', 'throwing'],
    ['inherited', 'throwing'],
    ['own', 'stateful'],
    ['inherited', 'stateful'],
  ] as const)('ignores %s %s headers accessors before dispatch', async (location, behavior) => {
    const implementation = await requestImplementation(kind);
    const requests: object[] = [];
    let shadowReads = 0;
    const readShadow = vi.fn<() => Headers>(() => {
      shadowReads += 1;
      if (behavior === 'throwing') {
        throw new Error('Caller Request.headers accessor must not run');
      }
      return new Headers({ Authorization: `Bearer independent-${shadowReads}` });
    });
    class HookClient extends OpenAI {
      override async fetchWithTimeout(
        url: RequestInfo,
        init: RequestInit | undefined,
        timeout: number,
        controller: AbortController,
        context?: object,
      ) {
        const request = implementation.create(url, init);
        const target = location === 'own' ? request : Object.create(Object.getPrototypeOf(request));
        Object.defineProperty(target, 'headers', { get: readShadow });
        if (location === 'inherited') {
          Object.setPrototypeOf(request, target);
        }
        requests.push(request);
        return super.fetchWithTimeout(request as RequestInfo, undefined, timeout, controller, context);
      }
    }
    const authorizations: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((url, init) => {
      expect(url).toBe(requests[authorizations.length]);
      expect(init?.headers).toBeUndefined();
      authorizations.push(implementation.dispatchedAuthorization(url, init));
      return authorizations.length === 1
        ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
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

    expect(readShadow).not.toHaveBeenCalled();
    expect(authorizations).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
    expect(transport.exchanges).toBe(2);
  });
});
