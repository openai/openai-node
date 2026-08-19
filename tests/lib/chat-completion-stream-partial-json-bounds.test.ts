import { afterEach, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { ChatCompletionStream } from 'openai/lib/ChatCompletionStream';
import { makeParseableResponseFormat, makeParseableTool } from 'openai/lib/parser';
import * as partialJSONParser from '../../src/_vendor/partial-json-parser/parser';

type Chunk = OpenAI.Chat.ChatCompletionChunk;

const structuredResponseFormat = {
  type: 'json_schema' as const,
  json_schema: { name: 'bounded_output', schema: { type: 'object' } },
};

const strictTool: OpenAI.Chat.ChatCompletionFunctionTool = {
  type: 'function',
  function: {
    name: 'bounded_tool',
    strict: true,
    parameters: { type: 'object', properties: { value: { type: 'string' } } },
  },
};

const nonStrictTool: OpenAI.Chat.ChatCompletionFunctionTool = {
  type: 'function',
  function: {
    name: 'unbounded_tool',
    strict: false,
    parameters: { type: 'object', properties: { value: { type: 'string' } } },
  },
};

function createClient(chunks: AsyncIterable<Chunk>): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn(async () => ({
          controller: new AbortController(),
          [Symbol.asyncIterator]: () => chunks[Symbol.asyncIterator](),
        })),
      },
    },
  } as unknown as OpenAI;
}

function chunk(
  delta: Chunk['choices'][number]['delta'],
  finishReason: Chunk['choices'][number]['finish_reason'] = null,
): Chunk {
  return {
    id: 'chatcmpl-bounded-json',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-test',
    choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
  };
}

async function* contentFragments(fragments: Iterable<string>): AsyncGenerator<Chunk> {
  let first = true;
  for (const fragment of fragments) {
    yield chunk(first ? { role: 'assistant', content: fragment } : { content: fragment });
    first = false;
  }
  yield chunk({}, 'stop');
}

async function* argumentFragments(fragments: Iterable<string>): AsyncGenerator<Chunk> {
  let first = true;
  for (const fragment of fragments) {
    yield chunk({
      ...(first ? { role: 'assistant' as const } : {}),
      tool_calls: [
        {
          index: 0,
          ...(first ? { id: 'call_bounded', type: 'function' as const } : {}),
          function: { ...(first ? { name: 'bounded_tool' } : {}), arguments: fragment },
        },
      ],
    });
    first = false;
  }
  yield chunk({}, 'tool_calls');
}

async function* namedArgumentFragments(name: string, fragments: Iterable<string>): AsyncGenerator<Chunk> {
  let first = true;
  for (const fragment of fragments) {
    yield chunk({
      ...(first ? { role: 'assistant' as const } : {}),
      tool_calls: [
        {
          index: 0,
          ...(first ? { id: 'call_named', type: 'function' as const } : {}),
          function: { ...(first ? { name } : {}), arguments: fragment },
        },
      ],
    });
    first = false;
  }
  yield chunk({}, 'tool_calls');
}

function* overStructuredLimit(limit: 'byte' | 'depth' | 'fragment'): Generator<string> {
  if (limit === 'byte') {
    yield `{"value":"${'a'.repeat(17 * 1024 * 1024)}"}`;
    return;
  }
  if (limit === 'depth') {
    yield `{"value":${'['.repeat(128)}0${']'.repeat(128)}}`;
    return;
  }

  yield '{"value":"';
  for (let index = 0; index < 65_536; index += 1) {
    yield '';
  }
  yield '"}';
}

async function* delayedToolIdentityFragments(
  fragment: string,
  name = strictTool.function.name,
): AsyncGenerator<Chunk> {
  yield chunk({
    role: 'assistant',
    tool_calls: [{ index: 0, function: { arguments: fragment } }],
  });
  yield chunk({
    tool_calls: [
      {
        index: 0,
        id: 'call_bounded',
        type: 'function',
        function: { name, arguments: '"}' },
      },
    ],
  });
  yield chunk({}, 'tool_calls');
}

async function* unmatchedToolThenContentFragments(): AsyncGenerator<Chunk> {
  yield chunk({
    role: 'assistant',
    tool_calls: [
      {
        index: 0,
        id: 'call_unmatched',
        type: 'function',
        function: { name: 'unmatched_tool', arguments: '{}' },
      },
    ],
  });

  for (let index = 1; index < 8200; index += 1) {
    yield chunk({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] });
  }

  yield chunk({ content: `{"value":"${'a'.repeat(32_768)}"}` });
  yield chunk({}, 'tool_calls');
}

function* singleCharacterJSON(characterCount: number): Generator<string> {
  yield '{"value":"';
  for (let index = 0; index < characterCount; index += 1) {
    yield 'a';
  }
  yield '"}';
}

function* emptyStructuredJSONFragments(): Generator<string> {
  yield '{"value":"';
  for (let index = 0; index < 65_536; index += 1) {
    yield '';
  }
}

function createStructuredStream(kind: 'content' | 'tool', fragments: Iterable<string>) {
  const chunks = kind === 'content' ? contentFragments(fragments) : argumentFragments(fragments);
  return ChatCompletionStream.createChatCompletion(createClient(chunks), {
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'Return bounded structured output' }],
    ...(kind === 'content' ? { response_format: structuredResponseFormat } : { tools: [strictTool] }),
  });
}

afterEach(() => vi.restoreAllMocks());

