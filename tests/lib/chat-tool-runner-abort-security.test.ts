import { vi } from 'vitest';
import OpenAI from 'openai';
import { APIUserAbortError } from 'openai/error';

import { mockFetch } from '../utils/mock-fetch';

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
  let complete!: (value: Value) => void;
  // oxlint-disable-next-line promise/avoid-new -- Deferred gates reproduce callbacks already in progress.
  const promise = new Promise<Value>((resolve) => {
    complete = resolve;
  });

  return { promise, resolve: complete };
}

function toolCall(name: string, id = name) {
  return {
    id,
    type: 'function' as const,
    function: { name, arguments: '{"amount":10000}' },
  };
}

function clientWithToolCalls(streaming: boolean, calls: ReturnType<typeof toolCall>[]) {
  const { fetch, handleRequest } = mockFetch();
  const client = new OpenAI({
    apiKey: 'synthetic-api-key',
    baseURL: 'https://example.invalid/v1',
    maxRetries: 0,
    fetch,
  });

  const respond = () =>
    handleRequest(async () => {
      if (streaming) {
        const chunk = {
          id: 'chatcmpl-abort-test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              finish_reason: 'tool_calls',
              logprobs: null,
              delta: {
                role: 'assistant',
                content: null,
                tool_calls: calls.map((call, index) => ({ ...call, index })),
              },
            },
          ],
        };

        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      return Response.json({
        id: 'chatcmpl-abort-test',
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o-mini',
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            logprobs: null,
            message: {
              role: 'assistant',
              content: null,
              refusal: null,
              tool_calls: calls,
            },
          },
        ],
      });
    });

  return { client, respond };
}

