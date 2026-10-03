import { vi } from 'vitest';
import OpenAI from 'openai';
import type { ChatCompletionToolRunnerParams } from 'openai/resources/chat/completions';

const usage: OpenAI.CompletionUsage = {
  prompt_tokens: 100,
  completion_tokens: 20,
  total_tokens: 120,
  prompt_tokens_details: {
    audio_tokens: 2,
    cache_write_tokens: 3,
    cached_tokens: 80,
    image_tokens: 5,
    text_tokens: 93,
  },
  completion_tokens_details: {
    accepted_prediction_tokens: 4,
    audio_tokens: 0,
    reasoning_tokens: 5,
    rejected_prediction_tokens: 1,
    text_tokens: 15,
  },
};

const plainUsage: OpenAI.CompletionUsage = {
  prompt_tokens: 10,
  completion_tokens: 2,
  total_tokens: 12,
};

const cases: {
  name: string;
  usages: (OpenAI.CompletionUsage | undefined)[];
  expected: OpenAI.CompletionUsage;
}[] = [
  { name: 'single completion', usages: [usage], expected: usage },
  {
    name: 'multiple completions',
    usages: [usage, usage],
    expected: {
      prompt_tokens: 200,
      completion_tokens: 40,
      total_tokens: 240,
      prompt_tokens_details: {
        audio_tokens: 4,
        cache_write_tokens: 6,
        cached_tokens: 160,
        image_tokens: 10,
        text_tokens: 186,
      },
      completion_tokens_details: {
        accepted_prediction_tokens: 8,
        audio_tokens: 0,
        reasoning_tokens: 10,
        rejected_prediction_tokens: 2,
        text_tokens: 30,
      },
    },
  },
  {
    name: 'missing usage and details between completions',
    usages: [plainUsage, usage, undefined, plainUsage],
    expected: { ...usage, prompt_tokens: 120, completion_tokens: 24, total_tokens: 144 },
  },
  {
    name: 'partial details and explicit zeros',
    usages: [
      { ...plainUsage, prompt_tokens_details: { cached_tokens: 0 } },
      { ...plainUsage, completion_tokens_details: { reasoning_tokens: 0 } },
      { ...plainUsage, prompt_tokens_details: { audio_tokens: 2 } },
    ],
    expected: {
      prompt_tokens: 30,
      completion_tokens: 6,
      total_tokens: 36,
      prompt_tokens_details: { cached_tokens: 0, audio_tokens: 2 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  },
  { name: 'omitted details', usages: [plainUsage], expected: plainUsage },
  {
    name: 'empty details',
    usages: [{ ...plainUsage, prompt_tokens_details: {}, completion_tokens_details: {} }],
    expected: { ...plainUsage, prompt_tokens_details: {}, completion_tokens_details: {} },
  },
  {
    name: 'omitted usage',
    usages: [undefined],
    expected: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  },
];

describe.each([false, true])('runner totalUsage with stream: %s', (stream) => {
  test.each(cases)('$name', async ({ usages, expected }) => {
    let requestIndex = 0;
    const fetch = vi.fn(async () => {
      const index = requestIndex;
      requestIndex += 1;
      const last = index === usages.length - 1;
      const completionUsage = usages[index];
      const message: OpenAI.ChatCompletionMessage = {
        role: 'assistant',
        content: last ? 'Done' : null,
        refusal: null,
        ...(last
          ? {}
          : {
              tool_calls: [
                {
                  id: `call_${index}`,
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{}' },
                },
              ],
            }),
      };
      const completion: OpenAI.ChatCompletion = {
        id: `chatcmpl_${index}`,
        object: 'chat.completion',
        created: 0,
        model: 'gpt-4o-mini',
        choices: [{ index: 0, message, finish_reason: last ? 'stop' : 'tool_calls', logprobs: null }],
        ...(completionUsage ? { usage: completionUsage } : {}),
      };
      if (!stream) {
        return Response.json(completion);
      }
      const chunks: OpenAI.ChatCompletionChunk[] = [
        {
          ...completion,
          object: 'chat.completion.chunk',
          usage: null,
          choices: [
            {
              index: 0,
              delta: {
                role: message.role,
                content: message.content,
                ...(message.tool_calls
                  ? {
                      tool_calls: message.tool_calls.map((tool, toolIndex) => ({
                        ...tool,
                        index: toolIndex,
                      })),
                    }
                  : {}),
              },
              finish_reason: last ? 'stop' : 'tool_calls',
              logprobs: null,
            },
          ],
        },
        { ...completion, object: 'chat.completion.chunk', choices: [] },
      ];
      return new Response(
        `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
        {
          headers: { 'Content-Type': 'text/event-stream' },
        },
      );
    });
    const client = new OpenAI({ apiKey: 'test-key', fetch });
    const params: ChatCompletionToolRunnerParams<[string]> = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'What is the weather?' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the weather',
            parameters: {},
            function: () => 'Sunny',
          },
        },
      ],
    };
    const totalUsage = vi.fn();
    const originalUsages: (OpenAI.CompletionUsage | undefined)[] = [];
    const recordUsage = (completion: OpenAI.ChatCompletion) =>
      originalUsages.push(structuredClone(completion.usage));
    const runner = stream
      ? client.chat.completions
          .runTools({ ...params, stream: true, stream_options: { include_usage: true } })
          .on('totalUsage', totalUsage)
          .on('chatCompletion', recordUsage)
      : client.chat.completions
          .runTools({ ...params, stream: false })
          .on('totalUsage', totalUsage)
          .on('chatCompletion', recordUsage);

    expect(await runner.totalUsage()).toStrictEqual(expected);
    if (usages.some((item) => item !== undefined)) {
      expect(totalUsage).toHaveBeenCalledTimes(1);
      expect(totalUsage).toHaveBeenCalledWith(expected);
    } else {
      expect(totalUsage).not.toHaveBeenCalled();
    }
    expect(await runner.totalUsage()).toStrictEqual(expected);
    expect(fetch).toHaveBeenCalledTimes(usages.length);
    expect(originalUsages.map((item) => item ?? undefined)).toStrictEqual(usages);
    expect(runner.allChatCompletions().map((completion) => completion.usage)).toStrictEqual(originalUsages);
  });
});