it.each(['strict', 'auto-parseable'] as const)(
  'captures receiver-bound %s argument accessors exactly once before all accounting and events',
  async (kind) => {
    const parse = vi.spyOn(partialJSONParser, 'partialParse');
    const oversized = `{"value":"${'x'.repeat(17 * 1024 * 1024)}"}`;
    let reads = 0;
    const functionDelta = {
      name: strictTool.function.name,
      get arguments(): string {
        expect(this).toBe(functionDelta);
        reads += 1;
        return reads <= 2 ? '{"value":"safe"}' : oversized;
      },
    };

    async function* accessorChunks(): AsyncGenerator<Chunk> {
      yield chunk({
        role: 'assistant',
        tool_calls: [{ index: 0, id: 'call_accessor', type: 'function', function: functionDelta }],
      });
      yield chunk({}, 'tool_calls');
    }

    const configuredTool =
      kind === 'strict'
        ? strictTool
        : makeParseableTool(
            { ...strictTool, function: { ...strictTool.function, strict: false } },
            { parser: (value: string) => JSON.parse(value) as unknown, callback: vi.fn() },
          );
    const stream = ChatCompletionStream.createChatCompletion(createClient(accessorChunks()), {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Read each strict argument fragment once' }],
      tools: [configuredTool],
    });
    const emittedFragments: string[] = [];
    stream.on('tool_calls.function.arguments.delta', (event) => emittedFragments.push(event.arguments_delta));

    const completion = await stream.finalChatCompletion();

    expect(reads).toBe(1);
    expect(emittedFragments).toEqual(['{"value":"safe"}']);
    expect(completion.choices[0]?.message.tool_calls?.[0]).toMatchObject({
      function: { arguments: '{"value":"safe"}', parsed_arguments: { value: 'safe' } },
    });
    expect(parse.mock.calls.every(([value]) => value === '{"value":"safe"}')).toBe(true);
  },
);

it('captures known non-strict mixed-tool argument accessors exactly once', async () => {
  let reads = 0;
  const functionDelta = {
    name: nonStrictTool.function.name,
    get arguments(): string {
      expect(this).toBe(functionDelta);
      reads += 1;
      return reads === 1 ? '{"value":"safe"}' : '{"value":"changed"}';
    },
  };

  async function* accessorChunks(): AsyncGenerator<Chunk> {
    yield chunk({
      role: 'assistant',
      tool_calls: [{ index: 0, id: 'call_accessor', type: 'function', function: functionDelta }],
    });
    yield chunk({}, 'tool_calls');
  }

  const stream = ChatCompletionStream.createChatCompletion(createClient(accessorChunks()), {
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'Read the non-strict argument fragment once' }],
    tools: [strictTool, nonStrictTool],
  });
  const emittedFragments: string[] = [];
  stream.on('tool_calls.function.arguments.delta', (event) => emittedFragments.push(event.arguments_delta));

  const completion = await stream.finalChatCompletion();

  expect(reads).toBe(1);
  expect(emittedFragments).toEqual(['{"value":"safe"}']);
  expect(completion.choices[0]?.message.tool_calls?.[0]).toMatchObject({
    function: { arguments: '{"value":"safe"}', parsed_arguments: null },
  });
});

it('captures an argument accessor once while its strict tool identity is incomplete', async () => {
  const oversizedPrefix = `{"value":"${'x'.repeat(17 * 1024 * 1024)}`;
  let reads = 0;
  const functionDelta = {
    get arguments(): string {
      expect(this).toBe(functionDelta);
      reads += 1;
      return reads <= 2 ? '{"value":"' : oversizedPrefix;
    },
  };

  async function* accessorChunks(): AsyncGenerator<Chunk> {
    yield chunk({ role: 'assistant', tool_calls: [{ index: 0, function: functionDelta }] });
    yield chunk({
      tool_calls: [
        {
          index: 0,
          id: 'call_accessor',
          type: 'function',
          function: { name: strictTool.function.name, arguments: 'safe"}' },
        },
      ],
    });
    yield chunk({}, 'tool_calls');
  }

  const completion = await ChatCompletionStream.createChatCompletion(createClient(accessorChunks()), {
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'Protect the provisional strict argument fragment' }],
    tools: [strictTool, nonStrictTool],
  }).finalChatCompletion();

  expect(reads).toBe(1);
  expect(completion.choices[0]?.message.tool_calls?.[0]).toMatchObject({
    function: { arguments: '{"value":"safe"}', parsed_arguments: { value: 'safe' } },
  });
});

it.each(['byte', 'depth'] as const)(
  'rejects an accessor argument fragment exceeding the structured %s limit after one read',
  async (limit) => {
    const parse = vi.spyOn(partialJSONParser, 'partialParse');
    const unsafe =
      limit === 'byte'
        ? `{"value":"${'x'.repeat(17 * 1024 * 1024)}"}`
        : `{"value":${'['.repeat(128)}0${']'.repeat(128)}}`;
    const readArguments = vi.fn(() => unsafe);
    const functionDelta: { name: string; arguments?: string } = { name: strictTool.function.name };
    Object.defineProperty(functionDelta, 'arguments', { enumerable: true, get: readArguments });

    async function* accessorChunks(): AsyncGenerator<Chunk> {
      yield chunk({
        role: 'assistant',
        tool_calls: [{ index: 0, id: 'call_accessor', type: 'function', function: functionDelta }],
      });
      yield chunk({}, 'tool_calls');
    }

    const stream = ChatCompletionStream.createChatCompletion(createClient(accessorChunks()), {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Reject the unsafe captured argument fragment' }],
      tools: [strictTool],
    });

    await expect(stream.finalChatCompletion()).rejects.toThrow(
      limit === 'byte' ? /structured JSON byte limit/u : /structured JSON nesting depth limit/u,
    );
    expect(readArguments).toHaveBeenCalledTimes(1);
    expect(parse).not.toHaveBeenCalled();
  },
);

it.each(['mutate', 'replace'] as const)(
  'enforces structured JSON limits for strict tools %sd before deferred dispatch',
  async (mutation) => {
    const parse = vi.spyOn(partialJSONParser, 'partialParse');
    const nestedJSON = `{"value":${'['.repeat(128)}0${']'.repeat(128)}}`;
    const params: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: 'gpt-test',
      stream: true,
      messages: [{ role: 'user', content: 'Call the strict tool' }],
      tools: [{ ...strictTool, function: { ...strictTool.function, strict: false } }],
    };
    const client = createClient(argumentFragments([nestedJSON]));
    const stream = ChatCompletionStream.createChatCompletion(client, params);

    if (mutation === 'mutate') {
      const tool = params.tools?.[0];
      if (!tool || tool.type !== 'function') {
        throw new Error('expected a function tool');
      }
      tool.function.strict = true;
    } else {
      params.tools = [strictTool];
    }

    await expect(stream.finalChatCompletion()).rejects.toThrow(/structured JSON nesting depth limit/u);
    expect(parse).not.toHaveBeenCalled();
    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [expect.objectContaining({ function: expect.objectContaining({ strict: true }) })],
      }),
      expect.anything(),
    );
  },
);

