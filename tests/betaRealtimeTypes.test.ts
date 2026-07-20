import OpenAI from 'openai/index';
import { expectType } from './utils/typing';

describe('beta realtime types', () => {
  test('response usage includes cached token details', () => {
    const inputTokenDetails: OpenAI.Beta.Realtime.RealtimeResponseUsage.InputTokenDetails = {
      audio_tokens: 1,
      cached_tokens: 2,
      cached_tokens_details: {
        audio_tokens: 3,
        text_tokens: 4,
      },
      text_tokens: 5,
    };

    expectType<number | undefined>(inputTokenDetails.cached_tokens_details?.audio_tokens);
    expectType<number | undefined>(inputTokenDetails.cached_tokens_details?.text_tokens);
    expect(inputTokenDetails.cached_tokens_details?.text_tokens).toBe(4);
  });
});
