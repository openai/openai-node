import OpenAI from '../src/index';
import { describe, expect, test, vi } from 'vitest';

describe.each(['completions', 'decisions'] as const)('%s cache-write usage', (endpoint) => {
  test.each([73, 0, null, undefined])('decodes %s without changing existing counters', async (value) => {
    const result = {
      object: `organization.usage.${endpoint}.result`,
      input_tokens: 200,
      output_tokens: 20,
      num_model_requests: 1,
      input_cache_write_tokens: 17,
      input_cache_write_12h_tokens: 19,
      ...(value === undefined ? {} : { input_cache_write_30m_tokens: value }),
    };
    const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe(`/organization/usage/${endpoint}`);
      expect(url.searchParams.get('start_time')).toBe('0');
      return Response.json({
        object: 'page',
        data: [{ object: 'bucket', start_time: 0, end_time: 60, results: [result] }],
        has_more: false,
        next_page: null,
      });
    });
    const client = new OpenAI({
      apiKey: 'fake-project-key',
      adminAPIKey: 'fake-admin-key',
      baseURL: 'https://example.test',
      maxRetries: 0,
      fetch,
    });
    const response =
      endpoint === 'completions'
        ? await client.admin.organization.usage.completions({ start_time: 0 })
        : await client.admin.organization.usage.decisions({ start_time: 0 });
    const row = response.data[0]?.results[0];
    if (!row) {
      throw new Error('Missing usage result');
    }
    if (
      row.object !== 'organization.usage.completions.result' &&
      row.object !== 'organization.usage.decisions.result'
    ) {
      throw new Error('Unexpected usage result variant');
    }
    const actual: number | null | undefined = row.input_cache_write_30m_tokens;
    expect(actual).toBe(value);
    expect(row.input_cache_write_tokens).toBe(17);
    expect(row.input_cache_write_12h_tokens).toBe(19);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