it.each(['byte', 'depth'] as const)(
  'does not activate strict argument parsing when caller tools mutate during %s streaming',
  async (limit) => {
    const parse = vi.spyOn(partialJSONParser, 'partialParse');
    const parseJSON = vi.spyOn(JSON, 'parse');
    const tool: OpenAI.Chat.ChatCompletionFunctionTool = {
      ...strictTool,
      function: { ...strictTool.function, strict: false },
    };
    const value =
      limit === 'byte' ? `"${'x'.repeat(17 * 1024 * 1024)}"` : `${'['.repeat(128)}0${']'.repeat(128)}`;
    const argumentsJSON = `{"value":${value}}`;

    async function* mutateStrictDuringStreaming(): AsyncGenerator<Chunk> {
      yield chunk({
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'call_bounded',
            type: 'function',
            function: { name: 'bounded_tool', arguments: '{"value":' },
          },
        ],
      });
      tool.function.strict = true;
      yield chunk({ tool_calls: [{ index: 0, function: { arguments: `${value}}` } }] });
      yield chunk({}, 'tool_calls');
    }

    const completion = await ChatCompletionStream.createChatCompletion(
      createClient(mutateStrictDuringStreaming()),
      {
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'Keep the dispatched tool non-strict' }],
        tools: [tool],
      },
    ).finalChatCompletion();

    expect(completion.choices[0]?.message.tool_calls?.[0]).not.toHaveProperty('function.parsed_arguments');
    expect(parse).not.toHaveBeenCalled();
    expect(parseJSON.mock.calls.some(([input]) => input === argumentsJSON)).toBe(false);
  },
);

it('retains dispatched strict parsing when caller tools become non-strict during streaming', async () => {
  const tool: OpenAI.Chat.ChatCompletionFunctionTool = {
    ...strictTool,
    function: { ...strictTool.function },
  };

  async function* mutateStrictDuringStreaming(): AsyncGenerator<Chunk> {
    yield chunk({
      role: 'assistant',
      tool_calls: [
        {
          index: 0,
          id: 'call_bounded',
          type: 'function',
          function: { name: 'bounded_tool', arguments: '{"value":' },
        },
      ],
    });
    tool.function.strict = false;
    yield chunk({ tool_calls: [{ index: 0, function: { arguments: '1}' } }] });
    yield chunk({}, 'tool_calls');
  }

  const completion = await ChatCompletionStream.createChatCompletion(
    createClient(mutateStrictDuringStreaming()),
    {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Keep the dispatched tool strict' }],
      tools: [tool],
    },
  ).finalChatCompletion();

  expect(completion.choices[0]?.message.tool_calls?.[0]).toMatchObject({
    function: { parsed_arguments: { value: 1 } },
  });
});

it('materializes accessor-backed strictness once before consuming streamed arguments', async () => {
  const parse = vi.spyOn(partialJSONParser, 'partialParse');
  const tool: OpenAI.Chat.ChatCompletionFunctionTool = {
    ...strictTool,
    function: { ...strictTool.function, strict: false },
  };
  let strict = false;
  const readStrict = vi.fn(() => strict);
  Object.defineProperty(tool.function, 'strict', { configurable: true, enumerable: true, get: readStrict });
  const nestedJSON = `{"value":${'['.repeat(128)}0${']'.repeat(128)}}`;

  async function* mutateAccessorDuringStreaming(): AsyncGenerator<Chunk> {
    yield chunk({
      role: 'assistant',
      tool_calls: [
        {
          index: 0,
          id: 'call_bounded',
          type: 'function',
          function: { name: 'bounded_tool', arguments: '' },
        },
      ],
    });
    strict = true;
    yield chunk({ tool_calls: [{ index: 0, function: { arguments: nestedJSON } }] });
    yield chunk({}, 'tool_calls');
  }

  const completion = await ChatCompletionStream.createChatCompletion(
    createClient(mutateAccessorDuringStreaming()),
    {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Keep the dispatched accessor non-strict' }],
      tools: [tool],
    },
  ).finalChatCompletion();

  expect(completion.choices[0]?.message.tool_calls?.[0]).not.toHaveProperty('function.parsed_arguments');
  expect(parse).not.toHaveBeenCalled();
  expect(readStrict).toHaveBeenCalledTimes(2);
});

it('materializes accessor-backed structured format types for the complete request lifetime', async () => {
  const responseFormat: OpenAI.Chat.ChatCompletionCreateParams['response_format'] = {
    type: 'json_schema',
    json_schema: { name: 'accessor_format', schema: { type: 'object' } },
  };
  let formatType = 'json_schema';
  const readType = vi.fn(() => formatType);
  Object.defineProperty(responseFormat, 'type', { configurable: true, enumerable: true, get: readType });

  async function* mutateAccessorDuringStreaming(): AsyncGenerator<Chunk> {
    yield chunk({ role: 'assistant', content: '{"value":' });
    formatType = 'text';
    yield chunk({ content: '1}' });
    yield chunk({}, 'stop');
  }

  const completion = await ChatCompletionStream.createChatCompletion(
    createClient(mutateAccessorDuringStreaming()),
    {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Keep the dispatched format type' }],
      response_format: responseFormat,
    },
  ).finalChatCompletion();

  expect(completion.choices[0]?.message.parsed).toEqual({ value: 1 });
});

