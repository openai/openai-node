import { vi } from 'vitest';

import OpenAI from 'openai';
import { OpenAIError } from 'openai/error';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name Responses WebSocket function api keys', ({ Responses }) => {
  test('rejects instead of opening an unauthenticated socket', () => {
    const apiKey = vi.fn(async () => 'sk-refreshed');
    const client = new OpenAI({ apiKey });

    expect(() => new Responses(client)).toThrow(
      new OpenAIError(
        'Cannot instantiate ResponsesWS with a function-based apiKey. Use a client with a resolved string apiKey instead.',
      ),
    );
    expect(apiKey).not.toHaveBeenCalled();
  });
});
