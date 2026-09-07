import OpenAI from 'openai';
import { buildHeaders } from 'openai/internal/headers';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each([false, true])(
  'registers a deferred canonical read before nested build, forwarding: %s',
  async (forward) => {
    let nested = false;
    class HookClient extends OpenAI {
      protected override async authHeaders(...args: Parameters<OpenAI['authHeaders']>) {
        if (!nested) {
          nested = true;
          expect(buildHeaders([args[0].headers]).nulls.has('authorization')).toBe(true);
          const result = this.buildRequest(
            { ...args[0] },
            forward && args[2] ? { credentialContext: args[2] } : {},
          );
          if (forward) {
            const built = await result;
            expect(built.req.headers.get('Authorization')).toBeNull();
          } else {
            await expect(result).rejects.toThrow('must forward credentialContext');
          }
        }
        return super.authHeaders(...args);
      }
    }
    let rows = [['Authorization', null] as const][Symbol.iterator]();
    const headers = { [Symbol.iterator]: () => rows } as unknown as Headers;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      return Response.json({ data: [] });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.models.list({ headers });
    rows = [['Authorization', null] as const][Symbol.iterator]();
    const standalone = await client.buildRequest({ method: 'get', path: '/synthetic', headers });
    expect(standalone.req.headers.get('Authorization')).toBeNull();
    expect(nested).toBe(true);
  },
);
