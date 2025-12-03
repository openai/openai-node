import OpenAI from 'openai';
import { mockFetch } from '../../utils/mock-fetch';
import type { BetaRunnableTool } from 'openai/lib/beta/BetaRunnableTool';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionMessage,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
} from 'openai/resources';
import type { Fetch } from 'openai/internal/builtin-types';
import type { BetaToolRunnerParams } from 'openai/lib/beta/BetaToolRunner';

const weatherTool: BetaRunnableTool<{ location: string }> = {
  type: 'function',
  function: {
    name: 'getWeather',
    description: 'Get weather',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string' },
      },
    },
  },
  run: async ({ location }) => `Sunny in ${location}`,
  parse: (input: unknown) => input as { location: string },
};

const calculatorTool: BetaRunnableTool<{ a: number; b: number; operation: string }> = {
  type: 'function',
  function: {
    name: 'calculate',
    description: 'Perform calculations',
    parameters: {
      type: 'object',
      properties: {
        a: { type: 'number' },
        b: { type: 'number' },
        operation: { type: 'string', enum: ['add', 'multiply'] },
      },
    },
  },
  run: async ({ a, b, operation }) => {
    if (operation === 'add') return String(a + b);
    if (operation === 'multiply') return String(a * b);
    throw new Error(`Unknown operation: ${operation}`);
  },
  parse: (input: unknown) => input as { a: number; b: number; operation: string },
};

// Helper functions to create content blocks
function getWeatherToolUse(location: string, id: string = 'tool_1'): ChatCompletionMessageToolCall {
  return {
    id: id,
    type: 'function',
    function: {
      name: 'getWeather',
      arguments: JSON.stringify({ location }),
    },
  };
}

function getWeatherToolResult(location: string, id: string = 'tool_1'): ChatCompletionToolMessageParam {
  return { role: 'tool', tool_call_id: id, content: `Sunny in ${location}` };
}

function getCalculatorToolUse(
  a: number,
  b: number,
  operation: string,
  id: string = 'tool_2',
): ChatCompletionMessageToolCall {
  return {
    id: id,
    type: 'function',
    function: {
      name: 'calculate',
      arguments: JSON.stringify({ a, b, operation }),
    },
  };
}

function getCalculatorToolResult(
  a: number,
  b: number,
  operation: string,
  id: string = 'tool_2',
): ChatCompletionToolMessageParam {
  let result: string;
  if (operation === 'add') {
    result = String(a + b);
  } else if (operation === 'multiply') {
    result = String(a * b);
  } else {
    result = `Error: Unknown operation: ${operation}`;
  }
  return {
    role: 'tool',
    tool_call_id: id,
    content: result,
  };
}

function getTextContent(text?: string): ChatCompletionMessage {
  return {
    role: 'assistant',
    content: text || 'Some text content',
    refusal: null,
  };
}

