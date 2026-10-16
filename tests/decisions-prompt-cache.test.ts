import OpenAI from 'openai';
import { expect, test } from 'vitest';
import type { DecisionCreateParams } from 'openai/resources/decisions';

for (const mode of ['explicit', 'implicit', 'nulls', 'omitted'] as const) {
  test(`Decisions caching request: ${mode}`, async () => {
    const breakpoint = mode === 'nulls' ? null : { mode: 'explicit' as const };
    const body: DecisionCreateParams = {
      model: 'synthetic-model',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'synthetic',
              ...(mode === 'omitted' ? {} : { prompt_cache_breakpoint: breakpoint }),
            },
            {
              type: 'input_image',
              image_url: 'https://example.test/image.png',
              ...(mode === 'omitted' ? {} : { prompt_cache_breakpoint: breakpoint }),
            },
          ],
        },
      ],
      questions: [{ instructions: 'Synthetic question', type: 'predicate' }],
      ...(mode === 'omitted'
        ? {}
        : {
            prompt_cache_key: mode === 'nulls' ? null : 'synthetic-key',
            prompt_cache_options: mode === 'nulls' ? null : { mode, ttl: '30m' },
          }),
    };
    let requests = 0;
    const client = new OpenAI({
      apiKey: 'fake-test-key',
      baseURL: 'https://example.test',
      maxRetries: 0,
      fetch: async (url, init) => {
        requests += 1;
        expect(String(url)).toBe('https://example.test/decisions');
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual(body);
        return Response.json({ id: 'decision_synthetic', answers: [], model: 'synthetic-model', usage: {} });
      },
    });
    await client.decisions.create(body);
    expect(requests).toBe(1);
  });
}
