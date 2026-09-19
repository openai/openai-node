import OpenAI from 'openai';
import { buildHeaders } from 'openai/internal/headers';
import type { HeadersLike } from 'openai/internal/headers';
import { vi } from 'vitest';

function createClient() {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ id: 'resp_synthetic', object: 'list', data: [], has_more: false, output: [] }),
  );
  const client = new OpenAI({
    apiKey: 'synthetic-key',
    adminAPIKey: 'synthetic-admin-key',
    project: 'proj_synthetic',
    organization: 'org_synthetic',
    defaultHeaders: { 'x-remove': 'default' },
    fetch,
  });
  return { client, fetch };
}

const restrictedHeaders: { name: string; headers: HeadersLike }[] = [
  { name: 'project record', headers: { 'OpenAI-Project': 'proj_other' } },
  { name: 'underscored project record', headers: { oPeNaI_pRoJeCt: 'proj_other' } },
  { name: 'organization record with mixed casing', headers: { 'oPeNaI-OrGaNiZaTiOn': 'org_other' } },
  { name: 'underscored organization Headers', headers: new Headers({ OpenAI_Organization: 'org_other' }) },
  { name: 'authorization Headers', headers: new Headers({ Authorization: 'Bearer synthetic-other' }) },
  { name: 'API key tuples', headers: [['api-key', 'synthetic-other']] },
  { name: 'authorization removal', headers: { Authorization: null } },
  { name: 'underscored project tuple removal', headers: [['OpenAI_Project', null]] },
  {
    name: 'own iterable protocol',
    headers: Object.defineProperty(new Headers(), Symbol.iterator, {
      value: () => [['OpenAI-Project', 'proj_other']][Symbol.iterator](),
    }),
  },
  { name: 'project removal in normalized headers', headers: buildHeaders([{ 'OpenAI-Project': null }]) },
  {
    name: 'underscored organization removal in normalized headers',
    headers: buildHeaders([{ OpenAI_Organization: null }]),
  },
  {
    name: 'duplicate project values',
    headers: [
      ['openai-project', 'one'],
      ['OpenAI-Project', 'two'],
    ],
  },
  { name: 'cookie', headers: { Cookie: 'synthetic=other' } },
  { name: 'host', headers: { Host: 'other.example' } },
];

test.each(restrictedHeaders)('retains explicit request options for $name', async ({ headers }) => {
  const { client, fetch } = createClient();

  await client.files.list({}, { headers });

  expect(fetch).toHaveBeenCalledTimes(1);
  const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
  const expected = buildHeaders([headers]);
  for (const [name, value] of expected.values) {
    expect(sent.get(name)).toBe(value);
  }
  for (const name of expected.nulls) {
    expect(sent.has(name)).toBe(false);
  }
});

test('preserves ordinary header values and removals in legacy options', async () => {
  const { client, fetch } = createClient();

  await client.files.list({ headers: { 'x-custom': ['one', 'two'], 'x-remove': null } });

  const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
  expect(sent.get('x-custom')).toBe('one, two');
  expect(sent.has('x-remove')).toBe(false);
  expect(sent.get('authorization')).toBe('Bearer synthetic-key');
  expect(sent.get('openai-project')).toBe('proj_synthetic');
  expect(new URL(String(fetch.mock.calls[0]?.[0])).search).toBe('');
});

test('reads an own iterable protocol once and dispatches its validated entries', async () => {
  const { client, fetch } = createClient();
  let reads = 0;
  const headers = new Headers();
  Object.defineProperty(headers, Symbol.iterator, {
    get() {
      reads += 1;
      return () =>
        (reads === 1 ? [['x-custom', 'original']] : [['OpenAI-Project', 'proj_other']])[Symbol.iterator]();
    },
  });

  await client.files.list({ headers });

  expect(reads).toBe(1);
  const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
  expect(sent.get('x-custom')).toBe('original');
  expect(sent.get('openai-project')).toBe('proj_synthetic');
});
