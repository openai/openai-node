import OpenAI from 'openai';
import { OpenAIError } from 'openai/error';
import { PassThrough } from 'stream';
import {
  ParsingFunction,
  type ChatCompletionRunner,
  type ChatCompletionFunctionRunnerParams,
  ChatCompletionStreamingRunner,
  type ChatCompletionStreamingFunctionRunnerParams,
} from 'openai/resources/beta/chat/completions';

import { type RequestInfo, type RequestInit } from 'openai/_shims/index';
import { Response } from 'node-fetch';

type Fetch = (req: string | RequestInfo, init?: RequestInit) => Promise<Response>;

/**
 * Creates a mock `fetch` function and a `handleRequest` function for intercepting `fetch` calls.
 *
 * You call `handleRequest` with a callback function that handles the next `fetch` call.
 * It returns a Promise that:
 * - waits for the next call to `fetch`
 * - calls the callback with the `fetch` arguments
 * - resolves `fetch` with the callback output
 */
function mockFetch(): { fetch: Fetch; handleRequest: (handle: Fetch) => Promise<void> } {
  const fetchQueue: ((handler: typeof fetch) => void)[] = [];
  const handlerQueue: Promise<typeof fetch>[] = [];

  const enqueueHandler = () => {
    handlerQueue.push(
      new Promise<typeof fetch>((resolve) => {
        fetchQueue.push((handle: typeof fetch) => {
          enqueueHandler();
          resolve(handle);
        });
      }),
    );
  };
  enqueueHandler();

  async function fetch(req: string | RequestInfo, init?: RequestInit): Promise<Response> {
    const handler = await handlerQueue.shift();
    if (!handler) throw new Error('expected handler to be defined');
    const signal = init?.signal;
    if (!signal) return await handler(req, init);
    return await Promise.race([
      handler(req, init),
      new Promise<Response>((resolve, reject) => {
        if (signal.aborted) {
          // @ts-ignore does exist in Node
          reject(new DOMException('The user aborted a request.', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', (e) => {
          // @ts-ignore does exist in Node
          reject(new DOMException('The user aborted a request.', 'AbortError'));
        });
      }),
    ]);
  }

  function handleRequest(handle: typeof fetch): Promise<void> {
    return new Promise<void>((resolve) => {
      fetchQueue.shift()?.(async (req, init) => {
        try {
          return await handle(req, init);
        } finally {
          resolve();
        }
      });
    });
  }

  return { fetch, handleRequest };
}

// mockChatCompletionFetch is like mockFetch, but with better a more convenient handleRequest to mock
// chat completion request/responses.
function mockChatCompletionFetch() {
  const { fetch, handleRequest: handleRawRequest } = mockFetch();

  function handleRequest(
    handler: (body: ChatCompletionFunctionRunnerParams<any[]>) => Promise<OpenAI.Chat.ChatCompletion>,
  ): Promise<void> {
    return handleRawRequest(async (req, init) => {
      const rawBody = init?.body;
      if (typeof rawBody !== 'string') throw new Error(`expected init.body to be a string`);
      const body: ChatCompletionFunctionRunnerParams<any[]> = JSON.parse(rawBody);
      return new Response(JSON.stringify(await handler(body)), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
  }
  return { fetch, handleRequest };
}

// mockStreamingChatCompletionFetch is like mockFetch, but with better a more convenient handleRequest to mock
// streaming chat completion request/responses.
function mockStreamingChatCompletionFetch() {
  const { fetch, handleRequest: handleRawRequest } = mockFetch();

  function handleRequest(
    handler: (
      body: ChatCompletionStreamingFunctionRunnerParams<any[]>,
    ) => AsyncIterable<OpenAI.Chat.ChatCompletionChunk>,
  ): Promise<void> {
    return handleRawRequest(async (req, init) => {
      const rawBody = init?.body;
      if (typeof rawBody !== 'string') throw new Error(`expected init.body to be a string`);
      const body: ChatCompletionStreamingFunctionRunnerParams<any[]> = JSON.parse(rawBody);
      const stream = new PassThrough();
      (async () => {
        for await (const chunk of handler(body)) {
          stream.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        stream.end(`data: [DONE]\n\n`);
      })();
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Transfer-Encoding': 'chunked',
        },
      });
    });
  }
  return { fetch, handleRequest };
}

// contentChoiceDeltas returns an async iterator which mocks a delta stream of a by splitting the
// argument into chunks separated by whitespace.
function* contentChoiceDeltas(
  content: string,
  {
    index = 0,
    role = 'assistant',
  }: { index?: number; role?: NonNullable<OpenAI.Chat.ChatCompletionChunk.Choice.Delta['role']> } = {},
): Iterable<OpenAI.Chat.Completions.ChatCompletionChunk.Choice> {
  const deltas = content.split(/\s+/g);
  for (let i = 0; i < deltas.length; i++) {
    yield {
      index,
      finish_reason: i === deltas.length - 1 ? 'stop' : null,
      delta: {
        role,
        content: deltas[i] ? `${deltas[i]}${i === deltas.length - 1 ? '' : ' '}` : null,
      },
    };
  }
}

// functionCallDeltas returns an async iterator which mocks a delta stream of a functionCall by splitting
// the argument into chunks separated by whitespace.
function* functionCallDeltas(
  args: string,
  {
    index = 0,
    name,
    role = 'assistant',
  }: {
    name: string;
    index?: number;
    role?: NonNullable<OpenAI.Chat.ChatCompletionChunk.Choice.Delta['role']>;
  },
): Iterable<OpenAI.Chat.Completions.ChatCompletionChunk.Choice> {
  const deltas = args.split(/\s+/g);
  for (let i = 0; i < deltas.length; i++) {
    yield {
      index,
      finish_reason: i === deltas.length - 1 ? 'function_call' : null,
      delta: {
        role,
        function_call: {
          arguments: `${deltas[i] || ''}${i === deltas.length - 1 ? '' : ' '}`,
          ...(i === deltas.length - 1 ? { name } : null),
        },
      },
    };
  }
}

class RunnerListener {
  readonly contents: string[] = [];
  readonly messages: OpenAI.Chat.ChatCompletionMessage[] = [];
  readonly chatCompletions: OpenAI.Chat.ChatCompletion[] = [];
  readonly functionCalls: OpenAI.Chat.ChatCompletionMessage.FunctionCall[] = [];
  readonly functionCallResults: string[] = [];
  finalContent: string | null = null;
  finalMessage: OpenAI.Chat.ChatCompletionMessage | undefined;
  finalChatCompletion: OpenAI.Chat.ChatCompletion | undefined;
  finalFunctionCall: OpenAI.Chat.ChatCompletionMessage.FunctionCall | undefined;
  finalFunctionCallResult: string | undefined;
  totalUsage: OpenAI.CompletionUsage | undefined;
  error: OpenAIError | undefined;
  gotConnect = false;
  gotAbort = false;
  gotEnd = false;

  onceMessageCallCount = 0;

  constructor(public runner: ChatCompletionRunner) {
    runner
      .on('connect', () => (this.gotConnect = true))
      .on('content', (content) => this.contents.push(content))
      .on('message', (message) => this.messages.push(message))
      .on('chatCompletion', (completion) => this.chatCompletions.push(completion))
      .on('functionCall', (functionCall) => this.functionCalls.push(functionCall))
      .on('functionCallResult', (result) => this.functionCallResults.push(result))
      .on('finalContent', (content) => (this.finalContent = content))
      .on('finalMessage', (message) => (this.finalMessage = message))
      .on('finalChatCompletion', (completion) => (this.finalChatCompletion = completion))
      .on('finalFunctionCall', (functionCall) => (this.finalFunctionCall = functionCall))
      .on('finalFunctionCallResult', (result) => (this.finalFunctionCallResult = result))
      .on('totalUsage', (usage) => (this.totalUsage = usage))
      .on('error', (error) => (this.error = error))
      .on('abort', () => (this.gotAbort = true))
      .on('end', () => (this.gotEnd = true))
      .once('message', () => this.onceMessageCallCount++);
  }

  async sanityCheck({ error }: { error?: string } = {}) {
    expect(this.onceMessageCallCount).toBeLessThanOrEqual(1);
    expect(this.gotAbort).toEqual(this.runner.aborted);
    if (this.runner.aborted) expect(this.runner.errored).toBe(true);
    if (error) {
      expect(this.error?.message).toEqual(error);
      expect(this.runner.errored).toBe(true);
      await expect(this.runner.finalChatCompletion()).rejects.toThrow(error);
      await expect(this.runner.finalMessage()).rejects.toThrow(error);
      await expect(this.runner.finalContent()).rejects.toThrow(error);
      await expect(this.runner.finalFunctionCall()).rejects.toThrow(error);
      await expect(this.runner.finalFunctionCallResult()).rejects.toThrow(error);
      await expect(this.runner.totalUsage()).rejects.toThrow(error);
      await expect(this.runner.done()).rejects.toThrow(error);
    } else {
      expect(this.error).toBeUndefined();
      expect(this.runner.errored).toBe(false);
    }

    if (!this.gotConnect) {
      expect(this.contents).toEqual([]);
      expect(this.messages).toEqual([]);
      expect(this.chatCompletions).toEqual([]);
      expect(this.functionCalls).toEqual([]);
      expect(this.functionCallResults).toEqual([]);
      expect(this.finalContent).toBeUndefined();
      expect(this.finalMessage).toBeUndefined();
      expect(this.finalChatCompletion).toBeUndefined();
      expect(this.finalFunctionCall).toBeUndefined();
      expect(this.finalFunctionCallResult).toBeUndefined();
      expect(this.totalUsage).toBeUndefined();
      expect(this.gotEnd).toBe(true);
      return;
    }

    if (error) return;

    const expectedContents = this.messages
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
      .filter(Boolean);
    expect(this.contents).toEqual(expectedContents);
    expect(this.finalMessage).toEqual(this.messages[this.messages.length - 1]);
    expect(await this.runner.finalMessage()).toEqual(this.finalMessage);
    expect(this.finalContent).toEqual(expectedContents[expectedContents.length - 1] ?? null);
    expect(await this.runner.finalContent()).toEqual(this.finalContent);
    expect(this.finalChatCompletion).toEqual(this.chatCompletions[this.chatCompletions.length - 1]);
    expect(await this.runner.finalChatCompletion()).toEqual(this.finalChatCompletion);
    expect(this.finalFunctionCall).toEqual(this.functionCalls[this.functionCalls.length - 1]);
    expect(await this.runner.finalFunctionCall()).toEqual(this.finalFunctionCall);
    expect(this.finalFunctionCallResult).toEqual(
      this.functionCallResults[this.functionCallResults.length - 1],
    );
    expect(await this.runner.finalFunctionCallResult()).toEqual(this.finalFunctionCallResult);
    expect(this.chatCompletions).toEqual(this.runner.allChatCompletions());
    expect(this.messages).toEqual(this.runner.messages.slice(-this.messages.length));
    if (this.chatCompletions.some((c) => c.usage)) {
      const totalUsage: OpenAI.CompletionUsage = {
        completion_tokens: 0,
        prompt_tokens: 0,
        total_tokens: 0,
      };
      for (const { usage } of this.chatCompletions) {
        if (usage) {
          totalUsage.completion_tokens += usage.completion_tokens;
          totalUsage.prompt_tokens += usage.prompt_tokens;
          totalUsage.total_tokens += usage.total_tokens;
        }
      }
      expect(this.totalUsage).toEqual(totalUsage);
      expect(await this.runner.totalUsage()).toEqual(totalUsage);
    }

    expect(this.gotEnd).toBe(true);
  }
}

class StreamingRunnerListener {
  readonly eventChunks: OpenAI.Chat.ChatCompletionChunk[] = [];
  readonly eventContents: [string, string][] = [];
  readonly eventMessages: OpenAI.Chat.ChatCompletionMessage[] = [];
  readonly eventChatCompletions: OpenAI.Chat.ChatCompletion[] = [];
  readonly eventFunctionCalls: OpenAI.Chat.ChatCompletionMessage.FunctionCall[] = [];
  readonly eventFunctionCallResults: string[] = [];

  finalContent: string | null = null;
  finalMessage: OpenAI.Chat.ChatCompletionMessage | undefined;
  finalChatCompletion: OpenAI.Chat.ChatCompletion | undefined;
  finalFunctionCall: OpenAI.Chat.ChatCompletionMessage.FunctionCall | undefined;
  finalFunctionCallResult: string | undefined;
  error: OpenAIError | undefined;
  gotConnect = false;
  gotEnd = false;

  constructor(public runner: ChatCompletionStreamingRunner) {
    runner
      .on('connect', () => (this.gotConnect = true))
      .on('chunk', (chunk) => this.eventChunks.push(chunk))
      .on('content', (delta, snapshot) => this.eventContents.push([delta, snapshot]))
      .on('message', (message) => this.eventMessages.push(message))
      .on('chatCompletion', (completion) => this.eventChatCompletions.push(completion))
      .on('functionCall', (functionCall) => this.eventFunctionCalls.push(functionCall))
      .on('functionCallResult', (result) => this.eventFunctionCallResults.push(result))
      .on('finalContent', (content) => (this.finalContent = content))
      .on('finalMessage', (message) => (this.finalMessage = message))
      .on('finalChatCompletion', (completion) => (this.finalChatCompletion = completion))
      .on('finalFunctionCall', (functionCall) => (this.finalFunctionCall = functionCall))
      .on('finalFunctionCallResult', (result) => (this.finalFunctionCallResult = result))
      .on('error', (error) => (this.error = error))
      .on('end', () => (this.gotEnd = true));
  }

  async sanityCheck({ error }: { error?: string } = {}) {
    if (error) {
      expect(this.error?.message).toEqual(error);
      expect(this.runner.errored).toBe(true);
      await expect(this.runner.finalChatCompletion()).rejects.toThrow(error);
      await expect(this.runner.finalMessage()).rejects.toThrow(error);
      await expect(this.runner.finalContent()).rejects.toThrow(error);
      await expect(this.runner.finalFunctionCall()).rejects.toThrow(error);
      await expect(this.runner.finalFunctionCallResult()).rejects.toThrow(error);
      await expect(this.runner.done()).rejects.toThrow(error);
    } else {
      expect(this.error).toBeUndefined();
      expect(this.runner.errored).toBe(false);
    }

    if (!this.gotConnect) {
      expect(this.eventContents).toEqual([]);
      expect(this.eventMessages).toEqual([]);
      expect(this.eventChatCompletions).toEqual([]);
      expect(this.eventFunctionCalls).toEqual([]);
      expect(this.eventFunctionCallResults).toEqual([]);
      expect(this.finalContent).toBeUndefined();
      expect(this.finalMessage).toBeUndefined();
      expect(this.finalChatCompletion).toBeUndefined();
      expect(this.finalFunctionCall).toBeUndefined();
      expect(this.finalFunctionCallResult).toBeUndefined();
      expect(this.gotEnd).toBe(true);
      return;
    }

    if (error) return;

    if (this.eventContents.length) expect(this.eventChunks.length).toBeGreaterThan(0);
    expect(this.finalMessage).toEqual(this.eventMessages[this.eventMessages.length - 1]);
    expect(await this.runner.finalMessage()).toEqual(this.finalMessage);
    expect(this.finalContent).toEqual(this.eventContents[this.eventContents.length - 1]?.[1] ?? null);
    expect(await this.runner.finalContent()).toEqual(this.finalContent);
    expect(this.finalChatCompletion).toEqual(this.eventChatCompletions[this.eventChatCompletions.length - 1]);
    expect(await this.runner.finalChatCompletion()).toEqual(this.finalChatCompletion);
    expect(this.finalFunctionCall).toEqual(this.eventFunctionCalls[this.eventFunctionCalls.length - 1]);
    expect(await this.runner.finalFunctionCall()).toEqual(this.finalFunctionCall);
    expect(this.finalFunctionCallResult).toEqual(
      this.eventFunctionCallResults[this.eventFunctionCallResults.length - 1],
    );
    expect(await this.runner.finalFunctionCallResult()).toEqual(this.finalFunctionCallResult);
    expect(this.eventChatCompletions).toEqual(this.runner.allChatCompletions());
    expect(this.eventMessages).toEqual(this.runner.messages.slice(-this.eventMessages.length));
    if (error) {
      expect(this.error?.message).toEqual(error);
      expect(this.runner.errored).toBe(true);
    } else {
      expect(this.error).toBeUndefined();
      expect(this.runner.errored).toBe(false);
    }
    expect(this.gotEnd).toBe(true);
  }
}

function _typeTests() {
  const openai = new OpenAI();

  openai.beta.chat.completions.runFunctions({
    messages: [
      { role: 'user', content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}' },
    ],
    model: 'gpt-3.5-turbo',
    functions: [
      {
        name: 'numProperties',
        function: (obj: object) => String(Object.keys(obj).length),
        parameters: { type: 'object' },
        parse: (str: string): object => {
          const result = JSON.parse(str);
          if (!(result instanceof Object) || Array.isArray(result)) {
            throw new Error('must be an object');
          }
          return result;
        },
        description: 'gets the number of properties on an object',
      },
      {
        function: (str: string) => String(str.length),
        parameters: { type: 'string' },
        description: 'gets the length of a string',
      },
      // @ts-expect-error function must accept string if parse is omitted
      {
        function: (obj: object) => String(Object.keys(obj).length),
        parameters: { type: 'object' },
        description: 'gets the number of properties on an object',
      },
    ],
  });
  openai.beta.chat.completions.runFunctions({
    messages: [
      { role: 'user', content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}' },
    ],
    model: 'gpt-3.5-turbo',
    functions: [
      new ParsingFunction({
        name: 'numProperties',
        // @ts-expect-error parse and function don't match
        parse: (str: string) => str,
        function: (obj: object) => String(Object.keys(obj).length),
        parameters: { type: 'object' },
        description: 'gets the number of properties on an object',
      }),
    ],
  });
  openai.beta.chat.completions.runFunctions({
    messages: [
      { role: 'user', content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}' },
    ],
    model: 'gpt-3.5-turbo',
    functions: [
      new ParsingFunction({
        name: 'numProperties',
        parse: (str: string): object => {
          const result = JSON.parse(str);
          if (!(result instanceof Object) || Array.isArray(result)) {
            throw new Error('must be an object');
          }
          return result;
        },
        function: (obj: object) => String(Object.keys(obj).length),
        parameters: { type: 'object' },
        description: 'gets the number of properties on an object',
      }),
      new ParsingFunction({
        name: 'keys',
        parse: (str: string): object => {
          const result = JSON.parse(str);
          if (!(result instanceof Object)) {
            throw new Error('must be an Object');
          }
          return result;
        },
        function: (obj: object) => Object.keys(obj).join(', '),
        parameters: { type: 'object' },
        description: 'gets the number of properties on an object',
      }),
      new ParsingFunction({
        name: 'len2',
        // @ts-expect-error parse and function don't match
        parse: (str: string) => str,
        function: (obj: object) => String(Object.keys(obj).length),
        parameters: { type: 'object' },
        description: 'gets the number of properties on an object',
      }),
    ],
  });
  openai.beta.chat.completions.runFunctions({
    messages: [
      { role: 'user', content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}' },
    ],
    model: 'gpt-3.5-turbo',
    // @ts-ignore error occurs here in TS 4
    functions: [
      {
        name: 'numProperties',
        parse: (str: string): object => {
          const result = JSON.parse(str);
          if (!(result instanceof Object) || Array.isArray(result)) {
            throw new Error('must be an object');
          }
          return result;
        },
        function: (obj: object) => String(Object.keys(obj).length),
        parameters: { type: 'object' },
        description: 'gets the number of properties on an object',
      },
      {
        name: 'keys',
        parse: (str: string): object => {
          const result = JSON.parse(str);
          if (!(result instanceof Object)) {
            throw new Error('must be an Object');
          }
          return result;
        },
        function: (obj: object) => Object.keys(obj).join(', '),
        parameters: { type: 'object' },
        description: 'gets the number of properties on an object',
      },
      {
        name: 'len2',
        parse: (str: string) => str,
        // @ts-ignore error occurs here in TS 5
        // function input doesn't match parse output
        function: (obj: object) => String(Object.keys(obj).length),
        parameters: { type: 'object' },
        description: 'gets the number of properties on an object',
      },
    ] as const,
  });
}

describe('resource completions', () => {
  describe('runFunctions with stream: false', () => {
    test('successful flow', async () => {
      const { fetch, handleRequest } = mockChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const runner = openai.beta.chat.completions.runFunctions({
        messages: [{ role: 'user', content: 'tell me what the weather is like' }],
        model: 'gpt-3.5-turbo',
        functions: [
          {
            function: function getWeather() {
              return `it's raining`;
            },
            parameters: {},
            description: 'gets the weather',
          },
        ],
      });
      const listener = new RunnerListener(runner);

      await Promise.all([
        handleRequest(async (request) => {
          expect(request.messages).toEqual([{ role: 'user', content: 'tell me what the weather is like' }]);
          return {
            id: '1',
            choices: [
              {
                index: 0,
                finish_reason: 'function_call',
                message: {
                  role: 'assistant',
                  content: null,
                  function_call: {
                    arguments: '',
                    name: 'getWeather',
                  },
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
          };
        }),
        handleRequest(async (request) => {
          expect(request.messages).toEqual([
            { role: 'user', content: 'tell me what the weather is like' },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '',
                name: 'getWeather',
              },
            },
            {
              role: 'function',
              content: `it's raining`,
              name: 'getWeather',
            },
          ]);
          return {
            id: '2',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: `it's raining`,
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
          };
        }),
        runner.done(),
      ]);

      expect(listener.messages).toEqual([
        { role: 'user', content: 'tell me what the weather is like' },
        { role: 'assistant', content: null, function_call: { name: 'getWeather', arguments: '' } },
        { role: 'function', content: `it's raining`, name: 'getWeather' },
        { role: 'assistant', content: "it's raining" },
      ]);
      expect(listener.functionCallResults).toEqual([`it's raining`]);
      await listener.sanityCheck();
    });
    test('flow with abort', async () => {
      const { fetch, handleRequest } = mockChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const controller = new AbortController();
      const runner = openai.beta.chat.completions.runFunctions(
        {
          messages: [{ role: 'user', content: 'tell me what the weather is like' }],
          model: 'gpt-3.5-turbo',
          functions: [
            {
              function: function getWeather() {
                return `it's raining`;
              },
              parameters: {},
              description: 'gets the weather',
            },
          ],
        },
        { signal: controller.signal },
      );
      const listener = new RunnerListener(runner);

      await handleRequest(async (request) => {
        expect(request.messages).toEqual([{ role: 'user', content: 'tell me what the weather is like' }]);
        return {
          id: '1',
          choices: [
            {
              index: 0,
              finish_reason: 'function_call',
              message: {
                role: 'assistant',
                content: null,
                function_call: {
                  arguments: '',
                  name: 'getWeather',
                },
              },
            },
          ],
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-3.5-turbo',
          object: 'chat.completion',
        };
      });

      controller.abort();

      await runner.done().catch(() => {});

      expect(listener.messages).toEqual([
        { role: 'user', content: 'tell me what the weather is like' },
        { role: 'assistant', content: null, function_call: { name: 'getWeather', arguments: '' } },
        { role: 'function', content: `it's raining`, name: 'getWeather' },
      ]);
      expect(listener.functionCallResults).toEqual([`it's raining`]);
      await listener.sanityCheck({ error: 'Request was aborted.' });
      expect(runner.aborted).toBe(true);
    });
    test('successful flow with parse', async () => {
      const { fetch, handleRequest } = mockChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const runner = openai.beta.chat.completions.runFunctions({
        messages: [
          {
            role: 'user',
            content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
          },
        ],
        model: 'gpt-3.5-turbo',
        functions: [
          new ParsingFunction({
            name: 'numProperties',
            function: (obj: object) => String(Object.keys(obj).length),
            parameters: { type: 'object' },
            parse: (str: string): object => {
              const result = JSON.parse(str);
              if (!(result instanceof Object) || Array.isArray(result)) {
                throw new Error('must be an object');
              }
              return result;
            },
            description: 'gets the number of properties on an object',
          }),
        ],
      });
      const listener = new RunnerListener(runner);

      await Promise.all([
        handleRequest(async (request) => {
          expect(request.messages).toEqual([
            {
              role: 'user',
              content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
            },
          ]);
          return {
            id: '1',
            choices: [
              {
                index: 0,
                finish_reason: 'function_call',
                message: {
                  role: 'assistant',
                  content: null,
                  function_call: {
                    arguments: '{"a": 1, "b": 2, "c": 3}',
                    name: 'numProperties',
                  },
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
            usage: {
              completion_tokens: 5,
              prompt_tokens: 20,
              total_tokens: 25,
            },
          };
        }),

        handleRequest(async (request) => {
          expect(request.messages).toEqual([
            {
              role: 'user',
              content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
            },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '{"a": 1, "b": 2, "c": 3}',
                name: 'numProperties',
              },
            },
            {
              role: 'function',
              content: '3',
              name: 'numProperties',
            },
          ]);
          return {
            id: '2',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: `there are 3 properties in {"a": 1, "b": 2, "c": 3}`,
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
            usage: {
              completion_tokens: 10,
              prompt_tokens: 25,
              total_tokens: 35,
            },
          };
        }),

        runner.done(),
      ]);

      expect(listener.messages).toEqual([
        {
          role: 'user',
          content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
        },
        {
          role: 'assistant',
          content: null,
          function_call: { name: 'numProperties', arguments: '{"a": 1, "b": 2, "c": 3}' },
        },
        { role: 'function', content: '3', name: 'numProperties' },
        { role: 'assistant', content: 'there are 3 properties in {"a": 1, "b": 2, "c": 3}' },
      ]);
      expect(listener.functionCallResults).toEqual(['3']);
      await listener.sanityCheck();
    });
    test('flow with parse error', async () => {
      const { fetch, handleRequest } = mockChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const runner = openai.beta.chat.completions.runFunctions({
        messages: [
          {
            role: 'user',
            content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
          },
        ],
        model: 'gpt-3.5-turbo',
        functions: [
          new ParsingFunction({
            name: 'numProperties',
            function: (obj: object) => String(Object.keys(obj).length),
            parameters: { type: 'object' },
            parse: (str: string): object => {
              const result = JSON.parse(str);
              if (!(result instanceof Object) || Array.isArray(result)) {
                throw new Error('must be an object');
              }
              return result;
            },
            description: 'gets the number of properties on an object',
          }),
        ],
      });
      const listener = new RunnerListener(runner);

      await Promise.all([
        handleRequest(async (request) => {
          expect(request.messages).toEqual([
            {
              role: 'user',
              content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
            },
          ]);
          return {
            id: '1',
            choices: [
              {
                index: 0,
                finish_reason: 'function_call',
                message: {
                  role: 'assistant',
                  content: null,
                  function_call: {
                    arguments: '[{"a": 1, "b": 2, "c": 3}]',
                    name: 'numProperties',
                  },
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
          };
        }),
        handleRequest(async (request) => {
          expect(request.messages).toEqual([
            {
              role: 'user',
              content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
            },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '[{"a": 1, "b": 2, "c": 3}]',
                name: 'numProperties',
              },
            },
            {
              role: 'function',
              content: `must be an object`,
              name: 'numProperties',
            },
          ]);
          return {
            id: '2',
            choices: [
              {
                index: 0,
                finish_reason: 'function_call',
                message: {
                  role: 'assistant',
                  content: null,
                  function_call: {
                    arguments: '{"a": 1, "b": 2, "c": 3}',
                    name: 'numProperties',
                  },
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
          };
        }),
        handleRequest(async (request) => {
          expect(request.messages).toEqual([
            {
              role: 'user',
              content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
            },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '[{"a": 1, "b": 2, "c": 3}]',
                name: 'numProperties',
              },
            },
            {
              role: 'function',
              content: `must be an object`,
              name: 'numProperties',
            },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '{"a": 1, "b": 2, "c": 3}',
                name: 'numProperties',
              },
            },
            {
              role: 'function',
              content: '3',
              name: 'numProperties',
            },
          ]);
          return {
            id: '3',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: `there are 3 properties in {"a": 1, "b": 2, "c": 3}`,
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
          };
        }),
        runner.done(),
      ]);

      expect(listener.messages).toEqual([
        {
          role: 'user',
          content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
        },
        {
          role: 'assistant',
          content: null,
          function_call: { name: 'numProperties', arguments: '[{"a": 1, "b": 2, "c": 3}]' },
        },
        { role: 'function', content: `must be an object`, name: 'numProperties' },
        {
          role: 'assistant',
          content: null,
          function_call: { name: 'numProperties', arguments: '{"a": 1, "b": 2, "c": 3}' },
        },
        { role: 'function', content: '3', name: 'numProperties' },
        { role: 'assistant', content: 'there are 3 properties in {"a": 1, "b": 2, "c": 3}' },
      ]);
      expect(listener.functionCallResults).toEqual([`must be an object`, '3']);
      await listener.sanityCheck();
    });
    test('single function call', async () => {
      const { fetch, handleRequest } = mockChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const runner = openai.beta.chat.completions.runFunctions({
        messages: [{ role: 'user', content: 'tell me what the weather is like' }],
        model: 'gpt-3.5-turbo',
        function_call: {
          name: 'getWeather',
        },
        functions: [
          {
            function: function getWeather() {
              return `it's raining`;
            },
            parameters: {},
            description: 'gets the weather',
          },
        ],
      });
      const listener = new RunnerListener(runner);

      await Promise.all([
        handleRequest(async (request) => {
          expect(request.messages).toEqual([{ role: 'user', content: 'tell me what the weather is like' }]);
          return {
            id: '1',
            choices: [
              {
                index: 0,
                finish_reason: 'function_call',
                message: {
                  role: 'assistant',
                  content: null,
                  function_call: {
                    arguments: '',
                    name: 'getWeather',
                  },
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
          };
        }),
        runner.done(),
      ]);

      expect(listener.messages).toEqual([
        { role: 'user', content: 'tell me what the weather is like' },
        { role: 'assistant', content: null, function_call: { name: 'getWeather', arguments: '' } },
        { role: 'function', content: `it's raining`, name: 'getWeather' },
      ]);
      expect(listener.functionCallResults).toEqual([`it's raining`]);
      await listener.sanityCheck();
    });
    test('wrong function name', async () => {
      const { fetch, handleRequest } = mockChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const runner = openai.beta.chat.completions.runFunctions({
        messages: [{ role: 'user', content: 'tell me what the weather is like' }],
        model: 'gpt-3.5-turbo',
        functions: [
          {
            function: function getWeather() {
              return `it's raining`;
            },
            parameters: {},
            description: 'gets the weather',
          },
        ],
      });
      const listener = new RunnerListener(runner);

      await Promise.all([
        handleRequest(async (request) => {
          expect(request.messages).toEqual([{ role: 'user', content: 'tell me what the weather is like' }]);
          return {
            id: '1',
            choices: [
              {
                index: 0,
                finish_reason: 'function_call',
                message: {
                  role: 'assistant',
                  content: null,
                  function_call: {
                    arguments: '',
                    name: 'get_weather',
                  },
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
          };
        }),
        handleRequest(async (request) => {
          expect(request.messages).toEqual([
            { role: 'user', content: 'tell me what the weather is like' },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '',
                name: 'get_weather',
              },
            },
            {
              role: 'function',
              content: `Invalid function_call: "get_weather". Available options are: "getWeather". Please try again`,
              name: 'get_weather',
            },
          ]);
          return {
            id: '2',
            choices: [
              {
                index: 0,
                finish_reason: 'function_call',
                message: {
                  role: 'assistant',
                  content: null,
                  function_call: {
                    arguments: '',
                    name: 'getWeather',
                  },
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
          };
        }),
        handleRequest(async (request) => {
          expect(request.messages).toEqual([
            { role: 'user', content: 'tell me what the weather is like' },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '',
                name: 'get_weather',
              },
            },
            {
              role: 'function',
              content: `Invalid function_call: "get_weather". Available options are: "getWeather". Please try again`,
              name: 'get_weather',
            },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '',
                name: 'getWeather',
              },
            },
            {
              role: 'function',
              content: `it's raining`,
              name: 'getWeather',
            },
          ]);
          return {
            id: '3',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: `it's raining`,
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
          };
        }),
        runner.done(),
      ]);

      expect(listener.messages).toEqual([
        { role: 'user', content: 'tell me what the weather is like' },
        { role: 'assistant', content: null, function_call: { name: 'get_weather', arguments: '' } },
        {
          role: 'function',
          content: `Invalid function_call: "get_weather". Available options are: "getWeather". Please try again`,
          name: 'get_weather',
        },
        { role: 'assistant', content: null, function_call: { name: 'getWeather', arguments: '' } },
        { role: 'function', content: `it's raining`, name: 'getWeather' },
        { role: 'assistant', content: "it's raining" },
      ]);
      expect(listener.functionCallResults).toEqual([
        `Invalid function_call: "get_weather". Available options are: "getWeather". Please try again`,
        `it's raining`,
      ]);
      await listener.sanityCheck();
    });
    test('wrong function name with single function call', async () => {
      const { fetch, handleRequest } = mockChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const runner = openai.beta.chat.completions.runFunctions({
        messages: [{ role: 'user', content: 'tell me what the weather is like' }],
        model: 'gpt-3.5-turbo',
        function_call: {
          name: 'getWeather',
        },
        functions: [
          {
            function: function getWeather() {
              return `it's raining`;
            },
            parameters: {},
            description: 'gets the weather',
          },
        ],
      });
      const listener = new RunnerListener(runner);

      await Promise.all([
        handleRequest(async (request) => {
          expect(request.messages).toEqual([{ role: 'user', content: 'tell me what the weather is like' }]);
          return {
            id: '1',
            choices: [
              {
                index: 0,
                finish_reason: 'function_call',
                message: {
                  role: 'assistant',
                  content: null,
                  function_call: {
                    arguments: '',
                    name: 'get_weather',
                  },
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
          };
        }),
        runner.done(),
      ]);

      expect(listener.messages).toEqual([
        { role: 'user', content: 'tell me what the weather is like' },
        { role: 'assistant', content: null, function_call: { name: 'get_weather', arguments: '' } },
        {
          role: 'function',
          content: `Invalid function_call: "get_weather". Available options are: "getWeather". Please try again`,
          name: 'get_weather',
        },
      ]);
      expect(listener.functionCallResults).toEqual([
        `Invalid function_call: "get_weather". Available options are: "getWeather". Please try again`,
      ]);
      await listener.sanityCheck();
    });
  });
  describe('runFunctions with stream: true', () => {
    test('successful flow', async () => {
      const { fetch, handleRequest } = mockStreamingChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const runner = openai.beta.chat.completions.runFunctions({
        stream: true,
        messages: [{ role: 'user', content: 'tell me what the weather is like' }],
        model: 'gpt-3.5-turbo',
        functions: [
          {
            function: function getWeather() {
              return `it's raining`;
            },
            parameters: {},
            description: 'gets the weather',
          },
        ],
      });
      const listener = new StreamingRunnerListener(runner);

      await Promise.all([
        handleRequest(async function* (request): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
          expect(request.messages).toEqual([{ role: 'user', content: 'tell me what the weather is like' }]);
          yield {
            id: '1',
            choices: [
              {
                index: 0,
                finish_reason: 'function_call',
                delta: {
                  role: 'assistant',
                  content: null,
                  function_call: {
                    arguments: '',
                    name: 'getWeather',
                  },
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion.chunk',
          };
        }),
        handleRequest(async function* (request): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
          expect(request.messages).toEqual([
            { role: 'user', content: 'tell me what the weather is like' },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '',
                name: 'getWeather',
              },
            },
            {
              role: 'function',
              content: `it's raining`,
              name: 'getWeather',
            },
          ]);
          for (const choice of contentChoiceDeltas(`it's raining`)) {
            yield {
              id: '2',
              choices: [choice],
              created: Math.floor(Date.now() / 1000),
              model: 'gpt-3.5-turbo',
              object: 'chat.completion',
            };
          }
        }),
        runner.done(),
      ]);

      expect(listener.eventMessages).toEqual([
        { role: 'assistant', content: null, function_call: { name: 'getWeather', arguments: '' } },
        { role: 'function', content: `it's raining`, name: 'getWeather' },
        { role: 'assistant', content: "it's raining" },
      ]);
      expect(listener.eventFunctionCallResults).toEqual([`it's raining`]);
      await listener.sanityCheck();
    });
    test('flow with abort', async () => {
      const { fetch, handleRequest } = mockStreamingChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const controller = new AbortController();
      const runner = openai.beta.chat.completions.runFunctions(
        {
          stream: true,
          messages: [{ role: 'user', content: 'tell me what the weather is like' }],
          model: 'gpt-3.5-turbo',
          functions: [
            {
              function: function getWeather() {
                return `it's raining`;
              },
              parameters: {},
              description: 'gets the weather',
            },
          ],
        },
        { signal: controller.signal },
      );
      runner.on('functionCallResult', () => controller.abort());
      const listener = new StreamingRunnerListener(runner);

      await handleRequest(async function* (request): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
        expect(request.messages).toEqual([{ role: 'user', content: 'tell me what the weather is like' }]);
        yield {
          id: '1',
          choices: [
            {
              index: 0,
              finish_reason: 'function_call',
              delta: {
                role: 'assistant',
                content: null,
                function_call: {
                  arguments: '',
                  name: 'getWeather',
                },
              },
            },
          ],
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-3.5-turbo',
          object: 'chat.completion',
        };
      });

      await runner.done().catch(() => {});

      expect(listener.eventMessages).toEqual([
        { role: 'assistant', content: null, function_call: { name: 'getWeather', arguments: '' } },
        { role: 'function', content: `it's raining`, name: 'getWeather' },
      ]);
      expect(listener.eventFunctionCallResults).toEqual([`it's raining`]);
      await listener.sanityCheck({ error: 'Request was aborted.' });
      expect(runner.aborted).toBe(true);
    });
    test('successful flow with parse', async () => {
      const { fetch, handleRequest } = mockStreamingChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const runner = openai.beta.chat.completions.runFunctions({
        stream: true,
        messages: [
          {
            role: 'user',
            content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
          },
        ],
        model: 'gpt-3.5-turbo',
        functions: [
          new ParsingFunction({
            name: 'numProperties',
            function: (obj: object) => String(Object.keys(obj).length),
            parameters: { type: 'object' },
            parse: (str: string): object => {
              const result = JSON.parse(str);
              if (!(result instanceof Object) || Array.isArray(result)) {
                throw new Error('must be an object');
              }
              return result;
            },
            description: 'gets the number of properties on an object',
          }),
        ],
      });
      const listener = new StreamingRunnerListener(runner);

      await Promise.all([
        handleRequest(async function* (request): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
          expect(request.messages).toEqual([
            {
              role: 'user',
              content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
            },
          ]);
          yield {
            id: '1',
            choices: [
              {
                index: 0,
                finish_reason: 'function_call',
                delta: {
                  role: 'assistant',
                  content: null,
                  function_call: {
                    arguments: '{"a": 1, "b": 2, "c": 3}',
                    name: 'numProperties',
                  },
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
          };
        }),
        handleRequest(async function* (request): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
          expect(request.messages).toEqual([
            {
              role: 'user',
              content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
            },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '{"a": 1, "b": 2, "c": 3}',
                name: 'numProperties',
              },
            },
            {
              role: 'function',
              content: '3',
              name: 'numProperties',
            },
          ]);
          for (const choice of contentChoiceDeltas(`there are 3 properties in {"a": 1, "b": 2, "c": 3}`)) {
            yield {
              id: '2',
              choices: [choice],
              created: Math.floor(Date.now() / 1000),
              model: 'gpt-3.5-turbo',
              object: 'chat.completion',
            };
          }
        }),
        runner.done(),
      ]);

      expect(listener.eventMessages).toEqual([
        {
          role: 'assistant',
          content: null,
          function_call: { name: 'numProperties', arguments: '{"a": 1, "b": 2, "c": 3}' },
        },
        { role: 'function', content: '3', name: 'numProperties' },
        { role: 'assistant', content: 'there are 3 properties in {"a": 1, "b": 2, "c": 3}' },
      ]);
      expect(listener.eventFunctionCallResults).toEqual(['3']);
      await listener.sanityCheck();
    });
    test('flow with parse error', async () => {
      const { fetch, handleRequest } = mockStreamingChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const runner = openai.beta.chat.completions.runFunctions({
        stream: true,
        messages: [
          {
            role: 'user',
            content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
          },
        ],
        model: 'gpt-3.5-turbo',
        functions: [
          new ParsingFunction({
            name: 'numProperties',
            function: (obj: object) => String(Object.keys(obj).length),
            parameters: { type: 'object' },
            parse: (str: string): object => {
              const result = JSON.parse(str);
              if (!(result instanceof Object) || Array.isArray(result)) {
                throw new Error('must be an object');
              }
              return result;
            },
            description: 'gets the number of properties on an object',
          }),
        ],
      });
      const listener = new StreamingRunnerListener(runner);

      await Promise.all([
        handleRequest(async function* (request): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
          expect(request.messages).toEqual([
            {
              role: 'user',
              content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
            },
          ]);
          for (const choice of functionCallDeltas('[{"a": 1, "b": 2, "c": 3}]', { name: 'numProperties' })) {
            yield {
              id: '1',
              choices: [choice],
              created: Math.floor(Date.now() / 1000),
              model: 'gpt-3.5-turbo',
              object: 'chat.completion',
            };
          }
        }),
        handleRequest(async function* (request): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
          expect(request.messages).toEqual([
            {
              role: 'user',
              content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
            },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '[{"a": 1, "b": 2, "c": 3}]',
                name: 'numProperties',
              },
            },
            {
              role: 'function',
              content: `must be an object`,
              name: 'numProperties',
            },
          ]);
          for (const choice of functionCallDeltas('{"a": 1, "b": 2, "c": 3}', { name: 'numProperties' })) {
            yield {
              id: '2',
              choices: [choice],
              created: Math.floor(Date.now() / 1000),
              model: 'gpt-3.5-turbo',
              object: 'chat.completion',
            };
          }
        }),
        handleRequest(async function* (request): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
          expect(request.messages).toEqual([
            {
              role: 'user',
              content: 'can you tell me how many properties are in {"a": 1, "b": 2, "c": 3}',
            },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '[{"a": 1, "b": 2, "c": 3}]',
                name: 'numProperties',
              },
            },
            {
              role: 'function',
              content: `must be an object`,
              name: 'numProperties',
            },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '{"a": 1, "b": 2, "c": 3}',
                name: 'numProperties',
              },
            },
            {
              role: 'function',
              content: '3',
              name: 'numProperties',
            },
          ]);
          for (const choice of contentChoiceDeltas(`there are 3 properties in {"a": 1, "b": 2, "c": 3}`)) {
            yield {
              id: '3',
              choices: [choice],
              created: Math.floor(Date.now() / 1000),
              model: 'gpt-3.5-turbo',
              object: 'chat.completion',
            };
          }
        }),
        runner.done(),
      ]);

      expect(listener.eventMessages).toEqual([
        {
          role: 'assistant',
          content: null,
          function_call: { name: 'numProperties', arguments: '[{"a": 1, "b": 2, "c": 3}]' },
        },
        { role: 'function', content: `must be an object`, name: 'numProperties' },
        {
          role: 'assistant',
          content: null,
          function_call: { name: 'numProperties', arguments: '{"a": 1, "b": 2, "c": 3}' },
        },
        { role: 'function', content: '3', name: 'numProperties' },
        { role: 'assistant', content: 'there are 3 properties in {"a": 1, "b": 2, "c": 3}' },
      ]);
      expect(listener.eventFunctionCallResults).toEqual([`must be an object`, '3']);
      await listener.sanityCheck();
    });
    test('single function call', async () => {
      const { fetch, handleRequest } = mockStreamingChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const runner = openai.beta.chat.completions.runFunctions({
        stream: true,
        messages: [{ role: 'user', content: 'tell me what the weather is like' }],
        model: 'gpt-3.5-turbo',
        function_call: {
          name: 'getWeather',
        },
        functions: [
          {
            function: function getWeather() {
              return `it's raining`;
            },
            parameters: {},
            description: 'gets the weather',
          },
        ],
      });
      const listener = new StreamingRunnerListener(runner);

      await Promise.all([
        handleRequest(async function* (request): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
          expect(request.messages).toEqual([{ role: 'user', content: 'tell me what the weather is like' }]);
          yield {
            id: '1',
            choices: [
              {
                index: 0,
                finish_reason: 'function_call',
                delta: {
                  role: 'assistant',
                  content: null,
                  function_call: {
                    arguments: '',
                    name: 'getWeather',
                  },
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
          };
        }),
        runner.done(),
      ]);

      expect(listener.eventMessages).toEqual([
        { role: 'assistant', content: null, function_call: { name: 'getWeather', arguments: '' } },
        { role: 'function', content: `it's raining`, name: 'getWeather' },
      ]);
      expect(listener.eventFunctionCallResults).toEqual([`it's raining`]);
      await listener.sanityCheck();
    });
    test('wrong function name', async () => {
      const { fetch, handleRequest } = mockStreamingChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const runner = openai.beta.chat.completions.runFunctions({
        stream: true,
        messages: [{ role: 'user', content: 'tell me what the weather is like' }],
        model: 'gpt-3.5-turbo',
        functions: [
          {
            function: function getWeather() {
              return `it's raining`;
            },
            parameters: {},
            description: 'gets the weather',
          },
        ],
      });
      const listener = new StreamingRunnerListener(runner);

      await Promise.all([
        handleRequest(async function* (request): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
          expect(request.messages).toEqual([{ role: 'user', content: 'tell me what the weather is like' }]);
          yield {
            id: '1',
            choices: [
              {
                index: 0,
                finish_reason: 'function_call',
                delta: {
                  role: 'assistant',
                  content: null,
                  function_call: {
                    arguments: '',
                    name: 'get_weather',
                  },
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
          };
        }),
        handleRequest(async function* (request): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
          expect(request.messages).toEqual([
            { role: 'user', content: 'tell me what the weather is like' },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '',
                name: 'get_weather',
              },
            },
            {
              role: 'function',
              content: `Invalid function_call: "get_weather". Available options are: "getWeather". Please try again`,
              name: 'get_weather',
            },
          ]);
          yield {
            id: '2',
            choices: [
              {
                index: 0,
                finish_reason: 'function_call',
                delta: {
                  role: 'assistant',
                  content: null,
                  function_call: {
                    arguments: '',
                    name: 'getWeather',
                  },
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
          };
        }),
        handleRequest(async function* (request): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
          expect(request.messages).toEqual([
            { role: 'user', content: 'tell me what the weather is like' },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '',
                name: 'get_weather',
              },
            },
            {
              role: 'function',
              content: `Invalid function_call: "get_weather". Available options are: "getWeather". Please try again`,
              name: 'get_weather',
            },
            {
              role: 'assistant',
              content: null,
              function_call: {
                arguments: '',
                name: 'getWeather',
              },
            },
            {
              role: 'function',
              content: `it's raining`,
              name: 'getWeather',
            },
          ]);
          for (const choice of contentChoiceDeltas(`it's raining`)) {
            yield {
              id: '3',
              choices: [choice],
              created: Math.floor(Date.now() / 1000),
              model: 'gpt-3.5-turbo',
              object: 'chat.completion',
            };
          }
        }),
        runner.done(),
      ]);

      expect(listener.eventMessages).toEqual([
        { role: 'assistant', content: null, function_call: { name: 'get_weather', arguments: '' } },
        {
          role: 'function',
          content: `Invalid function_call: "get_weather". Available options are: "getWeather". Please try again`,
          name: 'get_weather',
        },
        { role: 'assistant', content: null, function_call: { name: 'getWeather', arguments: '' } },
        { role: 'function', content: `it's raining`, name: 'getWeather' },
        { role: 'assistant', content: "it's raining" },
      ]);
      expect(listener.eventFunctionCallResults).toEqual([
        `Invalid function_call: "get_weather". Available options are: "getWeather". Please try again`,
        `it's raining`,
      ]);
      await listener.sanityCheck();
    });
    test('wrong function name with single function call', async () => {
      const { fetch, handleRequest } = mockStreamingChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const runner = openai.beta.chat.completions.runFunctions({
        stream: true,
        messages: [{ role: 'user', content: 'tell me what the weather is like' }],
        model: 'gpt-3.5-turbo',
        function_call: {
          name: 'getWeather',
        },
        functions: [
          {
            function: function getWeather() {
              return `it's raining`;
            },
            parameters: {},
            description: 'gets the weather',
          },
        ],
      });
      const listener = new StreamingRunnerListener(runner);

      await Promise.all([
        handleRequest(async function* (request): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
          expect(request.messages).toEqual([{ role: 'user', content: 'tell me what the weather is like' }]);
          yield {
            id: '1',
            choices: [
              {
                index: 0,
                finish_reason: 'function_call',
                delta: {
                  role: 'assistant',
                  content: null,
                  function_call: {
                    arguments: '',
                    name: 'get_weather',
                  },
                },
              },
            ],
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-3.5-turbo',
            object: 'chat.completion',
          };
        }),
        runner.done(),
      ]);

      expect(listener.eventMessages).toEqual([
        { role: 'assistant', content: null, function_call: { name: 'get_weather', arguments: '' } },
        {
          role: 'function',
          content: `Invalid function_call: "get_weather". Available options are: "getWeather". Please try again`,
          name: 'get_weather',
        },
      ]);
      expect(listener.eventFunctionCallResults).toEqual([
        `Invalid function_call: "get_weather". Available options are: "getWeather". Please try again`,
      ]);
      await listener.sanityCheck();
    });
  });
  describe('stream', () => {
    test('successful flow', async () => {
      const { fetch, handleRequest } = mockStreamingChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const runner = openai.beta.chat.completions.stream({
        stream: true,
        messages: [{ role: 'user', content: 'tell me what the weather is like' }],
        model: 'gpt-3.5-turbo',
      });

      const listener = new StreamingRunnerListener(runner);

      await Promise.all([
        handleRequest(async function* (request): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
          expect(request.messages).toEqual([{ role: 'user', content: 'tell me what the weather is like' }]);
          for (const choice of contentChoiceDeltas(`The weather is great today!`)) {
            yield {
              id: '1',
              choices: [choice],
              created: Math.floor(Date.now() / 1000),
              model: 'gpt-3.5-turbo',
              object: 'chat.completion',
            };
          }
        }),
        runner.done(),
      ]);

      expect(listener.finalMessage).toEqual({ role: 'assistant', content: 'The weather is great today!' });
      await listener.sanityCheck();
    });
    test('toReadableStream and fromReadableStream', async () => {
      const { fetch, handleRequest } = mockStreamingChatCompletionFetch();

      const openai = new OpenAI({ apiKey: 'something1234', baseURL: 'http://127.0.0.1:4010', fetch });

      const runner = openai.beta.chat.completions.stream({
        stream: true,
        messages: [{ role: 'user', content: 'tell me what the weather is like' }],
        model: 'gpt-3.5-turbo',
      });

      const proxied = ChatCompletionStreamingRunner.fromReadableStream(runner.toReadableStream());
      const listener = new StreamingRunnerListener(proxied);

      await Promise.all([
        handleRequest(async function* (request): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
          expect(request.messages).toEqual([{ role: 'user', content: 'tell me what the weather is like' }]);
          for (const choice of contentChoiceDeltas(`The weather is great today!`)) {
            yield {
              id: '1',
              choices: [choice],
              created: Math.floor(Date.now() / 1000),
              model: 'gpt-3.5-turbo',
              object: 'chat.completion',
            };
          }
        }),
        proxied.done(),
      ]);

      expect(listener.finalMessage).toEqual({ role: 'assistant', content: 'The weather is great today!' });
      await listener.sanityCheck();
    });
  });
});
