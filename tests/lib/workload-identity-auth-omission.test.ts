/* oxlint-disable max-classes-per-file -- Independent fixtures exercise protected authentication hooks. */
import OpenAI from 'openai';
import { buildHeaders } from 'openai/internal/headers';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['authHeaders', 'bearerAuth'] as const)('Legacy %s authentication omission', (hook) => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_ADMIN_KEY'];
  });

  test.each(['undefined', 'empty', 'unrelated', 'after-super'] as const)(
    'fills an ordinary %s result and refreshes once after a 401',
    async (kind) => {
      const omitted = () => (kind === 'empty' ? buildHeaders([]) : undefined);
      const result = () => (kind === 'unrelated' ? buildHeaders([{ 'X-Custom': 'retained' }]) : omitted());
      class HookClient extends OpenAI {
        protected override async authHeaders(options: FinalRequestOptions) {
          if (hook !== 'authHeaders') {
            return super.authHeaders(options);
          }
          if (kind === 'after-super') {
            await super.authHeaders(options);
          }
          return result();
        }
        protected override async bearerAuth(options: FinalRequestOptions) {
          if (hook !== 'bearerAuth') {
            return super.bearerAuth(options);
          }
          if (kind === 'after-super') {
            await super.bearerAuth(options);
          }
          return result();
        }
      }
      const sent: Headers[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        sent.push(new Headers(init?.headers));
        return sent.length === 1
          ? Response.json({ error: { message: 'Unauthorized' } }, { status: 401 })
          : Response.json({ data: [] });
      });
      const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });

      await client.models.list();

      expect(sent.map((headers) => headers.get('Authorization'))).toEqual([
        'Bearer access-token-1',
        'Bearer access-token-2',
      ]);
      expect(transport.exchanges).toBe(2);
      if (kind === 'unrelated') {
        expect(sent.every((headers) => headers.get('X-Custom') === 'retained')).toBe(true);
      }
    },
  );

  test.each([
    'issued-delete',
    'independent-delete',
    'null',
    'empty',
    'prepare-delete',
    'security-disabled',
  ] as const)('preserves intentional %s authentication removal', async (kind) => {
    const remove = (headers: ReturnType<typeof buildHeaders> | undefined) => {
      const selected =
        kind === 'independent-delete' ? buildHeaders([{ Authorization: 'Bearer independent' }]) : headers;
      selected?.values.delete('Authorization');
      return selected;
    };
    class HookClient extends OpenAI {
      protected override async authHeaders(options: FinalRequestOptions) {
        if (hook !== 'authHeaders') {
          return super.authHeaders(options);
        }
        return remove(kind === 'issued-delete' ? await super.authHeaders(options) : undefined);
      }
      protected override async bearerAuth(options: FinalRequestOptions) {
        if (hook !== 'bearerAuth') {
          return super.bearerAuth(options);
        }
        return remove(kind === 'issued-delete' ? await super.bearerAuth(options) : undefined);
      }
      // oxlint-disable-next-line class-methods-use-this -- This fixture removes auth at the preparation boundary.
      protected override async prepareRequest(...[request]: Parameters<OpenAI['prepareRequest']>) {
        if (kind === 'prepare-delete') {
          (request.headers as Headers).delete('Authorization');
        }
      }
    }
    const sent: Headers[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sent.push(new Headers(init?.headers));
      return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    });
    const client = new HookClient({ ...createTestClientOptions(), fetch: transport.fetch, maxRetries: 0 });
    const callerHeaders = kind === 'null' ? { Authorization: null } : undefined;
    const options: FinalRequestOptions = { method: 'get', path: '/models', headers: callerHeaders };
    if (kind === 'empty') {
      options.headers = { Authorization: '' };
    }
    if (kind === 'security-disabled') {
      options.__security = { bearerAuth: false };
    }

    if (kind === 'security-disabled') {
      await expect(client.request(options)).rejects.toThrow('Could not resolve authentication method');
      expect(sent).toHaveLength(0);
      expect(transport.exchanges).toBe(0);
      return;
    }

    await expect(client.request(options)).rejects.toMatchObject({ status: 401 });

    expect(sent.map((headers) => headers.get('Authorization'))).toEqual([kind === 'empty' ? '' : null]);
    expect(transport.exchanges).toBe(kind === 'issued-delete' ? 1 : 0);
  });
});
