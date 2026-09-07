import OpenAI from 'openai';
import { buildHeaders } from 'openai/internal/headers';
import type { RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each([undefined, null, 'Bearer independent', 'Bearer access-token-1'] as const)(
  'retains request ownership through legacy copied fetch input and replacement controller: %j',
  async (authorization) => {
    class LegacyClient extends OpenAI {
      protected override async fetchWithAuth(
        url: RequestInfo,
        init: RequestInit,
        timeout: number,
        _controller: AbortController,
        schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
      ) {
        return super.fetchWithAuth(
          url,
          {
            ...init,
            ...(authorization === undefined
              ? {}
              : { headers: buildHeaders([{ Authorization: authorization }]).values }),
          },
          timeout,
          new AbortController(),
          schemes,
        );
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(Object.getOwnPropertySymbols(init)).toEqual([]);
      sent.push(new Headers(init?.headers).get('Authorization'));
      return authorization === undefined && sent.length > 1
        ? Response.json({ data: [] })
        : Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new LegacyClient({
      ...createTestClientOptions(),
      apiKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    if (authorization === undefined) {
      await client.models.list();
      expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
      expect(transport.exchanges).toBe(2);
    } else {
      await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
      expect(sent).toEqual([authorization]);
      expect(transport.exchanges).toBe(1);
    }
  },
);
