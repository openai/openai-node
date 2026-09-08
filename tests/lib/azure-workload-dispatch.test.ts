import { AzureOpenAI } from 'openai';
import { WorkloadIdentityAuth } from 'openai/auth/workload-identity-auth';
import { buildHeaders } from 'openai/internal/headers';
import type { Fetch, RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import type { RequestCredentialContext } from 'openai/internal/request-credentials';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import { createTestWorkloadIdentity, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each([
  { forward: true, concurrent: false, independent: false },
  { forward: true, concurrent: true, independent: false },
  { forward: false, concurrent: true, independent: false },
  { forward: true, concurrent: true, independent: true },
])('preserves Azure dispatch context through reconstructed input: %j', async (scenario) => {
  class WorkloadAzure extends AzureOpenAI {
    constructor(fetch: Fetch) {
      super({
        apiKey: 'synthetic-azure-key',
        apiVersion: '2024-10-01-preview',
        baseURL: 'https://synthetic.example/v1',
        fetch,
        maxRetries: 0,
      });
      // This extension selects subject-token authentication through the inherited protected hooks.
      Object.defineProperty(this, '_workloadIdentityAuth', {
        value: new WorkloadIdentityAuth(createTestWorkloadIdentity(), fetch),
      });
    }

    protected override async authHeaders(
      options: FinalRequestOptions,
      _schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
      context?: RequestCredentialContext,
    ) {
      return super.bearerAuth(options, context);
    }

    protected override async fetchWithAuth(
      url: RequestInfo,
      init: RequestInit,
      timeout: number,
      _controller: AbortController,
      schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
      context?: object,
    ) {
      const headers = scenario.independent
        ? buildHeaders([{ Authorization: 'Bearer access-token-1' }]).values
        : new Headers(init.headers);
      return super.fetchWithAuth(
        url,
        {
          headers,
          ...(init.method === undefined ? {} : { method: init.method }),
          ...(init.body === undefined ? {} : { body: init.body }),
          ...(init.signal === undefined ? {} : { signal: init.signal }),
        },
        timeout,
        new AbortController(),
        schemes,
        scenario.forward ? context : undefined,
      );
    }
  }
  const sent = new Map<string, (string | null)[]>();
  const transport = createWorkloadIdentityTransport((url, init) => {
    const key = String(url);
    const attempts = sent.get(key) ?? [];
    attempts.push(new Headers(init?.headers).get('Authorization'));
    sent.set(key, attempts);
    return attempts.length === 1
      ? Response.json({ error: { message: 'Synthetic unauthorized' } }, { status: 401 })
      : Response.json({ id: 'synthetic-model' });
  });
  const client = new WorkloadAzure(transport.fetch);
  const refresh = scenario.forward && !scenario.independent;
  const requests = (scenario.concurrent ? ['first', 'second'] : ['first']).map((id) => {
    const request = client.models.retrieve(id);
    return refresh ? request : expect(request).rejects.toMatchObject({ status: 401 });
  });

  await Promise.all(requests);

  expect([...sent.values()]).toEqual(
    requests.map(() =>
      refresh ? ['Bearer access-token-1', 'Bearer access-token-2'] : ['Bearer access-token-1'],
    ),
  );
  expect(transport.exchanges).toBe(refresh ? 2 : 1);
});
