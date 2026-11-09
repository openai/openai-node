import OpenAI from 'openai';
import type { ExternalKeyCreateParams } from 'openai/resources/admin/organization/external-keys';

const baseURL = 'https://example.com/v1';
const providers: ExternalKeyCreateParams[] = [
  {
    type: 'aws',
    name: 'AWS',
    role_arn: 'arn:aws:iam::000000000000:role/test',
    external_id: 'org_test',
    kms_arn: 'arn:aws:kms:us-east-1:000000000000:key/test',
  },
  {
    type: 'gcp',
    name: 'GCP',
    audience: 'org_test',
    kms_key_location: 'global',
    kms_key_name: 'key',
    kms_key_ring_name: 'ring',
    kms_project_id: 'project',
    workload_identity_pool_id: 'pool',
    workload_identity_project_number: '123',
    workload_identity_provider_id: 'provider',
    purpose: 'psp_decryption',
    kms_key_version: '1',
  },
  {
    type: 'azure',
    name: 'Azure',
    key_name: 'org_test--key',
    tenant_id: 'tenant',
    vault_uri: 'https://example.vault.azure.net',
    purpose: 'psp_decryption',
    key_version: 'version',
  },
];

function key(id = 'extkey_test', object = 'organization.external_key') {
  return { id, object, type: 'aws', name: 'test', api_project_ids: [], workspace_id: '', created_at: 123 };
}

test.each(providers)(
  'external-key $type registration uses admin auth and preserves provider fields',
  async (provider) => {
    const requests: Request[] = [];
    const client = new OpenAI({
      apiKey: 'project-test',
      adminAPIKey: 'admin-test',
      baseURL,
      maxRetries: 0,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        expect(request.method).toBe('POST');
        expect(new URL(request.url).pathname).toBe('/v1/organization/external_keys');
        expect(request.headers.get('authorization')).toBe('Bearer admin-test');
        expect(await request.json()).toEqual(provider);
        return Response.json(key());
      },
    });
    expect(await client.admin.organization.externalKeys.create(provider)).toEqual(key());
    expect(requests).toHaveLength(1);
  },
);

test('external-key iteration carries the purpose filter and forward cursor', async () => {
  const queries: Record<string, string>[] = [];
  const client = new OpenAI({
    apiKey: 'project-test',
    adminAPIKey: 'admin-test',
    baseURL,
    maxRetries: 0,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      expect(request.headers.get('authorization')).toBe('Bearer admin-test');
      const query = new URL(request.url).searchParams;
      queries.push(Object.fromEntries(query));
      const more = !query.has('after');
      const id = more ? 'extkey_first' : 'extkey_last';
      return Response.json({ object: 'list', data: [key(id)], first_id: id, last_id: id, has_more: more });
    },
  });
  const ids: string[] = [];
  for await (const item of client.admin.organization.externalKeys.list({
    purpose: 'psp_decryption',
    limit: 1,
  })) {
    ids.push(item.id);
  }
  expect(ids).toEqual(['extkey_first', 'extkey_last']);
  expect(queries).toEqual([
    { purpose: 'psp_decryption', limit: '1' },
    { purpose: 'psp_decryption', limit: '1', after: 'extkey_first' },
  ]);
});

test('external-key lifecycle preserves raw responses and the full deletion resource', async () => {
  const routes: string[] = [];
  const client = new OpenAI({
    apiKey: 'project-test',
    adminAPIKey: 'admin-test',
    baseURL,
    maxRetries: 0,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const { pathname } = new URL(request.url);
      routes.push(`${request.method} ${pathname}`);
      expect(request.headers.get('authorization')).toBe('Bearer admin-test');
      if (pathname.endsWith('/validate')) {
        return Response.json({ status: 'valid' });
      }
      return Response.json(
        key('extkey_test', request.method === 'DELETE' ? 'organization.external_key.deleted' : undefined),
      );
    },
  });
  const keys = client.admin.organization.externalKeys;
  const { data, response } = await keys.retrieve('extkey_test').withResponse();
  expect(data).toEqual(key());
  expect(response.status).toBe(200);
  expect(await keys.validate('extkey_test')).toEqual({ status: 'valid' });
  expect(await keys.delete('extkey_test')).toEqual(key('extkey_test', 'organization.external_key.deleted'));
  expect(routes).toEqual([
    'GET /v1/organization/external_keys/extkey_test',
    'POST /v1/organization/external_keys/extkey_test/validate',
    'DELETE /v1/organization/external_keys/extkey_test',
  ]);
});
