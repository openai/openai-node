import { vi } from 'vitest';
import OpenAI from 'openai';
import { ContentFilterFinishReasonError, LengthFinishReasonError } from 'openai/error';
import type { Fetch } from 'openai/internal/builtin-types';
import type { RunnableToolFunction } from 'openai/lib/RunnableFunction';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionFunctionTool,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';

type UnfinishedReason = 'length' | 'content_filter';
type TurnShape = 'tool call' | 'content';
interface Turn {
  shape: TurnShape;
  finishReason: ChatCompletion.Choice['finish_reason'];
}

const unfinishedErrors = {
  length: LengthFinishReasonError,
  content_filter: ContentFilterFinishReasonError,
} as const;

const truncatedArguments = '{"city":"Par';
const messages: ChatCompletionMessageParam[] = [{ role: 'user', content: 'Look up Paris' }];
const lookupDefinition = {
  name: 'lookup',
  description: 'Looks up a city',
  parameters: { type: 'object', properties: { city: { type: 'string' } } },
};
const lookupTool: ChatCompletionFunctionTool = { type: 'function', function: lookupDefinition };

function runnableLookup(lookup: (args: string) => string): RunnableToolFunction<string> {
  return { type: 'function', function: { ...lookupDefinition, function: lookup } };
}

function completionTurn({ shape, finishReason }: Turn): ChatCompletion {
  return {
    id: 'chatcmpl-truncated',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-test',
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        logprobs: null,
        message:
          shape === 'tool call'
            ? {
                role: 'assistant',
                content: null,
                refusal: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'lookup', arguments: truncatedArguments },
                  },
                ],
              }
            : { role: 'assistant', content: 'Paris is', refusal: null },
      },
    ],
  };
}

function chunk(
  delta: ChatCompletionChunk.Choice.Delta,
  finish: ChatCompletionChunk.Choice['finish_reason'],
): ChatCompletionChunk {
  return {
    id: 'chatcmpl-truncated',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-test',
    choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }],
  };
}

function streamedTurn({ shape, finishReason }: Turn): ChatCompletionChunk[] {
  if (shape === 'tool call') {
    return [
      chunk(
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { index: 0, id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '' } },
          ],
        },
        null,
      ),
      chunk({ tool_calls: [{ index: 0, function: { arguments: truncatedArguments } }] }, finishReason),
    ];
  }

  return [chunk({ role: 'assistant', content: 'Paris is' }, finishReason)];
}

function mockClient(firstTurn: Turn) {
  const requests: { stream?: boolean }[] = [];
  const fetch = vi.fn<Fetch>(async (_url, init) => {
    if (typeof init?.body !== 'string') {
      throw new TypeError('Expected a serialized chat completion request');
    }
    const body = JSON.parse(init.body);
    requests.push(body);
    // Only the first turn is unfinished, so a runner that accepts it still terminates.
    const turn: Turn = requests.length === 1 ? firstTurn : { shape: 'content', finishReason: 'stop' };
    if (body.stream === true) {
      const events = streamedTurn(turn).map((event) => `data: ${JSON.stringify(event)}\n\n`);
      return new Response(`${events.join('')}data: [DONE]\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    return Response.json(completionTurn(turn));
  });

  return { client: new OpenAI({ apiKey: 'synthetic-key', fetch, maxRetries: 0 }), requests };
}

describe.each(['length', 'content_filter'] as const)(
  'runTools on a %s turn',
  (finishReason: UnfinishedReason) => {
    describe.each(['tool call', 'content'] as const)('that stops mid %s', (shape) => {
      it.each([false, true])('rejects the turn instead of continuing (stream: %s)', async (stream) => {
        const lookup = vi.fn((args: string) => `Found ${args}`);
        const { client, requests } = mockClient({ shape, finishReason });
        const params = { model: 'gpt-test', messages, tools: [runnableLookup(lookup)] };
        const runner = stream
          ? client.chat.completions.runTools({ ...params, stream: true })
          : client.chat.completions.runTools(params);

        await expect(runner.done()).rejects.toThrow(unfinishedErrors[finishReason]);

        expect(lookup).not.toHaveBeenCalled();
        expect(requests).toHaveLength(1);
        expect(runner.messages).toEqual(messages);
      });
    });

    it('leaves chat.completions.stream() reporting the finish reason', async () => {
      const { client, requests } = mockClient({ shape: 'tool call', finishReason });

      const completion = await client.chat.completions
        .stream({ model: 'gpt-test', messages, tools: [lookupTool] })
        .finalChatCompletion();

      expect(completion.choices[0]?.finish_reason).toBe(finishReason);
      expect(completion.choices[0]?.message.tool_calls?.[0]).toMatchObject({
        type: 'function',
        function: { name: 'lookup', arguments: truncatedArguments },
      });
      expect(requests).toHaveLength(1);
    });
  },
);
