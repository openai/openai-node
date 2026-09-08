import OpenAI from 'openai';
import { buildHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test('authentication hooks read synchronous mutations of replayable body request headers', async () => {
  const headers = { 'X-Credential': 'before' };
  class HookClient extends OpenAI {
    // oxlint-disable-next-line class-methods-use-this -- This hook derives authentication from request-local headers.
    protected override async authHeaders(options: FinalRequestOptions) {
      expect(options.headers).toBe(headers);
      headers['X-Credential'] = 'after';
      const credential = buildHeaders([options.headers]).values.get('X-Credential');
      return buildHeaders([{ Authorization: `Bearer ${credential}` }]);
    }
  }
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('Authorization'));
    return Response.json({ data: [] });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await client.post('https://independent.example.test/synthetic', { body: { synthetic: true }, headers });

  expect(sent).toEqual(['Bearer after']);
  expect(transport.exchanges).toBe(0);
});
