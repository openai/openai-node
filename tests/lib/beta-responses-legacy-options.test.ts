import OpenAI from 'openai';
import { vi } from 'vitest';

function createClient() {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ id: 'resp_test', object: 'response', output: [], data: [], has_more: false }),
  );
  return { client: new OpenAI({ apiKey: 'synthetic', fetch }), fetch };
}

test.each([undefined, 'synthetic=v1', null])(
  'preserves beta headers and explicit override %s',
  async (beta) => {
    const { client, fetch } = createClient();
    const options: OpenAI.RequestOptions = {
      maxRetries: 0,
      headers: { 'OpenAI-Beta': beta, 'OpenAI-Project': 'proj_synthetic' },
    };
    await client.beta.responses.retrieve('resp_test', { betas: ['responses_multi_agent=v1'] }, options);
    await client.beta.responses.inputItems.list(
      'resp_test',
      { betas: ['responses_multi_agent=v1'], limit: 0 },
      options,
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [input, init] of fetch.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get('openai-beta')).toBe(beta === undefined ? 'responses_multi_agent=v1' : beta);
      expect(headers.get('openai-project')).toBe('proj_synthetic');
      expect(new URL(String(input)).searchParams.get('betas')).toBeNull();
    }
    expect(new URL(String(fetch.mock.calls[1]?.[0])).searchParams.get('limit')).toBe('0');
  },
);
