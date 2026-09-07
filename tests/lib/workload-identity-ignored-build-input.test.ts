import OpenAI from 'openai';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['context', 'original', 'discarded'] as const)('%s request ownership', (ownership) => {
  test.each([
    { authorization: undefined, status: 401 },
    { authorization: undefined, status: 500 },
    { authorization: null, status: 500 },
    { authorization: '', status: 500 },
    { authorization: 'Bearer independent', status: 500 },
  ])(
    'retries a custom build that ignores its original header source: %j',
    async ({ authorization, status }) => {
      let reads = 0;
      const headers = {
        get [Symbol.iterator]() {
          reads += 1;
          throw new Error('An ignored header source was read');
        },
      } as unknown as Headers;
      class HookClient extends OpenAI {
        override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
          const replacement = authorization === undefined ? {} : { Authorization: authorization };
          if (ownership === 'original') {
            args[0].headers = replacement;
            return super.buildRequest(args[0]);
          }
          return super.buildRequest(
            { ...args[0], headers: replacement },
            ownership === 'context' ? args[1] : {},
          );
        }
      }
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers).get('Authorization'));
        return sent.length === 1
          ? Response.json({ error: 'synthetic retry' }, { status, headers: { 'retry-after-ms': '0' } })
          : Response.json({ data: [] });
      });
      const client = new HookClient({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        fetch: transport.fetch,
        maxRetries: 1,
      });

      const request = client.models.list({ headers });
      if (ownership === 'discarded') {
        await expect(request).rejects.toThrow('forward credentialContext');
        expect(sent).toHaveLength(1);
        expect(reads).toBe(0);
        expect(transport.exchanges).toBe(authorization === undefined ? 1 : 0);
        return;
      }
      await request;

      expect(reads).toBe(0);
      expect(sent).toEqual(
        authorization === undefined
          ? ['Bearer access-token-1', `Bearer access-token-${status === 401 ? 2 : 1}`]
          : [authorization, authorization],
      );
      const expectedExchanges = status === 401 ? 2 : 1;
      expect(transport.exchanges).toBe(authorization === undefined ? expectedExchanges : 0);
    },
  );
});
