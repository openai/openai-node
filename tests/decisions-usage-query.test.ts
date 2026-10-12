import OpenAI from '../src/index';

const capture = () => {
  const requests: { url: URL; body: unknown }[] = [];
  const client = new OpenAI({
    apiKey: 'fake-project-key',
    adminAPIKey: 'fake-admin-key',
    baseURL: 'https://example.test',
    maxRetries: 0,
    fetch: async (input, init) => {
      requests.push({ url: new URL(String(input)), body: init?.body });
      return Response.json({ object: 'page', data: [], has_more: false, next_page: null });
    },
  });
  return { client, requests };
};

describe('Decisions usage query values', () => {
  test('omits explicit null filters as it omits absent filters', async () => {
    const { client, requests } = capture();
    await client.admin.organization.usage.decisions({ start_time: 100 });
    await client.admin.organization.usage.decisions({
      start_time: 100,
      api_key_ids: null,
      batch: null,
      bucket_width: null,
      end_time: null,
      group_by: null,
      limit: null,
      models: null,
      page: null,
      project_ids: null,
      user_ids: null,
    });
    expect(requests.map(({ url }) => url.search)).toEqual(['?start_time=100', '?start_time=100']);
  });

  test('preserves false, zero, strings, lists and the caller object', async () => {
    const { client, requests } = capture();
    const params = Object.freeze({
      start_time: 0,
      batch: false,
      end_time: 0,
      limit: 0,
      page: 'cursor',
      project_ids: ['a', 'b'],
      models: [''],
      user_ids: null,
    });
    await client.admin.organization.usage.decisions(params);
    const query = requests[0]?.url.searchParams;
    expect(query?.get('batch')).toBe('false');
    for (const key of ['start_time', 'end_time', 'limit']) {
      expect(query?.get(key)).toBe('0');
    }
    expect(query?.get('page')).toBe('cursor');
    expect(query?.getAll('project_ids[]')).toEqual(['a', 'b']);
    expect(query?.getAll('models[]')).toEqual(['']);
    expect(params.user_ids).toBeNull();
    expect(query?.has('user_ids')).toBe(false);
  });

  test('preserves other query serialization and JSON body nulls', async () => {
    const { client, requests } = capture();
    await client.get('/other', { query: { value: null } });
    await client.post('/other', { body: { value: null } });
    expect(requests[0]?.url.search).toBe('?value=');
    expect(JSON.parse(String(requests[1]?.body))).toEqual({ value: null });
  });
});