describe.each([
  { label: 'non-streaming', streaming: false },
  { label: 'streaming', streaming: true },
])('$label public chat completion tool runners', ({ streaming }) => {
  test.each(['external signal', 'runner.abort'] as const)(
    'never starts a privileged callback after %s interrupts asynchronous parsing',
    async (abortMethod) => {
      const { client, respond } = clientWithToolCalls(streaming, [toolCall('transferFunds')]);
      const controller = new AbortController();
      const parsingStarted = deferred<boolean>();
      const parsing = deferred<{ amount: number }>();
      const transferFunds = vi.fn(() => 'transferred');
      const params = {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user' as const, content: 'transfer funds' }],
        tools: [
          {
            type: 'function' as const,
            function: {
              name: 'transferFunds',
              description: 'Transfers money from the current account',
              parameters: { type: 'object' as const },
              parse: async (_arguments: string) => {
                parsingStarted.resolve(true);
                return parsing.promise;
              },
              function: transferFunds,
            },
          },
        ],
      };
      const options = { signal: controller.signal };
      const runner = streaming
        ? client.chat.completions.runTools({ ...params, stream: true }, options)
        : client.chat.completions.runTools({ ...params, stream: false }, options);
      const onAbort = vi.fn();
      runner.controller.signal.addEventListener('abort', onAbort, { once: true });

      await respond();
      await parsingStarted.promise;

      if (abortMethod === 'external signal') {
        controller.abort();
      } else {
        runner.abort();
      }
      parsing.resolve({ amount: 10_000 });

      await expect(runner.done()).rejects.toBeInstanceOf(APIUserAbortError);
      expect(transferFunds).not.toHaveBeenCalled();
      expect(onAbort).toHaveBeenCalledTimes(1);
      expect(runner.aborted).toBe(true);
    },
  );

  test.each(['external signal', 'runner.abort'] as const)(
    'never starts the next sequential privileged callback after %s',
    async (abortMethod) => {
      const { client, respond } = clientWithToolCalls(streaming, [
        toolCall('readBalance', 'first-call'),
        toolCall('transferFunds', 'second-call'),
      ]);
      const controller = new AbortController();
      const firstStarted = deferred<boolean>();
      const firstResult = deferred<string>();
      const transferFunds = vi.fn(() => 'transferred');
      const params = {
        model: 'gpt-4o-mini',
        parallel_tool_calls: false,
        messages: [{ role: 'user' as const, content: 'read balance and transfer funds' }],
        tools: [
          {
            type: 'function' as const,
            function: {
              name: 'readBalance',
              description: 'Reads the current balance',
              parameters: { type: 'object' as const },
              function: async () => {
                firstStarted.resolve(true);
                return firstResult.promise;
              },
            },
          },
          {
            type: 'function' as const,
            function: {
              name: 'transferFunds',
              description: 'Transfers money from the current account',
              parameters: { type: 'object' as const },
              function: transferFunds,
            },
          },
        ],
      };
      const options = { signal: controller.signal };
      const runner = streaming
        ? client.chat.completions.runTools({ ...params, stream: true }, options)
        : client.chat.completions.runTools({ ...params, stream: false }, options);

      await respond();
      await firstStarted.promise;

      if (abortMethod === 'external signal') {
        controller.abort();
      } else {
        runner.abort();
      }
      firstResult.resolve('balance already read');

      await expect(runner.done()).rejects.toBeInstanceOf(APIUserAbortError);
      expect(transferFunds).not.toHaveBeenCalled();
      expect(runner.messages).toContainEqual({
        role: 'tool',
        tool_call_id: 'first-call',
        content: 'balance already read',
      });
    },
  );

  if (!streaming) {
    test('preserves only the first immediate callback from an already-buffered cancelled turn', async () => {
      const { client, respond } = clientWithToolCalls(false, [
        toolCall('readBalance', 'first-call'),
        toolCall('transferFunds', 'second-call'),
      ]);
      const controller = new AbortController();
      const readBalance = vi.fn(() => 'balance already read');
      const transferFunds = vi.fn(() => 'transferred');
      const runner = client.chat.completions.runTools(
        {
          model: 'gpt-4o-mini',
          parallel_tool_calls: false,
          messages: [{ role: 'user', content: 'read balance and transfer funds' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'readBalance',
                description: 'Reads the current balance',
                parameters: { type: 'object' },
                function: readBalance,
              },
            },
            {
              type: 'function',
              function: {
                name: 'transferFunds',
                description: 'Transfers money from the current account',
                parameters: { type: 'object' },
                function: transferFunds,
              },
            },
          ],
        },
        { signal: controller.signal },
      );

      runner.on('message', (message) => {
        if (message.role === 'assistant') {
          controller.abort();
        }
      });
      await respond();

      await expect(runner.done()).rejects.toBeInstanceOf(APIUserAbortError);
      expect(readBalance).toHaveBeenCalledTimes(1);
      expect(transferFunds).not.toHaveBeenCalled();
      expect(runner.messages).toContainEqual({
        role: 'tool',
        tool_call_id: 'first-call',
        content: 'balance already read',
      });
    });

    test('never treats a response awaiting delivery as an already-buffered cancelled turn', async () => {
      const { client, respond } = clientWithToolCalls(false, [toolCall('transferFunds')]);
      const controller = new AbortController();
      const transferFunds = vi.fn(() => 'transferred');
      const runner = client.chat.completions.runTools(
        {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'transfer funds' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'transferFunds',
                description: 'Transfers money from the current account',
                parameters: { type: 'object' },
                function: transferFunds,
              },
            },
          ],
        },
        { signal: controller.signal, maxChatCompletions: 1 },
      );

      await respond();
      controller.abort();

      await expect(runner.done()).rejects.toBeInstanceOf(APIUserAbortError);
      expect(transferFunds).not.toHaveBeenCalled();
      expect(runner.aborted).toBe(true);
    });

    test('never extends buffered-turn compatibility to a delayed parsed callback', async () => {
      const { client, respond } = clientWithToolCalls(false, [toolCall('transferFunds')]);
      const controller = new AbortController();
      const parsingStarted = deferred<boolean>();
      const parsing = deferred<{ amount: number }>();
      const transferFunds = vi.fn(() => 'transferred');
      const runner = client.chat.completions.runTools(
        {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'transfer funds' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'transferFunds',
                description: 'Transfers money from the current account',
                parameters: { type: 'object' },
                parse: async (_arguments: string) => {
                  parsingStarted.resolve(true);
                  return parsing.promise;
                },
                function: transferFunds,
              },
            },
          ],
        },
        { signal: controller.signal },
      );

      await respond();
      controller.abort();
      await parsingStarted.promise;
      parsing.resolve({ amount: 10_000 });

      await expect(runner.done()).rejects.toBeInstanceOf(APIUserAbortError);
      expect(transferFunds).not.toHaveBeenCalled();
    });
  }

  if (streaming) {
    test('preserves only one immediate callback from an already-buffered cancelled streaming turn', async () => {
      const { client, respond } = clientWithToolCalls(true, [
        toolCall('readBalance', 'first-call'),
        toolCall('transferFunds', 'second-call'),
      ]);
      const controller = new AbortController();
      const readBalance = vi.fn(() => 'balance already read');
      const transferFunds = vi.fn(() => 'transferred');
      const runner = client.chat.completions.runTools(
        {
          stream: true,
          model: 'gpt-4o-mini',
          parallel_tool_calls: false,
          messages: [{ role: 'user', content: 'read balance and transfer funds' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'readBalance',
                description: 'Reads the current balance',
                parameters: { type: 'object' },
                function: readBalance,
              },
            },
            {
              type: 'function',
              function: {
                name: 'transferFunds',
                description: 'Transfers money from the current account',
                parameters: { type: 'object' },
                function: transferFunds,
              },
            },
          ],
        },
        { signal: controller.signal },
      );

      runner.on('message', (message) => {
        if (message.role === 'assistant') {
          controller.abort();
        }
      });
      await respond();

      await expect(runner.done()).rejects.toBeInstanceOf(APIUserAbortError);
      expect(readBalance).toHaveBeenCalledTimes(1);
      expect(transferFunds).not.toHaveBeenCalled();
      expect(runner.messages).toContainEqual({
        role: 'tool',
        tool_call_id: 'first-call',
        content: 'balance already read',
      });
    });

    test('never extends buffered-streaming-turn compatibility to a delayed parsed callback', async () => {
      const { client, respond } = clientWithToolCalls(true, [toolCall('transferFunds')]);
      const controller = new AbortController();
      const parsingStarted = deferred<boolean>();
      const parsing = deferred<{ amount: number }>();
      const transferFunds = vi.fn(() => 'transferred');
      const runner = client.chat.completions.runTools(
        {
          stream: true,
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'transfer funds' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'transferFunds',
                description: 'Transfers money from the current account',
                parameters: { type: 'object' },
                parse: async (_arguments: string) => {
                  parsingStarted.resolve(true);
                  return parsing.promise;
                },
                function: transferFunds,
              },
            },
          ],
        },
        { signal: controller.signal },
      );

      runner.on('message', (message) => {
        if (message.role === 'assistant') {
          controller.abort();
        }
      });
      await respond();
      await parsingStarted.promise;
      parsing.resolve({ amount: 10_000 });

      await expect(runner.done()).rejects.toBeInstanceOf(APIUserAbortError);
      expect(transferFunds).not.toHaveBeenCalled();
    });
  }

  test('retains the result of a privileged callback that already started before cancellation', async () => {
    const { client, respond } = clientWithToolCalls(streaming, [toolCall('readBalance')]);
    const controller = new AbortController();
    const started = deferred<boolean>();
    const result = deferred<string>();
    const readBalance = vi.fn(async () => {
      started.resolve(true);
      return result.promise;
    });
    const params = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user' as const, content: 'read the current balance' }],
      tools: [
        {
          type: 'function' as const,
          function: {
            name: 'readBalance',
            description: 'Reads the current balance',
            parameters: { type: 'object' as const },
            function: readBalance,
          },
        },
      ],
    };
    const options = { signal: controller.signal };
    const runner = streaming
      ? client.chat.completions.runTools({ ...params, stream: true }, options)
      : client.chat.completions.runTools({ ...params, stream: false }, options);

    await respond();
    await started.promise;
    controller.abort();
    result.resolve('balance already read');

    await expect(runner.done()).rejects.toBeInstanceOf(APIUserAbortError);
    expect(readBalance).toHaveBeenCalledTimes(1);
    expect(runner.messages).toContainEqual({
      role: 'tool',
      tool_call_id: 'readBalance',
      content: 'balance already read',
    });
  });

  test('waits for already-running parallel callbacks while blocking newly parsed callbacks', async () => {
    const { client, respond } = clientWithToolCalls(streaming, [
      toolCall('readBalance', 'first-call'),
      toolCall('transferFunds', 'second-call'),
    ]);
    const controller = new AbortController();
    const firstStarted = deferred<boolean>();
    const firstResult = deferred<string>();
    const parsingStarted = deferred<boolean>();
    const parsing = deferred<{ amount: number }>();
    const transferFunds = vi.fn(() => 'transferred');
    const params = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user' as const, content: 'read balance and transfer funds' }],
      tools: [
        {
          type: 'function' as const,
          function: {
            name: 'readBalance',
            description: 'Reads the current balance',
            parameters: { type: 'object' as const },
            function: async () => {
              firstStarted.resolve(true);
              return firstResult.promise;
            },
          },
        },
        {
          type: 'function' as const,
          function: {
            name: 'transferFunds',
            description: 'Transfers money from the current account',
            parameters: { type: 'object' as const },
            parse: async (_arguments: string) => {
              parsingStarted.resolve(true);
              return parsing.promise;
            },
            function: transferFunds,
          },
        },
      ],
    };
    const options = { signal: controller.signal };
    const runner = streaming
      ? client.chat.completions.runTools({ ...params, stream: true }, options)
      : client.chat.completions.runTools({ ...params, stream: false }, options);

    await respond();
    await Promise.all([firstStarted.promise, parsingStarted.promise]);
    controller.abort();
    parsing.resolve({ amount: 10_000 });

    let settled = false;
    const done = runner.done().finally(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    firstResult.resolve('balance already read');
    await expect(done).rejects.toBeInstanceOf(APIUserAbortError);
    expect(transferFunds).not.toHaveBeenCalled();
    expect(runner.messages).toContainEqual({
      role: 'tool',
      tool_call_id: 'first-call',
      content: 'balance already read',
    });
  });

  test('never starts a callback when an abort-ignoring transport resolves after cancellation', async () => {
    const controller = new AbortController();
    const fetchStarted = deferred<boolean>();
    const responseReady = deferred<boolean>();
    const transferFunds = vi.fn(() => 'transferred');
    const calls = [toolCall('transferFunds')];
    const fetch = vi.fn(async (_input: unknown, _init?: unknown) => {
      fetchStarted.resolve(true);
      await responseReady.promise;

      if (streaming) {
        const chunk = {
          id: 'chatcmpl-late-abort-test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              finish_reason: 'tool_calls',
              logprobs: null,
              delta: {
                role: 'assistant',
                content: null,
                tool_calls: calls.map((call, index) => ({ ...call, index })),
              },
            },
          ],
        };

        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      return Response.json({
        id: 'chatcmpl-late-abort-test',
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o-mini',
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            logprobs: null,
            message: {
              role: 'assistant',
              content: null,
              refusal: null,
              tool_calls: calls,
            },
          },
        ],
      });
    });
    const client = new OpenAI({
      apiKey: 'synthetic-api-key',
      baseURL: 'https://example.invalid/v1',
      maxRetries: 0,
      fetch,
    });
    const params = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user' as const, content: 'transfer funds' }],
      tools: [
        {
          type: 'function' as const,
          function: {
            name: 'transferFunds',
            description: 'Transfers money from the current account',
            parameters: { type: 'object' as const },
            function: transferFunds,
          },
        },
      ],
    };
    const options = { signal: controller.signal, maxChatCompletions: 1 };
    const runner = streaming
      ? client.chat.completions.runTools({ ...params, stream: true }, options)
      : client.chat.completions.runTools({ ...params, stream: false }, options);

    await fetchStarted.promise;
    controller.abort();
    responseReady.resolve(true);

    await expect(runner.done()).rejects.toBeInstanceOf(APIUserAbortError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(transferFunds).not.toHaveBeenCalled();
    expect(runner.aborted).toBe(true);
  });

  test('surfaces cancellation when an in-flight tool parser rejects after abort', async () => {
    const { client, respond } = clientWithToolCalls(streaming, [toolCall('transferFunds')]);
    const controller = new AbortController();
    const parsingStarted = deferred<boolean>();
    const parsingReady = deferred<boolean>();
    const afterCompletion = vi.fn();
    const transferFunds = vi.fn(() => 'transferred');
    const params = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user' as const, content: 'transfer funds' }],
      tools: [
        {
          type: 'function' as const,
          function: {
            name: 'transferFunds',
            description: 'Transfers money from the current account',
            parameters: { type: 'object' as const },
            parse: async (_arguments: string): Promise<{ amount: number }> => {
              parsingStarted.resolve(true);
              await parsingReady.promise;
              throw new Error('safe delayed validation failure');
            },
            function: transferFunds,
          },
        },
      ],
    };
    const options = {
      signal: controller.signal,
      maxChatCompletions: 1,
      afterCompletion,
    };
    const runner = streaming
      ? client.chat.completions.runTools({ ...params, stream: true }, options)
      : client.chat.completions.runTools({ ...params, stream: false }, options);

    await respond();
    await parsingStarted.promise;
    controller.abort();
    parsingReady.resolve(true);

    await expect(runner.done()).rejects.toBeInstanceOf(APIUserAbortError);
    expect(transferFunds).not.toHaveBeenCalled();
    expect(afterCompletion).not.toHaveBeenCalled();
    expect(runner.aborted).toBe(true);
  });

  test.each([
    { label: 'final parallel iteration', parallelToolCalls: true, forcedToolChoice: false },
    { label: 'final sequential iteration', parallelToolCalls: false, forcedToolChoice: false },
    { label: 'forced single-function tool choice', parallelToolCalls: false, forcedToolChoice: true },
  ])(
    'surfaces cancellation during the $label after preserving its completed result',
    async ({ parallelToolCalls, forcedToolChoice }) => {
      const { client, respond } = clientWithToolCalls(streaming, [toolCall('readBalance')]);
      const controller = new AbortController();
      const callbackStarted = deferred<boolean>();
      const callbackResult = deferred<string>();
      const afterCompletion = vi.fn();
      const readBalance = vi.fn(async () => {
        callbackStarted.resolve(true);
        return callbackResult.promise;
      });
      const params = {
        model: 'gpt-4o-mini',
        parallel_tool_calls: parallelToolCalls,
        ...(forcedToolChoice
          ? { tool_choice: { type: 'function' as const, function: { name: 'readBalance' } } }
          : {}),
        messages: [{ role: 'user' as const, content: 'read the current balance' }],
        tools: [
          {
            type: 'function' as const,
            function: {
              name: 'readBalance',
              description: 'Reads the current balance',
              parameters: { type: 'object' as const },
              function: readBalance,
            },
          },
        ],
      };
      const options = {
        signal: controller.signal,
        maxChatCompletions: 1,
        afterCompletion,
      };
      const runner = streaming
        ? client.chat.completions.runTools({ ...params, stream: true }, options)
        : client.chat.completions.runTools({ ...params, stream: false }, options);

      await respond();
      await callbackStarted.promise;
      controller.abort();
      callbackResult.resolve('balance already read');

      await expect(runner.done()).rejects.toBeInstanceOf(APIUserAbortError);
      expect(readBalance).toHaveBeenCalledTimes(1);
      expect(runner.messages).toContainEqual({
        role: 'tool',
        tool_call_id: 'readBalance',
        content: 'balance already read',
      });
      expect(afterCompletion).not.toHaveBeenCalled();
      expect(runner.aborted).toBe(true);
    },
  );

  test('retains every completed parallel callback in input order when another callback is cancelled', async () => {
    const { client, respond } = clientWithToolCalls(streaming, [
      toolCall('readFirstAccount', 'first-call'),
      toolCall('readSecondAccount', 'second-call'),
      toolCall('transferFunds', 'third-call'),
    ]);
    const controller = new AbortController();
    const firstStarted = deferred<boolean>();
    const secondStarted = deferred<boolean>();
    const parsingStarted = deferred<boolean>();
    const firstResult = deferred<string>();
    const secondResult = deferred<string>();
    const parsing = deferred<{ amount: number }>();
    const transferFunds = vi.fn(() => 'transferred');
    const completionOrder: string[] = [];
    const params = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user' as const, content: 'read both accounts and transfer funds' }],
      tools: [
        {
          type: 'function' as const,
          function: {
            name: 'readFirstAccount',
            description: 'Reads the first account balance',
            parameters: { type: 'object' as const },
            function: async () => {
              firstStarted.resolve(true);
              const result = await firstResult.promise;
              completionOrder.push('first');
              return result;
            },
          },
        },
        {
          type: 'function' as const,
          function: {
            name: 'readSecondAccount',
            description: 'Reads the second account balance',
            parameters: { type: 'object' as const },
            function: async () => {
              secondStarted.resolve(true);
              const result = await secondResult.promise;
              completionOrder.push('second');
              return result;
            },
          },
        },
        {
          type: 'function' as const,
          function: {
            name: 'transferFunds',
            description: 'Transfers money from the current account',
            parameters: { type: 'object' as const },
            parse: async (_arguments: string) => {
              parsingStarted.resolve(true);
              return parsing.promise;
            },
            function: transferFunds,
          },
        },
      ],
    };
    const options = { signal: controller.signal, maxChatCompletions: 1 };
    const runner = streaming
      ? client.chat.completions.runTools({ ...params, stream: true }, options)
      : client.chat.completions.runTools({ ...params, stream: false }, options);

    await respond();
    await Promise.all([firstStarted.promise, secondStarted.promise, parsingStarted.promise]);
    controller.abort();
    parsing.resolve({ amount: 10_000 });
    secondResult.resolve('second balance already read');
    await Promise.resolve();
    firstResult.resolve('first balance already read');

    await expect(runner.done()).rejects.toBeInstanceOf(APIUserAbortError);
    expect(completionOrder).toEqual(['second', 'first']);
    expect(transferFunds).not.toHaveBeenCalled();
    expect(runner.messages.filter((message) => message.role === 'tool')).toEqual([
      {
        role: 'tool',
        tool_call_id: 'first-call',
        content: 'first balance already read',
      },
      {
        role: 'tool',
        tool_call_id: 'second-call',
        content: 'second balance already read',
      },
    ]);
    expect(runner.aborted).toBe(true);
  });

  test('preserves successful tool context, result ordering, and afterCompletion', async () => {
    const { client, respond } = clientWithToolCalls(streaming, [toolCall('readBalance')]);
    const toolContext = { accountId: 'account_123' };
    const afterCompletion = vi.fn();
    const readBalance = vi.fn(
      (_arguments: string, _runner: unknown, context: typeof toolContext) => context.accountId,
    );
    const params = {
      model: 'gpt-4o-mini',
      toolContext,
      messages: [{ role: 'user' as const, content: 'read the current balance' }],
      tools: [
        {
          type: 'function' as const,
          function: {
            name: 'readBalance',
            description: 'Reads the current balance',
            parameters: { type: 'object' as const },
            function: readBalance,
          },
        },
      ],
    };
    const options = { maxChatCompletions: 1, afterCompletion };
    const runner = streaming
      ? client.chat.completions.runTools({ ...params, stream: true }, options)
      : client.chat.completions.runTools({ ...params, stream: false }, options);

    await respond();
    await expect(runner.done()).resolves.toBeUndefined();
    expect(readBalance).toHaveBeenCalledTimes(1);
    expect(runner.messages).toContainEqual({
      role: 'tool',
      tool_call_id: 'readBalance',
      content: 'account_123',
    });
    expect(afterCompletion).toHaveBeenCalledTimes(1);
  });

  test('preserves parser failures as ordinary tool-feedback messages without invoking callbacks', async () => {
    const { client, respond } = clientWithToolCalls(streaming, [toolCall('transferFunds')]);
    const transferFunds = vi.fn(() => 'transferred');
    const params = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user' as const, content: 'transfer funds' }],
      tools: [
        {
          type: 'function' as const,
          function: {
            name: 'transferFunds',
            description: 'Transfers money from the current account',
            parameters: { type: 'object' as const },
            parse: (_arguments: string): { amount: number } => {
              throw new Error('safe validation failure');
            },
            function: transferFunds,
          },
        },
      ],
    };
    const options = { maxChatCompletions: 1 };
    const runner = streaming
      ? client.chat.completions.runTools({ ...params, stream: true }, options)
      : client.chat.completions.runTools({ ...params, stream: false }, options);

    await respond();
    await expect(runner.done()).resolves.toBeUndefined();
    expect(transferFunds).not.toHaveBeenCalled();
    expect(runner.messages).toContainEqual({
      role: 'tool',
      tool_call_id: 'transferFunds',
      content: 'safe validation failure',
    });
  });
});
