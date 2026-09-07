/* oxlint-disable max-classes-per-file -- Independent fixtures exercise deferred authentication boundaries. */
import OpenAI, { OpenAIError } from 'openai';
import { buildHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each([false, true])(
  'guards a consumed deferred header source before nested builds (after await: %s)',
  async (afterAwait) => {
    let rows = [['Authorization', null] as const].values();
    const headers = { [Symbol.iterator]: () => rows } as unknown as Headers;
    const options: FinalRequestOptions = { method: 'get', path: '/models', headers };
    let inspected = false;
    let nestedFailure: unknown;
    class InspectingClient extends OpenAI {
      protected override async authHeaders(
        received: FinalRequestOptions,
        schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
        context?: object,
      ) {
        if (inspected) {
          return super.authHeaders(received, schemes, context);
        }
        inspected = true;
        const parsed = buildHeaders([received.headers]);
        if (afterAwait) {
          await Promise.resolve();
        }
        try {
          await this.buildRequest({ ...received });
        } catch (error) {
          nestedFailure = error;
        }
        return parsed;
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return Response.json({ data: [] });
    });
    const client = new InspectingClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });

    await client.request(options);

    expect(nestedFailure).toBeInstanceOf(OpenAIError);
    expect(nestedFailure).toMatchObject({
      message: expect.stringContaining('must forward credentialContext'),
    });
    expect(sent).toEqual([null]);
    expect(transport.exchanges).toBe(0);

    rows = [['Authorization', null] as const].values();
    const fresh = await client.buildRequest({ ...options });
    expect(fresh.req.headers.get('Authorization')).toBeNull();
  },
);
