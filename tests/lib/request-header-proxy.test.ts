import OpenAI from 'openai';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { test, vi } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.skipIf(Number(process.versions.node.split('.')[0]) < 24)(
  'forwards a proxy-wrapped Request without reading shadowed headers or assuming workload usage',
  async () => {
    const readHeaders = vi.fn(() => {
      throw new Error('The Request headers shadow must not be evaluated');
    });
    const requests: Request[] = [];
    class ProxyRequestClient extends OpenAI {
      override async fetchWithTimeout(
        url: RequestInfo,
        init: RequestInit | undefined,
        timeout: number,
        controller: AbortController,
        context?: object,
      ) {
        const request = new Request(String(url), init);
        Object.defineProperty(request, 'headers', { get: readHeaders });
        const proxy = new Proxy(request, {});
        requests.push(proxy);
        return super.fetchWithTimeout(proxy, undefined, timeout, controller, context);
      }
    }
    let sends = 0;
    const transport = createWorkloadIdentityTransport(() => {
      throw new Error('Only string token exchange requests use the fixture transport');
    });
    const client = new ProxyRequestClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      maxRetries: 0,
      fetch: async (input, init) => {
        if (typeof input === 'string') {
          return transport.fetch(input, init);
        }
        expect(input).toBe(requests[sends]);
        expect(init?.headers).toBeUndefined();
        sends += 1;
        return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
      },
    });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    expect(sends).toBe(1);
    expect(transport.exchanges).toBe(1);
    expect(readHeaders).not.toHaveBeenCalled();
  },
);
