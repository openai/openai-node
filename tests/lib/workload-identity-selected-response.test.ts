import OpenAI from 'openai';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['sdk', 'independent'] as const)('selecting the %s response', (selected) => {
  test.each([true, false])('tracks the returned dispatch when SDK starts first: %s', async (sdkFirst) => {
    class DispatchClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [url, init, timeout, , context] = args;
        const order = sdkFirst ? ['sdk', 'independent'] : ['independent', 'sdk'];
        const responses = await Promise.all(
          order.map((credential) => {
            const headers = new Headers(init?.headers);
            if (credential === 'independent') {
              headers.set('Authorization', 'Bearer independent');
            }
            return super.fetchWithTimeout(url, { ...init, headers }, timeout, new AbortController(), context);
          }),
        );
        const chosen = responses[order.indexOf(selected)];
        const discarded = responses[order.indexOf(selected === 'sdk' ? 'independent' : 'sdk')];
        if (!chosen || !discarded) {
          throw new Error('Expected both delegated responses');
        }
        await discarded.body?.cancel();
        return chosen;
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const authorization = new Headers(init?.headers).get('Authorization');
      sent.push(authorization);
      return authorization === 'Bearer access-token-2'
        ? Response.json({ ok: true })
        : Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new DispatchClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    const response = client.post('/models', { body: { synthetic: true } });
    if (selected === 'sdk') {
      await expect(response).resolves.toEqual({ ok: true });
      expect(transport.exchanges).toBe(2);
      expect(sent).toHaveLength(4);
    } else {
      await expect(response).rejects.toMatchObject({ status: 401 });
      expect(transport.exchanges).toBe(1);
      expect(sent).toHaveLength(2);
    }
  });
});
