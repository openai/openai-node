import { vi } from 'vitest';

import OpenAI from 'openai';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name Responses WebSocket function api keys', ({ Responses }) => {
  test('rejects an unresolved function api key instead of opening an unauthenticated socket', () => {
    const apiKey = vi.fn(async () => 'sk-refreshed');
    const client = new OpenAI({ apiKey });

    expect(() => new Responses(client)).toThrow(/resolved string apiKey/);
    expect(apiKey).not.toHaveBeenCalled();
  });

  test('accepts a function api key after it has been resolved', async () => {
    const apiKey = vi.fn(async () => 'sk-refreshed');
    const client = new OpenAI({ apiKey });
    expect(await client._callApiKey()).toBe(true);

    expect(() => new Responses(client)).not.toThrow();
    expect(apiKey).toHaveBeenCalledTimes(1);
  });
});