it.each(['content', 'tool'] as const)(
  'does not expose a stale %s partial parse when coalescing a changed raw snapshot',
  async (kind) => {
    const fragments = ['{"value":"', 'a'.repeat(1100), 'b', '"}'];
    const stream = createStructuredStream(kind, fragments);
    const snapshots: { raw: string; parsed: unknown }[] = [];

    if (kind === 'content') {
      stream.on('content.delta', (event) => {
        snapshots.push({ raw: event.snapshot, parsed: event.parsed });
      });
    } else {
      stream.on('tool_calls.function.arguments.delta', (event) => {
        snapshots.push({ raw: event.arguments, parsed: event.parsed_arguments });
      });
    }

    const completion = await stream.finalChatCompletion();
    const skipped = snapshots.find((snapshot) => snapshot.raw.endsWith('b'));

    expect(skipped).toBeDefined();
    expect(skipped?.parsed).toBe(kind === 'content' ? null : undefined);
    if (kind === 'content') {
      expect(completion.choices[0]?.message.parsed).toEqual({ value: `${'a'.repeat(1100)}b` });
    } else {
      expect(completion.choices[0]?.message.tool_calls?.[0]).toMatchObject({
        function: { parsed_arguments: { value: `${'a'.repeat(1100)}b` } },
      });
    }
  },
);

it('preserves non-enumerable tool parsing brands and executable callbacks in private snapshots', async () => {
  const parser = vi.fn((content: string) => JSON.parse(content) as { value: string });
  const callback = vi.fn();
  const tool = makeParseableTool(strictTool, { parser, callback });

  const completion = await ChatCompletionStream.createChatCompletion(
    createClient(argumentFragments(['{"value":"retained"}'])),
    {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Preserve hidden parser metadata' }],
      tools: [tool],
    },
  ).finalChatCompletion();

  expect(completion.choices[0]?.message.tool_calls?.[0]).toMatchObject({
    function: { parsed_arguments: { value: 'retained' } },
  });
  expect(parser).toHaveBeenCalledWith('{"value":"retained"}');
  expect(tool.$callback).toBe(callback);
});

it('preserves branded structured-output parsing when caller formats mutate during streaming', async () => {
  const parser = vi.fn((content: string) => JSON.parse(content) as { value: number });
  const responseFormat = makeParseableResponseFormat(structuredResponseFormat, parser);

  async function* mutateFormatDuringStreaming(): AsyncGenerator<Chunk> {
    yield chunk({ role: 'assistant', content: '{"value":' });
    Object.defineProperty(responseFormat, 'type', { value: 'text' });
    yield chunk({ content: '1}' });
    yield chunk({}, 'stop');
  }

  const completion = await ChatCompletionStream.createChatCompletion(
    createClient(mutateFormatDuringStreaming()),
    {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Preserve the dispatched output parser' }],
      response_format: responseFormat,
    },
  ).finalChatCompletion();

  expect(completion.choices[0]?.message.parsed).toEqual({ value: 1 });
  expect(parser).toHaveBeenCalledWith('{"value":1}');
});

it.each(['content', 'tool'] as const)(
  'coalesces fragmented %s JSON parsing while retaining every raw snapshot and the final output',
  async (kind) => {
    const parse = vi.spyOn(partialJSONParser, 'partialParse');
    const stream = createStructuredStream(kind, singleCharacterJSON(4096));
    const snapshots: string[] = [];

    if (kind === 'content') {
      stream.on('content.delta', (event) => snapshots.push(event.snapshot));
    } else {
      stream.on('tool_calls.function.arguments.delta', (event) => snapshots.push(event.arguments));
    }

    const completion = await stream.finalChatCompletion();
    const expectedJSON = `{"value":"${'a'.repeat(4096)}"}`;
    const parseWork = parse.mock.calls.reduce((total, [value]) => total + value.length, 0);

    expect(snapshots).toHaveLength(4098);
    expect(snapshots.pop()).toBe(expectedJSON);
    expect(parse.mock.calls.length).toBeLessThan(1100);
    expect(parseWork).toBeLessThan(1_000_000);

    if (kind === 'content') {
      expect(completion.choices[0]?.message.parsed).toEqual({ value: 'a'.repeat(4096) });
    } else {
      expect(completion.choices[0]?.message.tool_calls?.[0]).toMatchObject({
        function: { arguments: expectedJSON, parsed_arguments: { value: 'a'.repeat(4096) } },
      });
    }
  },
);

it.each(['content', 'tool'] as const)(
  'rejects %s JSON exceeding its UTF-8 byte budget before invoking the partial parser',
  async (kind) => {
    const parse = vi.spyOn(partialJSONParser, 'partialParse');
    const oversizedJSON = `{"value":"${'😀'.repeat(4 * 1024 * 1024)}"}`;
    const stream = createStructuredStream(kind, [oversizedJSON]);

    await expect(stream.finalChatCompletion()).rejects.toThrow(/structured JSON byte limit/u);
    expect(parse).not.toHaveBeenCalled();
  },
);

it.each(['content', 'tool'] as const)(
  'rejects excessively nested %s JSON before invoking the recursive partial parser',
  async (kind) => {
    const parse = vi.spyOn(partialJSONParser, 'partialParse');
    const nestedJSON = `{"value":${'['.repeat(128)}0${']'.repeat(128)}}`;
    const stream = createStructuredStream(kind, [nestedJSON]);

    await expect(stream.finalChatCompletion()).rejects.toThrow(/structured JSON nesting depth limit/u);
    expect(parse).not.toHaveBeenCalled();
  },
);

it.each(['byte', 'depth'] as const)(
  'applies the %s limit before an argument fragment reveals its strict tool identity',
  async (limit) => {
    const parse = vi.spyOn(partialJSONParser, 'partialParse');
    const prefix =
      limit === 'byte' ? `{"value":"${'😀'.repeat(4 * 1024 * 1024)}` : `{"value":${'['.repeat(128)}`;
    const stream = ChatCompletionStream.createChatCompletion(
      createClient(delayedToolIdentityFragments(prefix)),
      {
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'Call the strict tool' }],
        tools: [strictTool],
      },
    );

    const failure = await stream.finalChatCompletion().then(
      () => 'unexpected success',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(failure).toMatch(
      limit === 'byte' ? /structured JSON byte limit/u : /structured JSON nesting depth limit/u,
    );
    expect(parse).not.toHaveBeenCalled();
  },
);

it.each(['byte', 'depth'] as const)(
  'retains the %s budget until a delayed non-strict identity is actually known',
  async (limit) => {
    const prefix =
      limit === 'byte' ? `{"value":"${'a'.repeat(17 * 1024 * 1024)}` : `{"value":${'['.repeat(128)}`;
    const stream = ChatCompletionStream.createChatCompletion(
      createClient(delayedToolIdentityFragments(prefix, nonStrictTool.function.name)),
      {
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'Protect incomplete mixed-tool identities' }],
        tools: [strictTool, nonStrictTool],
      },
    );

    await expect(stream.finalChatCompletion()).rejects.toThrow(
      limit === 'byte' ? /structured JSON byte limit/u : /structured JSON nesting depth limit/u,
    );
  },
);

