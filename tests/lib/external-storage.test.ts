import { afterEach, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';
import OpenAI from 'openai';
import type {
  ExternalStorageConfiguration,
  ExternalStorageCreateParams,
} from 'openai/resources/admin/organization/external-storage';

const baseURL = 'https://example.com/v1';
const storageID = 'extstorage/a?b#c';
const awsConfiguration: ExternalStorageConfiguration = {
  id: 'extstorage_test',
  object: 'organization.external_storage',
  project_id: 'proj_test',
  geography: 'US',
  status: 'validated',
  created_at: 123,
  provider: {
    type: 'aws',
    account_id: '000000000000',
    bucket: 'test-bucket',
    role_arn: 'arn:aws:iam::000000000000:role/test',
    region: 'us-east-1',
    external_id: 'test-external-id',
  },
};
const azureConfiguration: ExternalStorageConfiguration = {
  ...awsConfiguration,
  provider: {
    type: 'azure',
    tenant_id: 'test-tenant',
    subscription_id: 'test-subscription',
    resource_group: 'test-group',
    account_name: 'test-account',
    container: 'test-container',
    region: 'eastus',
  },
};
const providers = [
  {
    name: 'AWS',
    input: { type: 'aws', bucket: 'test-bucket', role_arn: 'arn:aws:iam::000000000000:role/test' },
    response: awsConfiguration,
  },
  {
    name: 'Azure',
    input: {
      type: 'azure',
      tenant_id: 'test-tenant',
      subscription_id: 'test-subscription',
      resource_group: 'test-group',
      account_name: 'test-account',
      container: 'test-container',
    },
    response: azureConfiguration,
  },
] satisfies {
  name: string;
  input: ExternalStorageCreateParams['provider'];
  response: ExternalStorageConfiguration;
}[];

function capturedRequest(fetchMock: Mock<typeof globalThis.fetch>, index = 0): Request {
  const args = fetchMock.mock.calls[index];
  if (!args) {
    throw new Error('Expected a captured SDK request');
  }
  return new Request(...args);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

test.each(providers)(
  'creates $name storage with admin auth and exact provider parameters',
  async ({ input, response }) => {
    const payload = {
      ...response,
      provider: { ...response.provider, future_provider_field: { retained: true } },
      future_configuration_field: { retained: true },
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(payload));
    const client = new OpenAI({ baseURL, apiKey: 'test-project-key', adminAPIKey: 'test-admin-key', fetch });
    const result = await client.admin.organization.externalStorage.create({
      project_id: 'proj_test',
      provider: input,
    });
    expect(result).toEqual(payload);
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = capturedRequest(fetch);
    expect(request.url).toBe(`${baseURL}/organization/external_storage`);
    expect(request.method).toBe('POST');
    expect(request.headers.get('authorization')).toBe('Bearer test-admin-key');
    expect(await request.json()).toEqual({ project_id: 'proj_test', provider: input });
  },
);

test.each([
  {
    name: 'retrieve',
    method: 'GET',
    suffix: '',
    payload: awsConfiguration,
    invoke: (client: OpenAI) => client.admin.organization.externalStorage.retrieve(storageID),
  },
  {
    name: 'validate',
    method: 'POST',
    suffix: '/validate',
    payload: azureConfiguration,
    invoke: (client: OpenAI) => client.admin.organization.externalStorage.validate(storageID),
  },
  {
    name: 'delete',
    method: 'DELETE',
    suffix: '',
    payload: { id: storageID, object: 'organization.external_storage.deleted', deleted: true },
    invoke: (client: OpenAI) => client.admin.organization.externalStorage.delete(storageID),
  },
])(
  '$name uses the admin key and treats the storage ID as one path parameter',
  async ({ method, suffix, payload, invoke }) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(payload));
    const client = new OpenAI({ baseURL, apiKey: 'test-project-key', adminAPIKey: 'test-admin-key', fetch });
    expect(await invoke(client)).toEqual(payload);
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = capturedRequest(fetch);
    expect(request.url).toBe(
      `${baseURL}/organization/external_storage/${encodeURIComponent(storageID)}${suffix}`,
    );
    expect(request.method).toBe(method);
    expect(request.headers.get('authorization')).toBe('Bearer test-admin-key');
    expect(await request.text()).toBe('');
  },
);

test('storage pagination preserves project filtering, ordering, limit, and admin auth', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({
        object: 'list',
        data: [{ ...awsConfiguration, id: 'extstorage_first' }],
        first_id: 'extstorage_first',
        last_id: 'extstorage_first',
        has_more: true,
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        object: 'list',
        data: [{ ...azureConfiguration, id: 'extstorage_last' }],
        first_id: 'extstorage_last',
        last_id: 'extstorage_last',
        has_more: false,
      }),
    );
  const client = new OpenAI({ baseURL, apiKey: 'test-project-key', adminAPIKey: 'test-admin-key', fetch });
  const ids: string[] = [];
  for await (const item of client.admin.organization.externalStorage.list({
    project_id: 'proj_test',
    order: 'desc',
    limit: 1,
  })) {
    ids.push(item.id);
  }
  expect(ids).toEqual(['extstorage_first', 'extstorage_last']);
  expect(fetch).toHaveBeenCalledTimes(2);
  for (let index = 0; index < 2; index += 1) {
    const request = capturedRequest(fetch, index);
    expect(request.headers.get('authorization')).toBe('Bearer test-admin-key');
    expect(request.method).toBe('GET');
    expect(Object.fromEntries(new URL(request.url).searchParams)).toEqual({
      project_id: 'proj_test',
      order: 'desc',
      limit: '1',
      ...(index === 1 ? { after: 'extstorage_first' } : {}),
    });
  }
});

test('storage requests do not fall back to a project API key', async () => {
  vi.stubEnv('OPENAI_ADMIN_KEY', '');
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = new OpenAI({ baseURL, apiKey: 'test-project-key', adminAPIKey: null, fetch });
  await expect(client.admin.organization.externalStorage.retrieve('extstorage_test')).rejects.toThrow(
    /Could not resolve authentication method/u,
  );
  expect(fetch).not.toHaveBeenCalled();
});