function betaMessageToStreamEvents(message: ChatCompletion): ChatCompletionChunk[] {
  const events: ChatCompletionChunk[] = [];

  const messageContent = message.choices[0]!.message;

  // Check if it's a text message
  if (messageContent.content) {
    // Initial chunk with role only (no content in first chunk for text messages)
    events.push({
      choices: message.choices.map(
        (choice): ChatCompletionChunk.Choice => ({
          delta: {
            content: null,
            refusal: null,
            role: choice.message.role,
          },
          finish_reason: null,
          index: choice.index,
        }),
      ),
      id: message.id,
      created: message.created,
      model: message.model,
      object: 'chat.completion.chunk',
    });

    // Text deltas - always chunked
    // Simulate chunked streaming by splitting text
    const words = messageContent.content.split(' ');
    const chunks = [];
    for (let i = 0; i < words.length; i += 2) {
      chunks.push(words.slice(i, i + 2).join(' ') + (i + 2 < words.length ? ' ' : ''));
    }

    // Create a chunk for each piece of text
    chunks.forEach((chunk) => {
      if (chunk) {
        events.push({
          choices: [
            {
              delta: {
                content: chunk,
                refusal: null,
              },
              index: 0,
              finish_reason: null,
            },
          ],
          id: message.id,
          created: message.created,
          model: message.model,
          object: 'chat.completion.chunk',
        });
      }
    });
  } else if (messageContent.tool_calls && messageContent.tool_calls.length > 0) {
    // Initial chunk with role only for tool calls
    events.push({
      choices: message.choices.map(
        (choice): ChatCompletionChunk.Choice => ({
          delta: {
            content: null,
            refusal: null,
            role: choice.message.role,
          },
          finish_reason: null,
          index: choice.index,
        }),
      ),
      id: message.id,
      created: message.created,
      model: message.model,
      object: 'chat.completion.chunk',
    });

    // Handle tool calls
    messageContent.tool_calls.forEach((toolCall, toolIndex) => {
      // Initial tool call chunk
      if (toolCall.type === 'function') {
        const functionToolCall = toolCall as ChatCompletionMessageFunctionToolCall;

        // Create a chunk for the function name
        events.push({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: toolIndex,
                    id: toolCall.id,
                    type: 'function',
                    function: {
                      name: functionToolCall.function.name,
                    },
                  },
                ],
                content: null,
                refusal: null,
              },
              index: 0,
              finish_reason: null,
            },
          ],
          id: message.id,
          created: message.created,
          model: message.model,
          object: 'chat.completion.chunk',
        });

        // Input JSON deltas - always chunked for arguments
        const jsonStr = functionToolCall.function.arguments;
        // Simulate chunked JSON streaming
        const chunkSize = Math.ceil(jsonStr.length / 3);
        for (let i = 0; i < jsonStr.length; i += chunkSize) {
          const argChunk = jsonStr.slice(i, i + chunkSize);
          events.push({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: toolIndex,
                      function: {
                        arguments: argChunk,
                      },
                    },
                  ],
                  content: null,
                  refusal: null,
                },
                index: 0,
                finish_reason: null,
              },
            ],
            id: message.id,
            created: message.created,
            model: message.model,
            object: 'chat.completion.chunk',
          });
        }
      }
    });
  }

  // Final chunk with finish reason
  events.push({
    choices: [
      {
        delta: {
          content: null,
          role: 'assistant',
          refusal: null,
        },
        index: 0,
        finish_reason: message.choices[0]!.finish_reason,
      },
    ],
    id: message.id,
    created: message.created,
    model: message.model,
    object: 'chat.completion.chunk',
    usage: message.usage ?? null,
  });

  return events;
}

// Overloaded setupTest function for both streaming and non-streaming
interface SetupTestResult<Stream extends boolean> {
  runner: OpenAI.Beta.Chat.Completions.BetaToolRunner<Stream>;
  fetch: ReturnType<typeof mockFetch>['fetch'];
  handleRequest: (fetch: Fetch) => void;
  handleAssistantMessage: (messageContentOrToolCalls: ToolCallsOrMessage) => ChatCompletion;
  handleAssistantMessageStream: (messageContentOrToolCalls?: ToolCallsOrMessage) => ChatCompletion;
}

type ToolCallsOrMessage = ChatCompletionMessageToolCall[] | ChatCompletionMessage;

function setupTest(params?: Partial<BetaToolRunnerParams> & { stream?: false }): SetupTestResult<false>;
function setupTest(params: Partial<BetaToolRunnerParams> & { stream: true }): SetupTestResult<true>;
function setupTest(params: Partial<BetaToolRunnerParams> = {}): SetupTestResult<boolean> {
  const { handleRequest, handleStreamEvents, fetch } = mockFetch();
  let messageIdCounter = 0;
  const handleAssistantMessage: SetupTestResult<false>['handleAssistantMessage'] = (
    messageContentOrToolCalls,
  ) => {
    const isToolCalls = Array.isArray(messageContentOrToolCalls);

    const messageContent =
      isToolCalls ?
        {
          role: 'assistant' as const,
          tool_calls: messageContentOrToolCalls,
          refusal: null,
          content: null,
        }
      : (messageContentOrToolCalls as ChatCompletionMessage); // TODO: check that this is right

    const message: ChatCompletion = {
      id: `msg_${messageIdCounter++}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          message: messageContent,
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    };

    handleRequest(async () => {
      return new Response(JSON.stringify(message), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    return message;
  };

  const handleAssistantMessageStream: SetupTestResult<true>['handleAssistantMessageStream'] = (
    messageContentOrToolCalls,
  ) => {
    const isToolCalls = Array.isArray(messageContentOrToolCalls);

    const messageContent =
      isToolCalls ?
        {
          role: 'assistant' as const,
          tool_calls: messageContentOrToolCalls,
          refusal: null,
          content: null,
        }
      : (messageContentOrToolCalls as ChatCompletionMessage);

    const message: ChatCompletion = {
      id: `msg_${messageIdCounter++}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          message: messageContent,
          finish_reason: isToolCalls ? 'tool_calls' : 'stop',
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    };

    handleStreamEvents(betaMessageToStreamEvents(message));
    return message;
  };

  const client = new OpenAI({ apiKey: 'test-key', fetch: fetch, maxRetries: 0 });

  const runnerParams: BetaToolRunnerParams = {
    messages: params.messages || [{ role: 'user', content: 'What is the weather?' }],
    model: params.model || 'gpt-4o',
    max_tokens: params.max_tokens || 1000,
    tools: params.tools || [weatherTool],
    ...params,
  };

  const runner = client.beta.chat.completions.toolRunner(runnerParams);

  return {
    runner,
    fetch,
    handleRequest,
    handleAssistantMessage,
    handleAssistantMessageStream,
  };
}