it.each(['byte', 'depth', 'fragment'] as const)(
  'does not apply the structured JSON %s budget to a known non-strict tool in a mixed request',
  async (limit) => {
    const parse = vi.spyOn(partialJSONParser, 'partialParse');
    const completion = await ChatCompletionStream.createChatCompletion(
      createClient(namedArgumentFragments(nonStrictTool.function.name, overStructuredLimit(limit))),
      {
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'Keep the non-strict tool unparsed' }],
        tools: [strictTool, nonStrictTool],
      },
    ).finalChatCompletion();

    const call = completion.choices[0]?.message.tool_calls?.[0];
    expect(call?.type).toBe('function');
    if (call?.type === 'function') {
      expect(call.function.name).toBe(nonStrictTool.function.name);
      expect(call.function.arguments.length).toBeGreaterThan(0);
      expect(call.function.parsed_arguments).toBeNull();
    }
    expect(parse).not.toHaveBeenCalled();
  },
);

it.each(['byte', 'depth', 'fragment'] as const)(
  'retains the structured JSON %s budget for a strict tool in a mixed request',
  async (limit) => {
    const stream = ChatCompletionStream.createChatCompletion(
      createClient(namedArgumentFragments(strictTool.function.name, overStructuredLimit(limit))),
      {
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'Keep the strict tool protected' }],
        tools: [strictTool, nonStrictTool],
      },
    );

    const failure = await stream.finalChatCompletion().then(
      () => 'unexpected success',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    const expectedFailures = {
      byte: /structured JSON byte limit/u,
      depth: /structured JSON nesting depth limit/u,
      fragment: /structured JSON fragment limit/u,
    };

    expect(failure).toMatch(expectedFailures[limit]);
  },
);

it('retains the structured JSON budget for a branded auto-parseable non-strict tool', async () => {
  const autoTool = makeParseableTool(
    { ...strictTool, function: { ...strictTool.function, strict: false } },
    { parser: (value: string) => JSON.parse(value) as unknown, callback: vi.fn() },
  );
  const stream = ChatCompletionStream.createChatCompletion(
    createClient(namedArgumentFragments(autoTool.function.name, overStructuredLimit('depth'))),
    {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Protect the branded auto-parseable tool' }],
      tools: [autoTool, nonStrictTool],
    },
  );

  await expect(stream.finalChatCompletion()).rejects.toThrow(/structured JSON nesting depth limit/u);
});

it('refunds provisional non-strict argument bytes before parsing another strict tool', async () => {
  const provisional = 'a'.repeat(8 * 1024 * 1024);
  const structured = 'b'.repeat(9 * 1024 * 1024);

  async function* mixedDelayedIdentities(): AsyncGenerator<Chunk> {
    yield chunk({
      role: 'assistant',
      tool_calls: [{ index: 0, function: { arguments: `{"value":"${provisional}` } }],
    });
    yield chunk({
      tool_calls: [
        {
          index: 0,
          id: 'call_nonstrict',
          type: 'function',
          function: { name: nonStrictTool.function.name, arguments: '"}' },
        },
      ],
    });
    yield chunk({
      tool_calls: [
        {
          index: 1,
          id: 'call_strict',
          type: 'function',
          function: { name: strictTool.function.name, arguments: `{"value":"${structured}"}` },
        },
      ],
    });
    yield chunk({}, 'tool_calls');
  }

  const completion = await ChatCompletionStream.createChatCompletion(createClient(mixedDelayedIdentities()), {
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'Refund the provisional non-strict budget' }],
    tools: [strictTool, nonStrictTool],
  }).finalChatCompletion();

  const looseCall = completion.choices[0]?.message.tool_calls?.[0];
  const boundedCall = completion.choices[0]?.message.tool_calls?.[1];
  expect(looseCall?.type === 'function' ? looseCall.function.parsed_arguments : undefined).toBeNull();
  expect(boundedCall?.type === 'function' ? boundedCall.function.parsed_arguments : undefined).toEqual({
    value: structured,
  });
});

it('refunds provisional non-strict fragments before parsing another strict tool', async () => {
  async function* mixedDelayedFragments(): AsyncGenerator<Chunk> {
    yield chunk({
      role: 'assistant',
      tool_calls: [{ index: 0, function: { arguments: '{"value":"' } }],
    });
    for (let index = 0; index < 40_000; index += 1) {
      yield chunk({ tool_calls: [{ index: 0, function: { arguments: '' } }] });
    }
    yield chunk({
      tool_calls: [
        {
          index: 0,
          id: 'call_nonstrict',
          type: 'function',
          function: { name: nonStrictTool.function.name, arguments: '"}' },
        },
      ],
    });
    yield chunk({
      tool_calls: [
        {
          index: 1,
          id: 'call_strict',
          type: 'function',
          function: { name: strictTool.function.name, arguments: '{"value":"' },
        },
      ],
    });
    for (let index = 0; index < 30_000; index += 1) {
      yield chunk({ tool_calls: [{ index: 1, function: { arguments: '' } }] });
    }
    yield chunk({ tool_calls: [{ index: 1, function: { arguments: '"}' } }] });
    yield chunk({}, 'tool_calls');
  }

  const completion = await ChatCompletionStream.createChatCompletion(createClient(mixedDelayedFragments()), {
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'Refund provisional non-strict fragments' }],
    tools: [strictTool, nonStrictTool],
  }).finalChatCompletion();

  const strictCall = completion.choices[0]?.message.tool_calls?.[1];
  expect(strictCall?.type === 'function' ? strictCall.function.parsed_arguments : undefined).toEqual({
    value: '',
  });
});

