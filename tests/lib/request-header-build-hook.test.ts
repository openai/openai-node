/* oxlint-disable max-classes-per-file -- Each class exercises a separate hook attempt boundary. */
import OpenAI from 'openai';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each([false, true])(
  'lets a buildRequest hook initialize lazy request headers before their first read (workload identity: %s)',
  async (workloadIdentity) => {
    let initialized = false;
    class HookClient extends OpenAI {
      override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
        initialized = true;
        return super.buildRequest(...args);
      }
    }
    const transport = createWorkloadIdentityTransport(() => Response.json({ ok: true }));
    const client = new HookClient({
      ...(workloadIdentity
        ? { ...createTestClientOptions(), apiKey: null, adminAPIKey: null }
        : { apiKey: 'synthetic-key' }),
      fetch: transport.fetch,
    });

    await expect(
      client.request({
        method: 'get',
        path: '/synthetic',
        get headers() {
          if (!initialized) {
            throw new Error('buildRequest has not initialized headers');
          }
          return { 'X-Custom': 'initialized' };
        },
      }),
    ).resolves.toEqual({ ok: true });
  },
);

test('lets a buildRequest hook initialize lazy request headers before each retry read', async () => {
  let initialized = false;
  let builds = 0;
  let sends = 0;
  class HookClient extends OpenAI {
    override async buildRequest(...args: Parameters<OpenAI['buildRequest']>) {
      builds += 1;
      initialized = true;
      return super.buildRequest(...args);
    }
  }
  const transport = createWorkloadIdentityTransport(() => {
    initialized = false;
    sends += 1;
    return sends === 1
      ? new Response(null, { status: 500, headers: { 'retry-after-ms': '0' } })
      : Response.json({ ok: true });
  });
  const client = new HookClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 1,
  });

  await expect(
    client.request({
      method: 'get',
      path: '/synthetic',
      get headers() {
        if (!initialized) {
          throw new Error('buildRequest has not initialized headers for this attempt');
        }
        return { 'X-Custom': 'initialized' };
      },
    }),
  ).resolves.toEqual({ ok: true });
  expect({ builds, sends }).toEqual({ builds: 2, sends: 2 });
});
