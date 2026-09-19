import OpenAI from 'openai';
import type { PagePromise } from 'openai/core/pagination';
import type { EnvironmentFile, EnvironmentFilesPage } from 'openai/resources/beta/agents/environments/files';
import { vi } from 'vitest';
import { compareType } from '../utils/typing';

function createClient() {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ object: 'page', data: [], next: null, has_more: false }),
  );
  const client = new OpenAI({ apiKey: 'synthetic', maxRetries: 0, fetch });
  return { client, fetch };
}

test('environment files accept literal and reusable legacy request options without serializing them', async () => {
  const { client, fetch } = createClient();
  const options: OpenAI.RequestOptions = { headers: { 'x-legacy-test': 'preserved' } };
  const page = client.beta.agents.environments.files.list('env_test', options);
  compareType<typeof page, PagePromise<EnvironmentFilesPage, EnvironmentFile>>(true);

  await page;
  await client.beta.agents.environments.files.list('env_test', {
    headers: { 'x-legacy-test': 'preserved' },
  });

  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [input, init] of fetch.mock.calls) {
    const url = new URL(String(input));
    expect(url.pathname).toBe('/v1/agents/environments/env_test/files');
    expect(url.search).toBe('');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-legacy-test')).toBe('preserved');
    expect(headers.get('openai-beta')).toBe('agents=v1');
  }
});

test('environment files preserve path and pagination queries through utility-type wrappers', async () => {
  const { client, fetch } = createClient();
  const parameters: Parameters<typeof client.beta.agents.environments.files.list> = [
    'env_test',
    { path: '/workspace/test', page: 'synthetic:token/+=', order: 'asc', limit: 1 },
    { headers: { 'x-explicit-test': 'preserved' } },
  ];
  const list = (...args: Parameters<typeof client.beta.agents.environments.files.list>) =>
    client.beta.agents.environments.files.list(...args);

  await list(...parameters);

  const url = new URL(String(fetch.mock.calls[0]?.[0]));
  expect(url.pathname).toBe('/v1/agents/environments/env_test/files');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    path: '/workspace/test',
    page: 'synthetic:token/+=',
    order: 'asc',
    limit: '1',
  });
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('x-explicit-test')).toBe('preserved');
});

test.each([null, undefined])('environment files retain explicit options with a %s query', async (query) => {
  const { client, fetch } = createClient();

  await client.beta.agents.environments.files.list('env_test', query, {
    headers: { 'OpenAI-Project': 'proj_synthetic', 'OpenAI-Beta': 'agents=v1,synthetic=v1' },
  });

  expect(new URL(String(fetch.mock.calls[0]?.[0])).search).toBe('');
  const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
  expect(headers.get('openai-project')).toBe('proj_synthetic');
  expect(headers.get('openai-beta')).toBe('agents=v1,synthetic=v1');
});

test('environment files reject mixed path queries and legacy request options before dispatch', () => {
  const { client, fetch } = createClient();

  expect(() =>
    // @ts-expect-error Query and request options must be separate arguments.
    client.beta.agents.environments.files.list('env_test', { path: '/workspace', headers: {} }),
  ).toThrow(/separate arguments/u);
  expect(fetch).not.toHaveBeenCalled();
});

test('environment files reject sensitive headers in legacy options before dispatch', () => {
  const { client, fetch } = createClient();

  expect(() =>
    client.beta.agents.environments.files.list('env_test', {
      headers: { 'OpenAI-Project': 'proj_synthetic' },
    }),
  ).toThrow(/explicit request options argument/u);
  expect(fetch).not.toHaveBeenCalled();
});