it.each(['name', 'type'] as const)(
  'rejects a %s change after binding a non-strict function-tool identity',
  async (field) => {
    async function* changedToolIdentity(): AsyncGenerator<Chunk> {
      yield chunk({
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'call_nonstrict',
            type: 'function',
            function: {
              name: nonStrictTool.function.name,
              arguments: `{"value":"${'a'.repeat(17 * 1024 * 1024)}"}`,
            },
          },
        ],
      });
      yield chunk({
        tool_calls: [
          field === 'name'
            ? { index: 0, function: { name: strictTool.function.name, arguments: '' } }
            : { index: 0, type: 'custom', custom: { name: 'changed', input: '' } },
        ],
      });
      yield chunk({}, 'tool_calls');
    }

    const stream = ChatCompletionStream.createChatCompletion(createClient(changedToolIdentity()), {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Reject an identity-changing tool delta' }],
      tools: [strictTool, nonStrictTool],
    });

    await expect(stream.finalChatCompletion()).rejects.toThrow(/tool call identity/u);
  },
);

it.each(['name', 'type'] as const)(
  'rejects a public snapshot %s mutation before final tool parsing',
  async (field) => {
    const stream = ChatCompletionStream.createChatCompletion(
      createClient(namedArgumentFragments(nonStrictTool.function.name, ['{}'])),
      {
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'Reject public identity mutation' }],
        tools: [strictTool, nonStrictTool],
      },
    );
    stream.on('chunk', (_current, snapshot) => {
      const toolCall = snapshot.choices[0]?.message.tool_calls?.[0];
      if (toolCall?.type !== 'function') {
        return;
      }
      if (field === 'name') {
        toolCall.function.name = strictTool.function.name;
      } else {
        Object.defineProperty(toolCall, 'type', { value: 'custom' });
      }
    });

    await expect(stream.finalChatCompletion()).rejects.toThrow(/tool call identity/u);
  },
);

it.each(['content', 'tool'] as const)(
  'preserves a bounded public %s snapshot edit and its original identity',
  async (kind) => {
    const stream = createStructuredStream(kind, ['{}']);
    const edited = '{"value":"edited"}';
    let publicSnapshot: unknown;

    stream.on('chunk', (current, snapshot) => {
      const delta = current.choices[0]?.delta;
      if (kind === 'content' && typeof delta?.content === 'string') {
        publicSnapshot = snapshot;
        const message = snapshot.choices[0]?.message;
        if (message) {
          message.content = edited;
        }
      } else if (kind === 'tool' && delta?.tool_calls?.length) {
        const toolCall = snapshot.choices[0]?.message.tool_calls?.[0];
        if (toolCall?.type === 'function') {
          publicSnapshot = snapshot;
          toolCall.function.arguments = edited;
        }
      }
    });

    const completion = await stream.finalChatCompletion();

    expect(publicSnapshot).toBeDefined();
    if (kind === 'content') {
      expect(completion.choices[0]?.message).toMatchObject({ content: edited, parsed: { value: 'edited' } });
    } else {
      expect(completion.choices[0]?.message.tool_calls?.[0]).toMatchObject({
        function: { arguments: edited, parsed_arguments: { value: 'edited' } },
      });
    }
  },
);

it.each(
  (['content', 'tool'] as const).flatMap((kind) =>
    (['byte', 'depth'] as const).flatMap((limit) =>
      (['final', 'next-partial'] as const).map((boundary) => ({ kind, limit, boundary })),
    ),
  ),
)(
  'rejects a public $kind snapshot $limit mutation before its $boundary parser',
  async ({ kind, limit, boundary }) => {
    const unsafe =
      limit === 'byte'
        ? `{"value":"${'x'.repeat(17 * 1024 * 1024)}"}`
        : `{"value":${'['.repeat(128)}0${']'.repeat(128)}}`;
    const stream = createStructuredStream(kind, boundary === 'next-partial' ? ['{}', ' '] : ['{}']);
    let changed = false;
    const parse = vi.spyOn(partialJSONParser, 'partialParse');

    stream.on('chunk', (current, snapshot) => {
      if (changed) {
        return;
      }
      const delta = current.choices[0]?.delta;
      if (kind === 'content' && typeof delta?.content === 'string') {
        const message = snapshot.choices[0]?.message;
        if (message) {
          message.content = unsafe;
        }
        changed = true;
      } else if (kind === 'tool' && delta?.tool_calls?.length) {
        const toolCall = snapshot.choices[0]?.message.tool_calls?.[0];
        if (toolCall?.type === 'function') {
          toolCall.function.arguments = unsafe;
          changed = true;
        }
      }
    });

    const failure = await stream.finalChatCompletion().then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(
      limit === 'byte' ? /structured JSON byte limit/u : /structured JSON nesting depth limit/u,
    );
    expect(parse.mock.calls.every(([value]) => value.length < 16 * 1024 * 1024)).toBe(true);
  },
);

it.each(['content', 'tool'] as const)(
  'revalidates a public %s snapshot changed after its done-event parser',
  async (kind) => {
    const stream = createStructuredStream(kind, ['{}']);
    const unsafe = `{"value":"${'x'.repeat(17 * 1024 * 1024)}"}`;
    let snapshot: typeof stream.currentChatCompletionSnapshot;

    stream.on('chunk', (_current, currentSnapshot) => {
      snapshot = currentSnapshot;
    });
    if (kind === 'content') {
      stream.on('content.done', () => {
        const message = snapshot?.choices[0]?.message;
        if (message) {
          message.content = unsafe;
        }
      });
    } else {
      stream.on('tool_calls.function.arguments.done', () => {
        const toolCall = snapshot?.choices[0]?.message.tool_calls?.[0];
        if (toolCall?.type === 'function') {
          toolCall.function.arguments = unsafe;
        }
      });
    }

    const failure = await stream.finalChatCompletion().then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/structured JSON byte limit/u);
  },
);

