import OpenAI from 'openai';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each(['unmarked', 'marked values', 'request carrier'] as const)(
  'retains build-result ownership only through explicit provenance: %s',
  async (kind) => {
    class HookClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        const built = await super.buildRequest(...args);
        const headers = kind === 'marked values' ? built.req.headers : new Headers(built.req.headers);
        const req = kind === 'request carrier' ? { ...built.req, headers } : { headers };
        return { ...built, req };
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((url, init) => {
      sent.push(new Request(url, init as globalThis.RequestInit).headers.get('Authorization'));
      return sent.length === 1
        ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
        : Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    const response = client.models.list();
    if (kind === 'unmarked') {
      await expect(response).rejects.toMatchObject({ status: 401 });
      expect(sent).toEqual(['Bearer access-token-1']);
      expect(transport.exchanges).toBe(1);
    } else {
      await response;
      expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
      expect(transport.exchanges).toBe(2);
    }
  },
);
