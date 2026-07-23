import OpenAI, { type RunnerOptions } from 'openai';
import type { RunnerOptions as ResourceRunnerOptions } from 'openai/resources/chat/completions';
import { compareType, expectType } from './utils/typing';

describe('RunnerOptions exports', () => {
  test('exports runTools options from public package surfaces', () => {
    const options: RunnerOptions = { maxChatCompletions: 1 };

    expectType<OpenAI.RunnerOptions>(options);
    compareType<RunnerOptions, ResourceRunnerOptions>(true);

    expect(true).toBe(true);
  });
});