it.each(['content', 'tool'] as const)(
  'rejects an accessor-backed public %s snapshot before invoking its stateful getter',
  async (kind) => {
    const stream = createStructuredStream(kind, ['{}']);
    const readSnapshot = vi.fn(() => '{"value":"changed"}');

    stream.on('chunk', (current, snapshot) => {
      const delta = current.choices[0]?.delta;
      if (kind === 'content' && typeof delta?.content === 'string') {
        const message = snapshot.choices[0]?.message;
        if (message) {
          Object.defineProperty(message, 'content', { configurable: true, get: readSnapshot });
        }
      } else if (kind === 'tool' && delta?.tool_calls?.length) {
        const toolCall = snapshot.choices[0]?.message.tool_calls?.[0];
        if (toolCall?.type === 'function') {
          Object.defineProperty(toolCall.function, 'arguments', { configurable: true, get: readSnapshot });
        }
      }
    });

    await expect(stream.finalChatCompletion()).rejects.toThrow(/unsafe structured JSON snapshot/u);
    expect(readSnapshot).not.toHaveBeenCalled();
  },
);

it.each(['data', 'accessor'] as const)(
  'rejects inherited structured content from a %s descriptor without invoking getters',
  async (kind) => {
    const unsafe = `{"value":"${'x'.repeat(17 * 1024 * 1024)}"}`;
    const stream = createStructuredStream('content', ['{}']);
    const readContent = vi.fn(() => unsafe);

    stream.on('chunk', (current, snapshot) => {
      if (typeof current.choices[0]?.delta.content !== 'string') {
        return;
      }
      const message = snapshot.choices[0]?.message;
      if (!message) {
        return;
      }
      const prototype = Object.create(Object.prototype) as object;
      Object.defineProperty(prototype, 'content', kind === 'data' ? { value: unsafe } : { get: readContent });
      Reflect.deleteProperty(message, 'content');
      Object.setPrototypeOf(message, prototype);
    });

    const failure = await stream.finalChatCompletion().then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/unsafe structured JSON snapshot/u);
    expect(readContent).not.toHaveBeenCalled();
  },
);

it.each(['choices', 'tool_calls'] as const)(
  'rejects an oversized sparse %s snapshot before invoking its iterator',
  async (collection) => {
    const stream = createStructuredStream(collection === 'choices' ? 'content' : 'tool', ['{}']);
    const iterate = vi.fn(() => {
      throw new Error('oversized sparse snapshot must not be iterated');
    });

    stream.on('chunk', (current, snapshot) => {
      if (!current.choices[0]?.delta.content && !current.choices[0]?.delta.tool_calls?.length) {
        return;
      }
      const array = collection === 'choices' ? snapshot.choices : snapshot.choices[0]?.message.tool_calls;
      if (!array) {
        throw new Error('Expected a mutable public snapshot array');
      }
      array.length = 2 ** 32 - 1;
      Object.defineProperty(array, Symbol.iterator, { configurable: true, value: iterate });
    });

    const failure = await stream.finalChatCompletion().then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/snapshot.*(?:choice|tool).*limit/iu);
    expect(iterate).not.toHaveBeenCalled();
  },
);

it('enforces an aggregate final budget across independently bounded public parser snapshots', async () => {
  const edited = `{"value":"${'x'.repeat(9 * 1024 * 1024)}"}`;

  async function* mixedStructuredFragments(): AsyncGenerator<Chunk> {
    yield chunk({
      role: 'assistant',
      content: '{}',
      tool_calls: [
        {
          index: 0,
          id: 'call_bounded',
          type: 'function',
          function: { name: strictTool.function.name, arguments: '{}' },
        },
      ],
    });
    yield chunk({}, 'tool_calls');
  }

  const stream = ChatCompletionStream.createChatCompletion(createClient(mixedStructuredFragments()), {
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'Bound the final content and strict-tool aggregate' }],
    response_format: structuredResponseFormat,
    tools: [strictTool],
  });
  stream.on('chunk', (current, snapshot) => {
    if (typeof current.choices[0]?.delta.content !== 'string') {
      return;
    }
    const message = snapshot.choices[0]?.message;
    const toolCall = message?.tool_calls?.[0];
    if (message && toolCall?.type === 'function') {
      message.content = edited;
      toolCall.function.arguments = edited;
    }
  });

  const failure = await stream.finalChatCompletion().then(
    () => null,
    (error: unknown) => error,
  );

  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toMatch(/structured JSON byte limit/u);
});

it.each(['content', 'tool'] as const)(
  'rejects a combined oversized %s snapshot before invoking any done-event parser',
  async (kind) => {
    const oversizedTogether = `{"value":"${'x'.repeat(9 * 1024 * 1024)}"}`;
    const parse = vi.fn((value: string) => JSON.parse(value) as unknown);

    async function* events(): AsyncGenerator<Chunk> {
      if (kind === 'content') {
        const first = chunk({ role: 'assistant', content: '{}' }, 'stop');
        const [firstChoice] = first.choices;
        if (!firstChoice) {
          throw new Error('Expected the initial structured choice');
        }
        yield {
          ...first,
          choices: [firstChoice, { ...firstChoice, index: 1 }],
        };
        return;
      }

      yield chunk({
        role: 'assistant',
        tool_calls: [0, 1].map((index) => ({
          index,
          id: `call_${index}`,
          type: 'function' as const,
          function: { name: strictTool.function.name, arguments: '{}' },
        })),
      });
      yield chunk({}, 'tool_calls');
    }

    const stream = ChatCompletionStream.createChatCompletion(createClient(events()), {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Reject the whole aggregate before done parsing' }],
      ...(kind === 'content'
        ? { n: 2, response_format: makeParseableResponseFormat(structuredResponseFormat, parse) }
        : { tools: [makeParseableTool(strictTool, { parser: parse, callback: undefined })] }),
    });
    stream.on('chunk', (current, snapshot) => {
      if (kind === 'content' && typeof current.choices[0]?.delta.content === 'string') {
        for (const choice of snapshot.choices) {
          choice.message.content = oversizedTogether;
        }
      } else if (kind === 'tool' && current.choices[0]?.delta.tool_calls?.length) {
        for (const toolCall of snapshot.choices[0]?.message.tool_calls ?? []) {
          if (toolCall.type === 'function') {
            toolCall.function.arguments = oversizedTogether;
          }
        }
      }
    });

    const failure = await stream.finalChatCompletion().then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/structured JSON byte limit/u);
    expect(parse.mock.calls.length).toBe(0);
  },
);

