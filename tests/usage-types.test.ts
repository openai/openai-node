import OpenAI from 'openai';
import { expectType } from './utils/typing';

describe('usage types', () => {
  test('prompt token details include modality token counts', () => {
    const usage = {} as OpenAI.CompletionUsage;
    const details = usage.prompt_tokens_details;

    if (details) {
      expectType<number | undefined>(details.audio_tokens);
      expectType<number | undefined>(details.cached_tokens);
      expectType<number | undefined>(details.image_tokens);
      expectType<number | undefined>(details.text_tokens);
    }
  });
});