async function expectEvent<T>(iterator: AsyncIterator<T>, assertions?: (event: T) => void | Promise<void>) {
  const result = await iterator.next();
  expect(result.done).toBe(false);
  if (!result.done) {
    await assertions?.(result.value);
  }
}

async function expectDone<T>(iterator: AsyncIterator<T>) {
  const result = await iterator.next();
  expect(result.done).toBe(true);
  expect(result.value).toBeUndefined();
}

describe('ToolRunner', () => {
  it('throws when consumed multiple times', async () => {
    const { runner, handleAssistantMessage } = setupTest();

    // First consumption - get the iterator explicitly
    handleAssistantMessage(getTextContent());
    await runner[Symbol.asyncIterator]().next();

    // Second attempt to get iterator should throw
    handleAssistantMessage(getTextContent());
    expect(async () => await runner[Symbol.asyncIterator]().next()).rejects.toThrow(
      'Cannot iterate over a consumed stream',
    );
  });

  it('throws when constructed with n>1', async () => {
    expect(() => {
      setupTest({ n: 999 });
    }).toThrow('BetaToolRunner does not support n > 1');

    expect(() => {
      setupTest({ n: null });
    }).not.toThrow();
  });

  describe('iterator.next()', () => {
    it('yields CompletionMessage', async () => {
      const { runner, handleAssistantMessage } = setupTest();

      const iterator = runner[Symbol.asyncIterator]();

      handleAssistantMessage([getWeatherToolUse('SF')]);

      await expectEvent(iterator, (message) => {
        expect(message?.choices[0]?.message.tool_calls).toMatchObject([getWeatherToolUse('SF')]);
      });

      handleAssistantMessage(getTextContent());

      await expectEvent(iterator, (message) => {
        expect(message?.choices[0]?.message).toMatchObject(getTextContent());
      });

      await expectDone(iterator);
    });

    it('yields BetaMessageStream when stream=true', async () => {
      const { runner, handleAssistantMessageStream } = setupTest({ stream: true });

      const iterator = runner[Symbol.asyncIterator]();

      // First iteration: assistant requests tool (using helper that generates proper stream events)
      handleAssistantMessageStream([getWeatherToolUse('SF')]);
      await expectEvent(iterator, async (stream) => {
        expect(stream.constructor.name).toBe('ChatCompletionStream');
        const events = [];
        for await (const event of stream) {
          events.push(event);
        }

        // 1. Initial chunk with role only (no content, no tool_calls)
        expect(events[0]).toMatchObject({
          choices: [
            {
              delta: {
                content: null,
                refusal: null,
                role: 'assistant',
              },
              finish_reason: null,
              index: 0,
            },
          ],
          object: 'chat.completion.chunk',
        });

        // 2. Tool call chunk with function name
        expect(events[1]).toMatchObject({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'tool_1',
                    type: 'function',
                    function: {
                      name: 'getWeather',
                    },
                  },
                ],
                content: null,
                refusal: null,
              },
              finish_reason: null,
            },
          ],
          object: 'chat.completion.chunk',
        });

        // 3-5. Argument chunks (3 chunks for the JSON string)
        expect(events[2]).toMatchObject({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: expect.any(String),
                    },
                  },
                ],
                content: null,
                refusal: null,
              },
              finish_reason: null,
            },
          ],
          object: 'chat.completion.chunk',
        });

        expect(events[3]).toMatchObject({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: expect.any(String),
                    },
                  },
                ],
                content: null,
                refusal: null,
              },
              finish_reason: null,
            },
          ],
          object: 'chat.completion.chunk',
        });

        expect(events[4]).toMatchObject({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: expect.any(String),
                    },
                  },
                ],
                content: null,
                refusal: null,
              },
              finish_reason: null,
            },
          ],
          object: 'chat.completion.chunk',
        });

        // 6. Final chunk with finish_reason
        expect(events[5]).toMatchObject({
          choices: [
            {
              delta: {
                content: null,
                role: 'assistant',
                refusal: null,
              },
              finish_reason: 'tool_calls',
            },
          ],
          object: 'chat.completion.chunk',
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        });

        expect(events.length).toBe(6);
      });

      // Second iteration: assistant provides final response
      handleAssistantMessageStream(getTextContent());
      const result2 = await iterator.next();
      expect(result2.done).toBe(false);

      const stream2 = result2.value;
      const events2: ChatCompletionChunk[] = [];
      for await (const event of stream2) {
        events2.push(event);
      }
      // Assert the expected structure of events2
      expect(events2).toHaveLength(4);

      // 1. Initial chunk with role only
      expect(events2[0]).toMatchObject({
        choices: [
          {
            delta: {
              content: null,
              refusal: null,
              role: 'assistant',
            },
            finish_reason: null,
            index: 0,
          },
        ],
        object: 'chat.completion.chunk',
      });

      // 2. First text content delta
      expect(events2[1]).toMatchObject({
        choices: [
          {
            delta: {
              content: 'Some text ',
              refusal: null,
            },
            index: 0,
            finish_reason: null,
          },
        ],
        object: 'chat.completion.chunk',
      });

      // 3. Second text content delta
      expect(events2[2]).toMatchObject({
        choices: [
          {
            delta: {
              content: 'content',
              refusal: null,
            },
            index: 0,
            finish_reason: null,
          },
        ],
        object: 'chat.completion.chunk',
      });

      // 4. Final chunk with finish_reason and usage
      expect(events2[3]).toMatchObject({
        choices: [
          {
            delta: {
              content: null,
              role: 'assistant',
              refusal: null,
            },
            index: 0,
            finish_reason: 'stop',
          },
        ],
        object: 'chat.completion.chunk',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });

      await expectDone(iterator);
    });

    it('handles multiple tools', async () => {
      const { runner, handleAssistantMessage } = setupTest({
        messages: [{ role: 'user', content: 'Get weather and calculate 2+3' }],
        tools: [weatherTool, calculatorTool],
      });

      const iterator = runner[Symbol.asyncIterator]();

      handleAssistantMessage([getWeatherToolUse('NYC'), getCalculatorToolUse(2, 3, 'add')]);
      await expectEvent(iterator, (message) => {
        expect(message?.choices).toHaveLength(1);
        expect(message?.choices[0]?.message.tool_calls).toHaveLength(2);
        expect(message?.choices[0]?.message.tool_calls).toMatchObject([
          getWeatherToolUse('NYC'),
          getCalculatorToolUse(2, 3, 'add'),
        ]);
      });

      // Assistant provides final response
      handleAssistantMessage(getTextContent());
      await expectEvent(iterator, (message) => {
        expect(message?.choices).toHaveLength(1);
        expect(message?.choices[0]?.message).toMatchObject(getTextContent());
      });

      // Check that we have both tool results in the messages
      // Second message should be assistant with tool uses
      // Third message should be user with both tool results
      const messages = runner.params.messages;
      expect(messages).toHaveLength(4); // user message, assistant with tools, tool result 1, tool result 2, assistant final
      expect(messages[1]).toMatchObject({
        role: 'assistant',
        tool_calls: [getWeatherToolUse('NYC'), getCalculatorToolUse(2, 3, 'add')],
      });
      expect(messages[2]).toMatchObject(getWeatherToolResult('NYC'));
      expect(messages[3]).toMatchObject(getCalculatorToolResult(2, 3, 'add', 'tool_2'));
      await expectDone(iterator);
    });

    it('handles missing tool', async () => {
      const { runner, handleAssistantMessage } = setupTest({
        messages: [{ role: 'user', content: 'Use a tool' }],
        tools: [weatherTool], // Only weather tool available
      });

      const iterator = runner[Symbol.asyncIterator]();

      // Assistant requests a tool that doesn't exist
      handleAssistantMessage([
        {
          type: 'function',
          id: 'tool',
          function: {
            name: 'unknownTool',
            arguments: JSON.stringify({ param: 'value' }),
          },
        },
      ]);

      await expectEvent(iterator, (message) => {
        expect(message?.choices?.[0]?.message.tool_calls).toMatchObject([
          {
            type: 'function',
            id: 'tool',
            function: {
              name: 'unknownTool',
              arguments: JSON.stringify({ param: 'value' }),
            },
          },
        ]);
      });

      // The tool response should contain an error
      handleAssistantMessage(getTextContent());
      await expectEvent(iterator, (message) => {
        // TODO: this seems sketchy
        expect(message?.choices?.[0]?.message).toMatchObject(getTextContent());
      });

      await expectDone(iterator);
    });

    it('handles tool execution errors', async () => {
      const errorTool: BetaRunnableTool<{ shouldFail: boolean }> = {
        type: 'function',
        function: {
          name: 'errorTool',
          description: 'Tool that can fail',
          parameters: { type: 'object', properties: { shouldFail: { type: 'boolean' } } },
        },
        run: async ({ shouldFail }) => {
          if (shouldFail) throw new Error('Tool execution failed');
          return 'Success';
        },
        parse: (input: unknown) => input as { shouldFail: boolean },
      };

      const { runner, handleAssistantMessage } = setupTest({
        messages: [{ role: 'user', content: 'Test error handling' }],
        tools: [errorTool],
      });

      const iterator = runner[Symbol.asyncIterator]();

      // Assistant requests the error tool with failure flag
      handleAssistantMessage([
        {
          id: 'tool_1',
          type: 'function',
          function: {
            name: 'errorTool',
            arguments: JSON.stringify({ shouldFail: true }),
          },
        },
      ]);

      await expectEvent(iterator, (message) => {
        expect(message?.choices[0]?.message.tool_calls?.[0]).toMatchObject({
          type: 'function',
          function: {
            name: 'errorTool',
          },
        });
      });

      // Assistant handles the error
      handleAssistantMessage(getTextContent());
      await expectEvent(iterator, (message) => {
        expect(message?.choices[0]?.message).toMatchObject(getTextContent());
      });

      // Check that the tool error was properly added to the messages
      expect(runner.params.messages).toHaveLength(3);
      expect(runner.params.messages[2]).toMatchObject({
        role: 'tool',
        tool_call_id: 'tool_1',
        content: expect.stringContaining('Error: Tool execution failed'),
      });

      await expectDone(iterator);
    });

    it('handles api errors streaming', async () => {
      const { runner, handleRequest, handleAssistantMessageStream } = setupTest({
        messages: [{ role: 'user', content: 'Test error handling' }],
        tools: [weatherTool],
        stream: true,
      });

      handleRequest(async () => {
        return new Response(null, {
          status: 400,
        });
      });
      const iterator1 = runner[Symbol.asyncIterator]();
      await expectEvent(iterator1, async (stream) => {
        await expect(stream.finalMessage()).rejects.toThrow('400');
      });
      await expect(iterator1.next()).rejects.toThrow('400');
      await expectDone(iterator1);

      // We let you consume the iterator again to continue the conversation when there is an error.
      handleAssistantMessageStream(getTextContent());
      const iterator2 = runner[Symbol.asyncIterator]();
      await expectEvent(iterator2, (message) => {
        expect(message.finalMessage()).resolves.toMatchObject(getTextContent());
      });
      await expectDone(iterator2);
    });

    it('handles api errors', async () => {
      const { runner, handleRequest, handleAssistantMessage } = setupTest({
        messages: [{ role: 'user', content: 'Test error handling' }],
        tools: [weatherTool],
      });

      handleRequest(async () => {
        return new Response(null, {
          status: 500,
        });
      });
      const iterator1 = runner[Symbol.asyncIterator]();
      await expect(iterator1.next()).rejects.toThrow('500');
      await expectDone(iterator1);

      // We let you consume the iterator again to continue the conversation when there is an error.
      handleAssistantMessage(getTextContent());
      const iterator2 = runner[Symbol.asyncIterator]();
      await expectEvent(iterator2, (message) => {
        expect(message?.choices?.[0]?.message).toMatchObject(getTextContent());
      });
      await expectDone(iterator2);
    });

    it('respects max_iterations parameter', async () => {
      const { runner, handleAssistantMessage } = setupTest({
        messages: [{ role: 'user', content: 'Use tools repeatedly, one at a time' }],
        max_iterations: 2, // Limit to 2 iterations
      });

      const iterator = runner[Symbol.asyncIterator]();

      // First iteration
      handleAssistantMessage([getWeatherToolUse('Paris')]);
      await expectEvent(iterator, (message) => {
        expect(message?.choices?.[0]?.message.tool_calls).toMatchObject([getWeatherToolUse('Paris')]);
      });

      // Second iteration (should be the last)
      handleAssistantMessage([getWeatherToolUse('Berlin', 'tool_2')]);
      await expectEvent(iterator, (message) => {
        expect(message?.choices?.[0]?.message.tool_calls).toMatchObject([
          getWeatherToolUse('Berlin', 'tool_2'),
        ]);
      });

      // Should stop here due to max_iterations
      await expectDone(iterator);

      // When max_iterations is reached, the iterator completes even if tools were requested.
      // The final message would be the last tool_use message from the assistant,
      // but no further iterations occur to execute those tools.
      const messages = runner.params.messages;
      expect(messages).toHaveLength(5);
      await expect(runner.runUntilDone()).resolves.toMatchObject({
        role: 'assistant',
        tool_calls: [getWeatherToolUse('Berlin', 'tool_2')],
      });
    });
  });

  describe('iterator.return()', () => {
    it('stops iteration', async () => {
      const { runner, handleAssistantMessage } = setupTest();

      const iterator = runner[Symbol.asyncIterator]();

      handleAssistantMessage([getWeatherToolUse('SF')]);

      // Get first message
      await expectEvent(iterator);

      // Call return to cleanup
      const returnResult = await iterator.return?.();
      expect(returnResult?.done).toBe(true);
      expect(returnResult?.value).toBeUndefined();

      // Further calls should indicate done
      await expectDone(iterator);
    });
  });

  describe('.setMessagesParams()', () => {
    it('updates parameters for next iteration', async () => {
      const { runner, handleAssistantMessage } = setupTest({
        messages: [{ role: 'user', content: 'Initial message' }],
        max_tokens: 100,
      });

      // Update parameters before iteration
      runner.setMessagesParams({
        messages: [{ role: 'user', content: 'Updated message' }],
        model: 'gpt-4o',
        max_tokens: 200,
        tools: [weatherTool],
      });

      const iterator = runner[Symbol.asyncIterator]();

      handleAssistantMessage(getTextContent());
      await expectEvent(iterator, (message) => {
        expect(message?.choices[0]?.message).toMatchObject(getTextContent());
      });

      // Verify params were updated
      expect(runner.params.max_tokens).toBe(200);
      expect(runner.params.messages[0]?.content).toBe('Updated message');

      await expectDone(iterator);
    });

    it('allows you to update append custom tool_use blocks', async () => {
      const { runner, handleAssistantMessage } = setupTest({
        messages: [{ role: 'user', content: 'Get weather' }],
      });

      const iterator = runner[Symbol.asyncIterator]();

      // First iteration: assistant requests tool
      handleAssistantMessage([getWeatherToolUse('Paris')]);
      await expectEvent(iterator, (message) => {
        expect(message?.choices[0]?.message?.tool_calls).toMatchObject([getWeatherToolUse('Paris')]);
      });

      // Verify generateToolResponse returns the tool result for Paris
      const toolResponse = await runner.generateToolResponse();
      expect(toolResponse).toMatchObject([getWeatherToolResult('Paris')]);

      // Update params to append a custom tool_use block to messages
      runner.setMessagesParams({
        ...runner.params,
        messages: [
          ...runner.params.messages,
          { role: 'assistant', tool_calls: [getWeatherToolUse('London', 'tool_1')] },
        ],
      });

      // Assistant provides final response incorporating both tool results
      handleAssistantMessage(getTextContent());
      await expectEvent(iterator, (message) => {
        expect(message?.choices[0]?.message).toMatchObject(getTextContent());
      });

      // Verify the messages were properly appended
      // The messages array should have: initial user message + custom assistant + custom tool_use
      expect(runner.params.messages).toHaveLength(3);
      expect(runner.params.messages[1]).toMatchObject({
        role: 'assistant',
        tool_calls: [getWeatherToolUse('London', 'tool_1')],
      });
      // Verify the third message has the London tool_result
      // (responded to automatically by the ToolRunner)
      expect(runner.params.messages[2]).toMatchObject(getWeatherToolResult('Paris', 'tool_1'));
      await expectDone(iterator);
    });
  });

  describe('.runUntilDone()', () => {
    it('consumes iterator if not started', async () => {
      const { runner, handleAssistantMessage } = setupTest({
        messages: [{ role: 'user', content: 'Test done method' }],
      });

      handleAssistantMessage(getTextContent());
      const finalMessage = await runner.runUntilDone();
      expect(finalMessage).toMatchObject(getTextContent());
    });
  });

  describe('.done()', () => {
    it('waits for completion when iterator is consumed', async () => {
      const { runner, handleAssistantMessage } = setupTest({
        messages: [{ role: 'user', content: 'Test done method' }],
      });

      // Start consuming in background
      const consumePromise = (async () => {
        for await (const _ of runner) {
          // Just consume
        }
      })();

      handleAssistantMessage(getTextContent());
      const finalMessage = await runner.done();
      expect(finalMessage).toMatchObject(getTextContent());

      await consumePromise;
    });
  });

  describe('.generateToolResponse()', () => {
    it('returns tool response for last message', async () => {
      const { runner, handleAssistantMessage } = setupTest({
        messages: [{ role: 'user', content: 'Get weather' }],
      });

      const iterator = runner[Symbol.asyncIterator]();

      // First message create call should respond with a tool use.
      handleAssistantMessage([getWeatherToolUse('Miami')]);
      const firstResult = await iterator.next();
      // Make sure we got the message
      expect(firstResult.value).toMatchObject({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              refusal: null,
              tool_calls: [getWeatherToolUse('Miami')],
            },
          },
        ],
      });

      // When we call generateToolResponse, it should use the previous message
      const toolResponse = await runner.generateToolResponse(); // this is the cached prev tool response (aka Miami weather)
      expect(toolResponse?.[0]).toMatchObject(getWeatherToolResult('Miami'));
      // At this point we should still only have the initial user message
      // The assistant message gets added after the yield completes
      expect(runner.params.messages.length).toBe(1);

      // Ending the tool loop with an assistant message should work as expected.
      handleAssistantMessage(getTextContent());
      await iterator.next();
      await expectDone(iterator);
    });

    it('calls tools at most once', async () => {
      let weatherToolCallCount = 0;
      const trackingWeatherTool: BetaRunnableTool<{ location: string }> = {
        type: 'function',
        function: {
          name: 'getWeather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { location: { type: 'string' } } },
        },
        run: async ({ location }) => {
          weatherToolCallCount++;
          return `Sunny in ${location}`;
        },
        parse: (input: unknown) => input as { location: string },
      };

      const { runner, handleAssistantMessage } = setupTest({
        messages: [{ role: 'user', content: 'Get weather' }],
        tools: [trackingWeatherTool],
      });

      const iterator = runner[Symbol.asyncIterator]();

      // Assistant requests tool
      handleAssistantMessage([getWeatherToolUse('Boston')]);
      await iterator.next();

      // Tools are executed automatically in the ToolRunner after receiving tool_use blocks
      // The generateToolResponse is called internally, which should trigger the tool
      // Let's call it manually to verify caching behavior
      const response1 = await runner.generateToolResponse();
      expect(weatherToolCallCount).toBe(1); // Tool should be called once
      expect(response1).toMatchObject([getWeatherToolResult('Boston')]);
      const response2 = await runner.generateToolResponse();
      expect(weatherToolCallCount).toBe(1); // Still 1, cached
      expect(response2).toMatchObject([getWeatherToolResult('Boston')]);

      // Final response should be an assistant response.
      handleAssistantMessage(getTextContent());
      await iterator.next();

      // At this point, the iterator should be completely consumed.
      await expectDone(iterator);

      // Since we've never called setMessagesParams(), we should expect the tool to only be called once since it should
      // all be cached. Note, that the caching mechanism here should be async-safe.
      expect(weatherToolCallCount).toBe(1);
    });

    it('returns null when no tools need execution', async () => {
      const { runner, handleAssistantMessage } = setupTest({
        messages: [{ role: 'user', content: 'Just chat' }],
      });

      const iterator = runner[Symbol.asyncIterator]();

      handleAssistantMessage(getTextContent());
      await iterator.next();

      // Since the previous block is a text response, we should expect generateToolResponse to return null
      const toolResponse = await runner.generateToolResponse();
      expect(toolResponse).toBeNull();
      await expectDone(iterator);
    });
  });
});