it('bounds a new strict tool appended to the public snapshot before its final parser', async () => {
  const unsafe = `{"value":"${'x'.repeat(17 * 1024 * 1024)}"}`;
  const stream = createStructuredStream('tool', ['{}']);
  const parse = vi.spyOn(JSON, 'parse');

  stream.on('chunk', (current, snapshot) => {
    if (!current.choices[0]?.delta.tool_calls?.length) {
      return;
    }
    snapshot.choices[0]?.message.tool_calls?.push({
      id: 'call_injected',
      type: 'function',
      function: { name: strictTool.function.name, arguments: unsafe },
    });
  });

  const failure = await stream.finalChatCompletion().then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toMatch(/structured JSON byte limit/u);
  expect(
    parse.mock.calls.every(([value]) => typeof value !== 'string' || value.length < 16 * 1024 * 1024),
  ).toBe(true);
});

it.each(['type', 'function', 'name', 'arguments'] as const)(
  'rejects an injected strict tool %s accessor without invoking its getter',
  async (property) => {
    const unsafe = `{"value":"${'x'.repeat(17 * 1024 * 1024)}"}`;
    const stream = createStructuredStream('tool', ['{}']);
    const injectedFunction = { name: strictTool.function.name, arguments: unsafe };
    const injectedTool = { id: 'call_injected', type: 'function' as const, function: injectedFunction };
    const target = property === 'type' || property === 'function' ? injectedTool : injectedFunction;
    const values: Record<typeof property, unknown> = {
      type: 'function',
      function: injectedFunction,
      name: strictTool.function.name,
      arguments: unsafe,
    };
    const value = values[property];
    const readProperty = vi.fn(() => value);
    Object.defineProperty(target, property, { configurable: true, get: readProperty });

    stream.on('chunk', (current, snapshot) => {
      if (current.choices[0]?.delta.tool_calls?.length) {
        snapshot.choices[0]?.message.tool_calls?.push(injectedTool);
      }
    });

    await expect(stream.finalChatCompletion()).rejects.toThrow(/unsafe structured JSON snapshot/u);
    expect(readProperty).not.toHaveBeenCalled();
  },
);

it.each(['content', 'tool'] as const)(
  'preserves the exact user-owned %s parser error and cause after bounded validation',
  async (kind) => {
    const expected = new SyntaxError('User-owned structured parser diagnostic');
    const expectedCause = new Error('User-owned structured parser cause');
    (expected as SyntaxError & { cause?: unknown }).cause = expectedCause;
    const parser = vi.fn(() => {
      throw expected;
    });
    const stream =
      kind === 'content'
        ? ChatCompletionStream.createChatCompletion(createClient(contentFragments(['{}'])), {
            model: 'gpt-test',
            messages: [{ role: 'user', content: 'Preserve the custom response parser' }],
            response_format: makeParseableResponseFormat(structuredResponseFormat, parser),
          })
        : ChatCompletionStream.createChatCompletion(createClient(argumentFragments(['{}'])), {
            model: 'gpt-test',
            messages: [{ role: 'user', content: 'Preserve the custom tool parser' }],
            tools: [makeParseableTool(strictTool, { parser, callback: undefined })],
          });

    const failure = await stream.finalChatCompletion().then(
      () => null,
      (error: unknown) => error,
    );

    expect((failure as Error & { cause?: unknown }).cause).toBe(expected);
    expect((expected as SyntaxError & { cause?: unknown }).cause).toBe(expectedCause);
    expect(parser).toHaveBeenCalledTimes(1);
  },
);

it('preserves an oversized known non-strict tool snapshot mutation without parsing it', async () => {
  const unsafe = `{"value":"${'x'.repeat(17 * 1024 * 1024)}"}`;
  const stream = ChatCompletionStream.createChatCompletion(
    createClient(namedArgumentFragments(nonStrictTool.function.name, ['{}'])),
    {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Keep the non-strict snapshot unparsed' }],
      tools: [strictTool, nonStrictTool],
    },
  );

  stream.on('chunk', (current, snapshot) => {
    if (!current.choices[0]?.delta.tool_calls?.length) {
      return;
    }
    const toolCall = snapshot.choices[0]?.message.tool_calls?.[0];
    if (toolCall?.type === 'function') {
      toolCall.function.arguments = unsafe;
    }
  });

  const completion = await stream.finalChatCompletion();

  expect(completion.choices[0]?.message.tool_calls?.[0]).toMatchObject({
    function: { arguments: unsafe },
  });
});

it.each(['content', 'tool'] as const)('rejects an excessive number of empty %s fragments', async (kind) => {
  const stream = createStructuredStream(kind, emptyStructuredJSONFragments());

  await expect(stream.finalChatCompletion()).rejects.toThrow(/structured JSON fragment limit/u);
});

it('does not charge unmatched tool fragments against the actual structured JSON parse-work budget', async () => {
  const stream = ChatCompletionStream.createChatCompletion(
    createClient(unmatchedToolThenContentFragments()),
    {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Return parsed structured content' }],
      response_format: structuredResponseFormat,
      tools: [strictTool, { type: 'function', function: { name: 'unmatched_tool' } }],
    },
  );
  const parsedSnapshots: unknown[] = [];
  stream.on('content.delta', (event) => parsedSnapshots.push(event.parsed));

  const completion = await stream.finalChatCompletion();

  expect(parsedSnapshots).toEqual([{ value: 'a'.repeat(32_768) }]);
  expect(completion.choices[0]?.message.parsed).toEqual({ value: 'a'.repeat(32_768) });
});

it('refreshes the partial snapshot when a top-level structured JSON string closes', async () => {
  const stream = ChatCompletionStream.createChatCompletion(
    createClient(contentFragments(['"', 'a'.repeat(1100), 'b"'])),
    {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Return a structured string' }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'bounded_string', schema: { type: 'string' } },
      },
    },
  );
  const parsedSnapshots: unknown[] = [];
  stream.on('content.delta', (event) => parsedSnapshots.push(event.parsed));

  const completion = await stream.finalChatCompletion();

  expect(parsedSnapshots.pop()).toBe(`${'a'.repeat(1100)}b`);
  expect(completion.choices[0]?.message.parsed).toBe(`${'a'.repeat(1100)}b`);
});
