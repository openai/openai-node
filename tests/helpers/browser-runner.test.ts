// oxlint-disable max-classes-per-file -- Separate regressions cover real class-backed MCP and computer policies.
import OpenAI, { OpenAIError } from 'openai';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { BrowserError, BrowserToolset } from 'openai/helpers/browser';
import type { BrowserDriver, BrowserOptions, BrowserState } from 'openai/helpers/browser';
import { ComputerToolset } from 'openai/helpers/computer';
import type { ComputerExecutionOptions } from 'openai/helpers/computer';
import {
  ResponsesToolRunner,
  ResponsesToolRunnerError,
  runnerFunction,
} from 'openai/helpers/responses-tool-runner';
import type {
  ResponsesContextBudget,
  ResponsesRunnerCheckpoint,
  ResponsesRunnerOptions,
  RunnerDiagnostic,
} from 'openai/helpers/responses-tool-runner';
import { zodResponsesFunction } from 'openai/helpers/zod';
import { standardResponsesFunction } from 'openai/helpers/standard-schema';
import { z } from 'zod/v4';
import { z as z3 } from 'zod/v3';
import { hasOwn, isObj } from 'openai/internal/utils/values';
import type {
  ComputerAction,
  ResponseFunctionToolCall,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  ResponseInputTextContent,
  ResponseOutputItem,
  Tool,
} from 'openai/resources/responses/responses';
import { describe, expect, test, vi } from 'vitest';

function deferred() {
  let resolve!: () => void;
  // oxlint-disable-next-line promise/avoid-new, promise/param-names -- Tests control when an active driver settles.
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const message: ResponseOutputItem = {
  id: 'msg_fixture',
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text: 'done', annotations: [] }],
};
function call(name: string, args: unknown, id = name): ResponseFunctionToolCall {
  return {
    type: 'function_call',
    id: `item_${id}`,
    call_id: `call_${id}`,
    name,
    status: 'completed',
    arguments: JSON.stringify(args),
  };
}
function state() {
  return { tabs: [{ id: 'one', title: 'Fixture', url: 'https://fixture.invalid/', active: true }] };
}

function harness(
  turns: {
    output: ResponseOutputItem[];
    completedOutput?: ResponseOutputItem[];
    lifecycleOutput?: ResponseOutputItem[];
    status?: string;
    interrupt?: boolean;
    duplicateIndex?: number;
    omitDoneIndices?: number[];
    wireIndices?: number[];
    doneOrder?: number[];
  }[],
) {
  const bodies: Record<string, unknown>[] = [];
  const client = new OpenAI({
    apiKey: 'synthetic-test-key',
    maxRetries: 0,
    // oxlint-disable-next-line complexity -- Emit malformed and contradictory native sequences for runner validation.
    fetch: async (url, init) => {
      const request = new Request(url, init);
      const body = await request.json();
      if (!isObj(body)) {
        throw new Error('Expected request object');
      }
      const turn = turns[bodies.length];
      bodies.push(body);
      if (!turn) {
        throw new Error('Unexpected request');
      }
      const response = {
        id: 'resp_fixture',
        object: 'response',
        model: '',
        status: turn.status ?? 'completed',
        output: turn.output,
      };
      if (!body['stream']) {
        return Response.json(response);
      }
      const events: object[] = [
        {
          type: 'response.created',
          sequence_number: 0,
          response: { ...response, status: 'in_progress', output: [] },
        },
      ];
      if (turn.wireIndices) {
        events.push({
          type: 'response.output_item.added',
          output_index: 0,
          item: null,
          sequence_number: events.length,
        });
      }
      const doneItems = new Map<number, object>();
      for (const [index, item] of turn.output.entries()) {
        const wireIndex = turn.wireIndices?.[index] ?? index;
        events.push({
          type: 'response.output_item.added',
          output_index: wireIndex,
          item: { ...item, status: 'in_progress' },
          sequence_number: events.length,
        });
        if (item.type === 'function_call' && item.id !== undefined) {
          events.push({
            type: 'response.function_call_arguments.delta',
            item_id: item.id,
            output_index: wireIndex,
            delta: '',
            sequence_number: events.length,
          });
        }
        if (turn.omitDoneIndices?.includes(index)) {
          continue;
        }
        const done = {
          type: 'response.output_item.done',
          output_index: wireIndex,
          item,
          sequence_number: events.length,
        };
        doneItems.set(index, done);
        if (turn.doneOrder) {
          continue;
        }
        events.push(done);
        if (turn.duplicateIndex === index) {
          events.push({ ...done, sequence_number: events.length });
        }
      }
      for (const index of turn.doneOrder ?? []) {
        const done = doneItems.get(index);
        if (!done) {
          throw new Error('Missing fixture done item');
        }
        events.push(done);
      }
      if (!turn.interrupt) {
        if (turn.lifecycleOutput) {
          events.push({
            type: 'response.in_progress',
            response: { ...response, status: 'in_progress', output: turn.lifecycleOutput },
            sequence_number: events.length,
          });
        }
        events.push({
          type: 'response.completed',
          response: { ...response, output: turn.completedOutput ?? turn.output },
          sequence_number: events.length,
        });
      }
      const data = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
      return new Response(data, { headers: { 'Content-Type': 'text/event-stream' } });
    },
  });
  return { client, bodies };
}
function wireCall(
  name: string,
  args: unknown,
  id?: string,
): Extract<ResponseOutputItem, { type: 'function_call' }> {
  // SAFETY: The call factory sets both id and completed status required for an output item.
  return call(name, args, id) as Extract<ResponseOutputItem, { type: 'function_call' }>;
}
const input = { model: '', input: 'fixture task', store: false };

test.each(['native', 'ledger', 'budget'] as const)(
  'retains protected native outputs unless plain replay is required (%s)',
  async (mode) => {
    const click = vi.fn(() => 'clicked');
    const browser = new BrowserToolset({ state, click }, { confirm: () => true });
    const h = harness([
      { output: [wireCall('browser_click', { tab_id: null, target: 'one' })] },
      { output: [message] },
    ]);
    const guards: boolean[] = [];
    const create = h.client.responses.create.bind(h.client.responses);
    vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) => {
      if (Array.isArray(params.input)) {
        for (const item of params.input) {
          if (item.type === 'function_call_output') {
            guards.push(hasOwn(item, 'toJSON'));
          }
        }
      }
      return create(params, options);
    });
    const options: ResponsesRunnerOptions = {};
    if (mode === 'ledger') {
      options.ledger = { runId: 'protected-output', save() {} };
    }
    if (mode === 'budget') {
      options.contextBudget = { maxInputBytes: 10_000, maxInputImages: 3 };
    }
    await expect(new ResponsesToolRunner({ browser }).run(h.client, input, options)).resolves.toHaveProperty(
      'output_text',
      'done',
    );
    expect(click).toHaveBeenCalledOnce();
    expect(guards).toEqual([mode === 'native']);
  },
);

test.each(['input', 'content'] as const)(
  'ordinary Responses refuses absent %s slots before transport',
  async (field) => {
    const sparseInput: ResponseInputItem[] = [];
    sparseInput.length = 1;
    const sparseContent: ResponseInputItem.Message['content'] = [];
    sparseContent.length = 1;
    const requestInput: ResponseCreateParamsNonStreaming['input'] =
      field === 'input' ? sparseInput : [{ role: 'user', content: sparseContent }];
    const h = harness([{ output: [wireCall('record', {}, 'r')] }, { output: [message] }]);
    const execute = vi.fn(() => 'recorded');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', strict: false, parameters: {} }, execute }],
    });
    await expect(runner.run(h.client, { ...input, input: requestInput })).rejects.toThrow();
    expect(h.bodies).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  },
);
test('ordinary native input serialization owns getters once, including toJSON content', async () => {
  const counts = { input: 0, item: 0, content: 0, part: 0, json: 0 };
  const content: { type: 'input_text'; text: string }[] = [];
  Object.defineProperty(content, 0, {
    enumerable: false,
    get() {
      counts.part += 1;
      return { type: 'input_text', text: 'fresh' };
    },
  });
  const items: ResponseInputItem[] = [];
  Object.defineProperty(items, 0, {
    enumerable: false,
    get() {
      counts.item += 1;
      return {
        toJSON() {
          counts.json += 1;
          return {
            role: 'user',
            get content() {
              counts.content += 1;
              return content;
            },
          };
        },
      };
    },
  });
  const request = {
    ...input,
    get input() {
      counts.input += 1;
      return items;
    },
  };
  const h = harness([{ output: [message] }]);
  await new ResponsesToolRunner({}).run(h.client, request);
  expect(h.bodies[0]?.['input']).toEqual([
    { role: 'user', content: [{ type: 'input_text', text: 'fresh' }] },
  ]);
  expect(counts).toEqual({ input: 1, item: 1, content: 1, part: 1, json: 1 });
});
test.each([
  { content: [null] },
  { content: [{ type: 'output_text', text: null, annotations: [] }] },
  { content: [{ type: 'refusal', refusal: null }] },
  { phase: 'unsupported' },
  { content: [{ type: 'output_text', text: 'fixture' }] },
  { content: [{ type: 'output_text', text: 'fixture', annotations: null }] },
  { content: [{ type: 'output_text', text: 'fixture', annotations: [null] }] },
  {
    content: [
      {
        type: 'output_text',
        text: 'fixture',
        annotations: [{ type: 'file_citation', file_id: 'f', index: 0 }],
      },
    ],
  },
  {
    content: [
      {
        type: 'output_text',
        text: 'fixture',
        annotations: [
          { type: 'url_citation', url: 'fixture', title: 'fixture', start_index: 0, end_index: '1' },
        ],
      },
    ],
  },
  {
    content: [
      {
        type: 'output_text',
        text: 'fixture',
        annotations: [
          { type: 'container_file_citation', file_id: 'f', filename: 'f', start_index: 0, end_index: 1 },
        ],
      },
    ],
  },
  {
    content: [
      {
        type: 'output_text',
        text: 'fixture',
        annotations: [{ type: 'file_path', file_id: 'f', index: null }],
      },
    ],
  },
  { content: [{ type: 'output_text', text: 'fixture', annotations: [{ type: 'unknown' }] }] },
  { content: [{ type: 'output_text', text: 'fixture', annotations: [], logprobs: 'invalid' }] },
  { content: [{ type: 'output_text', text: 'fixture', annotations: [], logprobs: [null] }] },
  {
    content: [
      {
        type: 'output_text',
        text: 'fixture',
        annotations: [],
        logprobs: [{ token: 'x', bytes: [null], logprob: -1, top_logprobs: [] }],
      },
    ],
  },
  {
    content: [
      {
        type: 'output_text',
        text: 'fixture',
        annotations: [],
        logprobs: [{ token: 'x', bytes: [120], logprob: -1, top_logprobs: [null] }],
      },
    ],
  },
  {
    content: [
      {
        type: 'output_text',
        text: 'fixture',
        annotations: [],
        logprobs: [
          {
            token: 'x',
            bytes: [120],
            logprob: -1,
            top_logprobs: [{ token: 'x', bytes: [120], logprob: 'invalid' }],
          },
        ],
      },
    ],
  },
  { role: 'user' },
  { id: null },
])('preflights completed native message $content $role $id before any sibling effect', async (changes) => {
  const execute = vi.fn(() => 'recorded');
  const runner = new ResponsesToolRunner({
    functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
  });
  const malformed = { ...message, ...changes };
  // SAFETY: Deliberately malformed wire data tests refusal before a valid sibling executes.
  const h = harness([{ output: [malformed as ResponseOutputItem, call('record', {})] }]);
  await expect(runner.run(h.client, input)).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});

test('non-ledger supplied requestOptions retain identity if their signal is already effective', async () => {
  const h = harness([{ output: [message] }]);
  const { signal } = new AbortController();
  const requestOptions = { signal };
  Object.defineProperty(requestOptions, 'timeout', { value: 451, enumerable: false });
  const create = vi.spyOn(h.client.responses, 'create');
  await new ResponsesToolRunner({}).run(h.client, input, { requestOptions });
  expect(create.mock.calls[0]?.[1]).toBe(requestOptions);
  expect(create.mock.calls[0]?.[1]?.timeout).toBe(451);
});

test.each([
  { signal: false, mcp: false },
  { signal: true, mcp: false },
  { signal: false, mcp: true },
  { signal: true, mcp: true },
])('request overlays keep native getters live, signal=$signal mcp=$mcp', async (mode) => {
  class NativeOptions implements OpenAI.RequestOptions {
    declare readonly headers: NonNullable<OpenAI.RequestOptions['headers']>;
    #revision = 1;

    constructor() {
      Object.defineProperty(this, 'headers', {
        enumerable: true,
        get() {
          return { 'x-revision': String(this.#revision) };
        },
      });
      Object.freeze(this);
    }

    advance() {
      this.#revision = 2;
    }
  }
  const requestOptions = new NativeOptions();
  const sent: (string | null)[] = [];
  const client = new OpenAI({
    apiKey: 'synthetic-test-key',
    maxRetries: 0,
    fetch: async (url, init) => {
      sent.push(new Request(url, init).headers.get('x-revision'));
      return Response.json({
        id: 'resp_fixture',
        object: 'response',
        status: 'completed',
        output: sent.length === 1 ? [call('advance', {})] : [message],
      });
    },
  });
  const runner = new ResponsesToolRunner({
    functions: [
      {
        tool: { type: 'function', name: 'advance', parameters: {}, strict: false },
        execute() {
          requestOptions.advance();
          return 'advanced';
        },
      },
    ],
  });
  await runner.run(
    client,
    {
      input: 'fixture',
      ...(mode.mcp
        ? {
            tools: [
              { type: 'mcp' as const, server_label: 'fixture', server_url: 'https://fixture.invalid/mcp' },
            ],
          }
        : {}),
    },
    { requestOptions, ...(mode.signal ? { signal: new AbortController().signal } : {}) },
  );
  expect(sent).toEqual(['1', '2']);
});

test.each([
  { content: [null] },
  { content: [{ type: 'reasoning_text' }] },
  { encrypted_content: {} },
  { status: 'other' },
  { status: null },
  { content: null },
])('refuses invalid native reasoning before a normal sibling function: %j', async (changes) => {
  const execute = vi.fn(() => 'recorded');
  const runner = new ResponsesToolRunner({
    functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
  });
  // SAFETY: Simulate untyped malformed provider data entering native replay preflight.
  const reasoning = { type: 'reasoning', id: 'rs', summary: [], ...changes } as ResponseOutputItem;
  const h = harness([{ output: [call('record', {}), reasoning] }]);
  await expect(runner.run(h.client, input)).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
  expect(h.bodies).toHaveLength(1);
});

test.each(['completed', 'incomplete', 'in_progress', undefined] as const)(
  'native reasoning replay preserves valid status %s, opaque content, and omission',
  async (status) => {
    const execute = vi.fn(() => 'recorded');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const reasoning: ResponseOutputItem = {
      type: 'reasoning',
      id: 'rs',
      summary: [{ type: 'summary_text', text: '' }],
      ...(status === undefined ? {} : { status, content: [{ type: 'reasoning_text' as const, text: '' }] }),
      encrypted_content: status === undefined ? null : 'opaque:%00/source',
    };
    const h = harness([{ output: [call('record', {}), reasoning] }, { output: [message] }]);
    await runner.run(h.client, input);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(h.bodies[1]?.['input']).toEqual(expect.arrayContaining([reasoning]));
  },
);

test('independent eager receipts settle before reading final response usage', async () => {
  const held = deferred();
  const finalizing = deferred();
  const execute = vi.fn(() => held.promise.then(() => 'recorded'));
  const runner = new ResponsesToolRunner({
    functions: [
      {
        tool: { type: 'function', name: 'record', parameters: {}, strict: false },
        execute,
        independent: true,
      },
    ],
  });
  const h = harness([{ output: [call('record', {})] }]);
  const stream = h.client.responses.stream.bind(h.client.responses);
  const usage = vi.fn(() => {
    throw new Error('fixture usage unavailable');
  });
  vi.spyOn(h.client.responses, 'stream').mockImplementation((params, options) => {
    const opened = stream(params, options);
    const final = opened.finalResponse.bind(opened);
    vi.spyOn(opened, 'finalResponse').mockImplementation(async () => {
      const response = await final();
      Object.defineProperty(response, 'usage', { enumerable: true, get: usage });
      finalizing.resolve();
      return response;
    });
    return opened;
  });
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Observe failure concurrently while testing retained ownership.
  const outcome = runner.run(h.client, input, { stream: true, eager: true }).catch((error: unknown) => error);
  await finalizing.promise;
  // Allow the finalResponse continuation to reach metadata or the settle barrier.
  await Promise.resolve();
  await Promise.resolve();
  const readBeforeRelease = usage.mock.calls.length;
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Attach rejection handling before releasing the held effect.
  const busy = runner.run(h.client, input).catch((error: unknown) => error);
  held.resolve();
  expect(await busy).toBeInstanceOf(Error);
  expect(await outcome).toMatchObject({
    attemptedCallIds: ['call_record'],
    completedCallIds: ['call_record'],
  });
  expect(readBeforeRelease).toBe(0);
  expect(usage).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledTimes(1);
});

test('preserves native citation/logprob metadata, nulls, and extensions on replay', async () => {
  const metadata = {
    id: '',
    phase: null,
    extension: { kept: 'message' },
    content: [
      {
        type: 'output_text',
        text: 'fixture',
        extension: { kept: 'part' },
        annotations: [
          { type: 'file_citation', file_id: '', filename: '', index: -1, extension: 'file' },
          { type: 'url_citation', url: 'opaque', title: '', start_index: -2, end_index: 3, extension: 'url' },
          {
            type: 'container_file_citation',
            container_id: '',
            file_id: '',
            filename: '',
            start_index: 0,
            end_index: 1,
            extension: 'container',
          },
          { type: 'file_path', file_id: '', index: 0, extension: 'path' },
        ],
        logprobs: [
          {
            token: '',
            bytes: [-1, 256],
            logprob: -0.25,
            extension: 'token',
            top_logprobs: [{ token: '', bytes: [120], logprob: 0, extension: 'top' }],
          },
        ],
      },
      { type: 'output_text', text: 'nullable output', annotations: [], logprobs: null },
      { type: 'output_text', text: 'omitted logprobs', annotations: [] },
      { type: 'refusal', refusal: 'fixture refusal', extension: 'refusal' },
    ],
  };

  const execute = vi.fn(() => 'recorded');
  const runner = new ResponsesToolRunner({
    functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
  });
  // SAFETY: Native Python output permits nullable logprobs; exercise its actual wire representation.
  const replay = { ...message, ...metadata } as ResponseOutputItem;
  const h = harness([{ output: [call('record', {}), replay] }, { output: [message] }]);
  await runner.run(h.client, input);
  expect(execute).toHaveBeenCalledOnce();
  expect(h.bodies[1]?.['input']).toEqual(expect.arrayContaining([expect.objectContaining(metadata)]));
});

describe('runner registration and stream compatibility', () => {
  const tool = { type: 'function' as const, name: 'record', parameters: {}, strict: false };

  test('function identity must belong to a serialized object declaration', () => {
    const declaration = Object.assign([], tool);
    const execute = vi.fn(() => 'unexpected');
    expect(JSON.stringify(declaration)).toBe('[]');
    expect(() => new ResponsesToolRunner({ functions: [{ tool: declaration, execute }] })).toThrow(
      'Registered functions require a function declaration',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  test('captures function declarations before the caller changes their name or schema', async () => {
    const declaration = { ...tool, parameters: { type: 'object', description: 'original' } };
    const expected = structuredClone(declaration);
    const execute = vi.fn(() => 'done');
    const runner = new ResponsesToolRunner({ functions: [{ tool: declaration, execute }] });
    declaration.name = 'changed';
    declaration.parameters.description = 'changed';
    const h = harness([{ output: [call('record', {})] }, { output: [message] }]);
    await runner.run(h.client, input);
    expect(h.bodies.map((body) => body['tools'])).toEqual([[expected], [expected]]);
    expect(execute).toHaveBeenCalledOnce();
  });

  test('captures an ordinary executor before the first request while retaining its receiver', async () => {
    const registration = {
      tool,
      value: 'original',
      execute() {
        return this.value;
      },
    };
    const runner = new ResponsesToolRunner({ functions: [registration] });
    const replacement = vi.fn(() => 'replacement');
    const h = harness([{ output: [call('record', {})] }, { output: [message] }]);
    await runner.run(h.client, input, {
      stream: true,
      onEvent: () => {
        registration.execute = replacement;
      },
    });
    expect(replacement).not.toHaveBeenCalled();
    expect(h.bodies[1]?.['input']).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_record',
      output: 'original',
    });
  });

  test.each([{}, { filename: 'fixture.txt' }, { file_data: ' ', file_id: '', file_url: '' }])(
    'rejects a file without a source before the next effect: %j',
    async (fields) => {
      const later = vi.fn(() => 'later');
      const h = harness([{ output: [call('record', {}), call('later', {})] }]);
      const runner = new ResponsesToolRunner({
        functions: [
          { tool, execute: () => [{ type: 'input_file', ...fields }] },
          { tool: { ...tool, name: 'later' }, execute: later },
        ],
      });
      await expect(runner.run(h.client, input)).rejects.toMatchObject({
        attemptedCallIds: ['call_record'],
        completedCallIds: [],
      });
      expect(later).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );

  test('binds the early-call policy to its original options', async () => {
    const effect = vi.fn(() => 'done');
    const h = harness([{ output: [call('record', {})] }, { output: [message] }]);
    const options = {
      stream: true,
      eager: true,
      allowed: true,
      beforeEarlyCall() {
        return this.allowed ? ('defer' as const) : ('execute' as const);
      },
    };
    await new ResponsesToolRunner({ functions: [{ tool, execute: effect }] }).run(h.client, input, options);
    expect(effect).toHaveBeenCalledOnce();
  });

  test.each(['ciphertext', 'id', 'summary', 'arguments', 'missing-ciphertext'] as const)(
    'reconciles opaque reasoning while preserving public fields: %s',
    async (change) => {
      const reasoning: ResponseOutputItem = {
        type: 'reasoning',
        id: 'rs',
        summary: [],
        encrypted_content: 'stream-ciphertext',
      };
      const pendingCall = call('record', {});
      const output = [reasoning, pendingCall];
      const terminalReasoning = structuredClone(reasoning);
      const terminalCall = structuredClone(pendingCall);
      const terminal = [terminalReasoning, terminalCall];
      if (change === 'arguments') {
        terminalCall.arguments = '{"changed":true}';
      } else if (change === 'id') {
        terminalReasoning.id = 'different';
      } else if (change === 'summary') {
        terminalReasoning.summary = [{ type: 'summary_text', text: 'different' }];
      } else if (change === 'missing-ciphertext') {
        delete terminalReasoning.encrypted_content;
      } else {
        terminalReasoning.encrypted_content = 'terminal-ciphertext';
      }
      const effect = vi.fn(() => 'done');
      const records: ResponsesRunnerCheckpoint[] = [];
      const h = harness([{ output, completedOutput: terminal }, { output: [message] }]);
      const runner = new ResponsesToolRunner({
        functions: [{ tool, execute: effect }],
        earlyExecution: { functions: [] },
      });
      const result = runner.run(h.client, input, {
        stream: true,
        eager: true,
        ledger: {
          runId: 'fixture',
          save: (value) => {
            records.push(value);
          },
        },
      });
      if (change === 'ciphertext') {
        await result;
        expect(effect).toHaveBeenCalledOnce();
        expect(h.bodies[1]?.['input']).toContainEqual({
          ...reasoning,
          encrypted_content: 'terminal-ciphertext',
        });
        expect(records.find((record) => record.phase === 'final')?.history).toContainEqual({
          ...reasoning,
          encrypted_content: 'terminal-ciphertext',
        });
      } else {
        await expect(result).rejects.toThrow('differs');
        expect(effect).not.toHaveBeenCalled();
        expect(h.bodies).toHaveLength(1);
      }
    },
  );

  test('appends a large completed response without argument-count limits', async () => {
    const output: ResponseOutputItem[] = Array.from({ length: 140_000 }, (_, index) => ({
      type: 'reasoning',
      id: `rs_${index}`,
      summary: [],
    }));
    output.push(call('record', {}));
    const effect = vi.fn(() => 'done');
    const h = harness([{ output }, { output: [message] }]);
    await new ResponsesToolRunner({ functions: [{ tool, execute: effect }] }).run(h.client, input);
    expect(effect).toHaveBeenCalledOnce();
    expect(h.bodies[1]?.['input']).toHaveLength(140_003);
  });
});

test.each(['browser', 'computer'] as const)(
  'keeps the admitted %s when the caller replaces the registry',
  async (kind) => {
    const original = vi.fn();
    const replacement = vi.fn();
    const screenshot = { type: 'computer_screenshot' as const, file_id: 'file_fixture' };
    const computer = (effect: () => void) =>
      new ComputerToolset({
        click: effect,
        double_click: effect,
        drag: effect,
        keypress: effect,
        move: effect,
        scroll: effect,
        type: effect,
        wait: effect,
        screenshot: () => screenshot,
      });
    const registry = {
      browser: new BrowserToolset({
        state,
        get_page_text: () => {
          original();
          return 'original';
        },
      }),
      computer: computer(original),
    };
    const pending: ResponseOutputItem =
      kind === 'browser'
        ? call('browser_get_page_text', { tab_id: null })
        : {
            type: 'computer_call',
            id: 'item_computer',
            call_id: 'call_computer',
            status: 'completed',
            actions: [{ type: 'wait' }],
            pending_safety_checks: [],
          };
    const h = harness([{ output: [pending] }, { output: [message] }]);
    const iterator = new ResponsesToolRunner(registry).iterate(h.client, input);
    const first = await iterator.next();
    expect(first.done).toBe(false);
    registry.browser = new BrowserToolset({
      state,
      get_page_text: () => {
        replacement();
        return 'replacement';
      },
    });
    registry.computer = computer(replacement);
    await iterator.next();
    await iterator.return();
    expect(original).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
  },
);

test('projects browser tabs by their captured array length without reading a custom iterator', async () => {
  const { tabs } = state();
  const iterate = vi.fn(() => [{ ...tabs[0], id: 'extra', active: true }].values());
  Object.defineProperty(tabs, Symbol.iterator, { value: iterate });
  const browser = new BrowserToolset({ state: () => ({ tabs }) });
  const result = await browser.execute(call('browser_list_tabs', {}));
  expect(iterate).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).toContain('one');
  expect(JSON.stringify(result)).not.toContain('extra');
});

test('accepts screenshot content with the optional detail omitted', async () => {
  const driver: BrowserDriver = {
    state,
    screenshot: () => ({ type: 'input_image', file_id: 'file_fixture' }),
  };
  const result = await new BrowserToolset(driver).execute(call('browser_screenshot', { tab_id: null }));
  expect(result.output).toContainEqual({ type: 'input_image', file_id: 'file_fixture' });
});

test.each([false, true])('failed requests emit one private diagnostic (stream=%s)', async (stream) => {
  const events: RunnerDiagnostic[] = [];
  const transport = vi.fn(async () =>
    Response.json({ error: { message: 'private failure detail' } }, { status: 500 }),
  );
  const client = new OpenAI({ apiKey: 'fake', maxRetries: 0, fetch: transport });
  await expect(
    new ResponsesToolRunner({}).run(client, input, {
      stream,
      onDiagnostic: (event) => {
        events.push(event);
      },
    }),
  ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ stage: 'request', reason: 'api_failed', usage: null });
  expect(JSON.stringify(events)).not.toContain('private failure detail');
});

function recording() {
  const writes: ResponsesRunnerCheckpoint[] = [];
  return {
    writes,
    ledger: {
      runId: 'context',
      save(value: ResponsesRunnerCheckpoint) {
        writes.push(structuredClone(value));
      },
    },
  };
}

function recordingComputer(effect: () => void) {
  return new ComputerToolset({
    click: effect,
    double_click: effect,
    drag: effect,
    keypress: effect,
    move: effect,
    scroll: effect,
    type: effect,
    wait: effect,
    screenshot: () => ({ type: 'computer_screenshot', file_id: 'file_fixture' }),
  });
}

test.each(
  (['browser', 'computer'] as const).flatMap((kind) =>
    (['ledger', 'budget', 'both'] as const).map((mode) => ({ kind, mode })),
  ),
)('replays direct $kind helper output with $mode', async ({ kind, mode }) => {
  const screenshot = vi.fn(() => ({ type: 'input_image' as const, file_id: 'file_observed' }));
  const effect = vi.fn();
  const browser = new BrowserToolset({ state, screenshot });
  const computer = recordingComputer(effect);
  const item: ResponseOutputItem =
    kind === 'browser'
      ? wireCall('browser_screenshot', { tab_id: null })
      : {
          type: 'computer_call',
          id: 'computer_item',
          call_id: 'computer_call',
          status: 'completed',
          pending_safety_checks: [],
          actions: [{ type: 'click', x: 1, y: 2, button: 'left' }],
        };
  const output = item.type === 'function_call' ? await browser.execute(item) : await computer.execute(item);
  Object.freeze(output);
  if (typeof output.output === 'object' && output.output !== null) {
    Object.freeze(output.output);
  }
  const saved = recording();
  const h = harness([{ output: [message] }]);
  await expect(
    new ResponsesToolRunner({ browser, computer }).run(
      h.client,
      { ...input, input: [item, output] },
      {
        ...(mode === 'budget' ? {} : { ledger: saved.ledger }),
        ...(mode === 'ledger' ? {} : { contextBudget: { maxInputBytes: 20_000, maxInputImages: 2 } }),
      },
    ),
  ).resolves.toHaveProperty('output_text', 'done');
  expect(h.bodies).toHaveLength(1);
  expect(h.bodies[0]?.['input']).toEqual([item, output]);
  expect(screenshot).toHaveBeenCalledTimes(kind === 'browser' ? 1 : 0);
  expect(effect).toHaveBeenCalledTimes(kind === 'computer' ? 1 : 0);
});

test.each(
  (['array', 'object'] as const).flatMap((target) =>
    (['hidden', 'callable', 'getter'] as const).flatMap((invalid) =>
      (['ledger', 'budget'] as const).map((mode) => ({ target, invalid, mode })),
    ),
  ),
)('rejects $invalid data on $target beside a JSON guard with $mode', async ({ target, invalid, mode }) => {
  const content = [{ type: 'input_text' as const, text: 'fixture' }];
  const output: ResponseInputItem.FunctionCallOutput = {
    type: 'function_call_output',
    call_id: 'call_record',
    output: content,
  };
  const value = target === 'array' ? content : output;
  const hook = vi.fn(() => 'must not run');
  Object.defineProperty(value, 'toJSON', { value: undefined, configurable: true });
  if (invalid === 'hidden') {
    Object.defineProperty(value, 'other', { value: 'hidden' });
  } else {
    Object.defineProperty(
      value,
      'toJSON',
      invalid === 'getter' ? { get: hook } : { value: hook, enumerable: true },
    );
  }
  const h = harness([{ output: [message] }]);
  await expect(
    new ResponsesToolRunner({}).run(
      h.client,
      { ...input, input: [wireCall('record', {}), output] },
      mode === 'ledger'
        ? { ledger: recording().ledger }
        : { contextBudget: { maxInputBytes: 20_000, maxInputImages: 2 } },
    ),
  ).rejects.toThrow(TypeError);
  expect(hook).not.toHaveBeenCalled();
  expect(h.bodies).toEqual([]);
});

test.each(['ledger', 'budget'] as const)(
  'rejects a guarded sparse array with a symbol in %s',
  async (mode) => {
    const content = [{ type: 'input_text' as const, text: 'fixture' }];
    delete content[0];
    Object.defineProperty(content, 'toJSON', { value: undefined });
    Object.defineProperty(content, Symbol('extra'), { value: 'hidden' });
    const h = harness([{ output: [message] }]);
    await expect(
      new ResponsesToolRunner({}).run(
        h.client,
        {
          ...input,
          input: [
            wireCall('record', {}),
            { type: 'function_call_output', call_id: 'call_record', output: content },
          ],
        },
        mode === 'ledger'
          ? { ledger: recording().ledger }
          : { contextBudget: { maxInputBytes: 20_000, maxInputImages: 2 } },
      ),
    ).rejects.toThrow(TypeError);
    expect(h.bodies).toEqual([]);
  },
);

describe('computer wire values in streams and ledgers', () => {
  test.each(
    (['browser', 'computer', 'function'] as const).flatMap((kind) =>
      [
        { stream: false, eager: false },
        { stream: true, eager: false },
        { stream: true, eager: true },
      ].map((mode) => ({ kind, ...mode })),
    ),
  )(
    'preserves an empty $kind call ID through execution and resume: $stream/$eager',
    async ({ kind, ...mode }) => {
      const effect = vi.fn(() => 'done');
      const item: ResponseOutputItem =
        kind === 'computer'
          ? {
              type: 'computer_call',
              id: 'computer_item',
              call_id: '',
              status: 'completed',
              pending_safety_checks: [],
              actions: [{ type: 'wait' }],
            }
          : {
              ...call(
                kind === 'browser' ? 'browser_read_page' : 'local',
                kind === 'browser' ? { tab_id: null, filter: 'all' } : {},
              ),
              call_id: '',
            };
      const runner = new ResponsesToolRunner({
        ...(kind === 'computer' ? { computer: recordingComputer(effect) } : {}),
        ...(kind === 'browser' ? { browser: new BrowserToolset({ state, read_page: effect }) } : {}),
        ...(kind === 'function'
          ? {
              functions: [
                {
                  tool: { type: 'function' as const, name: 'local', strict: false, parameters: {} },
                  execute: effect,
                },
              ],
            }
          : {}),
      });
      const h = harness([{ output: [item] }, { output: [message] }]);
      const saved = recording();
      await expect(runner.run(h.client, input, { ...mode, ledger: saved.ledger })).resolves.toHaveProperty(
        'output_text',
        'done',
      );
      expect(effect).toHaveBeenCalledTimes(1);
      const boundary = saved.writes.find(
        (value) => value.phase === 'boundary' && value.returned_call_ids.includes(''),
      );
      if (!boundary) {
        throw new Error('Expected a completed empty-ID boundary');
      }
      expect(boundary.returned_call_ids).toEqual(['']);
      const resumed = harness([{ output: [message] }]);
      await expect(
        runner.run(resumed.client, input, { ...mode, ledger: { ...saved.ledger, resumeFrom: boundary } }),
      ).resolves.toHaveProperty('output_text', 'done');
      expect(resumed.bodies[0]?.['input']).toContainEqual(item);
      expect(effect).toHaveBeenCalledTimes(1);
    },
  );

  const modes = [
    { stream: true, eager: true, ledger: false },
    { stream: true, eager: false, ledger: false },
    { stream: false, eager: false, ledger: true },
    { stream: true, eager: true, ledger: true },
  ];
  const actions: ComputerAction[] = [
    { type: 'click', x: 1, y: 2, button: 'left' },
    { type: 'drag', path: [{ x: 1, y: 2 }] },
    { type: 'move', x: 1, y: 2 },
    { type: 'scroll', x: 1, y: 2, scroll_x: 0, scroll_y: 4 },
  ];

  test.each(actions.flatMap((action) => modes.map((mode) => ({ action, ...mode }))))(
    'preserves omitted $action.type modifiers: stream=$stream eager=$eager ledger=$ledger',
    async ({ action, stream, eager, ledger }) => {
      const effect = vi.fn();
      const item: ResponseOutputItem = {
        type: 'computer_call',
        id: 'computer_item',
        call_id: 'native_one',
        status: 'completed',
        pending_safety_checks: [],
        actions: [action],
      };
      const h = harness([{ output: [item] }, { output: [message] }]);
      const saved = recording();
      await expect(
        new ResponsesToolRunner({ computer: recordingComputer(effect) }).run(h.client, input, {
          stream,
          eager,
          ...(ledger ? { ledger: saved.ledger } : {}),
        }),
      ).resolves.toHaveProperty('output_text', 'done');
      expect(effect).toHaveBeenCalledTimes(1);
      expect(h.bodies[1]?.['input']).toContainEqual(item);
      if (ledger) {
        const boundary = saved.writes.find(
          (value) => value.phase === 'boundary' && value.returned_call_ids.includes('native_one'),
        );
        expect(boundary?.history).toContainEqual(item);
        expect(boundary?.returned_call_ids).toEqual(['native_one']);
      }
    },
  );

  test.each([
    { stream: false, eager: false },
    { stream: true, eager: false },
    { stream: true, eager: true },
  ])('preserves an empty computer item ID through resume: $stream/$eager', async (mode) => {
    const effect = vi.fn();
    const item: ResponseOutputItem = {
      type: 'computer_call',
      id: '',
      call_id: 'native_one',
      status: 'completed',
      pending_safety_checks: [],
      actions: [{ type: 'wait' }],
    };
    const h = harness([{ output: [item] }, { output: [message] }]);
    const saved = recording();
    const runner = new ResponsesToolRunner({ computer: recordingComputer(effect) });
    await expect(runner.run(h.client, input, { ...mode, ledger: saved.ledger })).resolves.toHaveProperty(
      'output_text',
      'done',
    );
    const boundary = saved.writes.find(
      (value) => value.phase === 'boundary' && value.returned_call_ids.includes('native_one'),
    );
    expect(boundary?.history).toContainEqual(item);
    if (!boundary) {
      throw new Error('Expected resumable computer boundary');
    }
    const resumed = harness([{ output: [message] }]);
    await expect(
      runner.run(resumed.client, input, { ...mode, ledger: { ...saved.ledger, resumeFrom: boundary } }),
    ).resolves.toHaveProperty('output_text', 'done');
    expect(resumed.bodies[0]?.['input']).toContainEqual(item);
    expect(effect).toHaveBeenCalledTimes(1);
  });
});

describe('emitted server types and ledger choices', () => {
  const tool: Tool = { type: 'function', name: 'record', parameters: {}, strict: false };
  const mcp: Tool = { type: 'mcp', server_label: 'owned', server_url: 'https://fixture.invalid/mcp' };

  test.each([false, true])('rejects a missing output type before local input, ledger=%s', async (ledger) => {
    const server: ResponseOutputItem = {
      type: 'mcp_list_tools',
      id: 'list',
      server_label: 'owned',
      tools: [],
    };
    Reflect.deleteProperty(server, 'type');
    const effect = vi.fn(() => 'done');
    const h = harness([{ output: [server, call('record', {})] }]);
    const runner = new ResponsesToolRunner({ functions: [{ tool, execute: effect }] });
    await expect(
      runner.run(h.client, { ...input, tools: [mcp] }, ledger ? { ledger: recording().ledger } : {}),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    expect(effect).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(1);
  });

  test.each([undefined, 'auto', 'required'] as const)(
    'retains the emitted ledger tool choice %s',
    async (choice) => {
      const effect = vi.fn(() => 'done');
      const h = harness([{ output: [message] }]);
      const params: ResponseCreateParamsNonStreaming = {
        ...input,
        tools: [{ type: 'web_search' }],
        ...(choice === undefined ? {} : { tool_choice: choice }),
      };
      const runner = new ResponsesToolRunner({ functions: [{ tool, execute: effect }] });
      await runner.run(h.client, params, { ledger: recording().ledger });
      expect(h.bodies).toHaveLength(1);
      expect(hasOwn(h.bodies[0] ?? {}, 'tool_choice')).toBe(choice !== undefined);
      expect(h.bodies[0]?.['tool_choice']).toBe(choice);
      expect(effect).not.toHaveBeenCalled();
    },
  );

  test('retains a valid emitted server output', async () => {
    const server: ResponseOutputItem = {
      type: 'mcp_list_tools',
      id: 'list',
      server_label: 'owned',
      tools: [],
    };
    const h = harness([{ output: [server, message] }]);
    const result = await new ResponsesToolRunner({}).run(h.client, { ...input, tools: [mcp] });
    expect(result.output).toContainEqual(server);
    expect(h.bodies).toHaveLength(1);
  });
});

const functionTool = (name: string): Extract<Tool, { type: 'function' }> => ({
  type: 'function',
  name,
  parameters: {},
  strict: false,
});

describe('MCP approval tool choice', () => {
  const mcp: Tool.Mcp = {
    type: 'mcp',
    server_label: 'desk',
    server_url: 'https://fixture.invalid/mcp',
    require_approval: 'always',
  };
  const approval: ResponseOutputItem.McpApprovalRequest = {
    type: 'mcp_approval_request',
    id: 'approval',
    server_label: 'desk',
    name: 'read',
    arguments: '{}',
  };
  const choices: {
    label: string;
    choice: NonNullable<ResponseCreateParamsNonStreaming['tool_choice']>;
    allowed: boolean;
    allowedTools?: Tool.Mcp['allowed_tools'];
  }[] = [
    { label: 'none', choice: 'none', allowed: false },
    { label: 'other server', choice: { type: 'mcp', server_label: 'other' }, allowed: false },
    { label: 'other name', choice: { type: 'mcp', server_label: 'desk', name: 'write' }, allowed: false },
    { label: 'other type', choice: { type: 'web_search_preview' }, allowed: false },
    { label: 'exact name', choice: { type: 'mcp', server_label: 'desk', name: 'read' }, allowed: true },
    { label: 'null name', choice: { type: 'mcp', server_label: 'desk', name: null }, allowed: true },
    { label: 'whole server', choice: { type: 'mcp', server_label: 'desk' }, allowed: true },
    {
      label: 'allowed set',
      choice: {
        type: 'allowed_tools',
        mode: 'auto',
        tools: [
          { type: 'mcp', server_label: 'desk', name: 'write' },
          { type: 'mcp', server_label: 'desk', name: 'read' },
        ],
      },
      allowed: true,
    },
    { label: 'auto', choice: 'auto', allowed: true },
    { label: 'empty declared list', choice: 'auto', allowed: false, allowedTools: [] },
    { label: 'excluded declared name', choice: 'auto', allowed: false, allowedTools: ['write'] },
    { label: 'included declared name', choice: 'auto', allowed: true, allowedTools: ['read'] },
    { label: 'empty declared filter', choice: 'auto', allowed: false, allowedTools: { tool_names: [] } },
    {
      label: 'excluded declared filter',
      choice: 'auto',
      allowed: false,
      allowedTools: { tool_names: ['write'] },
    },
    {
      label: 'included declared filter',
      choice: 'auto',
      allowed: true,
      allowedTools: { tool_names: ['read'] },
    },
    { label: 'service-only filter', choice: 'auto', allowed: true, allowedTools: { read_only: true } },
    { label: 'null declared filter', choice: 'auto', allowed: true, allowedTools: null },
  ];
  test.each(choices.slice(0, 7))('completed MCP selection checks $label', async ({ choice, allowed }) => {
    const completed: ResponseOutputItem.McpCall = {
      type: 'mcp_call',
      id: 'remote',
      server_label: 'desk',
      name: 'read',
      arguments: '{}',
      output: 'recorded',
    };
    const h = harness([{ output: [completed, message] }]);
    const result = new ResponsesToolRunner({}).run(h.client, {
      ...input,
      tools: [{ ...mcp, require_approval: 'never' }],
      tool_choice: choice,
    });
    await (allowed
      ? expect(result).resolves.toHaveProperty('output', [completed, message])
      : expect(result).rejects.toBeInstanceOf(ResponsesToolRunnerError));
    expect(h.bodies).toHaveLength(1);
  });

  test.each([true, false])('MCP approval diagnostics can cancel before recording %s', async (approve) => {
    const controller = new AbortController();
    const h = harness([{ output: [approval] }]);
    const saved = recording();
    await expect(
      new ResponsesToolRunner({}).run(
        h.client,
        { ...input, tools: [mcp] },
        {
          signal: controller.signal,
          ledger: saved.ledger,
          approveMcp: () => approve,
          onDiagnostic: (event) => {
            if (event.stage === 'approval' && event.reason === (approve ? 'completed' : 'refused')) {
              controller.abort();
            }
          },
        },
      ),
    ).rejects.toMatchObject({ attemptedCallIds: [approval.id], completedCallIds: [] });
    expect(h.bodies).toHaveLength(1);
    expect(saved.writes.every((entry) => entry.returned_call_ids.length === 0)).toBe(true);
    expect(saved.writes.every((entry) => entry.returned_outputs.length === 0)).toBe(true);
  });

  test.each(['input_schema', 'extension'])(
    'MCP replayable tools reject invalid %s before effects',
    async (field) => {
      const listed: ResponseOutputItem.McpListTools = {
        type: 'mcp_list_tools',
        id: 'listed',
        server_label: 'desk',
        tools: [{ name: 'read', input_schema: {} }],
      };
      const h = harness([{ output: [call('record', {}), listed] }, { output: [message] }]);
      const create = h.client.responses.create.bind(h.client.responses);
      vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) =>
        create(params, options)._thenUnwrap((response) => {
          if ('output' in response) {
            const item = response.output.find((entry) => entry.type === 'mcp_list_tools');
            if (item?.type === 'mcp_list_tools' && item.tools[0]) {
              Reflect.set(item.tools[0], field, { value: 1n });
            }
          }
          return response;
        }),
      );
      const effect = vi.fn(() => 'recorded');
      const runner = new ResponsesToolRunner({
        functions: [{ tool: functionTool('record'), execute: effect }],
      });
      await expect(runner.run(h.client, { ...input, tools: [mcp] })).rejects.toBeInstanceOf(
        ResponsesToolRunnerError,
      );
      expect(effect).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );

  test.each([
    { fields: {}, valid: true },
    { fields: { description: null }, valid: true },
    { fields: { description: 'Read a local fixture' }, valid: true },
    { fields: { description: 3 }, valid: false },
    { fields: { description: false }, valid: false },
    { fields: { description: { text: 'read' } }, valid: false },
  ])('MCP list metadata before sibling dispatch: $fields', async ({ fields, valid }) => {
    const listed: ResponseOutputItem.McpListTools = {
      type: 'mcp_list_tools',
      id: 'listed',
      server_label: 'desk',
      // @ts-expect-error Invalid native metadata must be checked before sibling effects.
      tools: [{ name: 'read', input_schema: {}, annotations: ['free', 1, null], ...fields }],
    };
    const h = harness([{ output: [call('record', {}), listed] }, { output: [message] }]);
    const execute = vi.fn(() => 'permitted');
    const approveMcp = vi.fn(() => true);
    const runner = new ResponsesToolRunner({ functions: [{ tool: functionTool('record'), execute }] });
    const result = runner.run(
      h.client,
      {
        ...input,
        tools: [mcp],
        tool_choice: { type: 'allowed_tools', mode: 'auto', tools: [{ type: 'function', name: 'record' }] },
      },
      { approveMcp },
    );
    if (valid) {
      await result;
      expect(execute).toHaveBeenCalledOnce();
      expect(h.bodies).toHaveLength(2);
      expect(h.bodies[1]?.['input']).toContainEqual(listed);
      expect(h.bodies[1]?.['input']).not.toContainEqual(expect.objectContaining({ type: 'mcp_call' }));
    } else {
      await expect(result).rejects.toBeInstanceOf(ResponsesToolRunnerError);
      expect(execute).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    }
    expect(approveMcp).not.toHaveBeenCalled();
  });

  test.each(choices)(
    'checks $label before the approval callback',
    async ({ choice, allowed, allowedTools }) => {
      for (const options of [{ stream: false }, { stream: true }, { stream: true, eager: true }]) {
        const h = harness([{ output: [approval] }, { output: [message] }]);
        const approveMcp = vi.fn(() => true);
        const result = new ResponsesToolRunner({}).run(
          h.client,
          {
            ...input,
            tools: [{ ...mcp, ...(allowedTools === undefined ? {} : { allowed_tools: allowedTools }) }],
            tool_choice: choice,
          },
          { ...options, approveMcp },
        );
        if (allowed) {
          // oxlint-disable-next-line no-await-in-loop -- Each stream mode owns a separate transport and approval policy.
          await result;
          expect(approveMcp).toHaveBeenCalledOnce();
          expect(h.bodies[1]?.['input']).toContainEqual({
            type: 'mcp_approval_response',
            approval_request_id: approval.id,
            approve: true,
          });
        } else {
          // oxlint-disable-next-line no-await-in-loop -- Check rejection before the next isolated mode.
          await expect(result).rejects.toBeInstanceOf(ResponsesToolRunnerError);
          expect(approveMcp).not.toHaveBeenCalled();
        }
        expect(h.bodies).toHaveLength(allowed ? 2 : 1);
      }
    },
  );

  test.each(
    [false, true].flatMap((consumed) =>
      ['choice', 'declared'].map((restriction) => ({ consumed, restriction })),
    ),
  )(
    'checks unconsumed approval on resume, consumed=$consumed restriction=$restriction',
    async ({ consumed, restriction }) => {
      const remote: ResponseOutputItem.McpCall = {
        ...approval,
        type: 'mcp_call',
        id: 'remote',
        approval_request_id: approval.id,
        status: 'completed',
      };
      const runner = new ResponsesToolRunner({
        functions: [{ tool: functionTool('record'), execute: () => 'recorded' }],
      });
      const initial = recording();
      await runner.run(
        harness([
          { output: [approval, call('record', {}, 'first')] },
          ...(consumed ? [{ output: [remote, call('record', {}, 'second')] }] : []),
          { output: [message] },
        ]).client,
        { ...input, tools: [mcp] },
        { ledger: initial.ledger, approveMcp: () => true },
      );
      const boundary = initial.writes.find(
        (value) => value.phase === 'boundary' && value.returned_call_ids.length === (consumed ? 3 : 2),
      );
      if (!boundary) {
        throw new Error('Missing approval boundary');
      }
      const tools: Tool.Mcp[] = [{ ...mcp }];
      if (restriction === 'declared') {
        tools[0] = { ...mcp, allowed_tools: ['write'] };
        const historical = boundary.tools.find((entry) => entry.type === 'mcp');
        if (!historical || historical.type !== 'mcp') {
          throw new Error('Missing MCP declaration');
        }
        historical.allowed_tools = ['write'];
      }
      const resumed = harness([{ output: [message] }]);
      const saved = recording();
      const approveMcp = vi.fn(() => true);
      const result = runner.run(
        resumed.client,
        {
          ...input,
          input: 'new observation',
          tools,
          tool_choice: restriction === 'declared' ? 'auto' : 'none',
        },
        { ledger: { ...saved.ledger, resumeFrom: boundary }, approveMcp },
      );
      if (consumed) {
        await result;
        expect(resumed.bodies[0]?.['input']).toContainEqual(remote);
      } else {
        await expect(result).rejects.toBeInstanceOf(ResponsesToolRunnerError);
        expect(saved.writes).toEqual([]);
      }
      expect(approveMcp).not.toHaveBeenCalled();
      expect(resumed.bodies).toHaveLength(consumed ? 1 : 0);
    },
  );
});

describe('per-request local tool selection and reasoning replay', () => {
  const selected: ResponseCreateParamsNonStreaming['tool_choice'] = {
    type: 'allowed_tools',
    mode: 'auto',
    tools: [{ type: 'function', name: 'record' }],
  };
  const modes = [{ stream: false }, { stream: true }, { stream: true, eager: true }];

  const callerCases: {
    allowedCallers: Extract<Tool, { type: 'function' }>['allowed_callers'];
    caller: Extract<ResponseOutputItem, { type: 'function_call' }>['caller'];
    permitted: boolean;
  }[] = [
    { allowedCallers: ['programmatic'], caller: { type: 'direct' }, permitted: false },
    { allowedCallers: ['programmatic'], caller: undefined, permitted: false },
    { allowedCallers: ['programmatic'], caller: null, permitted: false },
    {
      allowedCallers: ['direct'],
      caller: { type: 'program', caller_id: 'program_fixture' },
      permitted: false,
    },
    { allowedCallers: [], caller: { type: 'direct' }, permitted: false },
    { allowedCallers: [], caller: { type: 'program', caller_id: 'program_fixture' }, permitted: false },
    { allowedCallers: ['direct'], caller: { type: 'direct' }, permitted: true },
    { allowedCallers: ['direct'], caller: undefined, permitted: true },
    { allowedCallers: ['direct'], caller: null, permitted: true },
    {
      allowedCallers: ['programmatic'],
      caller: { type: 'program', caller_id: 'program_fixture' },
      permitted: true,
    },
    {
      allowedCallers: ['direct', 'programmatic'],
      caller: { type: 'program', caller_id: 'program_fixture' },
      permitted: true,
    },
    { allowedCallers: undefined, caller: { type: 'program', caller_id: 'program_fixture' }, permitted: true },
    { allowedCallers: null, caller: { type: 'program', caller_id: 'program_fixture' }, permitted: true },
  ];
  test.each(callerCases.flatMap((policy) => modes.map((options) => ({ ...policy, options }))))(
    'enforces captured function caller policy %#',
    async ({ allowedCallers, caller, permitted, options }) => {
      const execute = vi.fn(() => 'done');
      const beforeEarlyCall = vi.fn(() => 'execute' as const);
      const item = { ...wireCall('record', {}), ...(caller === undefined ? {} : { caller }) };
      const h = harness([{ output: [item] }, { output: [message] }]);
      const runner = new ResponsesToolRunner({
        functions: [
          {
            tool: {
              ...functionTool('record'),
              ...(allowedCallers === undefined ? {} : { allowed_callers: allowedCallers }),
            },
            execute,
          },
        ],
      });
      const eager = 'eager' in options && options.eager;
      const result = runner.run(h.client, input, {
        ...options,
        ...(eager ? { beforeEarlyCall } : {}),
      });
      await (permitted
        ? expect(result).resolves.toHaveProperty('output_text', 'done')
        : expect(result).rejects.toMatchObject({ attemptedCallIds: [], completedCallIds: [] }));
      expect(execute).toHaveBeenCalledTimes(permitted ? 1 : 0);
      expect(beforeEarlyCall).toHaveBeenCalledTimes(permitted && eager ? 1 : 0);
      expect(h.bodies).toHaveLength(permitted ? 2 : 1);
    },
  );

  test.each(modes)('rejects an excluded registered function before execution %o', async (options) => {
    for (const choice of ['none', selected, { type: 'web_search_preview' }] as const) {
      const execute = vi.fn(() => 'done');
      const h = harness([{ output: [call('other', {})] }, { output: [message] }]);
      const runner = new ResponsesToolRunner({
        functions: ['record', 'other'].map((name) => ({ tool: functionTool(name), execute })),
      });
      // oxlint-disable-next-line no-await-in-loop -- Each mock request has an isolated effect and transport assertion.
      await expect(
        runner.run(
          h.client,
          { ...input, tools: [{ type: 'web_search_preview' }], tool_choice: choice },
          options,
        ),
      ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
      expect(execute).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    }
  });

  test('checks the whole deferred selection before a permitted sibling runs', async () => {
    const execute = vi.fn(() => 'done');
    const h = harness([{ output: [call('record', {}), call('other', {})] }]);
    const runner = new ResponsesToolRunner({
      functions: ['record', 'other'].map((name) => ({ tool: functionTool(name), execute })),
    });
    await expect(runner.run(h.client, { ...input, tool_choice: selected })).rejects.toBeInstanceOf(
      ResponsesToolRunnerError,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  test.each(modes)('applies the selected computer policy before driver input %o', async (options) => {
    for (const permitted of [false, true]) {
      const effect = vi.fn();
      const computer = new ComputerToolset({
        click: effect,
        double_click: effect,
        drag: effect,
        keypress: effect,
        move: effect,
        scroll: effect,
        type: effect,
        wait: effect,
        screenshot: () => ({ type: 'computer_screenshot', file_id: 'file_fixture' }),
      });
      const item: ResponseOutputItem = {
        id: 'computer',
        type: 'computer_call',
        call_id: 'call_computer',
        status: 'completed',
        pending_safety_checks: [],
        actions: [{ type: 'type', text: 'fixture' }],
      };
      const h = harness([{ output: [item] }, { output: [message] }]);
      const result = new ResponsesToolRunner({ computer }).run(
        h.client,
        {
          ...input,
          tool_choice: permitted
            ? { type: 'allowed_tools', mode: 'auto', tools: [{ type: 'computer' }] }
            : 'none',
        },
        options,
      );
      if (permitted) {
        // oxlint-disable-next-line no-await-in-loop -- Each selection has an independent driver and transport.
        await result;
        expect(effect).toHaveBeenCalledOnce();
      } else {
        // oxlint-disable-next-line no-await-in-loop -- Check rejection before the next independent driver.
        await expect(result).rejects.toBeInstanceOf(ResponsesToolRunnerError);
        expect(effect).not.toHaveBeenCalled();
      }
      expect(h.bodies).toHaveLength(permitted ? 2 : 1);
    }
  });

  test.each(modes)('retains a permitted local function %o', async (options) => {
    const execute = vi.fn(() => 'done');
    const h = harness([{ output: [call('record', {})] }, { output: [message] }]);
    const runner = new ResponsesToolRunner({ functions: [{ tool: functionTool('record'), execute }] });
    await runner.run(h.client, { ...input, tool_choice: selected }, options);
    expect(execute).toHaveBeenCalledOnce();
    expect(h.bodies).toHaveLength(2);
  });

  test('rejects explicit null maxSteps before transport', async () => {
    const h = harness([{ output: [message] }]);
    const options: ResponsesRunnerOptions = {};
    Reflect.set(options, 'maxSteps', null);
    await expect(new ResponsesToolRunner({}).run(h.client, input, options)).rejects.toThrow('maxSteps');
    expect(h.bodies).toHaveLength(0);
  });

  test.each(['id', 'summary', 'summary-text', 'content', 'content-text', 'encrypted_content', 'status'])(
    'rejects malformed replay reasoning %s before transport',
    async (field) => {
      const reasoning: ResponseInputItem = {
        type: 'reasoning',
        id: '',
        summary: [],
        encrypted_content: null,
      };
      if (field === 'id' || field === 'summary') {
        Reflect.deleteProperty(reasoning, field);
      } else if (field === 'summary-text') {
        Reflect.set(reasoning, 'summary', [{ type: 'summary_text', text: 7 }]);
      } else if (field === 'content-text') {
        Reflect.set(reasoning, 'content', [{ type: 'reasoning_text', text: 7 }]);
      } else {
        Reflect.set(reasoning, field, field === 'encrypted_content' ? 7 : null);
      }
      for (const options of [
        { ledger: recording().ledger },
        { contextBudget: { maxInputBytes: 10_000, maxInputImages: 0 } },
      ]) {
        const h = harness([{ output: [message] }]);
        // oxlint-disable-next-line no-await-in-loop -- Check each replay mode before creating the next fixture.
        await expect(
          new ResponsesToolRunner({}).run(
            h.client,
            { ...input, input: [{ role: 'user', content: 'fixture' }, reasoning] },
            options,
          ),
        ).rejects.toThrow();
        expect(h.bodies).toHaveLength(0);
      }
    },
  );

  test('retains native reasoning fields in replay', async () => {
    const reasoning: ResponseInputItem = {
      type: 'reasoning',
      id: '',
      summary: [{ type: 'summary_text', text: '' }],
      content: [{ type: 'reasoning_text', text: 'fixture' }],
      encrypted_content: null,
      status: 'in_progress',
    };
    const h = harness([{ output: [message] }]);
    await new ResponsesToolRunner({}).run(
      h.client,
      { ...input, input: [{ role: 'user', content: 'fixture' }, reasoning] },
      { contextBudget: { maxInputBytes: 10_000, maxInputImages: 0 } },
    );
    expect(h.bodies[0]?.['input']).toContainEqual(reasoning);
  });
});

describe('native response envelopes and MCP permissions', () => {
  const tool: Tool = { type: 'function', name: 'record', parameters: {}, strict: false };
  const mcp: Tool.Mcp = {
    type: 'mcp',
    server_label: 'owned',
    server_url: 'https://fixture.invalid/mcp',
  };

  test.each([undefined, null, 'final_answer', 'commentary'] as const)(
    'uses only the supplied final message phase %s',
    async (phase) => {
      const selected = phase === undefined ? { ...message } : { ...message, phase };
      const h = harness([{ output: [selected] }]);
      const run = new ResponsesToolRunner({}).run(h.client, input);
      if (phase === 'commentary') {
        await expect(run).rejects.toBeInstanceOf(ResponsesToolRunnerError);
      } else {
        const result = await run;
        expect(result.output).toEqual([selected]);
      }
      expect(h.bodies).toHaveLength(1);
    },
  );

  test.each(['status', 'output'] as const)(
    'rejects a missing response %s before an effect',
    async (field) => {
      const execute = vi.fn(() => 'done');
      const h = harness([{ output: [call('record', {})] }]);
      const create = h.client.responses.create.bind(h.client.responses);
      vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) =>
        create(params, options)._thenUnwrap((response) => {
          Reflect.deleteProperty(response, field);
          return response;
        }),
      );
      await expect(
        new ResponsesToolRunner({ functions: [{ tool, execute }] }).run(h.client, input),
      ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
      expect(execute).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );

  test('captures response status and output getters once', async () => {
    const h = harness([{ output: [message] }]);
    const reads = { status: 0, output: 0 };
    const create = h.client.responses.create.bind(h.client.responses);
    vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) =>
      create(params, options)._thenUnwrap((response) => {
        if ('output' in response) {
          const { status, output } = response;
          Object.defineProperties(response, {
            status: {
              enumerable: true,
              get() {
                reads.status += 1;
                return status;
              },
            },
            output: {
              enumerable: true,
              get() {
                reads.output += 1;
                return output;
              },
            },
          });
        }
        return response;
      }),
    );
    const result = await new ResponsesToolRunner({}).run(h.client, input);
    expect(reads).toEqual({ status: 1, output: 1 });
    expect(result.output).toEqual([message]);
  });

  test.each(['allowed_tools', 'allowed_filter', 'always', 'never'] as const)(
    'rejects a missing MCP %s permission slot before transport',
    async (path) => {
      const names = ['read'];
      Reflect.deleteProperty(names, '0');
      let permission: Partial<Tool.Mcp>;
      if (path === 'allowed_tools') {
        permission = { allowed_tools: names };
      } else if (path === 'allowed_filter') {
        permission = { allowed_tools: { tool_names: names } };
      } else {
        permission = { require_approval: { [path]: { tool_names: names } } };
      }
      const h = harness([{ output: [message] }]);
      await expect(
        new ResponsesToolRunner({}).run(h.client, { ...input, tools: [{ ...mcp, ...permission }] }),
      ).rejects.toThrow();
      expect(h.bodies).toHaveLength(0);
    },
  );

  test.each([
    { allowed_tools: ['read'], require_approval: 'never' as const },
    {
      allowed_tools: { tool_names: ['read'], read_only: false },
      require_approval: { always: { tool_names: ['write'] }, never: { tool_names: ['read'] } },
    },
    { allowed_tools: null, require_approval: null },
    { allowed_tools: { read_only: true }, require_approval: { always: {} } },
  ])('preserves native MCP permission values %o', async (permission) => {
    const h = harness([{ output: [message] }]);
    const declared = { ...mcp, ...permission };
    await new ResponsesToolRunner({}).run(h.client, { ...input, tools: [declared] });
    expect(h.bodies[0]?.['tools']).toEqual([declared]);
  });

  test('converts MCP permission objects and getters once and leaves extensions alone', async () => {
    const h = harness([{ output: [message] }]);
    const reads = { type: 0, convert: 0, names: 0 };
    const extension: string[] = ['ignored'];
    Reflect.deleteProperty(extension, '0');
    const declared = {
      ...mcp,
      get type() {
        reads.type += 1;
        return 'mcp' as const;
      },
      allowed_tools: {
        read_only: true,
        toJSON() {
          reads.convert += 1;
          return {
            get tool_names() {
              reads.names += 1;
              return ['read'];
            },
          };
        },
      },
      extension,
    };
    await new ResponsesToolRunner({}).run(h.client, { ...input, tools: [declared] });
    expect(reads).toEqual({ type: 1, convert: 1, names: 1 });
    expect(h.bodies[0]?.['tools']).toEqual([
      { ...mcp, allowed_tools: { tool_names: ['read'] }, extension: [null] },
    ]);
  });
});

describe('reviewed request and MCP output fields', () => {
  const modes = [
    { stream: false, eager: false },
    { stream: true, eager: false },
    { stream: true, eager: true },
  ];
  const mcp: Tool = {
    type: 'mcp',
    server_label: 'owned',
    server_url: 'https://fixture.invalid/mcp',
    require_approval: 'never',
  };

  test.each(['ordinary', 'ledger', 'budget'] as const)(
    'keeps omitted request fields empty in %s mode',
    async (mode) => {
      const h = harness([{ output: [message] }]);
      let options: ResponsesRunnerOptions = {};
      if (mode === 'ledger') {
        options = { ledger: recording().ledger };
      } else if (mode === 'budget') {
        options = { contextBudget: { maxInputBytes: 10_000, maxInputImages: 5 } };
      }
      await new ResponsesToolRunner({}).run(h.client, { model: '' }, options);
      expect(h.bodies[0]).toMatchObject({
        input: [],
        tools: [],
        include: ['reasoning.encrypted_content'],
      });
    },
  );

  test('uses emitted request fields after native JSON conversion', async () => {
    const h = harness([{ output: [message] }]);
    const toJSON = vi.fn(() => ({
      model: '',
      input: 'captured task',
      tools: [mcp],
      include: ['file_search_call.results'],
    }));
    const params = { model: '', toJSON };
    await new ResponsesToolRunner({}).run(h.client, params);
    expect(toJSON).toHaveBeenCalledTimes(1);
    expect(h.bodies[0]).toMatchObject({
      input: [{ role: 'user', content: 'captured task' }],
      tools: [mcp],
      include: ['file_search_call.results', 'reasoning.encrypted_content'],
    });
  });

  test.each(modes)('validates optional MCP output before effects ($stream/$eager)', async (mode) => {
    for (const { kind, result } of [
      { kind: 'missing', result: {} },
      { kind: 'null', result: { output: null } },
      { kind: 'string', result: { output: '' } },
      { kind: 'object', result: { output: {} } },
      { kind: 'array', result: { output: [] } },
    ]) {
      const item = {
        type: 'mcp_call',
        id: 'remote',
        name: 'read',
        server_label: 'owned',
        arguments: '{}',
        status: 'completed',
        ...result,
      };
      const execute = vi.fn(() => 'recorded');
      // SAFETY: The native transport can return invalid optional fields; the runner must reject them.
      const h = harness([
        { output: [call('record', {}), item as ResponseOutputItem] },
        { output: [message] },
      ]);
      const runner = new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
      });
      if (kind === 'object' || kind === 'array') {
        // oxlint-disable-next-line no-await-in-loop -- Each native representation has an independent request and effect.
        await expect(runner.run(h.client, { ...input, tools: [mcp] }, mode)).rejects.toBeInstanceOf(
          ResponsesToolRunnerError,
        );
        expect(execute).not.toHaveBeenCalled();
        expect(h.bodies).toHaveLength(1);
      } else {
        // oxlint-disable-next-line no-await-in-loop -- Each native representation has an independent request and effect.
        await runner.run(h.client, { ...input, tools: [mcp] }, mode);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(h.bodies[1]?.['input']).toContainEqual(item);
      }
    }
  });
});

describe('declared MCP approval rules', () => {
  const cases: {
    name: string;
    policy: Tool.Mcp['require_approval'];
    request: boolean;
    allowed: boolean;
    names?: string[];
  }[] = [
    { name: 'excluded remote name', policy: 'never', request: false, allowed: false, names: ['write'] },
    { name: 'included remote name', policy: 'never', request: false, allowed: true, names: ['read'] },
    { name: 'default call', policy: undefined, request: false, allowed: false },
    { name: 'null call', policy: null, request: false, allowed: false },
    { name: 'always call', policy: 'always', request: false, allowed: false },
    { name: 'never request', policy: 'never', request: true, allowed: false },
    { name: 'never call', policy: 'never', request: false, allowed: true },
    { name: 'default request', policy: undefined, request: true, allowed: true },
    { name: 'always request', policy: 'always', request: true, allowed: true },
    { name: 'named always', policy: { always: { tool_names: ['read'] } }, request: false, allowed: false },
    {
      name: 'named never request',
      policy: { never: { tool_names: ['read'] } },
      request: true,
      allowed: false,
    },
    {
      name: 'named never call',
      policy: { never: { tool_names: ['read'] } },
      request: false,
      allowed: true,
    },
    {
      name: 'never exception miss',
      policy: { never: { tool_names: ['write'] } },
      request: false,
      allowed: false,
    },
    {
      name: 'always filter miss',
      policy: { always: { tool_names: ['write'] } },
      request: false,
      allowed: true,
    },
    {
      name: 'always filter request miss',
      policy: { always: { tool_names: ['write'] } },
      request: true,
      allowed: false,
    },
    { name: 'read-only policy', policy: { always: { read_only: true } }, request: false, allowed: true },
    {
      name: 'universal always refuses a direct call',
      policy: { always: {} },
      request: false,
      allowed: false,
    },
    { name: 'universal always asks for approval', policy: { always: {} }, request: true, allowed: true },
    { name: 'universal never accepts a direct call', policy: { never: {} }, request: false, allowed: true },
    { name: 'universal never refuses a request', policy: { never: {} }, request: true, allowed: false },
    {
      name: 'overlapping filters',
      policy: { always: { tool_names: ['read'] }, never: { tool_names: ['read'] } },
      request: false,
      allowed: true,
    },
  ];
  test.each(
    cases.flatMap((entry) => [
      { ...entry, stream: false, eager: false },
      { ...entry, stream: true, eager: false },
      { ...entry, stream: true, eager: true },
    ]),
  )('$name ($stream/$eager)', async ({ policy, request, allowed, stream, eager, names }) => {
    const remote: ResponseOutputItem = request
      ? { type: 'mcp_approval_request', id: 'approval', server_label: 'desk', name: 'read', arguments: '{}' }
      : {
          type: 'mcp_call',
          id: 'remote',
          server_label: 'desk',
          name: 'read',
          arguments: '{}',
          status: 'completed',
        };
    const h = harness([{ output: [remote, call('record', {})] }, { output: [message] }]);
    const approveMcp = vi.fn(() => true);
    const execute = vi.fn(() => 'recorded');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const result = runner.run(
      h.client,
      {
        ...input,
        tools: [
          {
            type: 'mcp',
            server_label: 'desk',
            server_url: 'https://fixture.invalid/mcp',
            ...(policy === undefined ? {} : { require_approval: policy }),
            ...(names === undefined ? {} : { allowed_tools: names }),
          },
        ],
      },
      { stream, eager, approveMcp },
    );
    if (allowed) {
      await result;
      expect(execute).toHaveBeenCalledOnce();
      expect(approveMcp).toHaveBeenCalledTimes(request ? 1 : 0);
    } else {
      await expect(result).rejects.toBeInstanceOf(ResponsesToolRunnerError);
      expect(execute).not.toHaveBeenCalled();
      expect(approveMcp).not.toHaveBeenCalled();
    }
    expect(h.bodies).toHaveLength(allowed ? 2 : 1);
  });
});

describe('MCP declaration and grant admission', () => {
  const mcp: Tool.Mcp = {
    type: 'mcp',
    server_label: 'desk',
    server_url: 'https://fixture.invalid/mcp',
  };
  const approval: ResponseOutputItem.McpApprovalRequest = {
    type: 'mcp_approval_request',
    id: 'approval',
    server_label: 'desk',
    name: 'read',
    arguments: '{}',
  };
  const receipt: ResponseInputItem.McpApprovalResponse = {
    type: 'mcp_approval_response',
    approval_request_id: approval.id,
    approve: true,
  };
  const remote: ResponseOutputItem.McpCall = {
    type: 'mcp_call',
    id: 'remote',
    server_label: 'desk',
    name: 'read',
    arguments: '{}',
    approval_request_id: approval.id,
    status: 'completed',
  };

  test.each(['type', 'server_label'] as const)(
    'requires supplied MCP declaration %s before transport',
    async (field) => {
      const declaration = { ...mcp };
      Reflect.deleteProperty(declaration, field);
      const h = harness([{ output: [message] }]);
      const approveMcp = vi.fn(() => true);
      await expect(
        new ResponsesToolRunner({}).run(h.client, { ...input, tools: [declaration] }, { approveMcp }),
      ).rejects.toThrow();
      expect(h.bodies).toEqual([]);
      expect(approveMcp).not.toHaveBeenCalled();
    },
  );

  test.each(
    ['same-output', 'previous-output', 'saved-history', 'repeated-history', 'independent-grants'].flatMap(
      (scenario) => [
        { scenario, stream: false, eager: false },
        { scenario, stream: true, eager: false },
        { scenario, stream: true, eager: true },
      ],
    ),
  )('uses an MCP grant once in $scenario ($stream/$eager)', async ({ scenario, stream, eager }) => {
    const history: ResponseInputItem[] = [approval, receipt];
    const second = { ...remote, id: 'remote_second' };
    let output: ResponseOutputItem[] = [second, call('record', {})];
    if (scenario === 'same-output') {
      output.unshift(remote);
    } else if (scenario === 'previous-output') {
      history.push(remote);
    } else if (scenario === 'saved-history') {
      history.push(remote, second);
      output = [call('record', {})];
    } else if (scenario === 'repeated-history') {
      history.push(remote, approval, receipt);
    } else {
      const nextApproval = { ...approval, id: 'approval_second' };
      history.push(nextApproval, { ...receipt, approval_request_id: nextApproval.id });
      output = [remote, { ...second, approval_request_id: nextApproval.id }, call('record', {})];
    }
    const original = structuredClone(history);
    const execute = vi.fn(() => 'recorded');
    const approveMcp = vi.fn(() => true);
    const h = harness([{ output }, { output: [message] }]);
    const saved = recording();
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const result = runner.run(
      h.client,
      { ...input, input: history, tools: [mcp] },
      { stream, eager, approveMcp, ...(scenario === 'saved-history' ? { ledger: saved.ledger } : {}) },
    );
    if (scenario === 'independent-grants') {
      await result;
      expect(execute).toHaveBeenCalledOnce();
      expect(h.bodies).toHaveLength(2);
    } else {
      await expect(result).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(['saved-history', 'repeated-history'].includes(scenario) ? 0 : 1);
      expect(saved.writes).toEqual([]);
    }
    let approvals = 0;
    if (scenario === 'independent-grants') {
      approvals = 2;
    } else if (scenario === 'same-output') {
      approvals = 1;
    }
    expect(approveMcp).toHaveBeenCalledTimes(approvals);
    expect(history).toEqual(original);
  });

  test.each(
    ['ordinary', 'budget', 'ledger'].flatMap((mode) =>
      ['allow', 'deny', 'missing', 'invalid'].map((decision) => ({ mode, decision })),
    ),
  )(
    'reauthorizes imported MCP grants before first save or request: $mode $decision',
    async ({ mode, decision }) => {
      const history: ResponseInputItem[] = [approval, receipt, { role: 'user', content: 'continue' }];
      const original = structuredClone(history);
      const saved = recording();
      const h = harness([{ output: [message] }]);
      const approveMcp = vi.fn(() => {
        expect(h.bodies).toEqual([]);
        expect(saved.writes).toEqual([]);
        return decision === 'invalid' ? 'yes' : decision === 'allow';
      });
      const result = new ResponsesToolRunner({}).run(
        h.client,
        { ...input, input: history, tools: [mcp] },
        {
          ...(mode === 'budget' ? { contextBudget: { maxInputBytes: 8000, maxInputImages: 0 } } : {}),
          ...(mode === 'ledger' ? { ledger: saved.ledger } : {}),
          // @ts-expect-error Exercise rejection of a non-boolean callback result through the public API.
          approveMcp: decision === 'missing' ? undefined : approveMcp,
        },
      );
      if (decision === 'missing' || decision === 'invalid') {
        await expect(result).rejects.toBeInstanceOf(ResponsesToolRunnerError);
        expect(h.bodies).toEqual([]);
        expect(saved.writes).toEqual([]);
      } else {
        await result;
        const expected = { ...receipt, approve: decision === 'allow' };
        expect(h.bodies[0]?.['input']).toContainEqual(expected);
        if (mode === 'ledger') {
          expect(saved.writes[0]?.history).toContainEqual(expected);
        }
      }
      expect(approveMcp).toHaveBeenCalledTimes(decision === 'missing' ? 0 : 1);
      expect(history).toEqual(original);
    },
  );
});

describe('reviewed native observations', () => {
  test('reviewed file search rejects absent own result slots before effects', async () => {
    const execute = vi.fn(() => 'recorded');
    const search: ResponseOutputItem = {
      type: 'file_search_call',
      id: 'search',
      status: 'completed',
      queries: [],
      results: [],
    };
    const h = harness([{ output: [wireCall('record', {}), search] }, { output: [message] }]);
    const create = h.client.responses.create.bind(h.client.responses);
    vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) =>
      create(params, options)._thenUnwrap((response) => {
        if ('output' in response) {
          const found = response.output.find((item) => item.type === 'file_search_call');
          if (found?.type === 'file_search_call') {
            found.results = [];
            found.results.length = 1;
          }
        }
        return response;
      }),
    );
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await expect(
      runner.run(h.client, { ...input, tools: [{ type: 'file_search', vector_store_ids: ['fixture'] }] }),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    expect(execute).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(1);
  });

  test.each([
    {},
    [null],
    [3],
    [{ file_id: null }],
    [{ filename: false }],
    [{ text: 3 }],
    [{ score: '0.5' }],
    [{ score: null }],
    [{ attributes: [] }],
    [{ attributes: { invalid: null } }],
    [{ attributes: { invalid: {} } }],
  ])('reviewed file search rejects malformed results %j before effects', async (results) => {
    await Promise.all(
      [false, true].map(async (stream) => {
        const execute = vi.fn(() => 'recorded');
        const search: ResponseOutputItem = {
          type: 'file_search_call',
          id: 'search',
          status: 'completed',
          queries: [],
          // @ts-expect-error Invalid native fields exercise refusal before the sibling effect.
          results,
        };
        const h = harness([{ output: [wireCall('record', {}), search] }, { output: [message] }]);
        const runner = new ResponsesToolRunner({
          functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
        });
        await expect(
          runner.run(
            h.client,
            { ...input, tools: [{ type: 'file_search', vector_store_ids: ['fixture'] }] },
            { stream, eager: stream },
          ),
        ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
        expect(execute).not.toHaveBeenCalled();
        expect(h.bodies).toHaveLength(1);
      }),
    );
  });

  test.each([
    null,
    [],
    [{}],
    [{ attributes: null }],
    [
      {
        file_id: '',
        filename: 'fixture',
        text: '',
        score: 0.5,
        attributes: { name: '', active: true, count: 2 },
        extra: 'keep',
      },
    ],
  ])('reviewed file search preserves valid optional results %j', async (results) => {
    await Promise.all(
      [false, true].map(async (stream) => {
        const execute = vi.fn(() => 'recorded');
        // SAFETY: The native shape deliberately retains an unknown result field.
        const search = {
          type: 'file_search_call',
          id: 'search',
          status: 'completed',
          queries: [],
          results,
        } as ResponseOutputItem;
        const h = harness([{ output: [wireCall('record', {}), search] }, { output: [message] }]);
        const runner = new ResponsesToolRunner({
          functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
        });
        await runner.run(
          h.client,
          { ...input, tools: [{ type: 'file_search', vector_store_ids: ['fixture'] }] },
          { stream, eager: stream },
        );
        expect(execute).toHaveBeenCalledOnce();
        expect(h.bodies[1]?.['input']).toContainEqual(search);
      }),
    );
  });

  test.each([false, true])('reviewed automatic compaction replays and resumes (%s)', async (stream) => {
    const compact: ResponseOutputItem = {
      type: 'compaction',
      id: 'compact',
      encrypted_content: 'opaque fixture',
    };
    const execute = vi.fn(() => 'recorded');
    const h = harness([{ output: [compact, wireCall('record', {})] }, { output: [message] }]);
    const saved = recording();
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const params: ResponseCreateParamsNonStreaming = {
      ...input,
      context_management: [{ type: 'compaction' }],
    };
    await runner.run(h.client, params, { stream, eager: stream, ledger: saved.ledger });
    expect(h.bodies[1]?.['input']).toContainEqual(compact);
    expect(h.bodies[1]?.['context_management']).toEqual(params.context_management);
    const boundary = saved.writes.find(
      (value) => value.phase === 'boundary' && value.history.some((item) => item.type === 'compaction'),
    );
    if (!boundary) {
      throw new Error('Missing completed-turn compaction checkpoint');
    }
    const resumed = harness([{ output: [message] }]);
    await runner.run(resumed.client, params, { ledger: { ...saved.ledger, resumeFrom: boundary } });
    expect(resumed.bodies[0]?.['input']).toContainEqual(compact);
    expect(execute).toHaveBeenCalledOnce();
  });

  test.each([
    { type: 'compaction', id: 'compact' },
    { type: 'compaction', id: null, encrypted_content: 'opaque' },
    { type: 'compaction', id: 'compact', encrypted_content: null },
    { type: 'compaction_trigger' },
  ])('reviewed automatic compaction refuses malformed output %j before effects', async (item) => {
    const execute = vi.fn(() => 'recorded');
    // SAFETY: A response must not contain a malformed compaction or an input-only trigger.
    const h = harness([
      { output: [wireCall('record', {}), item as ResponseOutputItem] },
      { output: [message] },
    ]);
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await expect(
      runner.run(h.client, { ...input, context_management: [{ type: 'compaction' }] }),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    expect(execute).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(1);
  });
});

test.each(['text', 'shape'] as const)(
  'snapshots function output before diagnostic %s mutation',
  async (mutation) => {
    const env = harness([{ output: [call('record', {})] }, { output: [message] }]);
    const block = { type: 'input_text', text: 'captured' } satisfies ResponseInputTextContent;
    const runner = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'record', parameters: {}, strict: false },
          execute: () => [block],
        },
      ],
    });
    let observed = 0;
    await runner.run(env.client, input, {
      onDiagnostic(event) {
        if (event.stage === 'action' && event.reason === 'completed') {
          observed += 1;
          if (mutation === 'text') {
            block.text = 'changed';
          } else {
            Object.assign(block, { extra: true });
          }
        }
      },
    });
    expect(observed).toBe(1);
    expect(env.bodies[1]?.['input']).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_record',
      output: [{ type: 'input_text', text: 'captured' }],
    });
  },
);

test.each(['usage', 'diagnostic'] as const)(
  'owns Responses execution before %s metadata',
  async (trigger) => {
    const env = harness([{ output: [message] }, { output: [message] }]);
    const execute = vi.fn(() => 'unused');
    const saved = recording();
    let mutate: (() => void) | undefined;
    const create = env.client.responses.create.bind(env.client.responses);
    vi.spyOn(env.client.responses, 'create').mockImplementation((params, options) =>
      create(params, options)._thenUnwrap((response) => {
        if ('output' in response) {
          mutate = () => {
            response.output.splice(0, response.output.length, call('record', {}));
          };
          if (trigger === 'usage') {
            Object.defineProperty(response, 'usage', {
              enumerable: true,
              get() {
                mutate?.();
                return null;
              },
            });
          }
        }
        return response;
      }),
    );
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await runner.run(env.client, input, {
      ledger: saved.ledger,
      onDiagnostic(event) {
        if (trigger === 'diagnostic' && event.stage === 'request') {
          mutate?.();
        }
      },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(env.bodies).toHaveLength(1);
    expect(saved.writes.find((entry) => entry.phase === 'final')?.final_response?.output).toEqual([message]);
  },
);

test('ledger captures supported class-backed transport options once', async () => {
  const env = harness([{ output: [message] }]);
  const reads: string[] = [];
  const { signal } = new AbortController();
  class Transport {
    #headers = { 'x-fixture': 'permitted' };
    #timeout = 7321;
    #maxRetries = 0;
    #signal = signal;
    get headers() {
      reads.push('headers');
      return this.#headers;
    }
    get timeout() {
      reads.push('timeout');
      return this.#timeout;
    }
    get maxRetries() {
      reads.push('maxRetries');
      return this.#maxRetries;
    }
    get signal() {
      reads.push('signal');
      return this.#signal;
    }
  }
  const create = vi.spyOn(env.client.responses, 'create');
  await new ResponsesToolRunner({}).run(env.client, input, {
    requestOptions: new Transport(),
    ledger: recording().ledger,
  });
  expect(reads).toEqual(['signal', 'headers', 'timeout', 'maxRetries']);
  expect(create.mock.calls[0]?.[1]).toMatchObject({ signal, timeout: 7321, maxRetries: 0 });
});

test('explicit null input cannot dispatch a registered function', async () => {
  const execute = vi.fn(() => 'fixture');
  const runner = new ResponsesToolRunner({
    functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
  });
  const h = harness([{ output: [call('record', {})] }, { output: [message] }]);
  await expect(
    runner.run(h.client, {
      ...input,
      instructions: 'fixture',
      // @ts-expect-error Untyped input must not silently become an empty conversation.
      input: null,
    }),
  ).rejects.toThrow(TypeError);
  expect(h.bodies).toEqual([]);
  expect(execute).not.toHaveBeenCalled();
});

describe('runner admission and resume boundaries', () => {
  const mcp: Tool.Mcp = {
    type: 'mcp',
    server_label: 'desk',
    server_url: 'https://fixture.invalid/mcp',
    authorization: 'synthetic-original',
    require_approval: 'always',
  };
  const approval: ResponseOutputItem.McpApprovalRequest = {
    type: 'mcp_approval_request',
    id: 'approval',
    name: 'read',
    arguments: '{}',
    server_label: 'desk',
  };
  test.each(['pending', 'consumed', 'denied'] as const)(
    'resume reauthorizes only unconsumed true MCP approvals (%s)',
    async (approvalState) => {
      const remote: ResponseOutputItem.McpCall = {
        type: 'mcp_call',
        id: 'remote',
        approval_request_id: approval.id,
        name: approval.name,
        arguments: approval.arguments,
        server_label: approval.server_label,
        status: 'completed',
      };
      const execute = vi.fn(() => 'recorded');
      const runner = new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
      });
      const h = harness([
        { output: [approval, wireCall('record', {}, 'r')] },
        ...(approvalState === 'consumed' ? [{ output: [remote, wireCall('record', {}, 'second')] }] : []),
        { output: [message] },
      ]);
      const initial = recording();
      await runner.run(
        h.client,
        { ...input, tools: [mcp] },
        { ledger: initial.ledger, approveMcp: () => approvalState !== 'denied' },
      );
      const count = approvalState === 'consumed' ? 3 : 2;
      const boundary = initial.writes.find(
        (value) => value.phase === 'boundary' && value.returned_call_ids.length === count,
      );
      if (!boundary) {
        throw new Error('Missing MCP boundary');
      }
      const historicalEffects = execute.mock.calls.length;
      const resumed = harness([{ output: [message] }]);
      const saved = recording();
      const approveMcp = vi.fn(() => {
        expect(resumed.bodies).toHaveLength(0);
        expect(saved.writes).toHaveLength(0);
        return false;
      });
      await runner.run(
        resumed.client,
        { ...input, input: 'new observation', tools: [{ ...mcp, authorization: 'synthetic-rotated' }] },
        { ledger: { ...saved.ledger, resumeFrom: boundary }, approveMcp },
      );
      expect(approveMcp).toHaveBeenCalledTimes(approvalState === 'pending' ? 1 : 0);
      expect(execute).toHaveBeenCalledTimes(historicalEffects);
      expect(resumed.bodies[0]?.['input']).toContainEqual({
        type: 'mcp_approval_response',
        approval_request_id: approval.id,
        approve: approvalState === 'consumed',
      });
      if (approvalState === 'consumed') {
        expect(resumed.bodies[0]?.['input']).toContainEqual(remote);
      }
      expect(saved.writes[0]?.returned_call_ids).toEqual(boundary.returned_call_ids);
      expect(JSON.stringify(saved.writes)).not.toContain('synthetic-');
      expect(boundary.history).toContainEqual({
        type: 'mcp_approval_response',
        approval_request_id: approval.id,
        approve: approvalState !== 'denied',
      });
      if (approvalState === 'pending') {
        const blocked = harness([]);
        const noSave = recording();
        await expect(
          runner.run(
            blocked.client,
            { ...input, tools: [mcp] },
            { ledger: { ...noSave.ledger, resumeFrom: boundary } },
          ),
        ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
        expect(blocked.bodies).toEqual([]);
        expect(noSave.writes).toEqual([]);
        const exhausted = harness([]);
        const noRefresh = vi.fn(() => true);
        await expect(
          runner.run(
            exhausted.client,
            { ...input, tools: [mcp] },
            {
              ledger: {
                ...noSave.ledger,
                resumeFrom: { ...boundary, consumed_requests: boundary.max_steps },
              },
              approveMcp: noRefresh,
            },
          ),
        ).rejects.toThrow('maxSteps');
        expect(exhausted.bodies).toEqual([]);
        expect(noSave.writes).toEqual([]);
        expect(noRefresh).not.toHaveBeenCalled();
      }
    },
  );
  test('captures class ledger configuration once with its recorder receiver', async () => {
    const initial = recording();
    await new ResponsesToolRunner({}).run(harness([{ output: [message] }]).client, input, {
      ledger: initial.ledger,
    });
    const [checkpoint] = initial.writes;
    if (!checkpoint) {
      throw new Error('Missing admission boundary');
    }
    const original = checkpoint;
    class Ledger {
      reads = { runId: 0, resumeFrom: 0, save: 0 };
      writes: ResponsesRunnerCheckpoint[] = [];
      get runId() {
        this.reads.runId += 1;
        return original.run_id;
      }
      get resumeFrom() {
        this.reads.resumeFrom += 1;
        return original;
      }
      get save() {
        this.reads.save += 1;
        return this.record;
      }
      record(value: ResponsesRunnerCheckpoint) {
        this.writes.push(value);
      }
    }
    const ledger = new Ledger();
    await new ResponsesToolRunner({}).run(
      harness([{ output: [message] }]).client,
      { ...input, input: 'fresh' },
      { ledger },
    );
    expect(ledger.reads).toEqual({ runId: 1, resumeFrom: 1, save: 1 });
    expect(ledger.writes.some((value) => value.phase === 'final')).toBe(true);
  });
  test('ledger request tools use owned slots once, including nonenumerable own getters', async () => {
    const tools: Tool[] = [];
    tools.length = 1;
    let reads = 0;
    Object.defineProperty(tools, '0', {
      get() {
        reads += 1;
        return mcp;
      },
      enumerable: false,
    });
    const good = harness([{ output: [message] }]);
    await new ResponsesToolRunner({}).run(good.client, { ...input, tools }, { ledger: recording().ledger });
    expect(reads).toBe(1);
    expect(good.bodies[0]?.['tools']).toContainEqual(mcp);
    const absent: Tool[] = [];
    absent.length = 1;
    Object.setPrototypeOf(absent, Object.assign(Object.create(Array.prototype), { 0: mcp }));
    const blocked = harness([]);
    const noSave = recording();
    await expect(
      new ResponsesToolRunner({}).run(blocked.client, { ...input, tools: absent }, { ledger: noSave.ledger }),
    ).rejects.toThrow();
    expect(noSave.writes).toEqual([]);
    expect(blocked.bodies).toEqual([]);
  });
  test.each([null, {}, { name: 'read' }, { input_schema: {} }, { name: null, input_schema: {} }])(
    'validates required MCP list tool entries before local effects: %o',
    async (tool) => {
      const execute = vi.fn(() => 'recorded');
      // SAFETY: The malformed tool is deliberate test input to the public runner preflight.
      const listed = {
        type: 'mcp_list_tools',
        id: 'listed',
        server_label: 'desk',
        tools: [tool],
      } as ResponseOutputItem;
      const h = harness([{ output: [wireCall('record', {}, 'r'), listed] }, { output: [message] }]);
      const runner = new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
      });
      await expect(runner.run(h.client, { ...input, tools: [mcp] })).rejects.toBeInstanceOf(
        ResponsesToolRunnerError,
      );
      expect(execute).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );
  test.each(['message', 'server', 'function'] as const)(
    'rejects duplicate native %s IDs before local effects',
    async (kind) => {
      const incoming = wireCall('record', {}, 'r');
      const { id } = incoming;
      if (id === undefined) {
        throw new Error('Fixture requires ID');
      }
      let same: ResponseOutputItem;
      if (kind === 'message') {
        same = { ...message, id };
      } else if (kind === 'server') {
        same = { type: 'mcp_list_tools', id, server_label: 'desk', tools: [] };
      } else {
        same = { ...wireCall('record', {}, 'different'), id };
      }
      const execute = vi.fn(() => 'recorded');
      const h = harness([{ output: [incoming, same] }, { output: [message] }]);
      const runner = new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
      });
      await expect(runner.run(h.client, { ...input, tools: [mcp] })).rejects.toBeInstanceOf(
        ResponsesToolRunnerError,
      );
      expect(execute).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );
  test.each(['turn', 'eager', 'input', 'resume'] as const)(
    'refuses native output IDs reused after a prior turn: %s',
    async (mode) => {
      const original = wireCall('record', {}, 'old');
      if (original.id === undefined) {
        throw new Error('Expected native item ID');
      }
      const reused = { ...wireCall('record', {}, 'new'), id: original.id };
      const execute = vi.fn(() => 'recorded');
      const runner = new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
      });
      const saved = recording();
      let resumeFrom: ResponsesRunnerCheckpoint | undefined;
      if (mode === 'resume') {
        const initial = harness([{ output: [original] }, { output: [message] }]);
        await runner.run(initial.client, input, { maxSteps: 4, ledger: saved.ledger });
        resumeFrom = saved.writes.find(
          (value) => value.phase === 'boundary' && value.returned_call_ids.length > 0,
        );
        if (!resumeFrom) {
          throw new Error('Expected the completed first turn');
        }
      }
      const h = harness([
        ...(mode === 'turn' || mode === 'eager' ? [{ output: [original] }] : []),
        { output: [reused] },
        { output: [message] },
      ]);
      const initialInput: ResponseInputItem[] = [
        original,
        { type: 'function_call_output', call_id: original.call_id, output: 'recorded' },
      ];
      const next = recording();
      await expect(
        runner.run(
          h.client,
          { ...input, input: mode === 'input' ? initialInput : 'continue' },
          {
            maxSteps: 4,
            stream: mode === 'eager',
            eager: mode === 'eager',
            ...(resumeFrom ? { ledger: { ...next.ledger, resumeFrom } } : {}),
          },
        ),
      ).rejects.toThrow('item ID');
      expect(execute).toHaveBeenCalledTimes(mode === 'input' ? 0 : 1);
      expect(h.bodies).toHaveLength(mode === 'turn' || mode === 'eager' ? 2 : 1);
    },
  );
  test('keeps empty optional function IDs unassigned across turns', async () => {
    const execute = vi.fn(() => 'ok');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const h = harness([
      { output: [{ ...wireCall('record', {}, 'first'), id: '' }] },
      { output: [{ ...wireCall('record', {}, 'second'), id: '' }] },
      { output: [message] },
    ]);
    await expect(runner.run(h.client, input)).resolves.toHaveProperty('output_text', 'done');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(h.bodies).toHaveLength(3);
  });
  test.each([
    { id: 'ref_fixture', type: 'item_reference' as const },
    { id: 'ref_fixture' },
    { id: 'ref_fixture', type: null },
  ])('preserves a native reference and consumes a budgeted trigger once: %j', async (reference) => {
    const original: ResponseInputItem[] = [
      wireCall('record', {}, 'old'),
      { type: 'function_call_output', call_id: 'call_old', output: 'x'.repeat(4000) },
      reference,
      { type: 'compaction_trigger' },
    ];
    const frozen = structuredClone(original);
    const h = harness([{ output: [wireCall('record', {}, 'new')] }, { output: [message] }]);
    const compact = vi.fn(({ eligibleCallIds }) => ({ dropCallIds: eligibleCallIds }));
    const execute = vi.fn(() => 'new');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await expect(
      runner.run(
        h.client,
        { ...input, input: original },
        { contextBudget: { maxInputBytes: 1200, maxInputImages: 0, compact } },
      ),
    ).resolves.toHaveProperty('output_text', 'done');
    const sent = h.bodies.map((body) => body['input']);
    if (!Array.isArray(sent[0])) {
      throw new TypeError('Expected native request input');
    }
    expect(sent[0]).toContainEqual(reference);
    // The supported ES2020 library does not provide Array.prototype.at.
    // oxlint-disable-next-line unicorn/prefer-at
    expect(sent[0][sent[0].length - 1]).toEqual({ type: 'compaction_trigger' });
    expect(sent[1]).toContainEqual(reference);
    expect(sent[1]).not.toContainEqual({ type: 'compaction_trigger' });
    expect(execute).toHaveBeenCalledOnce();
    expect(compact).toHaveBeenCalled();
    expect(original).toEqual(frozen);
  });
});

test('ledger omits MCP credentials while requests and resume use the current credentials', async () => {
  const execute = vi.fn(() => 'recorded');
  const runner = new ResponsesToolRunner({
    functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
  });
  const mcp: Tool.Mcp = {
    type: 'mcp',
    server_label: 'desk',
    server_url:
      'https://user:synthetic-url@fixture.invalid/mcp/synthetic-path?team=fixture&key=synthetic-unknown&access_token=synthetic-query#synthetic-fragment',
    authorization: 'synthetic-old-token',
    headers: { Cookie: 'synthetic-cookie', 'X-Fleet-Key': 'synthetic-key' },
    require_approval: 'always',
  };
  const original = harness([{ output: [call('record', {})] }, { output: [message] }]);
  const create = original.client.responses.create.bind(original.client.responses);
  vi.spyOn(original.client.responses, 'create').mockImplementation((params, options) =>
    create(params, options)._thenUnwrap((response) => {
      if (!('output' in response)) {
        throw new Error('Expected non-streaming MCP checkpoint fixture');
      }
      response.tools = [mcp];
      return response;
    }),
  );
  const saved = recording();
  await runner.run(original.client, { ...input, tools: [mcp] }, { ledger: saved.ledger });
  expect(original.bodies[0]?.['tools']).toContainEqual(mcp);
  expect(JSON.stringify(saved.writes)).not.toMatch(
    /synthetic-(?:old-token|cookie|key|url|query|fragment|path|unknown)/u,
  );
  const boundary = saved.writes.find(
    (value) => value.phase === 'boundary' && value.returned_call_ids.length === 1,
  );
  if (!boundary) {
    throw new Error('Expected a complete MCP boundary after the local function');
  }
  const savedMcp = boundary.tools.find((tool) => tool.type === 'mcp');
  expect(savedMcp?.server_url).toMatch(/^sha256:[0-9a-f]{64}$/u);
  const refreshed = {
    ...mcp,
    server_url:
      'https://other:synthetic-new-url@fixture.invalid/mcp/synthetic-path?team=fixture&key=synthetic-unknown&access_token=synthetic-new-query#synthetic-new-fragment',
    authorization: 'synthetic-new-token',
    headers: { 'X-Fleet-Key': 'synthetic-new-key' },
  };
  const resumed = harness([{ output: [message] }]);
  const current = recording();
  await runner.run(
    resumed.client,
    { ...input, input: 'fresh observation', tools: [refreshed] },
    {
      ledger: { ...current.ledger, resumeFrom: boundary },
    },
  );
  expect(resumed.bodies[0]?.['tools']).toContainEqual(refreshed);
  expect(JSON.stringify(current.writes)).not.toMatch(
    /synthetic-(?:new-token|new-key|new-url|new-query|new-fragment|path|unknown)/u,
  );
  for (const changes of [
    { server_label: 'changed' },
    { server_url: refreshed.server_url.replace('synthetic-path', 'different-path') },
    { server_url: refreshed.server_url.replace('synthetic-unknown', 'rotated-unknown') },
    { server_url: refreshed.server_url.replace('team=fixture', 'team=different') },
    { server_url: 'https://another.fixture.invalid/mcp' },
    { allowed_tools: ['changed'] },
  ]) {
    const noRequest = harness([]);
    const noSave = vi.fn();
    // oxlint-disable-next-line no-await-in-loop -- Each rejected registry has its own read/write proof.
    await expect(
      runner.run(
        noRequest.client,
        { ...input, tools: [{ ...refreshed, ...changes }] },
        {
          ledger: { ...current.ledger, save: noSave, resumeFrom: boundary },
        },
      ),
    ).rejects.toThrow();
    expect(noSave).not.toHaveBeenCalled();
    expect(noRequest.bodies).toHaveLength(0);
  }
  const old = { ...boundary, tools: boundary.tools.map((tool) => (tool.type === 'mcp' ? mcp : tool)) };
  const noRequest = harness([]);
  const noSave = vi.fn();
  await expect(
    runner.run(
      noRequest.client,
      { ...input, tools: [refreshed] },
      {
        ledger: { ...current.ledger, save: noSave, resumeFrom: old },
      },
    ),
  ).rejects.toThrow();
  expect(noSave).not.toHaveBeenCalled();
  expect(noRequest.bodies).toHaveLength(0);
  expect(execute).toHaveBeenCalledTimes(1);
});

const interpreterCredential = (revision: number) => `fixture-interpreter-credential-${revision}`;
const interpreterPolicy = (revision: number, domain = 'fixture.invalid', name = 'fixture_auth'): Tool => ({
  type: 'code_interpreter',
  container: {
    type: 'auto',
    network_policy: {
      type: 'allowlist',
      allowed_domains: ['fixture.invalid'],
      domain_secrets: [{ domain, name, value: interpreterCredential(revision) }],
    },
  },
});

test('ledger keeps interpreter policy identity while rotating current domain credentials', async () => {
  const execute = vi.fn(() => 'recorded');
  const runner = new ResponsesToolRunner({
    functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
  });
  const old = interpreterPolicy(1);
  const original = harness([{ output: [call('record', {})] }, { output: [message] }]);
  const create = original.client.responses.create.bind(original.client.responses);
  vi.spyOn(original.client.responses, 'create').mockImplementation((params, options) =>
    create(params, options)._thenUnwrap((response) => {
      if (!('output' in response)) {
        throw new Error('Expected non-streaming checkpoint fixture');
      }
      response.tools = [old];
      return response;
    }),
  );
  const saved = recording();
  await runner.run(original.client, { ...input, tools: [old] }, { ledger: saved.ledger });
  expect(original.bodies[0]?.['tools']).toContainEqual(old);
  expect(JSON.stringify(saved.writes).includes(interpreterCredential(1))).toBe(false);
  const boundary = saved.writes.find(
    (value) => value.phase === 'boundary' && value.returned_call_ids.length === 1,
  );
  if (!boundary) {
    throw new Error('Expected interpreter boundary');
  }
  const refreshed = interpreterPolicy(2);
  const resumed = harness([{ output: [message] }]);
  const current = recording();
  await runner.run(
    resumed.client,
    { ...input, input: 'fresh observation', tools: [refreshed] },
    {
      ledger: { ...current.ledger, resumeFrom: boundary },
    },
  );
  expect(resumed.bodies[0]?.['tools']).toContainEqual(refreshed);
  expect(JSON.stringify(current.writes).includes(interpreterCredential(2))).toBe(false);
  for (const changed of [
    interpreterPolicy(2, 'other.invalid'),
    interpreterPolicy(2, 'fixture.invalid', 'different_auth'),
  ]) {
    const untouched = harness([]);
    const save = vi.fn();
    // oxlint-disable-next-line no-await-in-loop -- Prove each identity change stops before its own save and request.
    await expect(
      runner.run(
        untouched.client,
        { ...input, input: 'fresh observation', tools: [changed] },
        {
          ledger: { runId: current.ledger.runId, save, resumeFrom: boundary },
        },
      ),
    ).rejects.toBeInstanceOf(TypeError);
    expect(untouched.bodies).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  }
});

test('MCP checkpoint hashing keeps the original nested input snapshot', async () => {
  const runner = new ResponsesToolRunner({});
  const mcp: Tool.Mcp = { type: 'mcp', server_label: 'desk', server_url: 'https://fixture.invalid/mcp' };
  const originalMessage = { role: 'user' as const, content: 'original observation' };
  const originalInput = [originalMessage];
  const env = harness([{ output: [message] }]);
  const saved = recording();
  const result = runner.run(
    env.client,
    { ...input, input: originalInput, tools: [mcp] },
    { ledger: saved.ledger },
  );
  originalMessage.content = 'changed while hashing';
  await result;
  expect(env.bodies[0]?.['input']).toEqual([{ role: 'user', content: 'original observation' }]);
  expect(saved.writes[0]?.history).toEqual([{ role: 'user', content: 'original observation' }]);
});

test('Web Crypto is required only when storing an MCP URL in a checkpoint', async () => {
  const runner = new ResponsesToolRunner({});
  const mcp: Tool.Mcp = { type: 'mcp', server_label: 'desk', server_url: 'https://fixture.invalid/mcp' };
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Simulate an environment without the Web Crypto global.
  vi.stubGlobal('crypto', undefined);
  try {
    const blocked = harness([]);
    const save = vi.fn();
    await expect(
      runner.run(
        blocked.client,
        { ...input, tools: [mcp] },
        {
          ledger: { runId: 'mcp', save },
        },
      ),
    ).rejects.toThrow(/Web Crypto/u);
    expect(save).not.toHaveBeenCalled();
    expect(blocked.bodies).toHaveLength(0);
    const unrecorded = harness([{ output: [message] }]);
    await runner.run(unrecorded.client, { ...input, tools: [mcp] });
    expect(unrecorded.bodies).toHaveLength(1);
    const local = harness([{ output: [message] }]);
    await runner.run(local.client, input, { ledger: recording().ledger });
    expect(local.bodies).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

describe('runner validation messages and optional call status', () => {
  test('a modified admission error cannot expose private text in another run', async () => {
    const h = harness([{ output: [call('record', {})] }]);
    const failure: unknown = await new ResponsesToolRunner({})
      .run(
        h.client,
        {
          input: [
            {
              type: 'mcp_call',
              id: 'mcp_fixture',
              server_label: 'desk',
              name: 'lookup',
              arguments: '{}',
              output: 'ok',
              status: 'completed',
              approval_request_id: 'missing',
            },
          ],
          tools: [{ type: 'mcp', server_label: 'desk', server_url: 'https://fixture.invalid' }],
        },
        { ledger: recording().ledger },
      )
      .catch((error: unknown) => error);
    expect(h.bodies).toHaveLength(0);
    if (!(failure instanceof Error)) {
      throw new Error('Expected an admission error.');
    }
    failure.message += ' private admission detail';
    const runner = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'record', parameters: {}, strict: false },
          execute: () => {
            throw failure;
          },
        },
      ],
    });
    await expect(runner.run(h.client, { input: 'go' })).rejects.toMatchObject({
      message: 'ResponsesToolRunner stopped. Inspect attemptedCallIds and completedCallIds before retrying.',
      attemptedCallIds: ['call_record'],
      completedCallIds: [],
    });
  });

  test.each([
    { stream: false, eager: false, status: 'omitted' },
    { stream: true, eager: false, status: 'omitted' },
    { stream: true, eager: true, status: 'omitted' },
    { stream: false, eager: false, status: 'null' },
    { stream: true, eager: false, status: 'null' },
    { stream: true, eager: true, status: 'null' },
  ])('accepts $status function status ($stream/$eager)', async (options) => {
    const item = call('record', {});
    delete item.status;
    if (options.status === 'null') {
      Reflect.set(item, 'status', null);
    }
    const h = harness([{ output: [item] }, { output: [message] }]);
    const execute = vi.fn(() => 'recorded');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await runner.run(h.client, { input: 'go' }, options);
    expect(execute).toHaveBeenCalledOnce();
    expect(h.bodies[1]?.['input']).toContainEqual(item);
  });

  test.each(['in_progress', 'incomplete'] as const)('still rejects %s function status', async (status) => {
    const h = harness([{ output: [{ ...call('record', {}), status }] }]);
    const execute = vi.fn(() => 'must not run');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await expect(runner.run(h.client, { input: 'go' })).rejects.toMatchObject({
      message: 'Incomplete or unregistered function call.',
      attemptedCallIds: [],
      completedCallIds: [],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  test.each([false, true])('reports a fixed server validation message with ledger=%s', async (ledger) => {
    const image: ResponseOutputItem = {
      type: 'image_generation_call',
      id: 'image',
      status: 'failed',
      result: null,
    };
    const h = harness([{ output: [call('record', {}), image] }]);
    const execute = vi.fn(() => 'must not run');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await expect(
      runner.run(
        h.client,
        { input: 'go', tools: [{ type: 'image_generation' }] },
        ledger ? { ledger: recording().ledger } : {},
      ),
    ).rejects.toMatchObject({
      message: 'Server tool did not complete. Inspect the environment before continuing.',
      attemptedCallIds: [],
      completedCallIds: [],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  test('reports a stream mismatch before deferred effects without accepting status changes', async () => {
    const item = call('record', {});
    const omitted = { ...item };
    delete omitted.status;
    const h = harness([{ output: [omitted], completedOutput: [item] }]);
    const execute = vi.fn(() => 'must not run');
    const runner = new ResponsesToolRunner({
      earlyExecution: { functions: [] },
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await expect(runner.run(h.client, { input: 'go' }, { stream: true, eager: true })).rejects.toMatchObject({
      message: 'Completed response differs from observed stream items.',
      attemptedCallIds: [],
      completedCallIds: [],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  test('keeps a failed checkpoint write private when recording invalid server output', async () => {
    const h = harness([
      { output: [{ type: 'image_generation_call', id: 'image', status: 'failed', result: null }] },
    ]);
    await expect(
      new ResponsesToolRunner({}).run(
        h.client,
        { input: 'go', tools: [{ type: 'image_generation' }] },
        {
          ledger: {
            runId: 'fixture',
            save(value) {
              if (value.pending_items.length) {
                throw new Error('private checkpoint credentials');
              }
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      message: 'ResponsesToolRunner stopped. Inspect attemptedCallIds and completedCallIds before retrying.',
      attemptedCallIds: [],
      completedCallIds: [],
    });
  });
});

describe('sparse eager runner streams', () => {
  test.each([
    { kind: 'gap', wireIndices: [90, 91], attempted: [] },
    { kind: 'prefix gap', wireIndices: [0, 91], attempted: ['call_first'] },
    { kind: 'out of order', doneOrder: [1, 0], attempted: [] },
  ])('allows overrides for the actual deferred $kind suffix', async (streamCase) => {
    const execute = vi.fn(() => 'automatic');
    const runner = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'record', parameters: {}, strict: false },
          execute,
          allowOutputOverride: true,
        },
      ],
    });
    const h = harness([
      { ...streamCase, output: [call('record', {}, 'first'), call('record', {}, 'last')] },
      { output: [message] },
    ]);
    const turns = runner.iterate(h.client, input, { stream: true, eager: true });
    try {
      const turn = await turns.next();
      if (turn.done) {
        throw new Error('Missing deferred turn');
      }
      expect(turn.value.attemptedCallIds).toEqual(streamCase.attempted);
      expect(() =>
        turn.value.supplyOutputs([{ type: 'function_call_output', call_id: 'missing', output: 'bad' }]),
      ).toThrow();
      turn.value.supplyOutputs([
        { type: 'function_call_output', call_id: 'call_last', output: 'human result' },
      ]);
      if (streamCase.attempted.length) {
        expect(() =>
          turn.value.supplyOutputs([{ type: 'function_call_output', call_id: 'call_first', output: 'bad' }]),
        ).toThrow();
      }
      const last = await turns.next();
      expect(last.value).toMatchObject({ final: true, completedCallIds: ['call_first', 'call_last'] });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(h.bodies[1]?.['input']).toContainEqual({
        type: 'function_call_output',
        call_id: 'call_last',
        output: 'human result',
      });
    } finally {
      await turns.return();
    }
  });

  test.each([
    { kind: 'gap', wireIndices: [1_000_000, 1_000_001] },
    { kind: 'out-of-order', doneOrder: [1, 0] },
    { kind: 'interrupt', wireIndices: [1_000_000, 1_000_001], interrupt: true },
    { kind: 'duplicate', wireIndices: [1_000_000, 1_000_001], duplicateIndex: 0 },
    { kind: 'final', wireIndices: [1_000_000] },
    { kind: 'changed', wireIndices: [1_000_000, 1_000_001] },
    { kind: 'prefix-interrupt', wireIndices: [0, 1_000_000], interrupt: true },
  ])('$kind preserves reconciliation and ledger evidence', async (streamCase) => {
    for (const earlyExecution of [null, { functions: ['record'] }]) {
      const effects: string[] = [];
      const runner = new ResponsesToolRunner({
        earlyExecution,
        functions: [
          {
            tool: { type: 'function', name: 'record', parameters: {}, strict: false },
            execute(args) {
              const text = String(args['text']);
              effects.push(text);
              return text;
            },
          },
        ],
      });
      const first =
        streamCase.kind === 'final'
          ? [message]
          : [wireCall('record', { text: 'first' }, 'one'), wireCall('record', { text: 'second' }, 'two')];
      const completedOutput =
        streamCase.kind === 'changed'
          ? [wireCall('record', { text: 'changed' }, 'one'), first[1] ?? message]
          : first;
      const h = harness([{ ...streamCase, output: first, completedOutput }, { output: [message] }]);
      const { writes, ledger } = recording();
      const execution = runner.run(h.client, input, {
        stream: true,
        eager: true,
        ledger,
        onEvent(event) {
          if (h.bodies.length === 1 && event.type === 'response.completed') {
            expect(effects).toEqual([]);
            expect(writes.slice(-1)).toMatchObject([{ phase: 'pending' }]);
          }
        },
      });
      if (['interrupt', 'duplicate', 'changed', 'prefix-interrupt'].includes(streamCase.kind)) {
        const prefixIds = streamCase.kind === 'prefix-interrupt' ? ['call_one'] : [];
        // Each policy owns an independent runner and recorder.
        // oxlint-disable-next-line no-await-in-loop
        await expect(execution).rejects.toMatchObject({
          attemptedCallIds: prefixIds,
          completedCallIds: prefixIds,
        });
        expect(h.bodies).toHaveLength(1);
        expect(effects).toEqual(streamCase.kind === 'prefix-interrupt' ? ['first'] : []);
        expect(writes.slice(-1)).toMatchObject([{ phase: 'pending', returned_call_ids: prefixIds }]);
        const [lastWrite] = writes.slice(-1);
        expect(lastWrite?.pending_items.length).toBeGreaterThan(0);
      } else {
        // oxlint-disable-next-line no-await-in-loop
        await expect(execution).resolves.toHaveProperty('output_text', 'done');
        if (streamCase.kind === 'final') {
          expect(h.bodies).toHaveLength(1);
          expect(effects).toEqual([]);
          expect(writes.slice(-1)).toMatchObject([{ phase: 'final', returned_call_ids: [] }]);
        } else {
          expect(effects).toEqual(['first', 'second']);
          expect(h.bodies).toHaveLength(2);
          expect(h.bodies[1]?.['input']).toEqual([
            { role: 'user', content: input.input },
            ...first,
            { type: 'function_call_output', call_id: 'call_one', output: 'first' },
            { type: 'function_call_output', call_id: 'call_two', output: 'second' },
          ]);
          expect(writes.slice(-1)).toMatchObject([
            { phase: 'final', returned_call_ids: ['call_one', 'call_two'] },
          ]);
        }
      }
    }
  });
});

test.each(['omitted', 'class getter'] as const)(
  'runner functions ignore ambient declarations with %s',
  async (kind) => {
    const execute = vi.fn(() => 'automatic');
    const read = vi.fn();
    const registered = {
      tool: { type: 'function' as const, name: 'record', parameters: {}, strict: false },
      execute,
    };
    class Registry {
      #functions = [registered];
      get functions() {
        read();
        return this.#functions;
      }
    }
    const h = harness([{ output: [call('record', {})] }, { output: [message] }]);
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'functions');
    try {
      // oxlint-disable-next-line no-extend-native -- Local ambient lookup regression, restored below.
      Object.defineProperty(Object.prototype, 'functions', {
        configurable: true,
        writable: true,
        value: [registered],
      });
      const execution = new ResponsesToolRunner(kind === 'omitted' ? {} : new Registry()).run(
        h.client,
        input,
      );
      if (kind === 'omitted') {
        await expect(execution).rejects.toThrow();
        expect(execute).not.toHaveBeenCalled();
        expect(h.bodies[0]?.['tools']).toEqual([]);
      } else {
        await execution;
        expect(execute).toHaveBeenCalledTimes(1);
        expect(read).toHaveBeenCalledTimes(1);
      }
    } finally {
      if (previous) {
        // oxlint-disable-next-line no-extend-native -- Restore original descriptor.
        Object.defineProperty(Object.prototype, 'functions', previous);
      } else {
        Reflect.deleteProperty(Object.prototype, 'functions');
      }
    }
  },
);

test('sparse function registration cannot acquire an inherited slot', () => {
  const execute = vi.fn(() => 'ambient');
  const fn = { tool: { type: 'function' as const, name: 'record', parameters: {}, strict: false }, execute };
  const values: (typeof fn)[] = [];
  values.length = 1;
  const prototype = Object.create(Array.prototype);
  Object.defineProperty(prototype, '0', { value: fn });
  Object.setPrototypeOf(values, prototype);
  expect(() => new ResponsesToolRunner({ functions: values })).toThrow();
  expect(execute).not.toHaveBeenCalled();
});

test('a configured registration slot getter and its executor retain their owners', async () => {
  const read = vi.fn();
  const effect = vi.fn();
  class Fn {
    #value = 'configured';
    get tool() {
      return { type: 'function' as const, name: this.#value, parameters: {}, strict: false };
    }
    execute() {
      effect(this.#value);
      return this.#value;
    }
  }
  const fn = new Fn();
  const values: Fn[] = [];
  const iterate = vi.fn(() => [].values());
  Object.defineProperty(values, Symbol.iterator, { value: iterate });
  Object.defineProperty(values, '0', {
    get() {
      read();
      return fn;
    },
  });
  const h = harness([{ output: [call('configured', {})] }, { output: [message] }]);
  await new ResponsesToolRunner({ functions: values }).run(h.client, input);
  expect(read).toHaveBeenCalledTimes(1);
  expect(iterate).not.toHaveBeenCalled();
  expect(effect).toHaveBeenCalledWith('configured');
});

test.each(['inherited', 'nonenumerable'] as const)(
  'already-aborted %s runner signal prevents all requests',
  async (kind) => {
    const stopped = new AbortController();
    stopped.abort(new Error('already stopped'));
    class Options {
      #signal = stopped.signal;
      get signal() {
        return this.#signal;
      }
    }
    const options =
      kind === 'inherited' ? new Options() : Object.defineProperty({}, 'signal', { value: stopped.signal });
    const execute = vi.fn(() => 'effect');
    const h = harness([{ output: [call('record', {})] }, { output: [message] }]);
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await expect(runner.run(h.client, input, options)).rejects.toThrow();
    expect(h.bodies).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  },
);

test.each(['omitted', 'class getter'] as const)(
  'runner ledger ignores ambient saves with %s',
  async (kind) => {
    const save = vi.fn();
    const read = vi.fn();
    class Config {
      #ledger = { runId: 'chosen', save };
      get ledger() {
        read();
        return this.#ledger;
      }
    }
    const h = harness([{ output: [message] }]);
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'ledger');
    try {
      // oxlint-disable-next-line no-extend-native -- Local ambient lookup regression, restored below.
      Object.defineProperty(Object.prototype, 'ledger', {
        configurable: true,
        writable: true,
        value: { runId: 'ambient', save },
      });
      await new ResponsesToolRunner({}).run(h.client, input, kind === 'omitted' ? {} : new Config());
      if (kind === 'omitted') {
        expect(save).not.toHaveBeenCalled();
      } else {
        expect(read).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalled();
        expect(save.mock.calls.every(([record]) => record.run_id === 'chosen')).toBe(true);
      }
    } finally {
      if (previous) {
        // oxlint-disable-next-line no-extend-native -- Restore original descriptor.
        Object.defineProperty(Object.prototype, 'ledger', previous);
      } else {
        Reflect.deleteProperty(Object.prototype, 'ledger');
      }
    }
  },
);

describe('runner preflight and durable replay review', () => {
  const tool = { type: 'function', name: 'f', parameters: {}, strict: false } as const;

  test.each(['inherited-index', 'array-like', 'accessor', 'nonenumerable'] as const)(
    'rejects %s final output entries before the present sibling executes',
    async (kind) => {
      const h = harness([{ output: [call('f', {}, 'real')] }]);
      const execute = vi.fn(() => 'done');
      const injected = call('f', {}, 'injected');
      const read = vi.fn(() => injected);
      const create = h.client.responses.create.bind(h.client.responses);
      vi.spyOn(h.client.responses, 'create').mockImplementation((body, options) =>
        create(body, options)._thenUnwrap((response) => {
          if (!('output' in response)) {
            throw new Error('Expected native non-streaming response');
          }
          const source = [call('f', {}, 'real')];
          if (kind === 'array-like') {
            Reflect.set(response, 'output', { 0: source[0], 1: injected, length: 2 });
          } else {
            source.length = 2;
            if (kind === 'inherited-index') {
              Object.setPrototypeOf(source, Object.create(Array.prototype, { 1: { value: injected } }));
            } else if (kind === 'accessor') {
              Object.defineProperty(source, '1', { enumerable: true, get: read });
            } else {
              Object.defineProperty(source, '1', { enumerable: false, value: injected });
            }
            response.output = source;
          }
          return response;
        }),
      );
      await expect(
        new ResponsesToolRunner({ functions: [{ tool, execute }] }).run(h.client, input),
      ).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );

  test('ambient Object.prototype approval cannot authorize an MCP request', async () => {
    const request: ResponseOutputItem.McpApprovalRequest = {
      type: 'mcp_approval_request',
      id: 'approval',
      server_label: 'desk',
      name: 'read',
      arguments: '{}',
    };
    const h = harness([{ output: [request] }, { output: [message] }]);
    const ambient = vi.fn(() => true);
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'approveMcp');
    try {
      // oxlint-disable-next-line no-extend-native -- Regression for ambient authorization; restored below.
      Object.defineProperty(Object.prototype, 'approveMcp', {
        configurable: true,
        writable: true,
        value: ambient,
      });
      await expect(
        new ResponsesToolRunner({}).run(h.client, {
          ...input,
          tools: [{ type: 'mcp', server_label: 'desk', server_url: 'https://fixture.invalid/mcp' }],
        }),
      ).rejects.toThrow();
    } finally {
      if (previous) {
        // oxlint-disable-next-line no-extend-native -- Restore the prior descriptor.
        Object.defineProperty(Object.prototype, 'approveMcp', previous);
      } else {
        Reflect.deleteProperty(Object.prototype, 'approveMcp');
      }
    }
    expect(ambient).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(1);
  });

  test.each(['omitted', 'class getter'] as const)(
    'computer policy ignores ambient defaults but accepts %s configuration',
    async (kind) => {
      const effect = vi.fn();
      const computer = new ComputerToolset({
        click: effect,
        double_click: effect,
        drag: effect,
        keypress: effect,
        move: effect,
        scroll: effect,
        type: effect,
        wait: effect,
        screenshot: () => ({ type: 'computer_screenshot', file_id: 'file_fixture' }),
      });
      const h = harness([
        {
          output: [
            {
              type: 'computer_call',
              id: 'cu_test',
              call_id: 'call_test',
              status: 'completed',
              actions: [{ type: 'wait' }],
              pending_safety_checks: [{ id: 'needs_review' }],
            },
          ],
        },
        { output: [message] },
      ]);
      const ambient = vi.fn(() => true);
      const ownReads = vi.fn();
      class Config {
        decision = false;
        get computerOptions() {
          ownReads();
          return {
            approveSafetyChecks: () => this.decision,
          };
        }
      }
      const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'computerOptions');
      try {
        // oxlint-disable-next-line no-extend-native -- Local regression for ambient defaults; restored below.
        Object.defineProperty(Object.prototype, 'computerOptions', {
          configurable: true,
          value: { approveSafetyChecks: ambient },
        });
        await expect(
          new ResponsesToolRunner({ computer }).run(h.client, input, kind === 'omitted' ? {} : new Config()),
        ).rejects.toThrow();
      } finally {
        if (previous) {
          // oxlint-disable-next-line no-extend-native -- Restore the original descriptor.
          Object.defineProperty(Object.prototype, 'computerOptions', previous);
        } else {
          Reflect.deleteProperty(Object.prototype, 'computerOptions');
        }
      }
      expect(ambient).not.toHaveBeenCalled();
      expect(effect).not.toHaveBeenCalled();
      expect(ownReads).toHaveBeenCalledTimes(kind === 'omitted' ? 0 : 1);
      expect(h.bodies).toHaveLength(1);
    },
  );

  test('preserves the admitted MCP approval receiver even after a ledger callback changes options', async () => {
    const approval: ResponseOutputItem = {
      type: 'mcp_approval_request',
      id: 'approve_first',
      server_label: 'desk',
      name: 'book',
      arguments: '{}',
    };
    const h = harness([{ output: [approval] }, { output: [message] }]);
    const approve = vi.fn(() => true);
    const options = {
      decision: false,
      approveMcp() {
        return this.decision;
      },
      ledger: {
        runId: 'admitted',
        save(checkpoint: ResponsesRunnerCheckpoint) {
          if (checkpoint.phase === 'pending') {
            options.approveMcp = approve;
          }
        },
      },
    };
    await new ResponsesToolRunner({}).run(
      h.client,
      {
        ...input,
        tools: [{ type: 'mcp', server_label: 'desk', server_url: 'https://fixture.invalid/mcp' }],
      },
      options,
    );
    expect(approve).not.toHaveBeenCalled();
    expect(h.bodies[1]?.['input']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'mcp_approval_response',
          approval_request_id: 'approve_first',
          approve: false,
        }),
      ]),
    );
  });

  test.each(['own getter', 'class method'] as const)(
    'captures configured MCP %s with its original receiver',
    async (kind) => {
      const approval: ResponseOutputItem = {
        type: 'mcp_approval_request',
        id: 'approve_first',
        server_label: 'desk',
        name: 'book',
        arguments: '{}',
      };
      const h = harness([{ output: [approval] }, { output: [message] }]);
      const getter = vi.fn();
      class Policy {
        decision = false;
        approveMcp() {
          return this.decision;
        }
      }
      const options = new Policy();
      if (kind === 'own getter') {
        Object.defineProperty(options, 'approveMcp', {
          enumerable: true,
          get() {
            getter();
            return Policy.prototype.approveMcp;
          },
        });
      }
      await new ResponsesToolRunner({}).run(
        h.client,
        {
          ...input,
          tools: [{ type: 'mcp', server_label: 'desk', server_url: 'https://fixture.invalid/mcp' }],
        },
        options,
      );
      expect(getter).toHaveBeenCalledTimes(kind === 'own getter' ? 1 : 0);
      expect(h.bodies[1]?.['input']).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'mcp_approval_response', approve: false })]),
      );
    },
  );

  test('serializes ordinary nested server declarations once before callbacks', async () => {
    const h = harness([{ output: [wireCall('f', {}, 'one')] }, { output: [message] }]);
    const headers = { 'X-Owned-Value': 'admitted' };
    const params: ResponseCreateParamsNonStreaming = {
      ...input,
      tools: [{ type: 'mcp', server_label: 'desk', server_url: 'https://fixture.invalid/mcp', headers }],
    };
    const runner = new ResponsesToolRunner({
      functions: [
        {
          tool,
          execute() {
            headers['X-Owned-Value'] = 'later';
            return 'done';
          },
        },
      ],
    });
    await runner.run(h.client, params);
    expect(h.bodies[1]?.['tools']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'mcp', headers: { 'X-Owned-Value': 'admitted' } }),
      ]),
    );
  });

  test('validates and dispatches one indexed output snapshot from custom SDK response', async () => {
    const execute = vi.fn(() => 'effect');
    const h = harness([]);
    let reads = 0;
    const response = {
      status: 'completed',
      get output() {
        reads += 1;
        return reads === 1 ? [message] : [wireCall('f', {}, 'one'), wireCall('unknown', {}, 'two')];
      },
    };
    Object.defineProperty(h.client.responses, 'create', { value: async () => response });
    await new ResponsesToolRunner({ functions: [{ tool, execute }] }).run(h.client, input);
    expect(reads).toBe(1);
    expect(execute).not.toHaveBeenCalled();
  });

  test('rejects a missing image source before any later function can execute', async () => {
    const execute = vi.fn(() => [{ type: 'input_image' as const }]);
    const later = vi.fn(() => 'later');
    const h = harness([{ output: [wireCall('f', {}, 'one'), wireCall('later', {}, 'two')] }]);
    const runner = new ResponsesToolRunner({
      functions: [
        { tool, execute },
        { tool: { ...tool, name: 'later' }, execute: later },
      ],
    });
    await expect(runner.run(h.client, input)).rejects.toMatchObject({
      attemptedCallIds: ['call_one'],
      completedCallIds: [],
    });
    expect(later).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(1);
  });

  test('computer-only signal aborts an in-flight ordinary request', async () => {
    const controller = new AbortController();
    const observed: boolean[] = [];
    const client = new OpenAI({
      apiKey: 'fixture',
      maxRetries: 0,
      fetch: async (_url, init) => {
        controller.abort();
        observed.push(init?.signal?.aborted === true);
        init?.signal?.throwIfAborted();
        throw new Error('Resolved computer signal was not forwarded to fetch');
      },
    });
    const runner = new ResponsesToolRunner({});
    await expect(
      runner.run(client, input, { computerOptions: { signal: controller.signal } }),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    expect(controller.signal.aborted).toBe(true);
    expect(observed).toEqual([true]);
  });
  test.each<{
    choice: NonNullable<ResponseCreateParamsNonStreaming['tool_choice']>;
    server: boolean;
    reject: boolean;
  }>([
    { choice: 'required', server: false, reject: true },
    { choice: 'required', server: true, reject: false },
    { choice: { type: 'function', name: 'f' }, server: true, reject: true },
    {
      choice: { type: 'allowed_tools', mode: 'required', tools: [{ type: 'function', name: 'f' }] },
      server: true,
      reject: true,
    },
    {
      choice: {
        type: 'allowed_tools',
        mode: 'required',
        tools: [{ type: 'function', name: 'f' }, { type: 'web_search' }],
      },
      server: true,
      reject: false,
    },
    {
      choice: { type: 'allowed_tools', mode: 'auto', tools: [{ type: 'function', name: 'f' }] },
      server: false,
      reject: false,
    },
  ])('preflights tool_choice $choice with server=$server', async ({ choice, server, reject }) => {
    const h = harness([{ output: [message] }]);
    const execute = vi.fn(() => 'effect');
    const request: ResponseCreateParamsNonStreaming = {
      ...input,
      tool_choice: choice,
      ...(server ? { tools: [{ type: 'web_search' }] } : {}),
    };
    const run = new ResponsesToolRunner({ functions: [{ tool, execute }] }).run(h.client, request);
    if (reject) {
      await expect(run).rejects.toThrow('always requires a local tool');
      expect(h.bodies).toHaveLength(0);
    } else {
      await expect(run).resolves.toMatchObject({ status: 'completed' });
      expect(h.bodies).toHaveLength(1);
      expect(h.bodies[0]?.['tool_choice']).toEqual(choice);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  test('ordinary requests keep admitted foreground and choice fields after callback mutation', async () => {
    const h = harness([{ output: [wireCall('f', {}, 'one')] }, { output: [message] }]);
    const choice: OpenAI.Responses.ToolChoiceAllowed = {
      type: 'allowed_tools',
      mode: 'auto',
      tools: [{ type: 'function', name: 'f' }],
    };
    const request: ResponseCreateParamsNonStreaming = { ...input, tool_choice: choice };
    const runner = new ResponsesToolRunner({
      functions: [
        {
          tool,
          execute() {
            request.background = true;
            request.conversation = 'conv_changed';
            request.previous_response_id = 'resp_changed';
            Reflect.set(request, 'stream', true);
            choice.mode = 'required';
            return 'done';
          },
        },
      ],
    });
    await expect(runner.run(h.client, request)).resolves.toMatchObject({ status: 'completed' });
    expect(h.bodies).toHaveLength(2);
    expect(h.bodies[1]).toMatchObject({
      tool_choice: { type: 'allowed_tools', mode: 'auto', tools: [{ type: 'function', name: 'f' }] },
    });
    expect(h.bodies[1]).not.toHaveProperty('stream');
    expect(h.bodies[1]).not.toHaveProperty('background');
    expect(h.bodies[1]).not.toHaveProperty('conversation');
    expect(h.bodies[1]).not.toHaveProperty('previous_response_id');
  });

  test.each([false, true])(
    'rejects a malformed later function before any effect, stream=%s',
    async (stream) => {
      const execute = vi.fn(() => 'effect');
      const h = harness([
        { output: [wireCall('f', {}, 'one'), { ...wireCall('f', {}, 'two'), arguments: '{' }] },
      ]);
      await expect(
        new ResponsesToolRunner({ functions: [{ tool, execute }] }).run(h.client, input, { stream }),
      ).rejects.toMatchObject({ attemptedCallIds: [], completedCallIds: [] });
      expect(execute).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );

  test.each([undefined, { private: 'fixture content' }, [{ type: 'input_text', extra: 'private' }]])(
    'refuses malformed ordinary results before replay or completed receipts',
    async (result) => {
      const execute = vi.fn(() => result);
      const h = harness([{ output: [wireCall('f', {})] }, { output: [message] }]);
      // @ts-expect-error The public boundary must reject invalid JavaScript executor results.
      const runner = new ResponsesToolRunner({ functions: [{ tool, execute }] });
      await expect(runner.run(h.client, input)).rejects.toMatchObject({
        attemptedCallIds: ['call_f'],
        completedCallIds: [],
      });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(h.bodies).toHaveLength(1);
    },
  );

  test.each([{ stream: false }, { stream: true }, { stream: true, eager: true }])(
    'protects explicit-history IDs without ledger: %o',
    async (options) => {
      const execute = vi.fn(() => 'effect');
      const h = harness([{ output: [wireCall('f', {}, 'old')] }]);
      await expect(
        new ResponsesToolRunner({ functions: [{ tool, execute }] }).run(
          h.client,
          {
            ...input,
            input: [
              wireCall('f', {}, 'old'),
              { type: 'function_call_output', call_id: 'call_old', output: 'prior' },
            ],
          },
          options,
        ),
      ).rejects.toMatchObject({ attemptedCallIds: [], completedCallIds: [] });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  test('sends indexed tool declarations without accepting a substituted array iterator', async () => {
    const declarations: Tool[] = [{ type: 'web_search' }];
    const alternate: Tool[] = [
      { type: 'mcp', server_label: 'unapproved', server_url: 'https://fixture.invalid' },
    ];
    declarations[Symbol.iterator] = () => alternate.values();
    const h = harness([{ output: [message] }]);
    await new ResponsesToolRunner({}).run(h.client, { ...input, tools: declarations });
    expect(h.bodies[0]?.['tools']).toEqual([{ type: 'web_search' }]);
  });

  test.each([false, true])(
    'completed declared image result can finish without a message, stream=%s',
    async (stream) => {
      const image: ResponseOutputItem = {
        id: 'img_fixture',
        type: 'image_generation_call',
        status: 'completed',
        result: 'cG5n',
      };
      const h = harness([{ output: [image] }]);
      const result = await new ResponsesToolRunner({}).run(
        h.client,
        { ...input, store: true, tools: [{ type: 'image_generation' }] },
        { stream },
      );
      expect(result.output).toMatchObject([image]);
      expect(h.bodies).toHaveLength(1);
    },
  );

  test.each([
    { name: 17, arguments: '{}' },
    { name: 'f', arguments: { secret: 'private' } },
  ])('refuses invalid MCP approval fields before local effects and policy: %o', async (fields) => {
    const execute = vi.fn(() => 'effect');
    const approveMcp = vi.fn(() => true);
    const approval = { type: 'mcp_approval_request', id: 'approve_one', server_label: 'desk', ...fields };
    // @ts-expect-error Exercise an invalid custom transport response.
    const h = harness([{ output: [wireCall('f', {}), approval] }]);
    const runner = new ResponsesToolRunner({ functions: [{ tool, execute }] });
    await expect(
      runner.run(
        h.client,
        {
          ...input,
          tools: [{ type: 'mcp', server_label: 'desk', server_url: 'https://fixture.invalid' }],
        },
        { approveMcp },
      ),
    ).rejects.toMatchObject({ attemptedCallIds: [], completedCallIds: [] });
    expect(execute).not.toHaveBeenCalled();
    expect(approveMcp).not.toHaveBeenCalled();
  });

  test('empty MCP error prevents the whole deferred batch', async () => {
    const execute = vi.fn(() => 'effect');
    const h = harness([
      {
        output: [
          wireCall('f', {}),
          { type: 'mcp_list_tools', id: 'mcp_list', server_label: 'desk', tools: [], error: '' },
        ],
      },
    ]);
    await expect(
      new ResponsesToolRunner({ functions: [{ tool, execute }] }).run(h.client, {
        ...input,
        tools: [{ type: 'mcp', server_label: 'desk', server_url: 'https://fixture.invalid' }],
      }),
    ).rejects.toMatchObject({ attemptedCallIds: [], completedCallIds: [] });
    expect(execute).not.toHaveBeenCalled();
  });

  test.each(['in_progress', 'incomplete'] as const)(
    'a %s message stops the whole deferred batch before a sibling effect',
    async (status) => {
      const execute = vi.fn(() => 'changed');
      const runner = new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
      });
      const h = harness([{ output: [call('record', {}), { ...message, status }] }]);
      await expect(runner.run(h.client, input)).rejects.toBeInstanceOf(ResponsesToolRunnerError);
      expect(execute).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );

  test('restores a legitimate large checkpoint without a function-argument ceiling', async () => {
    const { ledger, writes } = recording();
    const history: ResponseInputItem[] = Array.from({ length: 140_000 }, () => ({
      role: 'user',
      content: 'x',
    }));
    const first = harness([{ output: [message] }]);
    await new ResponsesToolRunner({}).run(
      first.client,
      { ...input, input: history },
      { ledger, maxSteps: 3 },
    );
    const [boundary] = writes;
    if (!boundary) {
      throw new Error('Missing admission checkpoint.');
    }
    const h = harness([{ output: [message] }]);
    await expect(
      new ResponsesToolRunner({}).run(
        h.client,
        { ...input, input: 'fresh observation' },
        { ledger: { ...ledger, resumeFrom: boundary } },
      ),
    ).resolves.toMatchObject({ status: 'completed' });
    expect(h.bodies[0]?.['input']).toHaveLength(140_001);
  }, 20_000);

  test('an interrupted eager message leaves a durable pending checkpoint', async () => {
    const { ledger, writes } = recording();
    const h = harness([{ output: [message], interrupt: true }]);
    await expect(
      new ResponsesToolRunner({}).run(h.client, input, { ledger, stream: true, eager: true }),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    const saved = writes.pop();
    if (!saved) {
      throw new Error('Missing pending checkpoint.');
    }
    expect(saved).toMatchObject({
      phase: 'pending',
      pending_items: [message],
      attempted_call_ids: [],
      returned_call_ids: [],
    });
    const resume = harness([{ output: [message] }]);
    await expect(
      new ResponsesToolRunner({}).run(
        resume.client,
        { ...input, input: 'fresh observation' },
        { ledger: { ...ledger, resumeFrom: saved } },
      ),
    ).rejects.toThrow();
    expect(resume.bodies).toHaveLength(0);
  });

  test('observation-only streams save a linear volume of complete checkpoints', async () => {
    const measurements = await Promise.all(
      [2, 4, 8].map(async (size) => {
        const output = Array.from({ length: size }, (_, index) => ({
          ...message,
          id: `msg_${index}`,
          content: [{ type: 'output_text' as const, text: 'fixture '.repeat(128), annotations: [] }],
        }));
        const { ledger, writes } = recording();
        await new ResponsesToolRunner({}).run(harness([{ output }]).client, input, {
          ledger,
          stream: true,
          eager: true,
        });
        return { count: writes.length, bytes: JSON.stringify(writes).length };
      }),
    );
    const [two, four, eight] = measurements;
    if (!two || !four || !eight) {
      throw new Error('Missing observation measurements');
    }
    expect([two.count, four.count, eight.count]).toEqual([two.count, two.count, two.count]);
    expect(eight.bytes - four.bytes).toBeLessThanOrEqual((four.bytes - two.bytes) * 2.05);
  });

  test('eager interruption retains every server receipt and effect admission retains its full prefix', async () => {
    const saved = recording();
    const search: ResponseOutputItem = {
      type: 'web_search_call',
      id: 'search',
      status: 'completed',
      action: { type: 'search', query: 'fixture' },
    };
    const prefix: ResponseOutputItem[] = [
      { ...message, id: 'msg_0' },
      { ...message, id: 'msg_1' },
      search,
      { ...message, id: 'msg_2' },
    ];
    const request: ResponseCreateParamsNonStreaming = {
      ...input,
      tools: [{ type: 'web_search_preview' }],
      tool_choice: {
        type: 'allowed_tools',
        mode: 'auto',
        tools: [{ type: 'web_search_preview' }, { type: 'function', name: 'record' }],
      },
    };
    const execute = vi.fn(() => {
      const [last] = saved.writes.slice(-1);
      expect(last).toMatchObject({
        phase: 'pending',
        pending_items: [...prefix, wireCall('record', {})],
        attempted_call_ids: ['call_record'],
        returned_call_ids: [],
      });
      return 'recorded';
    });
    const runner = new ResponsesToolRunner({ functions: [{ tool: functionTool('record'), execute }] });
    await expect(
      runner.run(harness([{ output: prefix, interrupt: true }]).client, request, {
        ledger: saved.ledger,
        stream: true,
        eager: true,
      }),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    const [interrupted] = saved.writes.slice(-1);
    expect(interrupted).toMatchObject({
      phase: 'pending',
      pending_items: prefix.slice(0, 3),
    });
    expect(execute).not.toHaveBeenCalled();
    await runner.run(
      harness([{ output: [...prefix, wireCall('record', {})] }, { output: [message] }]).client,
      request,
      { ledger: saved.ledger, stream: true, eager: true },
    );
    expect(execute).toHaveBeenCalledOnce();
  });
});

describe('typed runner functions', () => {
  const parsed = z.object({ count: z.number().int().min(1) });
  const fromTyped = [
    {
      name: 'Zod 4',
      create: (
        execute?: (args: {
          count: number;
        }) => ResponseInputItem.FunctionCallOutput['output'] | { private: string },
      ) => zodResponsesFunction({ name: 'count', parameters: parsed, function: execute }),
    },
    {
      name: 'Zod 3',
      create: (
        execute?: (args: {
          count: number;
        }) => ResponseInputItem.FunctionCallOutput['output'] | { private: string },
      ) =>
        zodResponsesFunction({
          name: 'count',
          parameters: z3.object({ count: z3.number().int().min(1) }),
          function: execute,
        }),
    },
    {
      name: 'Standard Schema',
      create: (
        execute?: (args: {
          count: number;
        }) => ResponseInputItem.FunctionCallOutput['output'] | { private: string },
      ) => standardResponsesFunction({ name: 'count', parameters: parsed, function: execute }),
    },
  ];
  test.each(fromTyped)('$name validates before execution and replays native results', async ({ create }) => {
    const execute = vi.fn(({ count }: { count: number }) => `counted ${count}`);
    const env = harness([{ output: [wireCall('count', { count: 3 })] }, { output: [message] }]);
    const runner = new ResponsesToolRunner({ functions: [runnerFunction(create(execute))] });
    const { ledger } = recording();
    await runner.run(env.client, input, { ledger });
    expect(execute).toHaveBeenCalledExactlyOnceWith({ count: 3 });
    expect(env.bodies[1]?.['input']).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_count',
      output: 'counted 3',
    });
    const invalid = harness([{ output: [wireCall('count', { count: 0 })] }]);
    const diagnostic: RunnerDiagnostic[] = [];
    await expect(
      runner.run(invalid.client, input, {
        onDiagnostic: (event) => {
          diagnostic.push(event);
        },
      }),
    ).rejects.toMatchObject({
      attemptedCallIds: [],
      completedCallIds: [],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(diagnostic).toContainEqual(
      expect.objectContaining({ stage: 'arguments', reason: 'invalid_input' }),
    );
    expect(diagnostic.some((event) => event.stage === 'action')).toBe(false);
  });

  test.each(fromTyped)('$name rejects absent execution and unsafe output', async ({ create }) => {
    expect(() => runnerFunction(create())).toThrow('parser and callback');
    const execute = vi.fn(() => ({ private: 'must not be submitted' }));
    const env = harness([{ output: [wireCall('count', { count: 1 })] }]);
    const runner = new ResponsesToolRunner({ functions: [runnerFunction(create(execute))] });
    const diagnostic: RunnerDiagnostic[] = [];
    await expect(
      runner.run(env.client, input, {
        onDiagnostic: (event) => {
          diagnostic.push(event);
        },
      }),
    ).rejects.toMatchObject({
      attemptedCallIds: ['call_count'],
      completedCallIds: [],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(env.bodies).toHaveLength(1);
    expect(diagnostic.filter((event) => event.stage === 'action')).toMatchObject([{ reason: 'completed' }]);
    expect(diagnostic).toContainEqual(expect.objectContaining({ stage: 'output', reason: 'invalid_output' }));
  });
});

describe('mixed server tools', () => {
  test('rejects stateless image generation before a request or local effect', async () => {
    const execute = vi.fn(() => 'recorded');
    const env = harness([
      {
        output: [
          { type: 'image_generation_call', id: 'image', status: 'completed', result: null },
          wireCall('record', {}),
        ],
      },
      { output: [message] },
    ]);
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await expect(runner.run(env.client, { ...input, tools: [{ type: 'image_generation' }] })).rejects.toThrow(
      'stored responses',
    );
    expect(env.bodies).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  const serverCases = [
    {
      tool: { type: 'code_interpreter', container: { type: 'auto' } },
      item: {
        type: 'code_interpreter_call',
        id: 'ci',
        status: 'completed',
        container_id: 'owned_container',
        code: null,
        outputs: [],
      },
    },
    {
      tool: { type: 'image_generation' },
      item: { type: 'image_generation_call', id: 'image', status: 'completed', result: null },
    },
    {
      tool: { type: 'web_search_preview' },
      item: {
        type: 'web_search_call',
        id: 'search',
        status: 'completed',
        action: { type: 'search', query: 'fixture' },
      },
    },
  ] satisfies { tool: Tool; item: ResponseOutputItem }[];
  const replayCases = [
    ...serverCases,
    {
      tool: { type: 'file_search', vector_store_ids: ['vs_fixture'] },
      item: { type: 'file_search_call', id: 'files', status: 'completed', queries: ['fixture'] },
    },
    {
      tool: {
        type: 'mcp',
        server_label: 'desk',
        server_url: 'https://fixture.invalid/mcp',
        require_approval: 'never',
      },
      item: {
        type: 'mcp_call',
        id: 'remote',
        server_label: 'desk',
        name: 'read',
        arguments: '{}',
        output: 'done',
      },
    },
  ] satisfies { tool: Tool; item: ResponseOutputItem }[];
  test.each(replayCases.filter(({ tool }) => tool.type !== 'mcp'))(
    'lost $tool.type response cannot resume before the first output',
    async ({ tool }) => {
      const saved = recording();
      const request: ResponseCreateParamsNonStreaming = { ...input, store: true, tools: [tool] };
      const runner = new ResponsesToolRunner({});
      const h = harness([{ output: [], interrupt: true }]);
      await expect(
        runner.run(h.client, request, { ledger: saved.ledger, stream: true, eager: true }),
      ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
      const [last] = saved.writes.slice(-1);
      expect(last).toMatchObject({ phase: 'pending', pending_items: [] });
      if (!last) {
        throw new Error('Missing server admission');
      }
      const resumed = harness([{ output: [message] }]);
      await expect(
        runner.run(resumed.client, request, { ledger: { ...saved.ledger, resumeFrom: last } }),
      ).rejects.toThrow('Invalid or unresolved ledger');
      expect(resumed.bodies).toHaveLength(0);
    },
  );

  test.each(replayCases.filter(({ tool }) => tool.type !== 'mcp'))(
    '$tool.type honors none and allowed_tools before an eager local sibling and permits selected tools',
    async ({ tool, item }) => {
      const execute = vi.fn(() => 'recorded');
      const request: ResponseCreateParamsNonStreaming = { ...input, store: true, tools: [tool] };
      const excluded: NonNullable<ResponseCreateParamsNonStreaming['tool_choice']>[] = [
        'none',
        { type: 'allowed_tools', mode: 'auto', tools: [{ type: 'function', name: 'record' }] },
      ];
      await Promise.all(
        excluded.map(async (tool_choice) => {
          const runner = new ResponsesToolRunner({ functions: [{ tool: functionTool('record'), execute }] });
          const output = tool_choice === 'none' ? [item] : [item, wireCall('record', {})];
          const h = harness([{ output }, { output: [message] }]);
          await expect(
            runner.run(h.client, { ...request, tool_choice }, { stream: true, eager: true }),
          ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
          expect(h.bodies).toHaveLength(1);
        }),
      );
      expect(execute).not.toHaveBeenCalled();
      const selected: NonNullable<ResponseCreateParamsNonStreaming['tool_choice']>[] = [
        'auto',
        'required',
        { type: tool.type },
        { type: 'allowed_tools', mode: 'auto', tools: [{ type: tool.type }] },
      ];
      await Promise.all(
        selected.map(async (tool_choice) => {
          const runner = new ResponsesToolRunner({ functions: [{ tool: functionTool('record'), execute }] });
          const h = harness([{ output: [item] }]);
          await expect(
            runner.run(h.client, { ...request, tool_choice }, { stream: true, eager: true }),
          ).resolves.toMatchObject({ status: 'completed' });
          expect(h.bodies).toHaveLength(1);
        }),
      );
    },
  );

  test.each(
    replayCases.flatMap(({ tool, item }) =>
      ['scalar', 'nested', 'json', 'created_by'].map((extension) => ({ tool, item, extension })),
    ),
  )(
    'preflights $item.type replay data with $extension extras before sibling effects',
    async ({ tool, item, extension }) => {
      const env = harness([{ output: [wireCall('record', {}), item] }, { output: [message] }]);
      const create = env.client.responses.create.bind(env.client.responses);
      vi.spyOn(env.client.responses, 'create').mockImplementation((params, options) =>
        create(params, options)._thenUnwrap((response) => {
          if ('output' in response) {
            const returned = response.output.find((entry) => entry.type === item.type);
            if (returned) {
              let value: bigint | { value: number | bigint } = { value: 1n };
              if (extension === 'json') {
                value = { value: 1 };
              } else if (extension === 'scalar') {
                value = 1n;
              }
              Reflect.set(returned, extension === 'created_by' ? 'created_by' : 'extension', value);
            }
          }
          return response;
        }),
      );
      const execute = vi.fn(() => 'recorded');
      const runner = new ResponsesToolRunner({
        functions: [{ tool: functionTool('record'), execute }],
      });
      const result = runner.run(env.client, {
        ...input,
        store: tool.type === 'image_generation',
        tools: [tool],
      });
      if (extension === 'scalar' || extension === 'nested') {
        await expect(result).rejects.toBeInstanceOf(ResponsesToolRunnerError);
        expect(execute).not.toHaveBeenCalled();
        expect(env.bodies).toHaveLength(1);
      } else {
        await expect(result).resolves.toMatchObject({ status: 'completed' });
        expect(execute).toHaveBeenCalledOnce();
        expect(env.bodies[1]?.['input']).toContainEqual({
          ...item,
          ...(extension === 'json' ? { extension: { value: 1 } } : {}),
        });
      }
    },
  );
  test.each([
    { type: 'search', query: null },
    { type: 'search', query: 3 },
    { type: 'search', queries: null },
    { type: 'search', queries: 'query' },
    { type: 'search', queries: [null] },
    { type: 'search', sources: null },
    { type: 'search', sources: {} },
    { type: 'search', sources: [null] },
    { type: 'search', sources: ['source'] },
    { type: 'search', sources: [{}] },
    { type: 'search', sources: [{ type: 'url' }] },
    { type: 'search', sources: [{ type: 'file', url: 'fixture' }] },
    { type: 'search', sources: [{ type: 'url', url: null }] },
    { type: 'search', sources: [{ type: 'url', url: 3 }] },
    { type: 'open_page', url: false },
    { type: 'open_page', url: 3 },
  ])('rejects malformed web-search action %j before sibling effects', async (action) => {
    await Promise.all(
      [false, true].map(async (stream) => {
        const execute = vi.fn(() => 'recorded');
        // SAFETY: This controlled invalid reply exercises the native result boundary.
        const search = {
          type: 'web_search_call',
          id: 'search',
          status: 'completed',
          action,
        } as ResponseOutputItem;
        const env = harness([{ output: [wireCall('record', {}), search] }, { output: [message] }]);
        const runner = new ResponsesToolRunner({
          functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
        });
        await expect(
          runner.run(env.client, { ...input, tools: [{ type: 'web_search' }] }, { stream, eager: stream }),
        ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
        expect(execute).not.toHaveBeenCalled();
        expect(env.bodies).toHaveLength(1);
      }),
    );
  });

  test.each([
    { type: 'search' },
    { type: 'search', query: '', queries: [], sources: [] },
    {
      type: 'search',
      query: 'legacy query',
      queries: ['query', ''],
      sources: [{ type: 'url', url: '', title: 'keep source extra' }],
      note: 'keep action extra',
    },
    { type: 'open_page' },
    { type: 'open_page', url: null },
    { type: 'open_page', url: '' },
    { type: 'find_in_page', pattern: '', url: '' },
  ])('preserves valid web-search action %j during replay', async (action) => {
    await Promise.all(
      [false, true].map(async (stream) => {
        const execute = vi.fn(() => 'recorded');
        // SAFETY: The table intentionally retains native optional fields and unknown extras.
        const search = {
          type: 'web_search_call',
          id: 'search',
          status: 'completed',
          action,
        } as ResponseOutputItem;
        const env = harness([{ output: [wireCall('record', {}), search] }, { output: [message] }]);
        const runner = new ResponsesToolRunner({
          functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
        });
        await runner.run(
          env.client,
          { ...input, tools: [{ type: 'web_search' }] },
          { stream, eager: stream },
        );
        expect(execute).toHaveBeenCalledOnce();
        expect(env.bodies).toHaveLength(2);
        expect(env.bodies[1]?.['input']).toContainEqual(search);
      }),
    );
  });

  test.each([
    [null],
    [{ type: 'logs' }],
    [{ type: 'image' }],
    [{ type: 'logs', logs: 3 }],
    [{ type: 'image', url: false }],
    [{ type: 'other', logs: 'fixture' }],
  ])('rejects incomplete interpreter output %j before local effects', async (...outputs) => {
    const execute = vi.fn(() => 'unused');
    // SAFETY: Deliberate invalid native reply tests the public runner guard.
    const item = {
      type: 'code_interpreter_call',
      id: 'ci',
      status: 'completed',
      container_id: 'owned',
      code: null,
      outputs,
    } as ResponseOutputItem;
    const env = harness([{ output: [call('record', {}), item] }, { output: [message] }]);
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await expect(
      runner.run(env.client, {
        ...input,
        tools: [{ type: 'code_interpreter', container: { type: 'auto' } }],
      }),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    expect(execute).not.toHaveBeenCalled();
    expect(env.bodies).toHaveLength(1);
  });

  test.each([
    { stream: false, eager: false },
    { stream: true, eager: false },
    { stream: true, eager: true },
  ])('rejects an unselected interpreter container before effects %#', async ({ stream, eager }) => {
    const item: ResponseOutputItem = {
      type: 'code_interpreter_call',
      id: 'ci',
      status: 'completed',
      container_id: 'cn_other',
      code: null,
      outputs: [{ type: 'logs', logs: 'complete' }],
    };
    const execute = vi.fn(() => 'must not run');
    const env = harness([{ output: [wireCall('record', {}), item] }, { output: [message] }]);
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await expect(
      runner.run(
        env.client,
        { ...input, tools: [{ type: 'code_interpreter', container: 'cn_selected' }] },
        { stream, eager },
      ),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    expect(execute).not.toHaveBeenCalled();
    expect(env.bodies).toHaveLength(1);
  });

  test.each([
    { stream: false, eager: false, automatic: false },
    { stream: true, eager: false, automatic: false },
    { stream: true, eager: true, automatic: false },
    { stream: false, eager: false, automatic: true },
    { stream: true, eager: false, automatic: true },
    { stream: true, eager: true, automatic: true },
  ])(
    'replays the selected interpreter container and validates its ledger %#',
    async ({ stream, eager, automatic }) => {
      const item: ResponseOutputItem = {
        type: 'code_interpreter_call',
        id: 'ci',
        status: 'completed',
        container_id: 'cn_selected',
        code: null,
        outputs: [{ type: 'logs', logs: 'complete' }],
      };
      const execute = vi.fn(() => 'selected');
      const env = harness([{ output: [wireCall('record', {}), item] }, { output: [message] }]);
      const runner = new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
      });
      const params: ResponseCreateParamsNonStreaming = {
        ...input,
        tools: [{ type: 'code_interpreter', container: automatic ? { type: 'auto' } : 'cn_selected' }],
      };
      const saved = recording();
      await runner.run(env.client, params, { stream, eager, ledger: saved.ledger });
      expect(execute).toHaveBeenCalledOnce();
      expect(env.bodies[1]?.['input']).toContainEqual(item);
      const boundary = saved.writes.find(
        (entry) => entry.phase === 'boundary' && entry.returned_call_ids.includes('call_record'),
      );
      if (!boundary) {
        throw new Error('Missing returned local call boundary');
      }
      const resumed = harness([{ output: [message] }]);
      await runner.run(resumed.client, params, { ledger: { ...saved.ledger, resumeFrom: boundary } });
      expect(resumed.bodies).toHaveLength(1);
      expect(execute).toHaveBeenCalledOnce();
      const changed = structuredClone(boundary);
      const interpreter = changed.history.find((value) => value.type === 'code_interpreter_call');
      if (!interpreter || interpreter.type !== 'code_interpreter_call') {
        throw new Error('Missing interpreter history');
      }
      interpreter.container_id = 'cn_other';
      const other = harness([{ output: [message] }]);
      const replayed = recording();
      const run = runner.run(other.client, params, { ledger: { ...replayed.ledger, resumeFrom: changed } });
      if (automatic) {
        await run;
        expect(other.bodies).toHaveLength(1);
      } else {
        await expect(run).rejects.toThrow();
        expect(other.bodies).toHaveLength(0);
        expect(replayed.writes).toHaveLength(0);
      }
      expect(execute).toHaveBeenCalledOnce();
    },
  );

  test('replays native interpreter null, logs and image outputs without stripping extras', async () => {
    const outputs = [
      { type: 'logs', logs: '', metadata: 'keep' },
      { type: 'image', url: '', note: 'keep' },
    ];
    // SAFETY: Forward-compatible native wire extras do not belong to the generated exact type.
    const item = {
      type: 'code_interpreter_call',
      id: 'ci',
      status: 'completed',
      container_id: 'owned',
      code: null,
      outputs,
    } as ResponseOutputItem;
    const execute = vi.fn(() => 'recorded');
    const env = harness([{ output: [item, call('record', {})] }, { output: [message] }]);
    await new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    }).run(env.client, { ...input, tools: [{ type: 'code_interpreter', container: { type: 'auto' } }] });
    expect(execute).toHaveBeenCalledOnce();
    expect(env.bodies[1]?.['input']).toContainEqual(item);
  });
  test.each(serverCases)('replays $tool.type with an ordinary function', async ({ tool, item }) => {
    const execute = vi.fn(() => 'recorded');
    const env = harness([{ output: [item, wireCall('record', {})] }, { output: [message] }]);
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const saved = recording();
    await runner.run(
      env.client,
      { ...input, store: tool.type === 'image_generation', tools: [tool] },
      { ledger: saved.ledger },
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(env.bodies[1]?.['input']).toContainEqual(item);
    expect(
      saved.writes.some(
        (write) => write.phase === 'boundary' && write.history.some((v) => v.type === item.type),
      ),
    ).toBe(true);
  });

  test.each(['action', 'background', 'output_format', 'quality', 'revised_prompt', 'size'])(
    'reviewed image metadata %s rejects malformed present values before sibling work',
    async (field) => {
      const execute = vi.fn(() => 'recorded');
      const image: ResponseOutputItem = {
        type: 'image_generation_call',
        id: 'image',
        status: 'completed',
        result: null,
      };
      Object.assign(image, { [field]: {} });
      const env = harness([{ output: [call('record', {}), image] }, { output: [message] }]);
      const runner = new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
      });
      await expect(
        runner.run(env.client, { ...input, store: true, tools: [{ type: 'image_generation' }] }),
      ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
      expect(execute).not.toHaveBeenCalled();
      expect(env.bodies).toHaveLength(1);
    },
  );

  test.each([
    {},
    { action: null, background: null, output_format: null, quality: null, revised_prompt: null, size: null },
    {
      action: 'edit',
      background: 'transparent',
      output_format: 'webp',
      quality: 'max',
      revised_prompt: '',
      size: '1536x864',
      next_field: 'kept',
    },
  ])('reviewed image metadata preserves nullable, omitted and native fields %#', async (metadata) => {
    const execute = vi.fn(() => 'recorded');
    const image: ResponseOutputItem = {
      type: 'image_generation_call',
      id: 'image',
      status: 'completed',
      result: '',
    };
    Object.assign(image, metadata);
    const env = harness([{ output: [call('record', {}), image] }, { output: [message] }]);
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await runner.run(env.client, { ...input, store: true, tools: [{ type: 'image_generation' }] });
    expect(execute).toHaveBeenCalledOnce();
    expect(env.bodies[1]?.['input']).toContainEqual(image);
  });

  test.each(['type', 'name', 'arguments', 'call_id'])(
    'reviewed function routing rejects omitted native %s before sibling work',
    async (field) => {
      const execute = vi.fn(() => 'recorded');
      const incomplete = call('record', {}, 'second');
      Reflect.deleteProperty(incomplete, field);
      const env = harness([{ output: [call('record', {}), incomplete] }, { output: [message] }]);
      const runner = new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
      });
      await expect(runner.run(env.client, input)).rejects.toBeInstanceOf(ResponsesToolRunnerError);
      expect(execute).not.toHaveBeenCalled();
      expect(env.bodies).toHaveLength(1);
    },
  );

  test('reviewed function routing permits a native call without optional ID or status', async () => {
    const execute = vi.fn(() => 'recorded');
    const selected = call('record', {});
    Reflect.deleteProperty(selected, 'id');
    Reflect.deleteProperty(selected, 'status');
    const env = harness([{ output: [selected] }, { output: [message] }]);
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await runner.run(env.client, input);
    expect(execute).toHaveBeenCalledOnce();
    expect(env.bodies[1]?.['input']).toContainEqual(selected);
  });

  test.each([false, true])('distinct id-less native calls complete once each: eager=%s', async (eager) => {
    const execute = vi.fn(() => 'recorded');
    const first = call('record', {}, 'first');
    const second = call('record', {}, 'second');
    Reflect.deleteProperty(first, 'id');
    Reflect.deleteProperty(second, 'id');
    const env = harness([{ output: [first, second] }, { output: [message] }]);
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await runner.run(env.client, input, { stream: eager, eager });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(env.bodies[1]?.['input']).toEqual(expect.arrayContaining([first, second]));
  });

  test.each([
    { id: null },
    { id: [] },
    { async: null },
    { async: 'later' },
    { namespace: null },
    { namespace: {} },
    { caller: [] },
    { caller: {} },
    { caller: { type: 'program' } },
    { caller: { type: 'program', caller_id: null } },
    { caller: { type: 'other' } },
  ])('AG refuses malformed native function metadata before a sibling effect: %o', async (metadata) => {
    const execute = vi.fn(() => 'recorded');
    const selected = Object.assign(call('record', {}, 'second'), metadata);
    const env = harness([{ output: [call('record', {}), selected] }, { output: [message] }]);
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await expect(runner.run(env.client, input)).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    expect(execute).not.toHaveBeenCalled();
    expect(env.bodies).toHaveLength(1);
  });

  test.each([
    { caller: null, async: false, namespace: '' },
    { caller: { type: 'direct' as const }, async: true },
    { caller: { type: 'program' as const, caller_id: '' }, namespace: 'fixture', extra: ['kept'] },
  ])('AG preserves native function caller and metadata: %o', async (metadata) => {
    const execute = vi.fn(() => 'recorded');
    const selected = Object.assign(call('record', {}), metadata);
    const env = harness([{ output: [selected] }, { output: [message] }]);
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await runner.run(env.client, input);
    expect(execute).toHaveBeenCalledOnce();
    expect(env.bodies[1]?.['input']).toContainEqual(selected);
  });

  test('reviewed ordinary request tools reject a missing slot before transport', async () => {
    const tools: Tool[] = [{ type: 'web_search' }];
    Reflect.deleteProperty(tools, '0');
    const env = harness([{ output: [message] }]);
    await expect(new ResponsesToolRunner({}).run(env.client, { ...input, tools })).rejects.toThrow();
    expect(env.bodies).toHaveLength(0);
  });

  test('reviewed ordinary request tools capture an own getter and its native conversion once', async () => {
    const seen = { getter: 0, converted: 0 };
    class RequestTool {
      #tool = { type: 'web_search' as const };

      toJSON() {
        seen.converted += 1;
        return this.#tool;
      }
    }
    const tools: Tool[] = [];
    Object.defineProperty(tools, 0, {
      enumerable: false,
      get() {
        seen.getter += 1;
        return new RequestTool();
      },
    });
    const env = harness([{ output: [message] }]);
    await new ResponsesToolRunner({}).run(env.client, { ...input, tools });
    expect(env.bodies[0]?.['tools']).toEqual([{ type: 'web_search' }]);
    expect(seen).toEqual({ getter: 1, converted: 1 });
  });

  test('AG ordinary allowed tool choices capture dense own slots before transport', async () => {
    const tools: Record<string, unknown>[] = [{ type: 'web_search' }];
    Reflect.deleteProperty(tools, '0');
    const env = harness([{ output: [message] }]);
    await expect(
      new ResponsesToolRunner({}).run(env.client, {
        ...input,
        tools: [{ type: 'web_search' }],
        tool_choice: { type: 'allowed_tools', mode: 'auto', tools },
      }),
    ).rejects.toThrow();
    expect(env.bodies).toHaveLength(0);
  });

  test('ordinary include arrays require own entries before transport', async () => {
    const include: ResponseCreateParamsNonStreaming['include'] = ['reasoning.encrypted_content'];
    Reflect.deleteProperty(include, '0');
    const env = harness([{ output: [message] }]);
    await expect(new ResponsesToolRunner({}).run(env.client, { ...input, include })).rejects.toThrow();
    expect(env.bodies).toHaveLength(0);
  });

  test('ordinary include arrays preserve an owned getter and read it once', async () => {
    const include: ResponseCreateParamsNonStreaming['include'] = [];
    let reads = 0;
    Object.defineProperty(include, '0', {
      get() {
        reads += 1;
        return 'reasoning.encrypted_content';
      },
    });
    const env = harness([{ output: [message] }]);
    await new ResponsesToolRunner({}).run(env.client, { ...input, include });
    expect(env.bodies[0]?.['include']).toEqual(['reasoning.encrypted_content']);
    expect(reads).toBe(1);
  });

  test('AG allowed choice normal conversion and its own getters run once', async () => {
    const seen: string[] = [];
    const tools: Tool[] = [];
    Object.defineProperty(tools, 0, {
      enumerable: false,
      get() {
        seen.push('entry');
        return { type: 'web_search' };
      },
    });
    class Choice {
      readonly type = 'allowed_tools';
      readonly mode = 'auto';
      readonly tools: Record<string, unknown>[] = [];

      toJSON() {
        seen.push('toJSON');
        const { type: kind, mode } = this;
        return {
          get type() {
            seen.push('type');
            return kind;
          },
          get tools() {
            seen.push('tools');
            return tools;
          },
          mode,
        };
      }
    }
    const env = harness([{ output: [message] }]);
    const params = { ...input, tools: [{ type: 'web_search' as const }], tool_choice: new Choice() };
    await new ResponsesToolRunner({}).run(env.client, params);
    expect(seen).toEqual(['toJSON', 'type', 'tools', 'entry']);
    expect(env.bodies[0]?.['tool_choice']).toEqual({
      type: 'allowed_tools',
      mode: 'auto',
      tools: [{ type: 'web_search' }],
    });
  });

  test.each(
    serverCases.flatMap(({ tool, item }) => {
      let required = ['id', 'status', 'action'];
      if (item.type === 'code_interpreter_call') {
        required = ['id', 'status', 'container_id', 'code', 'outputs'];
      } else if (item.type === 'image_generation_call') {
        required = ['id', 'status', 'result'];
      }
      return required.map((field) => ({ tool, item, field }));
    }),
  )('refuses $tool.type missing $field before sibling work', async ({ tool, item, field }) => {
    const malformed = { ...item };
    Reflect.deleteProperty(malformed, field);
    const execute = vi.fn(() => 'must not run');
    const env = harness([{ output: [wireCall('record', {}), malformed] }, { output: [message] }]);
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    await expect(
      runner.run(env.client, { ...input, store: tool.type === 'image_generation', tools: [tool] }),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    expect(execute).not.toHaveBeenCalled();
    expect(env.bodies).toHaveLength(1);
  });

  test('file search cannot replay a missing query borrowed from the array prototype', async () => {
    const execute = vi.fn(() => 'must not run');
    const item: ResponseOutputItem = {
      type: 'file_search_call',
      id: 'fs',
      status: 'completed',
      queries: [],
    };
    const env = harness([{ output: [wireCall('record', {}), item] }, { output: [message] }]);
    const create = env.client.responses.create.bind(env.client.responses);
    vi.spyOn(env.client.responses, 'create').mockImplementation((params, options) =>
      create(params, options)._thenUnwrap((response) => {
        if ('output' in response) {
          const search = response.output.find((value) => value.type === 'file_search_call');
          if (search?.type === 'file_search_call') {
            search.queries = Array.from({ length: 501 }, () => 'fixture');
            Reflect.deleteProperty(search.queries, '500');
          }
        }
        return response;
      }),
    );
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const previous = Object.getOwnPropertyDescriptor(Array.prototype, '500');
    // oxlint-disable-next-line no-extend-native -- Reproduce a inherited value after native cloning; restore the exact descriptor in finally.
    Object.defineProperty(Array.prototype, '500', { value: 'fixture', configurable: true, writable: true });
    try {
      await expect(
        runner.run(env.client, {
          ...input,
          tools: [{ type: 'file_search', vector_store_ids: ['vs_fixture'] }],
        }),
      ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
      expect(execute).not.toHaveBeenCalled();
      expect(env.bodies).toHaveLength(1);
    } finally {
      if (previous) {
        // oxlint-disable-next-line no-extend-native -- Restore the original test environment.
        Object.defineProperty(Array.prototype, '500', previous);
      } else {
        Reflect.deleteProperty(Array.prototype, '500');
      }
    }
  });

  test.each(serverCases.slice(0, 2))(
    'preserves a failed $tool.type and stops before a local effect',
    async ({ tool, item }) => {
      const execute = vi.fn(() => 'must not run');
      const failed = { ...item, status: 'failed' };
      // SAFETY: These cases are code interpreter or image generation, both with native failed status.
      const env = harness([{ output: [failed as ResponseOutputItem, wireCall('record', {})] }]);
      const runner = new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
      });
      const saved = recording();
      await expect(
        runner.run(
          env.client,
          { ...input, store: tool.type === 'image_generation', tools: [tool] },
          { ledger: saved.ledger },
        ),
      ).rejects.toThrow(ResponsesToolRunnerError);
      expect(execute).not.toHaveBeenCalled();
      // oxlint-disable-next-line prefer-at -- The SDK compiles against ES2020.
      expect(saved.writes[saved.writes.length - 1]).toMatchObject({
        phase: 'pending',
        pending_items: [failed, wireCall('record', {})],
      });
    },
  );

  const mcp: Tool = { type: 'mcp', server_label: 'owned', server_url: 'https://fixture.invalid/mcp' };
  const approval: ResponseOutputItem.McpApprovalRequest = {
    type: 'mcp_approval_request',
    id: 'approval_actual',
    name: 'read',
    server_label: 'owned',
    arguments: '{}',
  };
  test.each<ResponseOutputItem>([
    { ...approval },
    { ...approval, type: 'mcp_call', status: 'completed' },
    { type: 'mcp_list_tools', id: 'mcp', server_label: 'owned', tools: [] },
  ])('rejects $type without a server label before approval or local input', async (source) => {
    const item = structuredClone(source);
    Reflect.deleteProperty(item, 'server_label');
    const effect = vi.fn(() => 'done');
    const approveMcp = vi.fn(() => true);
    const h = harness([{ output: [item, call('record', {})] }, { output: [message] }]);
    const runner = new ResponsesToolRunner({
      functions: [
        { tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute: effect },
      ],
    });
    await expect(runner.run(h.client, { ...input, tools: [mcp] }, { approveMcp })).rejects.toBeInstanceOf(
      ResponsesToolRunnerError,
    );
    expect(effect).not.toHaveBeenCalled();
    expect(approveMcp).not.toHaveBeenCalled();
  });
  test('a duplicate MCP request ID cannot replace the approved action in ordinary history', async () => {
    const changed = { ...approval, arguments: '{"changed":true}' };
    const receipt: ResponseInputItem = {
      type: 'mcp_approval_response',
      approval_request_id: approval.id,
      approve: true,
    };
    const executed: ResponseOutputItem = {
      type: 'mcp_call',
      id: 'remote',
      approval_request_id: approval.id,
      server_label: changed.server_label,
      name: changed.name,
      arguments: changed.arguments,
      status: 'completed',
    };
    const effect = vi.fn(() => 'must not run');
    const runner = new ResponsesToolRunner({
      functions: [
        { tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute: effect },
      ],
    });
    const h = harness([{ output: [executed, call('record', {})] }, { output: [message] }]);
    await expect(
      runner.run(h.client, { ...input, input: [approval, receipt, changed, receipt], tools: [mcp] }),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    expect(effect).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(0);
  });
  test.each([false, true])(
    'does not retry MCP after a retryable HTTP failure (automatic=%s)',
    async (automatic) => {
      const bodies: unknown[] = [];
      const client = new OpenAI({
        apiKey: 'fixture',
        maxRetries: 1,
        fetch: async (_url, init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return bodies.length === 1 && !automatic
            ? Response.json({ id: 'response', object: 'response', status: 'completed', output: [approval] })
            : Response.json({ error: { message: 'synthetic failure' } }, { status: 500 });
        },
      });
      await expect(
        new ResponsesToolRunner({}).run(client, { ...input, tools: [mcp] }, { approveMcp: () => true }),
      ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
      expect(bodies).toHaveLength(automatic ? 1 : 2);
    },
  );

  test('reports an MCP approval on the last request as a step limit without asking for approval', async () => {
    const h = harness([{ output: [approval] }]);
    const approveMcp = vi.fn(() => true);
    await expect(
      new ResponsesToolRunner({}).run(h.client, { ...input, tools: [mcp] }, { maxSteps: 1, approveMcp }),
    ).rejects.toThrow('reached maxSteps');
    expect(approveMcp).not.toHaveBeenCalled();
  });
  test.each([true, false])(
    'MCP approval %s waits for inspection and uses its actual ID',
    async (approved) => {
      const approveMcp = vi.fn(() => approved);
      const env = harness([
        { output: [approval, { ...message, id: 'msg_before_approval' }] },
        { output: [message] },
      ]);
      const saved = recording();
      const runner = new ResponsesToolRunner({});
      const iterator = runner.iterate(
        env.client,
        { ...input, tools: [mcp] },
        { ledger: saved.ledger, stream: true, eager: true, approveMcp },
      );
      const first = await iterator.next();
      expect(first.value).toMatchObject({ final: false, toolsExecuted: false });
      expect(approveMcp).not.toHaveBeenCalled();
      await iterator.next();
      expect(approveMcp).toHaveBeenCalledExactlyOnceWith(approval);
      expect(env.bodies[1]?.['input']).toContainEqual({
        type: 'mcp_approval_response',
        approval_request_id: approval.id,
        approve: approved,
      });
      expect(
        saved.writes.some((w) => w.phase === 'boundary' && w.returned_call_ids.includes(approval.id)),
      ).toBe(true);
      await iterator.return();
    },
  );
  test('cancellation during ledger persistence prevents the MCP approval callback', async () => {
    const controller = new AbortController();
    const approveMcp = vi.fn(() => true);
    const diagnostics: RunnerDiagnostic[] = [];
    const env = harness([{ output: [approval] }]);
    const saved = recording();
    const runner = new ResponsesToolRunner({});
    await expect(
      runner.run(
        env.client,
        { ...input, tools: [mcp] },
        {
          signal: controller.signal,
          approveMcp,
          onDiagnostic: (event) => diagnostics.push(event),
          ledger: {
            ...saved.ledger,
            save(value) {
              saved.ledger.save(value);
              if (value.attempted_call_ids.includes(approval.id)) {
                controller.abort();
              }
            },
          },
        },
      ),
    ).rejects.toMatchObject({ attemptedCallIds: [approval.id], completedCallIds: [] });
    expect(approveMcp).not.toHaveBeenCalled();
    expect(env.bodies).toHaveLength(1);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ stage: 'approval', reason: 'cancelled', call_id: approval.id }),
    );
    expect(saved.writes.some((value) => value.attempted_call_ids.includes(approval.id))).toBe(true);
  });

  test('MCP never accepts implicit, forged, duplicate or undeclared approval', async () => {
    const runner = new ResponsesToolRunner({});
    for (const output of [
      [approval],
      [{ ...approval, server_label: 'outside' }],
      [approval, approval],
      [
        // SAFETY: Test a forbidden wire item the API can return at runtime.
        {
          type: 'mcp_approval_response',
          id: 'forged',
          approval_request_id: approval.id,
          approve: true,
        } as ResponseOutputItem,
      ],
    ]) {
      const env = harness([{ output }]);
      // oxlint-disable-next-line no-await-in-loop -- Each invalid case uses the same runner to check recovery.
      await expect(runner.run(env.client, { ...input, tools: [mcp] })).rejects.toThrow(
        ResponsesToolRunnerError,
      );
      expect(env.bodies).toHaveLength(1);
    }
  });

  test.each([
    { approve: false, change: {} },
    { approve: true, change: { approval_request_id: 'unknown' } },
    { approve: true, change: { name: 'another' } },
    { approve: true, change: { arguments: '{"changed":true}' } },
  ])('MCP call must match earlier receipt %#', async ({ approve, change }) => {
    const execute = vi.fn(() => 'must not run');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const mcpCall: ResponseOutputItem.McpCall = {
      type: 'mcp_call',
      id: 'remote',
      approval_request_id: approval.id,
      name: approval.name,
      arguments: approval.arguments,
      server_label: approval.server_label,
      status: 'completed',
      ...change,
    };
    const env = harness([{ output: [approval] }, { output: [mcpCall, wireCall('record', {})] }]);
    await expect(
      runner.run(
        env.client,
        { ...input, tools: [mcp] },
        { stream: true, eager: true, approveMcp: () => approve },
      ),
    ).rejects.toThrow(ResponsesToolRunnerError);
    expect(execute).not.toHaveBeenCalled();
  });

  test('server tools defer eager local effects until the entire response passes inspection', async () => {
    const execute = vi.fn(() => 'must not run');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const env = harness([
      {
        output: [
          wireCall('record', {}),
          {
            type: 'code_interpreter_call',
            id: 'ci',
            status: 'failed',
            container_id: 'owned',
            code: null,
            outputs: null,
          },
        ],
      },
    ]);
    await expect(
      runner.run(
        env.client,
        { ...input, tools: [{ type: 'code_interpreter', container: { type: 'auto' } }] },
        { stream: true, eager: true },
      ),
    ).rejects.toThrow(ResponsesToolRunnerError);
    expect(execute).not.toHaveBeenCalled();
  });
});

test('diagnostics isolate approval/action stages and keep missing usage unknown', async () => {
  const events: RunnerDiagnostic[] = [];
  const effect = vi.fn(() => 'private effect result');
  const browser = new BrowserToolset({ state, click: effect }, { confirm: () => false });
  const env = harness([
    { output: [wireCall('browser_click', { tab_id: null, target: 'private_target' })] },
    { output: [message] },
  ]);
  await new ResponsesToolRunner({ browser }).run(env.client, input, {
    onDiagnostic(event) {
      events.push(structuredClone(event));
      throw new Error('sink credentials');
    },
  });
  expect(effect).not.toHaveBeenCalled();
  expect(events.filter((event) => event.stage === 'request')).toMatchObject([
    { api: 'responses', reason: 'completed', usage: null },
    { api: 'responses', reason: 'completed', usage: null },
  ]);
  expect(events).toContainEqual(
    expect.objectContaining({ api: 'browser', stage: 'approval', reason: 'policy_failed' }),
  );
  expect(events.some((event) => event.stage === 'action')).toBe(false);
  expect(JSON.stringify(events)).not.toMatch(
    /private_target|fixture.invalid|sink credentials|synthetic-test-key/u,
  );
});

test.each([true, false])('human text follows pending outputs, with ledger=%s', async (durable) => {
  const execute = vi.fn(() => 'actual output');
  const runner = new ResponsesToolRunner({
    functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
  });
  const env = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
  const saved = recording();
  const iterator = runner.iterate(env.client, input, durable ? { ledger: saved.ledger } : {});
  const first = await iterator.next();
  if (!first.value) {
    throw new Error('Expected a proposed turn');
  }
  const proposed = first.value;
  expect(() => {
    // @ts-expect-error runtime guard rejects tool receipts from human text input
    proposed.appendUserText({ type: 'function_call_output', call_id: 'forged' });
  }).toThrow();
  proposed.appendUserText('Please review again.');
  expect(execute).not.toHaveBeenCalled();
  const last = await iterator.next();
  expect(execute).toHaveBeenCalledOnce();
  expect(env.bodies[1]?.['input']).toEqual([
    { role: 'user', content: input.input },
    wireCall('record', {}),
    { type: 'function_call_output', call_id: 'call_record', output: 'actual output' },
    { role: 'user', content: 'Please review again.' },
  ]);
  expect(() => proposed.appendUserText('stale')).toThrow();
  if (!last.value) {
    throw new Error('Expected a final turn');
  }
  const final = last.value;
  expect(() => final.appendUserText('after final')).toThrow();
  if (durable) {
    expect(
      saved.writes.filter((write) => write.phase === 'boundary' && write.consumed_requests === 1),
    ).toContainEqual(expect.objectContaining({ history: env.bodies[1]?.['input'] }));
  }
  await iterator.return();
});

test('one allowlisted eager call can be deferred until the iterator advances', async () => {
  const execute = vi.fn(() => 'recorded');
  const runner = new ResponsesToolRunner({
    functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    earlyExecution: { functions: ['record'] },
  });
  const env = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
  const beforeEarlyCall = vi.fn(() => 'defer' as const);
  const iterator = runner.iterate(env.client, input, { stream: true, eager: true, beforeEarlyCall });
  const first = await iterator.next();
  expect(first.value).toMatchObject({ final: false, toolsExecuted: false });
  expect(beforeEarlyCall).toHaveBeenCalledExactlyOnceWith(wireCall('record', {}));
  expect(execute).not.toHaveBeenCalled();
  await iterator.next();
  expect(execute).toHaveBeenCalledExactlyOnceWith({});
  await iterator.return();
});

test('an early gate permits only opted-in pending ordinary overrides without a registration allowlist', async () => {
  const record = vi.fn(() => 'executed record');
  const restricted = vi.fn(() => 'actual restricted');
  const read = vi.fn(() => 'actual page');
  const runner = new ResponsesToolRunner({
    browser: new BrowserToolset({ state, get_page_text: read }),
    functions: [
      {
        tool: { type: 'function', name: 'record', parameters: {}, strict: false },
        allowOutputOverride: true,
        execute: record,
      },
      {
        tool: { type: 'function', name: 'restricted', parameters: {}, strict: false },
        execute: restricted,
      },
    ],
  });
  const env = harness([
    {
      output: [
        wireCall('record', {}, 'already'),
        wireCall('record', {}, 'pending'),
        wireCall('browser_get_page_text', { tab_id: null }),
        wireCall('restricted', {}),
      ],
    },
    { output: [message] },
  ]);
  const iterator = runner.iterate(env.client, input, {
    stream: true,
    eager: true,
    beforeEarlyCall: (item) => (item.call_id === 'call_already' ? 'execute' : 'defer'),
  });
  const first = await iterator.next();
  if (first.done) {
    throw new Error('Missing pending turn');
  }
  expect(first.value).toMatchObject({ toolsExecuted: true, attemptedCallIds: ['call_already'] });
  for (const call_id of [
    'call_already',
    'call_browser_get_page_text',
    'call_restricted',
    'remote_approval',
  ]) {
    expect(() =>
      first.value.supplyOutputs([{ type: 'function_call_output', call_id, output: 'forged' }]),
    ).toThrow();
  }
  first.value.supplyOutputs([
    { type: 'function_call_output', call_id: 'call_pending', output: 'human record' },
  ]);
  await iterator.next();
  expect(record).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(1);
  expect(restricted).toHaveBeenCalledTimes(1);
  expect(env.bodies[1]?.['input']).toContainEqual({
    type: 'function_call_output',
    call_id: 'call_pending',
    output: 'human record',
  });
  await iterator.return();
});

test('an independent read progresses beside stream events and settles before a dependent effect', async () => {
  const order: string[] = [];
  const held = deferred();
  const runner = new ResponsesToolRunner({
    functions: [
      {
        tool: { type: 'function', name: 'read', parameters: {}, strict: false },
        independent: true,
        execute: async () => {
          order.push('read started');
          await held.promise;
          order.push('read ended');
          return 'read';
        },
      },
      {
        tool: { type: 'function', name: 'record', parameters: {}, strict: false },
        execute: () => {
          order.push('record');
          return 'recorded';
        },
      },
    ],
    earlyExecution: { functions: ['read', 'record'] },
  });
  const env = harness([{ output: [wireCall('read', {}), wireCall('record', {})] }, { output: [message] }]);
  await runner.run(env.client, input, {
    stream: true,
    eager: true,
    onEvent(event) {
      if (
        event.type === 'response.output_item.added' &&
        event.item.type === 'function_call' &&
        event.item.name === 'record'
      ) {
        order.push('stream advanced');
        held.resolve();
      }
    },
  });
  expect(order).toEqual(['read started', 'stream advanced', 'read ended', 'record']);
  expect(env.bodies[1]?.['input']).toEqual([
    { role: 'user', content: input.input },
    wireCall('read', {}),
    wireCall('record', {}),
    { type: 'function_call_output', call_id: 'call_read', output: 'read' },
    { type: 'function_call_output', call_id: 'call_record', output: 'recorded' },
  ]);
});

test.each([undefined, 1, 3])(
  'eager independent calls respect window %s and replay every receipt in order',
  async (limit) => {
    let active = 0;
    let peak = 0;
    const runner = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'read', parameters: {}, strict: false },
          independent: true,
          execute: async () => {
            active += 1;
            peak = Math.max(peak, active);
            await nextTurn();
            active -= 1;
            return 'observed';
          },
        },
      ],
    });
    const calls = Array.from({ length: 8 }, (_, index) => call('read', {}, String(index)));
    const env = harness([{ output: calls }, { output: [message] }]);
    await runner.run(env.client, input, {
      stream: true,
      eager: true,
      ...(limit === undefined ? {} : { maxConcurrentCalls: limit }),
    });
    expect(peak).toBeLessThanOrEqual(limit ?? 2);
    expect(active).toBe(0);
    expect(env.bodies[1]?.['input']).toEqual([
      { role: 'user', content: input.input },
      ...calls,
      ...calls.map((item) => ({ type: 'function_call_output', call_id: item.call_id, output: 'observed' })),
    ]);
  },
);

test('admission precedes getters when busy or closed and invalid preparation releases the slot', async () => {
  const env = harness([{ output: [message] }, { output: [message] }]);
  const runner = new ResponsesToolRunner({});
  await expect(runner.run(env.client, input, { maxConcurrentCalls: 0 })).rejects.toBeInstanceOf(TypeError);
  const iterator = runner.iterate(env.client, input);
  await expect(iterator.next()).resolves.toMatchObject({ value: { final: true } });
  const read = vi.fn(() => {
    throw new Error('new-run options were inspected');
  });
  const options = Object.defineProperty({}, 'computerOptions', { enumerable: true, get: read });
  await expect(runner.run(env.client, input, options)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  runner.close();
  await iterator.return();
  await expect(runner.run(env.client, input, options)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(env.bodies).toHaveLength(1);
});

test.each([
  { kind: 'JSON metadata', value: { source: 'fixture' }, valid: true },
  { kind: 'non-JSON metadata', value: 1n, valid: false },
])('a ledger final checkpoint preserves inspected fields and checks own $kind', async ({ value, valid }) => {
  const env = harness([{ output: [message] }]);
  const create = env.client.responses.create.bind(env.client.responses);
  const statuses = vi.fn().mockReturnValueOnce('completed').mockReturnValue('failed');
  const outputs = vi.fn().mockReturnValueOnce([message]).mockReturnValue([]);
  vi.spyOn(env.client.responses, 'create').mockImplementation((body, options) =>
    create(body, options)._thenUnwrap((response) => {
      Object.defineProperties(response, {
        status: { configurable: true, enumerable: true, get: statuses },
        output: { configurable: true, enumerable: true, get: outputs },
      });
      // JSON.parse creates this as an ordinary own data field, never as the object's prototype.
      Object.defineProperty(response, '__proto__', { configurable: true, enumerable: true, value });
      return response;
    }),
  );
  const { ledger, writes } = recording();
  const run = new ResponsesToolRunner({}).run(env.client, input, { ledger });
  if (valid) {
    await run;
    const final = writes.find((item) => item.phase === 'final');
    expect(final?.final_response).toMatchObject({ status: 'completed', output: [message] });
    expect(Object.getOwnPropertyDescriptor(final?.final_response ?? {}, '__proto__')).toMatchObject({
      value,
      enumerable: true,
    });
  } else {
    await expect(run).rejects.toThrow();
    expect(writes.some((item) => item.phase === 'final')).toBe(false);
  }
  expect(statuses).toHaveBeenCalledTimes(1);
  expect(outputs).toHaveBeenCalledTimes(1);
});

test('independent failure is retained before any dependent browser effect', async () => {
  const click = vi.fn();
  const runner = new ResponsesToolRunner({
    browser: new BrowserToolset({ state, click }, { confirm: () => true }),
    functions: [
      {
        tool: { type: 'function', name: 'read', parameters: {}, strict: false },
        independent: true,
        execute: async () => {
          throw new Error('read failed');
        },
      },
    ],
  });
  const env = harness([
    { output: [wireCall('read', {}), wireCall('browser_click', { tab_id: null, target: 'button' })] },
  ]);
  await expect(runner.run(env.client, input, { stream: true, eager: true })).rejects.toMatchObject({
    attemptedCallIds: ['call_read'],
    completedCallIds: [],
  });
  expect(click).not.toHaveBeenCalled();
});

function contextNative(id: string, checked = false): ResponseOutputItem {
  return {
    id: `native_${id}`,
    call_id: id,
    type: 'computer_call',
    status: 'completed',
    actions: [{ type: 'screenshot' }],
    pending_safety_checks: checked
      ? [{ id: `consent_${id}`, code: 'fixture', message: 'Approve fixture' }]
      : [],
  };
}
const unexpectedNative = () => {
  throw new Error('Unexpected non-screenshot native action');
};
const nativeActions = {
  click: unexpectedNative,
  double_click: unexpectedNative,
  drag: unexpectedNative,
  keypress: unexpectedNative,
  move: unexpectedNative,
  scroll: unexpectedNative,
  type: unexpectedNative,
  wait: unexpectedNative,
};

describe('audit Node browser and runner boundaries', () => {
  test.each([42, true, { id: 'same' }, ['same']])(
    'rejects non-string call ID %j before any effect',
    async (id) => {
      const execute = vi.fn(() => 'must not run');
      const runner = new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
      });
      const malformed = wireCall('record', {}, 'malformed');
      Reflect.set(malformed, 'call_id', id);
      const h = harness([{ output: [wireCall('record', {}, 'valid'), malformed] }, { output: [message] }]);
      await expect(runner.run(h.client, input)).rejects.toMatchObject({
        attemptedCallIds: [],
        completedCallIds: [],
      });
      expect(execute).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );

  test('eager completion rejects a queued item beyond a missing stream index', async () => {
    const execute = vi.fn(() => 'must not run');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const h = harness([
      {
        output: [
          message,
          { type: 'reasoning', id: 'pending_reasoning', summary: [] },
          wireCall('record', {}),
        ],
        omitDoneIndices: [1],
        completedOutput: [message],
      },
    ]);
    await expect(runner.run(h.client, input, { stream: true, eager: true })).rejects.toMatchObject({
      attemptedCallIds: [],
      completedCallIds: [],
    });
    expect(execute).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(1);
  });

  test.each(['screenshot', 'zoom'])('failed %s cannot displace the last image', async (member) => {
    let captured = false;
    const browser = new BrowserToolset({
      state,
      screenshot: () => {
        if (captured) {
          throw new BrowserError('Image unavailable');
        }
        captured = true;
        return { type: 'input_image', detail: 'auto', file_id: 'file_observed' };
      },
      zoom: () => {
        throw new BrowserError('Image unavailable');
      },
      get_page_text: () => 'current page',
    });
    const good = wireCall('browser_screenshot', { tab_id: null }, 'good');
    const failed = wireCall(
      `browser_${member}`,
      {
        tab_id: null,
        ...(member === 'zoom' ? { region: [0, 0, 5, 5] } : {}),
      },
      'failed',
    );
    const latest = wireCall('browser_get_page_text', { tab_id: null }, 'latest');
    const history = [
      good,
      await browser.execute(good),
      failed,
      await browser.execute(failed),
      latest,
      await browser.execute(latest),
    ];
    const h = harness([{ output: [message] }]);
    const eligible: string[][] = [];
    await expect(
      new ResponsesToolRunner({ browser }).run(
        h.client,
        { ...input, input: history },
        {
          ledger: recording().ledger,
          contextBudget: {
            maxInputBytes: 20_000,
            maxInputImages: 0,
            compact(snapshot) {
              eligible.push(snapshot.eligibleCallIds);
              return { dropCallIds: snapshot.eligibleCallIds };
            },
          },
        },
      ),
    ).rejects.toMatchObject({ attemptedCallIds: [], completedCallIds: [] });
    expect(eligible).toEqual([['call_failed']]);
    expect(h.bodies).toHaveLength(0);
  });

  test('blanket eager replay accepts large native JSON and ignores only SDK parsed metadata', async () => {
    const largeText = 'synthetic pixels'.repeat(160_000);
    const effects: unknown[] = [];
    const runner = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'record', parameters: {}, strict: false },
          execute(args) {
            effects.push(args['value']);
            return 'recorded';
          },
        },
      ],
    });
    const item = wireCall('record', { value: largeText });
    const completed = { ...item, created_by: 'synthetic metadata' };
    const h = harness([{ output: [item], completedOutput: [completed] }, { output: [message] }]);
    const response = await runner.run(h.client, input, { stream: true, eager: true });
    expect(response.output_text).toBe('done');
    expect(effects).toEqual([largeText]);
    expect(h.bodies[1]?.['input']).toContainEqual(item);
    expect(h.bodies[1]?.['input']).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_record',
      output: 'recorded',
    });
  });

  test.each(['replace', 'drop'])(
    'eager lifecycle %s preserves effects and refuses pending replay',
    async (change) => {
      const execute = vi.fn(() => 'recorded');
      const runner = new ResponsesToolRunner({ functions: [{ tool: functionTool('record'), execute }] });
      const first = wireCall('record', { value: 'original' });
      const later = change === 'drop' ? [] : [{ ...first, arguments: '{"value":"replacement"}' }];
      const env = harness([{ output: [first], lifecycleOutput: later, completedOutput: later }]);
      const saved = recording();
      await expect(
        runner.run(env.client, input, { stream: true, eager: true, ledger: saved.ledger }),
      ).rejects.toMatchObject({
        attemptedCallIds: ['call_record'],
        completedCallIds: ['call_record'],
      });
      expect(execute).toHaveBeenCalledExactlyOnceWith({ value: 'original' });
      expect(env.bodies).toHaveLength(1);
      // oxlint-disable-next-line unicorn/prefer-at -- The package's minimum type-check target is ES2020.
      const pending = saved.writes[saved.writes.length - 1];
      if (!pending) {
        throw new Error('Expected the failed stream to retain a pending checkpoint');
      }
      expect(pending?.phase).toBe('pending');
      const restarted = harness([]);
      const save = vi.fn();
      await expect(
        runner.run(
          restarted.client,
          { ...input, input: 'fresh observation' },
          {
            ledger: { ...saved.ledger, save, resumeFrom: pending },
          },
        ),
      ).rejects.toThrow(/boundary/u);
      expect(restarted.bodies).toHaveLength(0);
      expect(save).not.toHaveBeenCalled();
      expect(execute).toHaveBeenCalledOnce();
    },
  );

  test('a duplicate blanket eager index stops before later stream items', async () => {
    const effects: string[] = [];
    const runner = new ResponsesToolRunner({
      functions: ['first', 'later'].map((name) => ({
        tool: { type: 'function' as const, name, parameters: {}, strict: false },
        execute() {
          effects.push(name);
          return name;
        },
      })),
    });
    const h = harness([{ output: [wireCall('first', {}), wireCall('later', {})], duplicateIndex: 0 }]);
    await expect(runner.run(h.client, input, { stream: true, eager: true })).rejects.toMatchObject({
      attemptedCallIds: ['call_first'],
      completedCallIds: ['call_first'],
    });
    expect(effects).toEqual(['first']);
    expect(h.bodies).toHaveLength(1);
  });

  test('preflights IDs from caller ledger input before any new effects', async () => {
    const effects: unknown[] = [];
    const runner = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'submit', parameters: {}, strict: false },
          execute(args) {
            effects.push(args);
            return 'saved';
          },
        },
      ],
    });
    const h = harness([
      { output: [wireCall('submit', { value: 'must not run' }, 'new'), wireCall('submit', {}, 'history')] },
      { output: [message] },
    ]);
    await expect(
      runner.run(
        h.client,
        {
          ...input,
          input: [
            wireCall('submit', { value: 'earlier' }, 'history'),
            { type: 'function_call_output', call_id: 'call_history', output: 'already handled' },
          ],
        },
        { ledger: recording().ledger },
      ),
    ).rejects.toMatchObject({ attemptedCallIds: [], completedCallIds: [] });
    expect(effects).toEqual([]);
    expect(h.bodies[0]?.['input']).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_history',
      output: 'already handled',
    });
    expect(h.bodies).toHaveLength(1);
  });

  test.each(['text', '', null, undefined])('keeps valid action result %j', async (result) => {
    const driver: BrowserDriver = { state };
    Reflect.set(driver, 'click', () => result);
    const browser = new BrowserToolset(driver, { confirm: () => true });
    const h = harness([
      { output: [wireCall('browser_click', { target: 'ref_one', tab_id: null })] },
      { output: [message] },
    ]);
    const response = await new ResponsesToolRunner({ browser }).run(h.client, input);
    expect(response.output_text).toBe('done');
    expect(h.bodies[1]?.['input']).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_browser_click',
      output: [
        {
          type: 'input_text',
          text: JSON.stringify({
            ok: true,
            result,
            state: { tabs: [{ id: 'one', title: 'Fixture', url: 'https://fixture.invalid', active: true }] },
          }),
        },
      ],
    });
  });

  test.each([null, { functions: ['submit'] }])(
    'eager completion cannot rewrite an executed call (policy=%j)',
    async (earlyExecution) => {
      const effects: unknown[] = [];
      const runner = new ResponsesToolRunner({
        earlyExecution,
        functions: [
          {
            tool: { type: 'function', name: 'submit', parameters: {}, strict: false },
            execute(args) {
              effects.push(args);
              return 'saved';
            },
          },
        ],
      });
      const h = harness([
        {
          output: [wireCall('submit', { value: 'ACTUAL' })],
          completedOutput: [wireCall('submit', { value: 'NEVER_ACTED' })],
        },
        { output: [message] },
      ]);
      await expect(runner.run(h.client, input, { stream: true, eager: true })).rejects.toMatchObject({
        attemptedCallIds: ['call_submit'],
        completedCallIds: ['call_submit'],
      });
      expect(effects).toEqual([{ value: 'ACTUAL' }]);
      expect(h.bodies).toHaveLength(1);
    },
  );

  test.each([false, true])('preflights all non-eager IDs before effects (stream=%s)', async (stream) => {
    const effects: unknown[] = [];
    const runner = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'submit', parameters: {}, strict: false },
          execute(args) {
            effects.push(args);
            return 'saved';
          },
        },
      ],
    });
    const sameTurn = harness([
      {
        output: [
          wireCall('submit', { value: 'one' }, 'repeat'),
          wireCall('submit', { value: 'two' }, 'repeat'),
        ],
      },
      { output: [message] },
    ]);
    await expect(runner.run(sameTurn.client, input, { stream })).rejects.toMatchObject({
      attemptedCallIds: [],
      completedCallIds: [],
    });
    expect(effects).toEqual([]);
    expect(sameTurn.bodies).toHaveLength(1);

    const laterTurn = harness([
      { output: [wireCall('submit', { value: 'accepted' }, 'old')] },
      { output: [wireCall('submit', { value: 'must not run' }, 'new'), wireCall('submit', {}, 'old')] },
      { output: [message] },
    ]);
    await expect(runner.run(laterTurn.client, input, { stream })).rejects.toMatchObject({
      attemptedCallIds: ['call_old'],
      completedCallIds: ['call_old'],
    });
    expect(effects).toEqual([{ value: 'accepted' }]);
    expect(laterTurn.bodies).toHaveLength(2);
  });

  test('retains a zoom observation even after a newer page read', async () => {
    const browser = new BrowserToolset({
      state,
      zoom: () => ({ type: 'input_image', file_id: 'file_zoom' }),
      get_page_text: () => 'current page',
    });
    const h = harness([
      {
        output: [
          wireCall('browser_zoom', { tab_id: null, region: [0, 0, 5, 5] }, 'zoom'),
          wireCall('browser_get_page_text', { tab_id: null }, 'read'),
        ],
      },
      { output: [message] },
    ]);
    const eligible: string[][] = [];
    await expect(
      new ResponsesToolRunner({ browser }).run(h.client, input, {
        ledger: recording().ledger,
        contextBudget: {
          maxInputBytes: 20_000,
          maxInputImages: 0,
          compact(snapshot) {
            eligible.push(snapshot.eligibleCallIds);
            return { dropCallIds: snapshot.eligibleCallIds, summary: 'discard older observations' };
          },
        },
      }),
    ).rejects.toMatchObject({
      attemptedCallIds: ['call_zoom', 'call_read'],
      completedCallIds: ['call_zoom', 'call_read'],
    });
    expect(eligible).toEqual([[]]);
    expect(h.bodies).toHaveLength(1);
  });

  test('tool declarations stay isolated across callers and requests', async () => {
    const driver: BrowserDriver = { state, read_page: () => 'contents' };
    const browser = new BrowserToolset(driver);
    const filter = browser.tools().find((tool) => tool.name === 'browser_read_page')?.parameters?.[
      'properties'
    ];
    if (!isObj(filter) || !isObj(filter['filter']) || !Array.isArray(filter['filter']['enum'])) {
      throw new Error('Missing advertised read_page filter');
    }
    const choices = filter['filter']['enum'];
    choices.push('not_supported');
    try {
      const h = harness([
        { output: [wireCall('browser_read_page', { tab_id: null, filter: 'interactive' })] },
        { output: [message] },
      ]);
      const result = await new ResponsesToolRunner({ browser: new BrowserToolset(driver) }).run(
        h.client,
        input,
      );
      expect(result.output_text).toBe('done');
      expect(h.bodies[0]?.['tools']).toContainEqual(
        expect.objectContaining({
          name: 'browser_read_page',
          parameters: expect.objectContaining({
            properties: expect.objectContaining({ filter: { type: 'string', enum: ['all', 'interactive'] } }),
          }),
        }),
      );
    } finally {
      choices.pop();
    }
  });

  test.each([
    {
      kind: 'extra field',
      result: { type: 'input_image', detail: 'auto', file_id: 'file_test', extra: 'unapproved' },
    },
    {
      kind: 'invalid second image source',
      result: { type: 'input_image', image_url: 'data:image/png;base64,AAAA', file_id: ' ' },
    },
    {
      kind: 'invalid detail',
      result: { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'invalid' },
    },
    { kind: 'action object', result: { internal: 'metadata' } },
    { kind: 'action number', result: 7 },
  ])('stops malformed driver result before another SDK request: $kind', async ({ kind, result }) => {
    const screenshot = kind !== 'action object' && kind !== 'action number';
    const driver: BrowserDriver = { state };
    Reflect.set(driver, 'screenshot', () => result);
    Reflect.set(driver, 'click', () => result);
    const browser = new BrowserToolset(driver, { confirm: () => true });
    const name = screenshot ? 'browser_screenshot' : 'browser_click';
    const args = screenshot ? { tab_id: null } : { target: 'ref_one', tab_id: null };
    const h = harness([{ output: [wireCall(name, args)] }, { output: [message] }]);
    await expect(new ResponsesToolRunner({ browser }).run(h.client, input)).rejects.toMatchObject({
      attemptedCallIds: [`call_${name}`],
      completedCallIds: [],
    });
    expect(h.bodies).toHaveLength(1);
  });

  test('snapshots screenshot fields before final state changes a driver result', async () => {
    const image = { type: 'input_image' as const, detail: 'auto' as const, file_id: 'file_original' };
    let reports = 0;
    const browser = new BrowserToolset({
      state() {
        reports += 1;
        if (reports === 2) {
          image.file_id = 'file_replaced';
        }
        return state();
      },
      screenshot: () => image,
    });
    const h = harness([
      { output: [wireCall('browser_screenshot', { tab_id: null })] },
      { output: [message] },
    ]);
    const response = await new ResponsesToolRunner({ browser }).run(h.client, input);
    expect(response.output_text).toBe('done');
    expect(h.bodies[1]?.['input']).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_browser_screenshot',
      output: [
        {
          type: 'input_text',
          text: JSON.stringify({
            ok: true,
            state: { tabs: [{ id: 'one', title: 'Fixture', url: 'https://fixture.invalid', active: true }] },
          }),
        },
        { type: 'input_image', detail: 'auto', file_id: 'file_original' },
      ],
    });
  });
});

describe('ResponsesToolRunner request context budget', () => {
  test.each(
    [false, true].flatMap((withLedger) => [false, true].map((withBudget) => ({ withLedger, withBudget }))),
  )(
    'omits undefined request fields with ledger=$withLedger budget=$withBudget',
    async ({ withLedger, withBudget }) => {
      const entry = { role: 'user' as const, content: 'fixture task' };
      const tool = { type: 'web_search' as const };
      const request = { ...input, input: [entry], tools: [tool], text: {} };
      // JavaScript callers can pass present undefined fields despite exact optional property types.
      Reflect.set(request, 'metadata', undefined);
      Reflect.set(request, 'max_output_tokens', undefined);
      Reflect.set(request.text, 'verbosity', undefined);
      Reflect.set(entry, 'type', undefined);
      Reflect.set(tool, 'search_context_size', undefined);
      const h = harness([{ output: [message] }]);
      const saved = recording();
      await expect(
        new ResponsesToolRunner({}).run(h.client, request, {
          ...(withBudget ? { contextBudget: { maxInputBytes: 1000, maxInputImages: 0 } } : {}),
          ...(withLedger ? { ledger: saved.ledger } : {}),
        }),
      ).resolves.toMatchObject({ output_text: 'done' });
      expect(h.bodies[0]).toMatchObject({ text: {}, tools: [{ type: 'web_search' }] });
      expect(h.bodies[0]).not.toHaveProperty('metadata');
      expect(h.bodies[0]).not.toHaveProperty('max_output_tokens');
      expect(h.bodies[0]?.['input']).toStrictEqual([{ role: 'user', content: 'fixture task' }]);
      expect(h.bodies[0]?.['tools']).toStrictEqual([{ type: 'web_search' }]);
      for (const checkpoint of saved.writes) {
        expect(checkpoint.history[0]).toStrictEqual({ role: 'user', content: 'fixture task' });
        expect(checkpoint.tools).toStrictEqual([{ type: 'web_search' }]);
      }
      expect(hasOwn(request, 'metadata')).toBe(true);
      expect(hasOwn(request.text, 'verbosity')).toBe(true);
      expect(hasOwn(entry, 'type')).toBe(true);
      expect(hasOwn(tool, 'search_context_size')).toBe(true);
    },
  );

  test.each(
    [false, true].flatMap((withLedger) => [false, true].map((withBudget) => ({ withLedger, withBudget }))),
  )(
    'omits undefined registered tool fields with ledger=$withLedger budget=$withBudget',
    async ({ withLedger, withBudget }) => {
      const tool = { type: 'function' as const, name: 'record', parameters: {}, strict: false };
      Reflect.set(tool, 'description', undefined);
      Reflect.set(tool.parameters, 'title', undefined);
      const saved = recording();
      const execute = vi.fn(() => 'saved');
      const h = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
      await new ResponsesToolRunner({ functions: [{ tool, execute }] }).run(h.client, input, {
        ...(withBudget ? { contextBudget: { maxInputBytes: 2000, maxInputImages: 0 } } : {}),
        ...(withLedger ? { ledger: saved.ledger } : {}),
      });
      expect(execute).toHaveBeenCalledOnce();
      for (const body of h.bodies) {
        expect(body['tools']).toStrictEqual([
          { type: 'function', name: 'record', parameters: {}, strict: false },
        ]);
      }
      for (const checkpoint of saved.writes) {
        expect(checkpoint.tools).toStrictEqual([
          { type: 'function', name: 'record', parameters: {}, strict: false },
        ]);
      }
      expect(hasOwn(tool, 'description')).toBe(true);
      expect(hasOwn(tool.parameters, 'title')).toBe(true);
    },
  );

  const image = {
    type: 'input_image' as const,
    detail: 'auto' as const,
    image_url: `data:image/png;base64,${'AAAA'.repeat(150)}`,
  };
  const shotArgs = { tab_id: null };
  const modes = [
    { stream: false, eager: false, earlyExecution: null },
    { stream: true, eager: false, earlyExecution: null },
    { stream: true, eager: true, earlyExecution: null },
    { stream: true, eager: true, earlyExecution: { functions: ['browser_screenshot'] } },
  ];

  test.each([0, 1])(
    'measures scalar UTF-8 before admission, with fit shortfall=%s bytes',
    async (shortfall) => {
      const request = { ...input, input: 'café 🙂' };
      const size = new TextEncoder().encode(
        JSON.stringify([{ role: 'user', content: request.input }]),
      ).length;
      const maxInputBytes = size - shortfall;
      const h = harness([{ output: [message] }]);
      const save = vi.fn();
      const runner = new ResponsesToolRunner({});
      const result = runner.run(h.client, request, {
        ledger: { runId: 'bytes', save },
        contextBudget: { maxInputBytes, maxInputImages: 0 },
      });
      if (maxInputBytes === size) {
        await expect(result).resolves.toMatchObject({ status: 'completed' });
        expect(h.bodies[0]).toMatchObject({ truncation: 'disabled' });
      } else {
        await expect(result).rejects.toBeInstanceOf(ResponsesToolRunnerError);
        expect(save).not.toHaveBeenCalled();
        expect(h.bodies).toHaveLength(0);
      }
    },
  );

  test.each([0, 1])(
    'measures a large escaped Unicode scalar without a second whole UTF-8 buffer (shortfall=%s)',
    async (shortfall) => {
      const prefixLength = '[{"content":"'.length;
      const text = `${'a'.repeat(65_535 - prefixLength)}🐦\n"${'尾'.repeat(65_536)}`;
      const serialized = JSON.stringify([{ content: text, role: 'user' }]);
      const size = new TextEncoder().encode(serialized).length;
      const allocations: number[] = [];
      const original = TextEncoder.prototype.encode;
      const encoded = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function recordEncodedSize(
        this: TextEncoder,
        value,
      ) {
        const bytes = original.call(this, value);
        if (value === serialized) {
          allocations.push(bytes.length);
        }
        return bytes;
      });
      try {
        const h = harness([{ output: [message] }]);
        const save = vi.fn();
        const result = new ResponsesToolRunner({}).run(
          h.client,
          { ...input, input: text },
          {
            ledger: { runId: 'unicode-bytes', save },
            contextBudget: { maxInputBytes: size - shortfall, maxInputImages: 0 },
          },
        );
        if (shortfall) {
          await expect(result).rejects.toBeInstanceOf(ResponsesToolRunnerError);
          expect(save).not.toHaveBeenCalled();
          expect(h.bodies).toHaveLength(0);
        } else {
          await expect(result).resolves.toMatchObject({ status: 'completed' });
          expect(h.bodies[0]?.['input']).toStrictEqual([{ role: 'user', content: text }]);
        }
        expect(allocations).toStrictEqual([]);
      } finally {
        encoded.mockRestore();
      }
    },
  );

  test('counts native images, not JSON-looking strings or files', async () => {
    const h = harness([{ output: [message] }]);
    const runner = new ResponsesToolRunner({});
    const save = vi.fn();
    await expect(
      runner.run(
        h.client,
        {
          ...input,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: '{"type":"input_image","image_url":"https://example.invalid/not-an-image"}',
                },
                { type: 'input_file', file_id: 'file-one' },
                { type: 'input_image', image_url: 'https://fixture.invalid/image', detail: 'auto' },
              ],
            },
          ],
        },
        { ledger: { runId: 'images', save }, contextBudget: { maxInputBytes: 10_000, maxInputImages: 0 } },
      ),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    expect(h.bodies).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });

  test.each(modes)(
    'bounds long mixed replay and preserves private full evidence ($stream/$eager/$earlyExecution)',
    async (mode) => {
      const effects: string[] = [];
      const browser = new BrowserToolset(
        {
          state,
          screenshot: () => {
            effects.push('browser-shot');
            return image;
          },
        },
        { members: ['screenshot'] },
      );
      const computer = new ComputerToolset({
        ...nativeActions,
        screenshot: () => {
          effects.push('native-shot');
          return { type: 'computer_screenshot', image_url: image.image_url };
        },
      });
      const runner = new ResponsesToolRunner({
        browser,
        computer,
        earlyExecution: mode.earlyExecution,
        functions: [
          {
            tool: { type: 'function', name: 'record', parameters: {}, strict: false },
            allowOutputOverride: true,
            execute: () => {
              effects.push('record');
              return [
                { type: 'input_text', text: 'Only in full history' },
                { type: 'input_file', file_id: 'file_fixture' },
                image,
              ];
            },
          },
        ],
      });
      const h = harness([
        {
          output: [
            wireCall('browser_screenshot', shotArgs, 'a'),
            contextNative('n1'),
            wireCall('record', {}, 'r'),
          ],
        },
        { output: [wireCall('browser_screenshot', shotArgs, 'b'), contextNative('n2')] },
        { output: [wireCall('browser_screenshot', shotArgs, 'c'), contextNative('n3')] },
        { output: [message] },
      ]);
      const { ledger, writes } = recording();
      const choices: string[][] = [];
      const budget: ResponsesContextBudget = {
        maxInputBytes: 9000,
        maxInputImages: 2,
        compact(snapshot) {
          const ids = [...snapshot.eligibleCallIds];
          choices.push(ids);
          snapshot.eligibleCallIds.push('n3');
          snapshot.history.length = 0;
          return { dropCallIds: ids, summary: 'Caller summary without any receipts' };
        },
      };
      await runner.run(h.client, input, { ...mode, maxSteps: 5, ledger, contextBudget: budget });
      expect(effects).toEqual([
        'browser-shot',
        'native-shot',
        'record',
        'browser-shot',
        'native-shot',
        'browser-shot',
        'native-shot',
      ]);
      expect(h.bodies).toHaveLength(4);
      expect(choices).toEqual([
        ['call_r'],
        ['call_a', 'n1', 'call_r'],
        ['call_a', 'n1', 'call_r', 'call_b', 'n2'],
      ]);
      for (const body of h.bodies) {
        // SAFETY: This is outgoing JSON input captured after native history validation.
        const history = body['input'] as ResponseInputItem[];
        expect(new TextEncoder().encode(JSON.stringify(history)).length).toBeLessThanOrEqual(
          budget.maxInputBytes,
        );
        let imageCount = 0;
        for (const item of history) {
          if (item.type === 'computer_call_output') {
            imageCount += 1;
          } else if (item.type === 'function_call_output' && Array.isArray(item.output)) {
            imageCount += item.output.filter((b) => b.type === 'input_image').length;
          }
        }
        expect(imageCount).toBeLessThanOrEqual(2);
        expect(body).toMatchObject({ truncation: 'disabled' });
      }
      // SAFETY: The fixture captures the fourth validated input as native JSON items.
      const last = h.bodies[3]?.['input'] as ResponseInputItem[];
      const nativeItems = last.filter((v) => v.type === 'function_call' || v.type === 'computer_call');
      expect(nativeItems.map((v) => v.call_id)).toEqual(['call_c', 'n3']);
      const userMessages = last.filter((v) => 'role' in v && v.role === 'user');
      expect(userMessages).toContainEqual({
        role: 'user',
        content: 'Caller summary of omitted completed tool results: Caller summary without any receipts',
      });
      for (const id of ['call_a', 'n1', 'call_r', 'call_b', 'n2']) {
        const receipt = userMessages.find(
          (v) =>
            'content' in v &&
            typeof v.content === 'string' &&
            v.content.startsWith('Runner receipt:') &&
            v.content.includes(id),
        );
        expect(receipt).toBeDefined();
        expect(receipt).not.toHaveProperty('call_id');
        expect(JSON.stringify(receipt)).toContain('external success is unverified');
        expect(JSON.stringify(receipt)).not.toContain(image.image_url);
        expect(JSON.stringify(receipt)).not.toContain('Only in full history');
      }
      const [final] = writes.slice(-1);
      expect(final).toMatchObject({ phase: 'final', max_steps: 5, consumed_requests: 4 });
      expect(final?.attempted_call_ids).toEqual(['call_a', 'n1', 'call_r', 'call_b', 'n2', 'call_c', 'n3']);
      expect(final?.returned_call_ids).toEqual(final?.attempted_call_ids);
      expect(JSON.stringify(final?.history)).toContain('file_fixture');
      expect(JSON.stringify(final?.history)).not.toContain('Runner receipt:');
      expect(Object.keys(final ?? {})).toHaveLength(14);
    },
  );

  test.each(modes)(
    'rejects dropped IDs on later calls, including eager and selective ($stream/$eager/$earlyExecution)',
    async (mode) => {
      const execute = vi.fn(() => [image]);
      const runner = new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
        earlyExecution: mode.earlyExecution ? { functions: ['record'] } : null,
      });
      const h = harness([
        { output: [wireCall('record', {}, 'same')] },
        { output: [wireCall('record', {}, 'same')] },
      ]);
      const { ledger, writes } = recording();
      const compact = vi.fn(({ eligibleCallIds }: { eligibleCallIds: string[] }) => ({
        dropCallIds: eligibleCallIds,
      }));
      await expect(
        runner.run(h.client, input, {
          ...mode,
          maxSteps: 4,
          ledger,
          contextBudget: { maxInputBytes: 3000, maxInputImages: 0, compact },
        }),
      ).rejects.toMatchObject({ attemptedCallIds: ['call_same'], completedCallIds: ['call_same'] });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(compact).toHaveBeenCalledTimes(1);
      expect(h.bodies).toHaveLength(2);
      expect(JSON.stringify(h.bodies[1]?.['input'])).toContain('Runner receipt:');
      expect(writes.some((s) => s.history.some((v) => 'call_id' in v && v.call_id === 'call_same'))).toBe(
        true,
      );
    },
  );

  test('pins latest browser state and safety checks as well as retained screenshots', async () => {
    const browser = new BrowserToolset(
      {
        state,
        screenshot: () => image,
        get_page_text: () => 'current rendered state',
      },
      { members: ['screenshot', 'get_page_text'] },
    );
    const runner = new ResponsesToolRunner({
      browser,
      computer: new ComputerToolset({
        ...nativeActions,
        screenshot: () => ({ type: 'computer_screenshot', image_url: image.image_url }),
      }),
    });
    const h = harness([
      {
        output: [
          wireCall('browser_screenshot', shotArgs, 'first'),
          contextNative('checked', true),
          contextNative('current'),
          wireCall('browser_get_page_text', shotArgs, 'text'),
        ],
      },
      { output: [message] },
    ]);
    const { ledger, writes } = recording();
    const compact = vi.fn((s: { eligibleCallIds: string[] }) => {
      expect(s.eligibleCallIds).toEqual(['call_first']);
      return { dropCallIds: ['checked'], summary: 'Not authority' };
    });
    await expect(
      runner.run(h.client, input, {
        maxSteps: 4,
        ledger,
        computerOptions: { approveSafetyChecks: () => true },
        contextBudget: { maxInputBytes: 10_000, maxInputImages: 1, compact },
      }),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    expect(h.bodies).toHaveLength(1);
    expect(compact).toHaveBeenCalledTimes(1);
    expect(writes.slice(-1)).toMatchObject([{ phase: 'boundary', consumed_requests: 1 }]);
  });

  test.each([
    { maxInputBytes: 1, maxInputImages: 0, keepRecentScreenshots: 0 },
    { maxInputBytes: 1, maxInputImages: -1 },
    { maxInputBytes: 1.1, maxInputImages: 0 },
    { maxInputBytes: Number.MAX_SAFE_INTEGER + 1, maxInputImages: 0 },
    { maxInputBytes: 1, maxInputImages: true },
    { maxInputBytes: 1, maxInputImages: 0, keepRecentScreenshots: null },
    { maxInputBytes: 1, maxInputImages: 0, unknown: true },
  ])('rejects invalid budget %# before save or HTTP', async (contextBudget) => {
    const h = harness([{ output: [message] }]);
    const save = vi.fn();
    await expect(
      new ResponsesToolRunner({}).run(h.client, input, {
        ledger: { runId: 'invalid', save },
        // SAFETY: Deliberately exercise rejected runtime values at this typed API boundary.
        contextBudget: contextBudget as ResponsesContextBudget,
      }),
    ).rejects.toThrow();
    expect(h.bodies).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });

  test.each(['input', 'array entry', 'array iterator'] as const)(
    'validates budgeted native %s without running caller accessors',
    async (location) => {
      const h = harness([{ output: [message] }]);
      const effects: string[] = [];
      const items: ResponseInputItem[] = [{ role: 'user', content: 'fixture' }];
      const params = { ...input, input: items };
      if (location === 'input') {
        Object.defineProperty(params, 'input', {
          enumerable: true,
          get() {
            effects.push('input getter');
            return items;
          },
        });
      } else {
        Object.defineProperty(items, location === 'array entry' ? '0' : Symbol.iterator, {
          enumerable: true,
          get() {
            effects.push('array getter');
            return location === 'array entry'
              ? { role: 'user', content: 'synthetic page' }
              : Array.prototype[Symbol.iterator];
          },
        });
      }
      const save = vi.fn();
      const compact = vi.fn(() => ({ dropCallIds: [] }));
      await expect(
        new ResponsesToolRunner({}).run(h.client, params, {
          ledger: { runId: 'data-only', save },
          contextBudget: { maxInputBytes: 1000, maxInputImages: 0, compact },
        }),
      ).rejects.toThrow();
      expect(effects).toEqual([]);
      expect([h.bodies.length, save.mock.calls.length, compact.mock.calls.length]).toEqual([0, 0, 0]);
    },
  );

  test.each(['maxInputBytes', 'compact', 'unrecognized', Symbol('local-option')])(
    'validates budget fields before reading accessors: %s',
    async (key) => {
      const h = harness([{ output: [message] }]);
      const effects: string[] = [];
      const contextBudget: ResponsesContextBudget = { maxInputBytes: 1000, maxInputImages: 0 };
      Object.defineProperty(contextBudget, key, {
        enumerable: true,
        get() {
          effects.push('budget getter');
          return 0;
        },
      });
      const save = vi.fn();
      await expect(
        new ResponsesToolRunner({}).run(h.client, input, {
          ledger: { runId: 'budget-fields', save },
          contextBudget,
        }),
      ).rejects.toThrow();
      expect(effects).toEqual([]);
      expect([h.bodies.length, save.mock.calls.length]).toEqual([0, 0]);
    },
  );

  test.each([{ truncation: 'auto' as const }, { context_management: [{ type: 'compaction' }] }])(
    'refuses backend auto-omission when a local budget is present',
    async (params) => {
      const h = harness([{ output: [message] }]);
      const save = vi.fn();
      const compact = vi.fn();
      await expect(
        new ResponsesToolRunner({}).run(
          h.client,
          { ...input, ...params },
          {
            ledger: { runId: 'auto', save },
            contextBudget: { maxInputBytes: 100, maxInputImages: 0, compact },
          },
        ),
      ).rejects.toThrow();
      expect(h.bodies).toHaveLength(0);
      expect(save).not.toHaveBeenCalled();
      expect(compact).not.toHaveBeenCalled();
    },
  );

  test.each([null, undefined])(
    'budget works without a ledger; nullish %s retains parameter forwarding',
    async (contextBudget) => {
      const runner = new ResponsesToolRunner({});
      const first = harness([{ output: [message] }]);
      await expect(
        runner.run(first.client, input, { contextBudget: { maxInputBytes: 100, maxInputImages: 0 } }),
      ).resolves.toMatchObject({ status: 'completed' });
      expect(first.bodies).toHaveLength(1);
      const h = harness([{ output: [message] }]);
      const reads: string[] = [];
      await runner.run(
        h.client,
        {
          ...input,
          truncation: 'auto',
          get input() {
            reads.push('legacy read');
            return input.input;
          },
        },
        { contextBudget },
      );
      expect(reads.length).toBeGreaterThan(0);
      expect(h.bodies[0]).toMatchObject({
        truncation: 'auto',
        input: [{ role: 'user', content: input.input }],
      });
    },
  );

  test.each(['call_old', ''])(
    'ephemeral budget drops only an eligible older screenshot pair: %j',
    async (oldId) => {
      const browser = new BrowserToolset({
        state,
        screenshot: () => ({ type: 'input_image', detail: 'auto', image_url: 'data:image/png;base64,AAAA' }),
      });
      const env = harness([
        { output: [{ ...wireCall('browser_screenshot', { tab_id: null }, 'old'), call_id: oldId }] },
        { output: [wireCall('browser_screenshot', { tab_id: null }, 'fresh')] },
        { output: [message] },
      ]);
      const compact = vi.fn(({ eligibleCallIds }: { eligibleCallIds: string[] }) => ({
        dropCallIds: eligibleCallIds,
      }));
      await new ResponsesToolRunner({ browser }).run(env.client, input, {
        contextBudget: { maxInputBytes: 10_000, maxInputImages: 1, compact },
      });
      expect(compact).toHaveBeenCalledOnce();
      const history = env.bodies[2]?.['input'];
      expect(history).toContainEqual(
        expect.objectContaining({ type: 'function_call', call_id: 'call_fresh' }),
      );
      expect(history).not.toContainEqual(expect.objectContaining({ type: 'function_call', call_id: oldId }));
    },
  );

  test.each([
    { dropCallIds: ['call_record', 'call_record'] },
    { dropCallIds: ['missing'] },
    { dropCallIds: [], summary: '\uD800' },
    { dropCallIds: 'call_record' },
    { dropCallIds: ['call_record'], summary: {} },
    { dropCallIds: ['call_record'], more: true },
  ])('validates the whole decision and fails before any second admission %#', async (decision) => {
    const execute = vi.fn(() => [image]);
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const h = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
    const { ledger, writes } = recording();
    await expect(
      runner.run(h.client, input, {
        ledger,
        contextBudget: {
          maxInputBytes: 2000,
          maxInputImages: 0,
          // SAFETY: Deliberately return malformed data to exercise the callback boundary.
          compact: () => decision as { dropCallIds: string[]; summary?: string },
        },
      }),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(h.bodies).toHaveLength(1);
    expect(writes.slice(-1)).toMatchObject([{ phase: 'boundary', consumed_requests: 1 }]);
  });

  test.each(['getter', 'receipt'])(
    'does not admit invalid data or insufficient receipt space: %s',
    async (bad) => {
      const runner = new ResponsesToolRunner({
        functions: [
          {
            tool: { type: 'function', name: 'record', parameters: {}, strict: false },
            execute: () => [image],
          },
        ],
      });
      const h = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
      const { ledger, writes } = recording();
      const accessed = vi.fn();
      const compact: NonNullable<ResponsesContextBudget['compact']> = () =>
        bad === 'getter'
          ? Object.defineProperty({ dropCallIds: [] }, 'dropCallIds', {
              enumerable: true,
              get() {
                accessed();
                return ['call_record'];
              },
            })
          : { dropCallIds: ['call_record'] };
      await expect(
        runner.run(h.client, input, {
          ledger,
          contextBudget: { maxInputBytes: 100, maxInputImages: 0, compact },
        }),
      ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
      expect(accessed).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
      expect(writes.slice(-1)).toMatchObject([{ phase: 'boundary', consumed_requests: 1 }]);
    },
  );

  test('awaits a compactor ignoring abort, then sends no request after it settles', async () => {
    let enter!: () => void;
    let release!: () => void;
    // oxlint-disable-next-line promise/avoid-new -- Explicit gates prove callback lifetime after abort.
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    // oxlint-disable-next-line promise/avoid-new -- The test controls callback settlement.
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
    const { ledger, writes } = recording();
    const signal = new AbortController();
    const runner = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'record', parameters: {}, strict: false },
          execute: () => [image],
        },
      ],
    });
    let settled = false;
    const result = runner
      .run(h.client, input, {
        ledger,
        signal: signal.signal,
        contextBudget: {
          maxInputBytes: 1000,
          maxInputImages: 0,
          compact: async () => {
            enter();
            await held;
            return { dropCallIds: ['call_record'] };
          },
        },
      })
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Observe rejection immediately while the test controls the gate.
      .then(
        (value) => ({ value }),
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Observe rejection immediately while the test controls the gate.
        (error: unknown) => ({ error }),
      )
      .finally(() => {
        settled = true;
      });
    await entered;
    const count = writes.length;
    signal.abort();
    await nextTurn();
    expect(settled).toBe(false);
    expect(h.bodies).toHaveLength(1);
    release();
    expect(await result).toMatchObject({
      error: { attemptedCallIds: ['call_record'], completedCallIds: ['call_record'] },
    });
    expect(writes).toHaveLength(count);
    expect(h.bodies).toHaveLength(1);
  });

  test('resumes only a saved complete boundary with fresh input, full receipts and original request count', async () => {
    const execute = vi.fn(() => [image]);
    const registered = {
      functions: [
        { tool: { type: 'function' as const, name: 'record', parameters: {}, strict: false }, execute },
      ],
    };
    const before = harness([{ output: [wireCall('record', {}, 'old')] }, { output: [message] }]);
    const { ledger, writes } = recording();
    // Fail admission for the next request after the first completed boundary has been saved.
    await expect(
      new ResponsesToolRunner(registered).run(before.client, input, {
        maxSteps: 3,
        ledger,
        contextBudget: { maxInputBytes: 10_000, maxInputImages: 0 },
      }),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    const [saved] = writes.slice(-1);
    expect(saved).toMatchObject({ phase: 'boundary', consumed_requests: 1, max_steps: 3 });
    expect(execute).toHaveBeenCalledTimes(1);
    if (!saved) {
      throw new Error('Expected a saved boundary');
    }
    const after = harness([{ output: [message] }]);
    const restored = recording();
    const compact = vi.fn((snapshot: { history: ResponseInputItem[]; eligibleCallIds: string[] }) => {
      expect(JSON.stringify(snapshot.history)).toContain('Fresh on resume');
      return { dropCallIds: snapshot.eligibleCallIds };
    });
    await new ResponsesToolRunner(registered).run(
      after.client,
      { ...input, input: 'Fresh on resume' },
      {
        ledger: { ...restored.ledger, resumeFrom: saved },
        contextBudget: { maxInputBytes: 2000, maxInputImages: 0, compact },
      },
    );
    expect(compact).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(after.bodies).toHaveLength(1);
    expect(JSON.stringify(after.bodies[0]?.['input'])).toContain('Runner receipt:');
    expect(JSON.stringify(after.bodies[0]?.['input'])).toContain('Fresh on resume');
    expect(restored.writes.slice(-1)).toMatchObject([
      {
        phase: 'final',
        consumed_requests: 2,
        max_steps: 3,
        attempted_call_ids: ['call_old'],
        returned_call_ids: ['call_old'],
      },
    ]);
    expect(JSON.stringify(restored.writes)).toContain(image.image_url);
    expect(JSON.stringify(restored.writes)).not.toContain('Runner receipt:');
    // Budget/registry/revision validation must win over a potentially side-effecting compactor.
    for (const invalid of [
      { ...saved, consumed_requests: 3 },
      { ...saved, revision: Number.MAX_SAFE_INTEGER },
      { ...saved, phase: 'pending' as const },
    ]) {
      const h = harness([{ output: [message] }]);
      const save = vi.fn();
      const decision = vi.fn(() => ({ dropCallIds: ['call_old'] }));
      // oxlint-disable-next-line no-await-in-loop -- Each refused resume has its own full validation counts.
      await expect(
        new ResponsesToolRunner(registered).run(
          h.client,
          { ...input, input: 'Fresh' },
          {
            ledger: { runId: 'context', save, resumeFrom: invalid },
            contextBudget: { maxInputBytes: 100, maxInputImages: 0, compact: decision },
          },
        ),
      ).rejects.toThrow();
      expect([h.bodies.length, save.mock.calls.length, decision.mock.calls.length]).toEqual([0, 0, 0]);
    }
  });

  test('does not compact on iterator close with a selectively executed prefix and deferred suffix', async () => {
    const fast = vi.fn(() => [image]);
    const slow = vi.fn(() => 'late');
    const runner = new ResponsesToolRunner({
      functions: [
        { tool: { type: 'function', name: 'fast', parameters: {}, strict: false }, execute: fast },
        { tool: { type: 'function', name: 'slow', parameters: {}, strict: false }, execute: slow },
      ],
      earlyExecution: { functions: ['fast'] },
    });
    const h = harness([{ output: [wireCall('fast', {}), wireCall('slow', {})] }, { output: [message] }]);
    const { ledger, writes } = recording();
    const compact = vi.fn(({ eligibleCallIds }: { eligibleCallIds: string[] }) => ({
      dropCallIds: eligibleCallIds,
    }));
    const iterator = runner.iterate(h.client, input, {
      stream: true,
      eager: true,
      ledger,
      contextBudget: { maxInputBytes: 1000, maxInputImages: 0, compact },
    });
    const turn = await iterator.next();
    expect(turn.value).toMatchObject({ toolsExecuted: true, attemptedCallIds: ['call_fast'] });
    expect(writes.slice(-1)).toMatchObject([{ phase: 'pending', attempted_call_ids: ['call_fast'] }]);
    await iterator.return();
    expect(fast).toHaveBeenCalledTimes(1);
    expect(slow).not.toHaveBeenCalled();
    expect(compact).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(1);
  });

  test('snapshots budget limits before the first ledger save and rejects raw non-scalar input', async () => {
    const runner = new ResponsesToolRunner({});
    const compact = vi.fn(() => ({ dropCallIds: [] }));
    const h = harness([{ output: [message] }]);
    const save = vi.fn();
    await expect(
      runner.run(
        h.client,
        { ...input, input: '\uD800' },
        {
          ledger: { runId: 'scalar', save },
          contextBudget: { maxInputBytes: 1000, maxInputImages: 0, compact },
        },
      ),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    expect([h.bodies.length, save.mock.calls.length, compact.mock.calls.length]).toEqual([0, 0, 0]);
    const recordingBudget: ResponsesContextBudget = { maxInputBytes: 5000, maxInputImages: 0 };
    const execute = vi.fn(() => [image]);
    const second = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
    await expect(
      new ResponsesToolRunner({
        functions: [
          {
            tool: { type: 'function', name: 'record', parameters: {}, strict: false },
            execute,
          },
        ],
      }).run(second.client, input, {
        ledger: {
          runId: 'snapshot',
          save() {
            recordingBudget.maxInputImages = 100;
          },
        },
        contextBudget: recordingBudget,
      }),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    expect(second.bodies).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('ResponsesToolRunner selective early execution', () => {
  const inheritedPolicy = {};
  Object.setPrototypeOf(inheritedPolicy, { functions: ['f'] });

  test('holds the whole suffix, including non-tools, then advances once with safe overrides', async () => {
    const effects: string[] = [];
    const policy = { functions: ['fast'], computer: false };
    const proposed: ResponseOutputItem[] = [
      wireCall('fast', { text: 'one' }, 'one'),
      wireCall('slow', { text: 'two' }, 'two'),
      { type: 'reasoning', id: 'rs_select', summary: [], encrypted_content: 'opaque' },
      { ...message, id: 'msg_commentary', phase: 'commentary' },
      { type: 'reasoning', id: 'rs_later', summary: [], encrypted_content: 'opaque_later' },
      wireCall('fast', { text: 'three' }, 'three'),
    ];
    const runner = new ResponsesToolRunner({
      earlyExecution: policy,
      functions: ['fast', 'slow'].map((name) => ({
        tool: { type: 'function', name, parameters: {}, strict: false },
        allowOutputOverride: true,
        execute(args) {
          effects.push(String(args['text']));
          return `ran ${String(args['text'])}`;
        },
      })),
    });
    // Mutating the caller's registration may not turn slow into an early tool.
    policy.functions.push('slow');
    const h = harness([{ output: proposed }, { output: [message] }]);
    const observed: string[][] = [];
    const iterator = runner.iterate(h.client, input, {
      stream: true,
      eager: true,
      onEvent(event) {
        if (event.type === 'response.output_item.done' || event.type === 'response.completed') {
          observed.push([...effects]);
        }
      },
    });
    const first = await iterator.next();
    if (first.done) {
      throw new Error('Missing selective turn');
    }
    expect(observed).toEqual([[], ['one'], ['one'], ['one'], ['one'], ['one'], ['one']]);
    expect(first.value).toMatchObject({
      final: false,
      toolsExecuted: true,
      attemptedCallIds: ['call_one'],
      completedCallIds: ['call_one'],
    });
    expect(effects).toEqual(['one']);
    const supplied = { type: 'function_call_output' as const, call_id: 'call_two', output: 'supplied two' };
    first.value.supplyOutputs([supplied]);
    expect(() =>
      first.value.supplyOutputs([
        { type: 'function_call_output', call_id: 'call_three', output: 'unused invalid set' },
        { type: 'function_call_output', call_id: 'call_one', output: 'cannot rewrite an effect' },
      ]),
    ).toThrow();
    supplied.output = 'changed';
    first.value.response.output.length = 0;
    const final = await iterator.next();
    expect(final.done).toBe(false);
    expect(final.value).toMatchObject({ final: true, toolsExecuted: false });
    expect(effects).toEqual(['one', 'three']);
    expect(h.bodies).toHaveLength(2);
    expect(h.bodies[1]?.['input']).toEqual([
      { role: 'user', content: 'fixture task' },
      ...proposed,
      { type: 'function_call_output', call_id: 'call_one', output: 'ran one' },
      { type: 'function_call_output', call_id: 'call_two', output: 'supplied two' },
      { type: 'function_call_output', call_id: 'call_three', output: 'ran three' },
    ]);
    expect(() => first.value.supplyOutputs([])).toThrow();
    await iterator.return();
  });

  test.each([{}, { functions: [] }, inheritedPolicy])(
    'an explicit empty policy waits for inspection: %j',
    async (earlyExecution) => {
      const execute = vi.fn(() => 'effect');
      const runner = new ResponsesToolRunner({
        earlyExecution,
        functions: [{ tool: { type: 'function', name: 'f', parameters: {}, strict: false }, execute }],
      });
      const h = harness([{ output: [wireCall('f', {})] }, { output: [message] }]);
      const iterator = runner.iterate(h.client, input, { stream: true, eager: true });
      const next = await iterator.next();
      expect(next.value).toMatchObject({ final: false, toolsExecuted: false, attemptedCallIds: [] });
      expect(execute).not.toHaveBeenCalled();
      await iterator.return();
      expect(execute).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );

  test.each([null, undefined])('nullish policy preserves global eager opt-in %j', async (earlyExecution) => {
    const execute = vi.fn(() => 'effect');
    const runner = new ResponsesToolRunner({
      earlyExecution,
      functions: [{ tool: { type: 'function', name: 'f', parameters: {}, strict: false }, execute }],
    });
    const h = harness([{ output: [wireCall('f', {})] }, { output: [message] }]);
    const iterator = runner.iterate(h.client, input, { stream: true, eager: true });
    const next = await iterator.next();
    if (next.done) {
      throw new Error('Missing legacy eager turn');
    }
    expect(next.value).toMatchObject({ final: false, toolsExecuted: true, attemptedCallIds: ['call_f'] });
    expect(() => next.value.supplyOutputs([])).toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
    await iterator.return();
  });

  test('an empty policy does not inherit global early permissions', async () => {
    const execute = vi.fn(() => 'effect');
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'functions');
    let runner: ResponsesToolRunner;
    try {
      // oxlint-disable-next-line no-extend-native -- Exercise inherited permissions during synchronous construction and restore before streaming.
      Object.defineProperty(Object.prototype, 'functions', {
        value: ['f'],
        writable: true,
        configurable: true,
      });
      runner = new ResponsesToolRunner({
        earlyExecution: {},
        functions: [{ tool: { type: 'function', name: 'f', parameters: {}, strict: false }, execute }],
      });
    } finally {
      if (previous) {
        // oxlint-disable-next-line no-extend-native -- Restore the exact descriptor after the isolated permission fixture.
        Object.defineProperty(Object.prototype, 'functions', previous);
      } else {
        Reflect.deleteProperty(Object.prototype, 'functions');
      }
    }
    const h = harness([{ output: [wireCall('f', {})] }, { output: [message] }]);
    const iterator = runner.iterate(h.client, input, { stream: true, eager: true });
    const next = await iterator.next();
    expect(next.value).toMatchObject({ toolsExecuted: false, attemptedCallIds: [] });
    expect(execute).not.toHaveBeenCalled();
    await iterator.return();
  });

  test.each([
    { functions: ['missing'] },
    { functions: ['f', 'f'] },
    { functions: [7] },
    { functions: 'f' },
    { computer: 'yes' },
    { computer: true },
    { extra: true },
  ])('invalid policy refuses at registration %j', (bad) => {
    const execute = vi.fn(() => 'effect');
    expect(
      () =>
        new ResponsesToolRunner({
          // SAFETY: Verify malformed untyped caller input rejects before request or execution.
          earlyExecution: bad as never,
          functions: [{ tool: { type: 'function', name: 'f', parameters: {}, strict: false }, execute }],
        }),
    ).toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  test.each(['hidden field', 'accessor field', 'inherited entry', 'accessor entry'])(
    'rejects non-data early permissions: %s',
    (kind) => {
      const getter = vi.fn(() => ['f']);
      const entries = ['f'];
      const policy = { functions: entries };
      if (kind === 'hidden field') {
        Object.defineProperty(policy, 'functions', { value: entries, enumerable: false });
      } else if (kind === 'accessor field') {
        Object.defineProperty(policy, 'functions', { get: getter });
      } else if (kind === 'inherited entry') {
        delete entries[0];
        Object.setPrototypeOf(entries, Object.create(Array.prototype, { 0: { value: 'f' } }));
      } else {
        Object.defineProperty(entries, '0', { get: getter });
      }
      expect(
        () =>
          new ResponsesToolRunner({
            earlyExecution: policy,
            functions: [
              {
                tool: { type: 'function', name: 'f', parameters: {}, strict: false },
                execute: () => 'effect',
              },
            ],
          }),
      ).toThrow();
      expect(getter).not.toHaveBeenCalled();
    },
  );

  test.each([
    { kind: 'unknown', names: ['missing'] },
    { kind: 'duplicate', names: ['f', 'f'] },
    { kind: 'wrong scalar', names: [true] },
  ])('policy entries cannot be replaced by a custom iterator: $kind', ({ names }) => {
    const entries: unknown[] = names;
    const validName = 'f';
    entries[Symbol.iterator] = function* validNames(): Generator<unknown, undefined, unknown> {
      yield validName;
    };
    const execute = vi.fn(() => 'effect');
    expect(
      () =>
        new ResponsesToolRunner({
          // SAFETY: Malformed caller entries must reject even when their iterator yields a valid name.
          earlyExecution: { functions: entries } as never,
          functions: [{ tool: { type: 'function', name: 'f', parameters: {}, strict: false }, execute }],
        }),
    ).toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    'server search types stay bound to the sent request: mutate=%s',
    async (mutate) => {
      const execute = vi.fn(() => 'effect');
      const declaration: Tool = mutate
        ? { type: 'web_search' }
        : { type: 'file_search', vector_store_ids: ['synthetic'] };
      const search: ResponseOutputItem = {
        type: 'file_search_call',
        id: 'fs_pinned',
        status: 'completed',
        queries: ['fixture'],
        results: [],
      };
      const runner = new ResponsesToolRunner({
        earlyExecution: {},
        functions: [{ tool: { type: 'function', name: 'f', parameters: {}, strict: false }, execute }],
      });
      const h = harness([{ output: [wireCall('f', {}), search] }, { output: [message] }]);
      const result = runner.run(
        h.client,
        { ...input, tools: [declaration] },
        {
          stream: true,
          eager: true,
          onEvent(event) {
            if (mutate && event.type === 'response.created') {
              Object.assign(declaration, { type: 'file_search', vector_store_ids: ['synthetic'] });
            }
          },
        },
      );
      if (mutate) {
        await expect(result).rejects.toMatchObject({ attemptedCallIds: [], completedCallIds: [] });
        expect(h.bodies[0]?.['tools']).not.toContainEqual(expect.objectContaining({ type: 'file_search' }));
        expect(execute).not.toHaveBeenCalled();
        expect(h.bodies).toHaveLength(1);
      } else {
        await expect(result).resolves.toMatchObject({ status: 'completed' });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(h.bodies).toHaveLength(2);
      }
    },
  );

  test.each([
    { initial: 'file_search', changed: 'web_search', succeeds: true },
    { initial: 'web_search', changed: 'file_search', succeeds: false },
    { initial: 'file_search', changed: 'file_search', succeeds: true },
  ] as const)(
    'server declaration stays fixed during request admission: $initial to $changed',
    async ({ initial, changed, succeeds }) => {
      const execute = vi.fn(() => 'effect');
      const declaration: Tool =
        initial === 'file_search' ? { type: initial, vector_store_ids: ['synthetic'] } : { type: initial };
      const runner = new ResponsesToolRunner({
        earlyExecution: {},
        functions: [{ tool: { type: 'function', name: 'f', parameters: {}, strict: false }, execute }],
      });
      const h = harness([
        {
          output: [
            wireCall('f', {}),
            {
              type: 'file_search_call',
              id: 'fs_admission',
              status: 'completed',
              queries: ['fixture'],
              results: [],
            },
          ],
        },
        { output: [message] },
      ]);
      const result = runner.run(h.client, { ...input, tools: [declaration] }, { stream: true, eager: true });
      Object.assign(declaration, { type: changed });
      if (succeeds) {
        await expect(result).resolves.toMatchObject({ status: 'completed' });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(h.bodies).toHaveLength(2);
        expect(h.bodies[1]?.['tools']).toContainEqual(expect.objectContaining({ type: initial }));
      } else {
        await expect(result).rejects.toMatchObject({ attemptedCallIds: [], completedCallIds: [] });
        expect(execute).not.toHaveBeenCalled();
        expect(h.bodies).toHaveLength(1);
      }
      expect(h.bodies[0]?.['tools']).toContainEqual(expect.objectContaining({ type: initial }));
    },
  );

  test('a ledger at selective inspection holds a proposal, not a resumable completed prefix', async () => {
    const fast = vi.fn(() => 'fast');
    const slow = vi.fn(() => 'slow');
    const runner = new ResponsesToolRunner({
      earlyExecution: { functions: ['fast'] },
      functions: [
        { tool: { type: 'function', name: 'fast', parameters: {}, strict: false }, execute: fast },
        { tool: { type: 'function', name: 'slow', parameters: {}, strict: false }, execute: slow },
      ],
    });
    const proposed = [wireCall('fast', {}), wireCall('slow', {})];
    const h = harness([{ output: proposed }, { output: [message] }]);
    const writes: ResponsesRunnerCheckpoint[] = [];
    const ledger = {
      runId: 'select',
      save(value: ResponsesRunnerCheckpoint) {
        writes.push(value);
      },
    };
    const iterator = runner.iterate(h.client, input, { stream: true, eager: true, maxSteps: 3, ledger });
    const turn = await iterator.next();
    expect(turn.value).toMatchObject({ attemptedCallIds: ['call_fast'], completedCallIds: ['call_fast'] });
    expect(writes.slice(-1)).toMatchObject([
      {
        phase: 'pending',
        consumed_requests: 1,
        pending_items: proposed,
        attempted_call_ids: ['call_fast'],
        returned_call_ids: ['call_fast'],
        returned_outputs: [{ type: 'function_call_output', call_id: 'call_fast', output: 'fast' }],
      },
    ]);
    await iterator.return();
    const [unresolved] = writes.slice(-1);
    if (!unresolved) {
      throw new Error('Missing pending checkpoint');
    }
    const resumed = harness([{ output: [message] }]);
    await expect(
      runner.run(
        resumed.client,
        { ...input, input: 'fresh' },
        {
          stream: true,
          eager: true,
          ledger: { ...ledger, resumeFrom: unresolved },
        },
      ),
    ).rejects.toThrow();
    expect(resumed.bodies).toHaveLength(0);
    expect(slow).not.toHaveBeenCalled();
    expect(fast).toHaveBeenCalledTimes(1);
    expect(h.bodies).toHaveLength(1);
  });

  test.each(['web_search_call', 'file_search_call'] as const)(
    'selective mode refuses undeclared %s even behind the barrier',
    async (type) => {
      const execute = vi.fn(() => 'effect');
      const search: ResponseOutputItem =
        type === 'web_search_call'
          ? { type, id: 'ws_refuse', status: 'completed', action: { type: 'search', query: 'q' } }
          : { type, id: 'fs_refuse', status: 'completed', queries: [], results: null };
      const runner = new ResponsesToolRunner({
        earlyExecution: {},
        functions: [{ tool: { type: 'function', name: 'f', parameters: {}, strict: false }, execute }],
      });
      const h = harness([{ output: [wireCall('f', {}), search] }]);
      await expect(runner.run(h.client, input, { stream: true, eager: true })).rejects.toMatchObject({
        attemptedCallIds: [],
        completedCallIds: [],
      });
      expect(execute).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );

  test('selective lifecycle mismatch stops before deferred work and retains early effects', async () => {
    const execute = vi.fn(() => 'done');
    const runner = new ResponsesToolRunner({
      earlyExecution: { functions: ['fast'] },
      functions: ['fast', 'slow'].map((name) => ({
        tool: { type: 'function', name, parameters: {}, strict: false },
        execute,
      })),
    });
    const h = harness([
      {
        output: [wireCall('fast', {}, 'one'), wireCall('slow', {}, 'two')],
        completedOutput: [message, wireCall('slow', { replaced: true }, 'two')],
      },
    ]);
    await expect(runner.run(h.client, input, { stream: true, eager: true })).rejects.toMatchObject({
      attemptedCallIds: ['call_one'],
      completedCallIds: ['call_one'],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(h.bodies).toHaveLength(1);
  });

  test.each([0, 1])(
    'selective duplicate done index %s aborts before any later tool',
    async (duplicateIndex) => {
      const fast = vi.fn(() => 'fast');
      const slow = vi.fn(() => 'slow');
      const runner = new ResponsesToolRunner({
        earlyExecution: { functions: ['fast'] },
        functions: [
          { tool: { type: 'function', name: 'fast', parameters: {}, strict: false }, execute: fast },
          { tool: { type: 'function', name: 'slow', parameters: {}, strict: false }, execute: slow },
        ],
      });
      const h = harness([{ output: [wireCall('fast', {}), wireCall('slow', {})], duplicateIndex }]);
      await expect(runner.run(h.client, input, { stream: true, eager: true })).rejects.toMatchObject({
        attemptedCallIds: ['call_fast'],
        completedCallIds: ['call_fast'],
      });
      expect(fast).toHaveBeenCalledTimes(1);
      expect(slow).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );

  test('duplicate pending or earlier-turn call IDs cannot become deferred effects', async () => {
    const execute = vi.fn(() => 'done');
    const runner = new ResponsesToolRunner({
      earlyExecution: {},
      functions: [{ tool: { type: 'function', name: 'f', parameters: {}, strict: false }, execute }],
    });
    const sameTurn = harness([{ output: [wireCall('f', {}), wireCall('f', {})] }]);
    await expect(runner.run(sameTurn.client, input, { stream: true, eager: true })).rejects.toMatchObject({
      attemptedCallIds: [],
      completedCallIds: [],
    });
    expect(execute).not.toHaveBeenCalled();
    const laterTurn = harness([{ output: [wireCall('f', {})] }, { output: [wireCall('f', {})] }]);
    await expect(runner.run(laterTurn.client, input, { stream: true, eager: true })).rejects.toMatchObject({
      attemptedCallIds: ['call_f'],
      completedCallIds: ['call_f'],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(laterTurn.bodies).toHaveLength(2);
  });

  test.each([true, false])(
    'native and ordinary computer permission are distinct, native=%s',
    async (nativeEarly) => {
      const nativeEffect = vi.fn();
      const screenshot = vi.fn(() => ({ type: 'computer_screenshot' as const, file_id: 'file_scoped' }));
      const ordinary = vi.fn(() => 'ordinary result');
      const approval = vi.fn(() => true);
      const beforeAction = vi.fn(() => true);
      const computer = new ComputerToolset({
        click: nativeEffect,
        double_click: nativeEffect,
        drag: nativeEffect,
        keypress: nativeEffect,
        move: nativeEffect,
        scroll: nativeEffect,
        type: nativeEffect,
        wait: nativeEffect,
        screenshot,
      });
      const native: ResponseOutputItem = {
        type: 'computer_call',
        id: 'cu_scoped',
        call_id: 'native',
        status: 'completed',
        pending_safety_checks: [{ id: 'review' }],
        actions: [{ type: 'wait' }],
      };
      const fn = wireCall('computer', {});
      const runner = new ResponsesToolRunner({
        computer,
        earlyExecution: { functions: nativeEarly ? [] : ['computer'], computer: nativeEarly },
        functions: [
          { tool: { type: 'function', name: 'computer', parameters: {}, strict: false }, execute: ordinary },
        ],
      });
      const h = harness([{ output: nativeEarly ? [native, fn] : [fn, native] }, { output: [message] }]);
      const iterator = runner.iterate(h.client, input, {
        stream: true,
        eager: true,
        computerOptions: { approveSafetyChecks: approval, beforeAction },
      });
      const turn = await iterator.next();
      if (turn.done) {
        throw new Error('Missing scoped computer turn');
      }
      expect(turn.value.attemptedCallIds).toEqual(nativeEarly ? ['native'] : ['call_computer']);
      expect(approval).toHaveBeenCalledTimes(nativeEarly ? 1 : 0);
      expect(beforeAction).toHaveBeenCalledTimes(nativeEarly ? 2 : 0);
      expect(nativeEffect).toHaveBeenCalledTimes(nativeEarly ? 1 : 0);
      expect(screenshot).toHaveBeenCalledTimes(nativeEarly ? 1 : 0);
      expect(ordinary).toHaveBeenCalledTimes(nativeEarly ? 0 : 1);
      const last = await iterator.next();
      expect(last.value).toMatchObject({ final: true });
      expect(approval).toHaveBeenCalledTimes(1);
      expect(beforeAction).toHaveBeenCalledTimes(2);
      expect(nativeEffect).toHaveBeenCalledTimes(1);
      expect(screenshot).toHaveBeenCalledTimes(1);
      expect(ordinary).toHaveBeenCalledTimes(1);
      expect(h.bodies[1]?.['input']).toEqual(
        expect.arrayContaining([
          {
            type: 'computer_call_output',
            call_id: 'native',
            output: { type: 'computer_screenshot', file_id: 'file_scoped' },
            acknowledged_safety_checks: [{ id: 'review' }],
          },
          { type: 'function_call_output', call_id: 'call_computer', output: 'ordinary result' },
        ]),
      );
      await iterator.return();
    },
  );

  test('cancellation waits for the actual held approval to settle before reporting completion', async () => {
    let announce!: () => void;
    // oxlint-disable-next-line promise/avoid-new -- Gate a real callback entry independently of cancellation.
    const entered = new Promise<void>((resolve) => {
      announce = resolve;
    });
    let release!: () => void;
    // oxlint-disable-next-line promise/avoid-new -- The held approval ignores cancellation until released by the test.
    const approval = new Promise<void>((resolve) => {
      release = resolve;
    });
    const click = vi.fn(async () => 'effect');
    const confirm = vi.fn(async () => {
      announce();
      await approval;
      return true;
    });
    const browser = new BrowserToolset({ state, click }, { confirm });
    const runner = new ResponsesToolRunner({ browser, earlyExecution: { functions: ['browser_click'] } });
    const h = harness([{ output: [wireCall('browser_click', { target: 'one', tab_id: null })] }]);
    const controller = new AbortController();
    let settled = false;
    const outcome = (async () => {
      try {
        return {
          value: await runner.run(h.client, input, { stream: true, eager: true, signal: controller.signal }),
        };
      } catch (error) {
        return { error };
      } finally {
        settled = true;
      }
    })();
    await entered;
    controller.abort();
    // Give abort listeners and queued stream callbacks a turn; the approval still owns pending work.
    await nextTurn();
    expect(settled).toBe(false);
    expect(click).not.toHaveBeenCalled();
    release();
    expect(await outcome).toMatchObject({
      error: { attemptedCallIds: ['call_browser_click'], completedCallIds: [] },
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(1);
  });

  test.each([1, 2])(
    'ledger save rejection stops the selective dispatch at returned count %s',
    async (returned) => {
      const effects: string[] = [];
      const runner = new ResponsesToolRunner({
        earlyExecution: { functions: ['fast'] },
        functions: ['fast', 'slow', 'later'].map((name) => ({
          tool: { type: 'function', name, parameters: {}, strict: false },
          execute: () => {
            effects.push(name);
            return name;
          },
        })),
      });
      const h = harness([
        {
          output: [wireCall('fast', {}), wireCall('slow', {}), wireCall('later', {})],
        },
      ]);
      const writes: ResponsesRunnerCheckpoint[] = [];
      const ledger = {
        runId: 'save-failure',
        save(value: ResponsesRunnerCheckpoint) {
          writes.push(value);
          if (value.returned_call_ids.length === returned) {
            throw new Error('lost ACK');
          }
        },
      };
      const ids = ['call_fast', 'call_slow'].slice(0, returned);
      await expect(runner.run(h.client, input, { stream: true, eager: true, ledger })).rejects.toMatchObject({
        attemptedCallIds: ids,
        completedCallIds: ids,
      });
      expect(effects).toEqual(['fast', 'slow'].slice(0, returned));
      expect(writes.slice(-1)).toMatchObject([
        { phase: 'pending', attempted_call_ids: ids, returned_call_ids: ids },
      ]);
      expect(h.bodies).toHaveLength(1);
    },
  );

  test('selective ledger continues only a fully completed boundary, with remaining budget and fresh choice', async () => {
    const fast = vi.fn(() => 'fast');
    const slow = vi.fn(() => 'slow');
    const registered = {
      functions: [
        { tool: { type: 'function' as const, name: 'fast', parameters: {}, strict: false }, execute: fast },
        { tool: { type: 'function' as const, name: 'slow', parameters: {}, strict: false }, execute: slow },
      ],
    };
    const runner = new ResponsesToolRunner({ ...registered, earlyExecution: { functions: ['fast'] } });
    const proposed = [wireCall('fast', {}), wireCall('slow', {})];
    const h = harness([{ output: proposed }, { output: [message] }]);
    const writes: ResponsesRunnerCheckpoint[] = [];
    const ledger = {
      runId: 'resume',
      save(value: ResponsesRunnerCheckpoint) {
        writes.push(value);
      },
    };
    await expect(
      runner.run(h.client, input, { stream: true, eager: true, maxSteps: 3, ledger }),
    ).resolves.toHaveProperty('output_text', 'done');
    const boundary = writes.find((v) => v.phase === 'boundary' && v.returned_call_ids.length === 2);
    if (!boundary) {
      throw new Error('No boundary');
    }
    expect(boundary.history).toEqual([
      { role: 'user', content: 'fixture task' },
      ...proposed,
      { type: 'function_call_output', call_id: 'call_fast', output: 'fast' },
      { type: 'function_call_output', call_id: 'call_slow', output: 'slow' },
    ]);
    const restored = new ResponsesToolRunner({ ...registered, earlyExecution: {} });
    const resumed = harness([{ output: [message] }]);
    await expect(
      restored.run(
        resumed.client,
        { ...input, input: 'fresh page' },
        {
          stream: true,
          eager: true,
          ledger: { ...ledger, resumeFrom: boundary },
        },
      ),
    ).resolves.toHaveProperty('output_text', 'done');
    expect(resumed.bodies[0]?.['input']).toEqual([
      ...boundary.history,
      { role: 'user', content: 'fresh page' },
    ]);
    expect(writes.slice(-1)).toMatchObject([{ phase: 'final', max_steps: 3, consumed_requests: 2 }]);
    expect(fast).toHaveBeenCalledTimes(1);
    expect(slow).toHaveBeenCalledTimes(1);
  });

  test.each([{ functions: ['f'] }, {}])(
    'last allowed request never executes in selective mode %j',
    async (earlyExecution) => {
      const execute = vi.fn(() => 'effect');
      const runner = new ResponsesToolRunner({
        earlyExecution,
        functions: [{ tool: { type: 'function', name: 'f', parameters: {}, strict: false }, execute }],
      });
      const h = harness([{ output: [wireCall('f', {})] }]);
      await expect(
        runner.run(h.client, input, { stream: true, eager: true, maxSteps: 1 }),
      ).rejects.toMatchObject({
        attemptedCallIds: [],
        completedCallIds: [],
      });
      expect(execute).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );
});

describe('ResponsesToolRunner effect ledger', () => {
  test.each(['name', 'arguments'] as const)(
    'MCP resume validates required %s before asking for fresh approval',
    async (field) => {
      const approval: ResponseOutputItem.McpApprovalRequest = {
        type: 'mcp_approval_request',
        id: 'approval_resume',
        server_label: 'desk',
        name: 'read',
        arguments: '{}',
      };
      const request: ResponseCreateParamsNonStreaming = {
        ...input,
        tools: [{ type: 'mcp', server_label: 'desk', server_url: 'https://fixture.invalid/mcp' }],
      };
      const runner = new ResponsesToolRunner({});
      const seed = harness([{ output: [approval] }, { output: [message] }]);
      const saved = recording();
      await runner.run(seed.client, request, { ledger: saved.ledger, approveMcp: () => true });
      const checkpoint = saved.writes.find(
        (value) => value.phase === 'boundary' && value.returned_call_ids.includes(approval.id),
      );
      if (!checkpoint) {
        throw new Error('Missing completed approval checkpoint');
      }
      await Promise.all(
        [undefined, null, 42].map(async (invalid) => {
          const restored = structuredClone(checkpoint);
          const item = restored.history.find((value) => value.type === 'mcp_approval_request');
          if (!item) {
            throw new Error('Missing approval request');
          }
          if (invalid === undefined) {
            Reflect.deleteProperty(item, field);
          } else {
            Reflect.set(item, field, invalid);
          }
          const resumed = harness([{ output: [message] }]);
          const approveMcp = vi.fn(() => true);
          await expect(
            new ResponsesToolRunner({}).run(resumed.client, request, {
              ledger: { ...recording().ledger, resumeFrom: restored },
              approveMcp,
            }),
          ).rejects.toThrow(TypeError);
          expect(approveMcp).not.toHaveBeenCalled();
          expect(resumed.bodies).toHaveLength(0);
        }),
      );
    },
  );

  test.each(['approved continuation', 'automatic first request'] as const)(
    'lost MCP %s has a durable pending phase and cannot resume',
    async (scenario) => {
      const approval: ResponseOutputItem = {
        type: 'mcp_approval_request',
        id: 'approve_one',
        server_label: 'desk',
        name: 'record',
        arguments: '{}',
      };
      const request: ResponseCreateParamsNonStreaming = {
        ...input,
        tools: [
          {
            type: 'mcp',
            server_label: 'desk',
            server_url: 'https://fixture.invalid/mcp',
            require_approval: scenario === 'automatic first request' ? 'never' : 'always',
          },
        ],
      };
      const h = harness(scenario === 'approved continuation' ? [{ output: [approval] }] : []);
      const saved = recording();
      const approveMcp = vi.fn(() => true);
      const runner = new ResponsesToolRunner({});
      await expect(
        runner.run(h.client, request, { ledger: saved.ledger, approveMcp }),
      ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
      expect(h.bodies).toHaveLength(scenario === 'approved continuation' ? 2 : 1);
      expect(approveMcp).toHaveBeenCalledTimes(scenario === 'approved continuation' ? 1 : 0);
      const count = saved.writes.length;
      const last = saved.writes[count - 1];
      expect(last).toMatchObject({ phase: 'pending', pending_items: [], returned_outputs: [] });
      if (!last) {
        throw new Error('Missing MCP admission checkpoint');
      }
      const resumed = harness([{ output: [message] }]);
      await expect(
        runner.run(resumed.client, request, { ledger: { ...saved.ledger, resumeFrom: last }, approveMcp }),
      ).rejects.toThrow('Invalid or unresolved ledger');
      expect(resumed.bodies).toHaveLength(0);
    },
  );

  test('records admission before HTTP and before/after effects with detached native evidence', async () => {
    const writes: ResponsesRunnerCheckpoint[] = [];
    const execute = vi.fn(() => 'filed');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const h = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
    const options = {
      maxSteps: 3,
      ledger: {
        runId: 'fixture',
        save(value: ResponsesRunnerCheckpoint) {
          writes.push(structuredClone(value));
        },
      },
    };
    await runner.run(h.client, input, options);
    expect(writes.map((r) => [r['phase'], r['consumed_requests']])).toEqual([
      ['boundary', 1],
      ['pending', 1],
      ['pending', 1],
      ['pending', 1],
      ['boundary', 1],
      ['boundary', 2],
      ['final', 2],
    ]);
    expect(writes[2]).toMatchObject({ attempted_call_ids: ['call_record'], returned_call_ids: [] });
    expect(writes[3]).toMatchObject({
      returned_call_ids: ['call_record'],
      returned_outputs: [{ type: 'function_call_output', call_id: 'call_record', output: 'filed' }],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(h.bodies).toHaveLength(2);
  });

  test('mutate-then-throw browser output stops without another effect or request in ledger mode', async () => {
    const effects: string[] = [];
    const browser = new BrowserToolset(
      {
        state,
        click: async () => {
          effects.push('changed');
          throw new Error('private');
        },
      },
      { confirm: () => true },
    );
    const h = harness([
      { output: [wireCall('browser_click', { target: 'one', tab_id: null })] },
      { output: [message] },
    ]);
    const writes: ResponsesRunnerCheckpoint[] = [];
    const options = {
      ledger: {
        runId: 'fixture',
        save(value: ResponsesRunnerCheckpoint) {
          writes.push(value);
        },
      },
    };
    await expect(new ResponsesToolRunner({ browser }).run(h.client, input, options)).rejects.toMatchObject({
      attemptedCallIds: ['call_browser_click'],
      completedCallIds: ['call_browser_click'],
    });
    expect(effects).toEqual(['changed']);
    expect(h.bodies).toHaveLength(1);
    expect(writes.slice(-1)).toMatchObject([
      {
        phase: 'pending',
        attempted_call_ids: ['call_browser_click'],
        returned_call_ids: ['call_browser_click'],
      },
    ]);
  });

  test('a recorder failure on attempt prevents state, approval and driver entry', async () => {
    const read = vi.fn(state);
    const confirm = vi.fn(() => true);
    const click = vi.fn(async () => 'clicked');
    const browser = new BrowserToolset({ state: read, click }, { confirm });
    const h = harness([{ output: [wireCall('browser_click', { target: 'one', tab_id: null })] }]);
    const options = {
      ledger: {
        runId: 'fixture',
        save(value: ResponsesRunnerCheckpoint) {
          if (value.attempted_call_ids.length) {
            throw new Error('lost save');
          }
        },
      },
    };
    await expect(new ResponsesToolRunner({ browser }).run(h.client, input, options)).rejects.toBeInstanceOf(
      ResponsesToolRunnerError,
    );
    expect(read).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(1);
  });

  test('admission survives a lost response; resume restores the budget and appends fresh input once', async () => {
    let saved: ResponsesRunnerCheckpoint | undefined;
    let requests = 0;
    const client = new OpenAI({
      apiKey: 'synthetic-test-key',
      maxRetries: 3,
      fetch: async () => {
        requests += 1;
        return Response.json({ error: { message: 'synthetic failure' } }, { status: 500 });
      },
    });
    const runner = new ResponsesToolRunner({});
    const ledger = {
      runId: 'fixture',
      save(value: ResponsesRunnerCheckpoint) {
        saved = value;
      },
    };
    await expect(runner.run(client, input, { maxSteps: 2, ledger })).rejects.toBeInstanceOf(
      ResponsesToolRunnerError,
    );
    expect(requests).toBe(1);
    expect(saved).toMatchObject({
      phase: 'boundary',
      consumed_requests: 1,
      max_steps: 2,
      attempted_call_ids: [],
    });
    if (!saved) {
      throw new Error('expected admission');
    }
    const original = structuredClone(saved);
    const h = harness([{ output: [message] }]);
    await runner.run(
      h.client,
      { ...input, input: 'fresh observation' },
      { ledger: { ...ledger, resumeFrom: original } },
    );
    expect(h.bodies).toHaveLength(1);
    expect(h.bodies[0]?.['input']).toEqual([
      { role: 'user', content: 'fixture task' },
      { role: 'user', content: 'fresh observation' },
    ]);
    expect(saved).toMatchObject({ phase: 'final', consumed_requests: 2, max_steps: 2 });
    const exhausted = { ...original, consumed_requests: 2 };
    const noRequest = harness([]);
    await expect(
      runner.run(noRequest.client, input, { ledger: { ...ledger, resumeFrom: exhausted } }),
    ).rejects.toThrow('maxSteps');
    expect(noRequest.bodies).toHaveLength(0);
  });

  test('only a matching boundary can resume; inspect, saved return and final never replay', async () => {
    const execute = vi.fn(() => 'filed');
    const runner = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'record', parameters: {}, strict: false },
          execute,
          allowOutputOverride: true,
        },
      ],
    });
    const writes: ResponsesRunnerCheckpoint[] = [];
    const ledger = {
      runId: 'fixture',
      save(value: ResponsesRunnerCheckpoint) {
        writes.push(value);
      },
    };
    const h = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
    await runner.run(h.client, input, { maxSteps: 3, ledger });
    const boundary = writes.find(
      (value) => value.phase === 'boundary' && value.returned_call_ids.length === 1,
    );
    if (!boundary) {
      throw new Error('expected completed boundary');
    }
    const bad = [
      ...writes.filter((value) => value.phase !== 'boundary'),
      { ...boundary, run_id: 'different' },
      { ...boundary, version: 2 },
      { ...boundary, history: [...boundary.history, boundary.history[1]] },
      { ...boundary, history: boundary.history.slice(0, 2) },
      { ...boundary, output_override_names: [] },
      { ...boundary, unknown: 'private' },
      { ...boundary, returned_call_ids: [] },
      false,
      0,
      '',
    ];
    const missingField = { ...boundary, extra: 'unknown replacement' };
    Reflect.deleteProperty(missingField, 'final_response');
    bad.push(missingField);
    for (const value of bad) {
      const noRequest = harness([]);
      const saved = writes.length;
      // SAFETY: Checkpoints may come from untrusted storage. The public API must validate them.
      const resumeFrom = value as ResponsesRunnerCheckpoint;
      // oxlint-disable-next-line no-await-in-loop -- The recorder belongs to the shared runner.
      await expect(
        runner.run(noRequest.client, input, { ledger: { ...ledger, resumeFrom } }),
      ).rejects.toBeInstanceOf(Error);
      expect(noRequest.bodies).toHaveLength(0);
      expect(writes).toHaveLength(saved);
    }
    const noConflict = harness([]);
    await expect(
      runner.run(noConflict.client, input, { maxSteps: 4, ledger: { ...ledger, resumeFrom: boundary } }),
    ).rejects.toBeInstanceOf(Error);
    expect(noConflict.bodies).toHaveLength(0);
    const fresh = harness([{ output: [message] }]);
    await runner.run(
      fresh.client,
      { ...input, input: 'checked environment' },
      { ledger: { ...ledger, resumeFrom: boundary } },
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(fresh.bodies).toHaveLength(1);
  });

  test.each([undefined, null])('omitted resume checkpoint starts a new run: %s', async (resumeFrom) => {
    const h = harness([{ output: [message] }]);
    const save = vi.fn();
    const ledger = { runId: 'fixture', save };
    // JS callers may pass null to omit a checkpoint; neither omission reuses a saved budget.
    Reflect.set(ledger, 'resumeFrom', resumeFrom);
    await expect(new ResponsesToolRunner({}).run(h.client, input, { ledger })).resolves.toHaveProperty(
      'output_text',
      'done',
    );
    expect(h.bodies).toHaveLength(1);
    expect(save).toHaveBeenCalledTimes(2);
  });

  test('historical pairs block reused IDs but never become this run receipts', async () => {
    const execute = vi.fn(() => 'filed');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const writes: ResponsesRunnerCheckpoint[] = [];
    const ledger = {
      runId: 'fixture',
      save(value: ResponsesRunnerCheckpoint) {
        writes.push(value);
      },
    };
    const h = harness([{ output: [wireCall('record', {})] }]);
    await expect(
      runner.run(
        h.client,
        {
          ...input,
          input: [
            call('record', {}),
            {
              type: 'function_call_output',
              call_id: 'call_record',
              output: 'earlier externally supplied result',
            },
            { role: 'user', content: 'continue' },
          ],
        },
        { ledger },
      ),
    ).rejects.toMatchObject({ attemptedCallIds: [], completedCallIds: [] });
    expect(writes[0]).toMatchObject({ attempted_call_ids: [], returned_call_ids: [] });
    expect(execute).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    'save failure after effect preserves IDs and forbids subsequent requests (eager=%s)',
    async (eager) => {
      const effects: string[] = [];
      const runner = new ResponsesToolRunner({
        functions: [
          {
            tool: { type: 'function', name: 'record', parameters: {}, strict: false },
            execute: () => {
              effects.push('filed');
              return 'filed';
            },
          },
        ],
      });
      const h = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
      const saved: ResponsesRunnerCheckpoint[] = [];
      const ledger = {
        runId: 'fixture',
        save(value: ResponsesRunnerCheckpoint) {
          saved.push(value);
          if (value.returned_call_ids.length) {
            throw new Error('simulated lost save acknowledgement');
          }
        },
      };
      await expect(runner.run(h.client, input, { stream: true, eager, ledger })).rejects.toMatchObject({
        attemptedCallIds: ['call_record'],
        completedCallIds: ['call_record'],
      });
      expect(effects).toEqual(['filed']);
      expect(h.bodies).toHaveLength(1);
      expect(saved.slice(-1)).toMatchObject([{ phase: 'pending', returned_outputs: [{ output: 'filed' }] }]);
    },
  );

  test('successful eager ledger streams replay wire items and resume without repeating effects', async () => {
    const click = vi.fn(async () => 'clicked');
    const execute = vi.fn(() => 'filed');
    const browser = new BrowserToolset({ state, click }, { confirm: () => true });
    const runner = new ResponsesToolRunner({
      browser,
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const proposed = [
      wireCall('browser_click', { target: 'one', tab_id: null }),
      wireCall('record', {}),
      { ...message, id: 'msg_commentary', phase: 'commentary' as const },
    ];
    const h = harness([{ output: proposed }, { output: [message] }]);
    const writes: ResponsesRunnerCheckpoint[] = [];
    const ledger = {
      runId: 'fixture',
      save(value: ResponsesRunnerCheckpoint) {
        writes.push(value);
      },
    };
    await expect(
      runner.run(h.client, input, { stream: true, eager: true, maxSteps: 3, ledger }),
    ).resolves.toHaveProperty('output_text', 'done');
    expect(click).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(h.bodies).toHaveLength(2);
    expect(h.bodies[0]?.['tools']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'browser_click', strict: true }),
        expect.objectContaining({ name: 'record', strict: false }),
      ]),
    );
    const boundary = writes.find(
      (value) => value.phase === 'boundary' && value.returned_call_ids.length === 2,
    );
    if (!boundary) {
      throw new Error('expected completed eager boundary');
    }
    expect(boundary.history.slice(1, 4)).toEqual(proposed);
    expect(boundary.history.slice(4).map((item) => item.type)).toEqual([
      'function_call_output',
      'function_call_output',
    ]);
    expect(h.bodies[1]?.['input']).toEqual(boundary.history);
    expect(boundary.attempted_call_ids).toEqual(['call_browser_click', 'call_record']);
    expect(boundary.returned_call_ids).toEqual(boundary.attempted_call_ids);
    const resumed = harness([{ output: [message] }]);
    await expect(
      runner.run(
        resumed.client,
        { ...input, input: 'fresh checked state' },
        { stream: true, eager: true, ledger: { ...ledger, resumeFrom: boundary } },
      ),
    ).resolves.toHaveProperty('output_text', 'done');
    expect(resumed.bodies).toHaveLength(1);
    expect(resumed.bodies[0]?.['input']).toEqual([
      ...boundary.history,
      { role: 'user', content: 'fresh checked state' },
    ]);
    expect(click).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(writes.slice(-1)).toMatchObject([{ phase: 'final', consumed_requests: 2, max_steps: 3 }]);
  });

  test('eager interrupted or changed completed output stays pending even after a tool returned', async () => {
    for (const turn of [
      { output: [wireCall('record', {})], interrupt: true },
      { output: [wireCall('record', {})], completedOutput: [wireCall('record', { altered: true })] },
    ]) {
      const execute = vi.fn(() => 'filed');
      const runner = new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
      });
      const writes: ResponsesRunnerCheckpoint[] = [];
      const ledger = {
        runId: 'fixture',
        save(value: ResponsesRunnerCheckpoint) {
          writes.push(value);
        },
      };
      const h = harness([turn]);
      // These cases share a runner and recorder; verify each rejected checkpoint before the next.
      // oxlint-disable-next-line no-await-in-loop
      await expect(runner.run(h.client, input, { stream: true, eager: true, ledger })).rejects.toMatchObject({
        attemptedCallIds: ['call_record'],
        completedCallIds: ['call_record'],
      });
      expect(writes.slice(-1)).toMatchObject([{ phase: 'pending', returned_call_ids: ['call_record'] }]);
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });

  test('saved copies and mutated original params cannot alter actual request history or declarations', async () => {
    const params = { ...input, input: [{ role: 'user' as const, content: 'fixture task' }] };
    const execute = vi.fn(() => 'filed');
    const tool = { type: 'function' as const, name: 'record', parameters: {}, strict: false };
    const runner = new ResponsesToolRunner({ functions: [{ tool, execute }] });
    const h = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
    await runner.run(h.client, params, {
      ledger: {
        runId: 'fixture',
        save(value) {
          const [first] = params.input;
          if (first) {
            first.content = 'mutated original';
          }
          tool.name = 'mutated declaration';
          value.history.splice(0);
          value.tools.splice(0);
          value.attempted_call_ids.push('spoof');
        },
      },
    });
    expect(h.bodies[0]?.['input']).toEqual([{ role: 'user', content: 'fixture task' }]);
    expect(h.bodies[0]?.['tools']).toMatchObject([{ name: 'record' }]);
    expect(h.bodies[1]?.['input']).toMatchObject([
      { role: 'user', content: 'fixture task' },
      { name: 'record' },
      { call_id: 'call_record', output: 'filed' },
    ]);
  });

  test('transport overrides cannot evade the saved request or retry budget in ledger mode', async () => {
    const h = harness([]);
    const save = vi.fn();
    const runner = new ResponsesToolRunner({});
    for (const requestOptions of [
      { body: { input: 'bypass' } },
      { path: '/other' },
      { fetchOptions: { body: 'bypass' } },
      { maxRetries: 2 },
    ]) {
      // SAFETY: JS callers can bypass the type-level fetch body restriction.
      const unsafe = requestOptions as OpenAI.RequestOptions;
      // These cases share a runner and recorder; verify each rejected checkpoint before the next.
      // oxlint-disable-next-line no-await-in-loop
      await expect(
        runner.run(h.client, input, { requestOptions: unsafe, ledger: { runId: 'fixture', save } }),
      ).rejects.toBeInstanceOf(Error);
    }
    expect(save).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(0);
  });

  test.each([
    ['date', new Date(0)],
    ['map', new Map([['value', 'a']])],
    ['set', new Set(['a'])],
    ['undefined array', [undefined]],
    ['nonfinite number', Number.NaN],
  ])('ledger never silently changes non-JSON body values: %s', async (_name, value) => {
    const h = harness([]);
    const save = vi.fn();
    const params = { ...input };
    // JS callers can supply values outside generated types.
    Reflect.set(params, 'metadata', value);
    await expect(
      new ResponsesToolRunner({}).run(h.client, params, { ledger: { runId: 'fixture', save } }),
    ).rejects.toBeInstanceOf(Error);
    expect(save).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(0);
  });

  test('ledger omits undefined metadata properties without changing the caller', async () => {
    const metadata = { kept: 'value' };
    Reflect.set(metadata, 'omitted', undefined);
    const h = harness([{ output: [message] }]);
    const saved = recording();
    await expect(
      new ResponsesToolRunner({}).run(h.client, { ...input, metadata }, { ledger: saved.ledger }),
    ).resolves.toHaveProperty('output_text', 'done');
    expect(h.bodies).toHaveLength(1);
    expect(h.bodies[0]?.['metadata']).toStrictEqual({ kept: 'value' });
    expect(saved.writes).toHaveLength(2);
    expect(metadata).toStrictEqual({ kept: 'value', omitted: undefined });
  });

  test.each([
    'missing-output',
    'empty-source',
    'bad-action',
    'legacy-checks',
    'missing-id',
    'empty-actions',
    'x-string',
    'x-bool',
    'bad-file-valid-image',
    'bad-image-valid-file',
  ] as const)(
    'rejects invalid native computer history before save, request, or effects: %s',
    async (scenario) => {
      const effect = vi.fn();
      const computer = new ComputerToolset({
        click: effect,
        double_click: effect,
        drag: effect,
        keypress: effect,
        move: effect,
        scroll: effect,
        type: effect,
        wait: effect,
        screenshot: () => ({ type: 'computer_screenshot', file_id: 'file_fixture' }),
      });
      const item = {
        type: 'computer_call',
        id: 'item_native',
        call_id: 'native',
        status: 'completed',
        actions: [{ type: 'wait' }],
      };
      const output = {
        type: 'computer_call_output',
        call_id: 'native',
        output: { type: 'computer_screenshot', file_id: 'file_fixture' },
      };
      const fixtures = {
        'missing-output': [item, { type: output.type, call_id: output.call_id }],
        'empty-source': [item, { ...output, output: { type: 'computer_screenshot', file_id: ' ' } }],
        'bad-file-valid-image': [
          item,
          {
            ...output,
            output: { type: 'computer_screenshot', file_id: 7, image_url: 'data:image/png;base64,AA==' },
          },
        ],
        'bad-image-valid-file': [
          item,
          { ...output, output: { type: 'computer_screenshot', file_id: 'file_fixture', image_url: {} } },
        ],
        'bad-action': [{ ...item, actions: [{ type: 'other' }] }, output],
        'missing-id': [
          { type: 'computer_call', call_id: 'native', status: 'completed', actions: [{ type: 'wait' }] },
          output,
        ],
        'empty-actions': [{ ...item, actions: [] }, output],
        'x-string': [{ ...item, actions: [{ type: 'click', button: 'left', x: '42', y: 17 }] }, output],
        'x-bool': [{ ...item, actions: [{ type: 'click', button: 'left', x: true, y: 17 }] }, output],
        'legacy-checks': [
          {
            type: 'computer_call',
            id: 'legacy',
            call_id: 'native',
            status: 'completed',
            action: { type: 'wait' },
            pending_safety_checks: null,
          },
          output,
        ],
      };
      const save = vi.fn();
      const h = harness([]);
      const params = { ...input };
      // Reflect unvalidated caller-owned storage, bypassing TypeScript as in a JS consumer.
      Reflect.set(params, 'input', fixtures[scenario]);
      await expect(
        new ResponsesToolRunner({ computer }).run(h.client, params, { ledger: { runId: 'fixture', save } }),
      ).rejects.toBeInstanceOf(Error);
      expect(save).not.toHaveBeenCalled();
      expect(effect).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(0);
    },
  );

  test('a current observation needs real message content; empty input never spends a resumed request', async () => {
    const resumeFrom: ResponsesRunnerCheckpoint = {
      version: 1,
      run_id: 'fixture',
      revision: 1,
      phase: 'boundary',
      max_steps: 3,
      consumed_requests: 1,
      tools: [],
      output_override_names: [],
      history: [{ role: 'user', content: 'old state' }],
      attempted_call_ids: [],
      returned_call_ids: [],
      pending_items: [],
      returned_outputs: [],
      final_response: null,
    };
    for (const [role, content] of [
      ['user', []],
      ['user', [{ type: 'input_text', text: '' }]],
      ['user', ' '],
      ['user', [{ type: 'input_image', detail: 'auto' }]],
      ['user', [{ type: 'input_file', filename: 'fixture.txt' }]],
      ['user', [{ type: 'output_text', text: 'old response' }]],
      ['system', 'not a user observation'],
      ['developer', 'not a user observation'],
      ['assistant', 'not a user observation'],
    ]) {
      const h = harness([]);
      const save = vi.fn();
      const params = { ...input };
      Reflect.set(params, 'input', [{ role, content }]);
      // Same original budget; test each rejected candidate before moving to another.
      // oxlint-disable-next-line no-await-in-loop
      await expect(
        new ResponsesToolRunner({}).run(h.client, params, { ledger: { runId: 'fixture', save, resumeFrom } }),
      ).rejects.toBeInstanceOf(Error);
      expect(save).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(0);
    }
  });

  test.each([
    { role: 'user', content: [null] },
    { role: 'assistant', content: [null] },
    { role: 'user', content: [{ type: 'input_text', text: 123 }] },
    { role: 'user', content: [{ type: 'refusal', refusal: 'old answer' }] },
    { role: 'user', content: 'old state', type: undefined },
    { role: 'user', content: [undefined] },
  ])('AM malformed message replay is rejected before request: %o', async (invalid) => {
    const resumeFrom: ResponsesRunnerCheckpoint = {
      version: 1,
      run_id: 'fixture',
      revision: 1,
      phase: 'boundary',
      max_steps: 3,
      consumed_requests: 1,
      tools: [],
      output_override_names: [],
      history: [],
      attempted_call_ids: [],
      returned_call_ids: [],
      pending_items: [],
      returned_outputs: [],
      final_response: null,
    };
    Reflect.set(resumeFrom, 'history', [invalid]);
    const h = harness([{ output: [message] }]);
    const save = vi.fn();
    await expect(
      new ResponsesToolRunner({}).run(h.client, input, {
        ledger: { runId: 'fixture', save, resumeFrom },
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(h.bodies).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });

  test.each(['text', 'image', 'file'] as const)(
    'resuming from supplied current %s preserves native input',
    async (kind) => {
      const resumeFrom: ResponsesRunnerCheckpoint = {
        version: 1,
        run_id: 'fixture',
        revision: 1,
        phase: 'boundary',
        max_steps: 3,
        consumed_requests: 1,
        tools: [],
        output_override_names: [],
        history: [{ role: 'user', content: 'old state' }],
        attempted_call_ids: [],
        returned_call_ids: [],
        pending_items: [],
        returned_outputs: [],
        final_response: null,
      };
      const sources = {
        text: { type: 'input_text', text: 'current fixture state' },
        image: { type: 'input_image', detail: 'auto', file_id: 'file_fixture' },
        file: { type: 'input_file', filename: 'fixture.txt', file_data: 'Zml4dHVyZQ==' },
      };
      const h = harness([{ output: [message] }]);
      const save = vi.fn();
      const params = { ...input };
      const current = { role: 'user', content: [sources[kind]] };
      Reflect.set(params, 'input', [current]);
      await new ResponsesToolRunner({}).run(h.client, params, {
        ledger: { runId: 'fixture', save, resumeFrom },
      });
      expect(h.bodies[0]?.['input']).toEqual([...resumeFrom.history, current]);
      expect(save).toHaveBeenCalledTimes(2);
    },
  );

  test('native reasoning extras cannot masquerade as a current observation message', async () => {
    const resumeFrom: ResponsesRunnerCheckpoint = {
      version: 1,
      run_id: 'fixture',
      revision: 1,
      phase: 'boundary',
      max_steps: 3,
      consumed_requests: 1,
      tools: [],
      output_override_names: [],
      history: [{ role: 'user', content: 'old state' }],
      attempted_call_ids: [],
      returned_call_ids: [],
      pending_items: [],
      returned_outputs: [],
      final_response: null,
    };
    const h = harness([]);
    const save = vi.fn();
    const params = { ...input };
    Reflect.set(params, 'input', [
      { type: 'reasoning', id: 'rs_fixture', summary: [], role: 'user', content: 'extra metadata' },
    ]);
    await expect(
      new ResponsesToolRunner({}).run(h.client, params, { ledger: { runId: 'fixture', save, resumeFrom } }),
    ).rejects.toBeInstanceOf(Error);
    expect(save).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(0);
  });

  test('revision exhaustion stops before first effect and never emits duplicate unsafe revisions', async () => {
    const execute = vi.fn(() => 'filed');
    const tool = { type: 'function' as const, name: 'record', parameters: {}, strict: false };
    const runner = new ResponsesToolRunner({ functions: [{ tool, execute }] });
    const resumeFrom: ResponsesRunnerCheckpoint = {
      version: 1,
      run_id: 'fixture',
      revision: Number.MAX_SAFE_INTEGER - 1,
      phase: 'boundary',
      max_steps: 4,
      consumed_requests: 1,
      tools: [tool],
      output_override_names: [],
      history: [{ role: 'user', content: 'fixture' }],
      attempted_call_ids: [],
      returned_call_ids: [],
      pending_items: [],
      returned_outputs: [],
      final_response: null,
    };
    const writes: ResponsesRunnerCheckpoint[] = [];
    const h = harness([{ output: [wireCall('record', {})] }]);
    await expect(
      runner.run(h.client, input, {
        ledger: {
          runId: 'fixture',
          resumeFrom,
          save(value) {
            writes.push(value);
          },
        },
      }),
    ).rejects.toBeInstanceOf(ResponsesToolRunnerError);
    expect(writes.map((value) => value.revision)).toEqual([Number.MAX_SAFE_INTEGER]);
    expect(h.bodies).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    'closing at inspection keeps a non-resumable proposal and no effect (stream=%s)',
    async (stream) => {
      const execute = vi.fn(() => 'filed');
      const runner = new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
      });
      const writes: ResponsesRunnerCheckpoint[] = [];
      const ledger = {
        runId: 'fixture',
        save(value: ResponsesRunnerCheckpoint) {
          writes.push(value);
        },
      };
      const h = harness([{ output: [wireCall('record', {})] }]);
      // Exercise the public for-await break cleanup, which must close the active turn.
      // oxlint-disable-next-line no-unreachable-loop
      for await (const turn of runner.iterate(h.client, input, { ledger, stream })) {
        expect(turn.toolsExecuted).toBe(false);
        break;
      }
      expect(writes.slice(-1)).toMatchObject([
        {
          phase: 'pending',
          attempted_call_ids: [],
          returned_call_ids: [],
          pending_items: [{ type: 'function_call', call_id: 'call_record' }],
        },
      ]);
      expect(execute).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );

  test('native checks and screenshots share the saved mixed history without transferring old approval', async () => {
    const effect = vi.fn();
    const computer = new ComputerToolset({
      click: effect,
      double_click: effect,
      drag: effect,
      keypress: effect,
      move: effect,
      scroll: effect,
      type: effect,
      wait: effect,
      screenshot: () => ({ type: 'computer_screenshot', file_id: 'file_fixture' }),
    });
    const confirm = vi.fn(() => true);
    const execute = vi.fn(() => 'filed');
    const runner = new ResponsesToolRunner({
      computer,
      functions: [
        {
          tool: { type: 'function', name: 'record', parameters: {}, strict: false },
          execute,
        },
      ],
    });
    const native: ResponseOutputItem = {
      id: 'native_item',
      type: 'computer_call',
      status: 'completed',
      call_id: 'native',
      pending_safety_checks: [{ id: 'safety' }],
      actions: [{ type: 'wait' }],
    };
    const writes: ResponsesRunnerCheckpoint[] = [];
    const ledger = {
      runId: 'fixture',
      save(value: ResponsesRunnerCheckpoint) {
        writes.push(value);
      },
    };
    const h = harness([{ output: [native, wireCall('record', {})] }, { output: [message] }]);
    await runner.run(h.client, input, {
      ledger,
      computerOptions: { approveSafetyChecks: confirm },
      maxSteps: 4,
    });
    const boundary = writes.find(
      (value) => value.phase === 'boundary' && value.returned_call_ids.length === 2,
    );
    if (!boundary) {
      throw new Error('Expected mixed completed boundary.');
    }
    expect(boundary.history).toContainEqual({
      type: 'computer_call_output',
      call_id: 'native',
      output: { type: 'computer_screenshot', file_id: 'file_fixture' },
      acknowledged_safety_checks: [{ id: 'safety' }],
    });
    expect(boundary).toMatchObject({
      tools: [{ name: 'record' }, { type: 'computer' }],
      attempted_call_ids: ['native', 'call_record'],
    });
    const resumed = harness([{ output: [{ ...native, id: 'second', call_id: 'new_native' }] }]);
    await expect(
      runner.run(
        resumed.client,
        { ...input, input: 'current display' },
        { ledger: { ...ledger, resumeFrom: boundary } },
      ),
    ).rejects.toMatchObject({
      attemptedCallIds: ['native', 'call_record', 'new_native'],
      completedCallIds: ['native', 'call_record'],
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  test('cancellation immediately after return saves evidence before stopping, nested errors use outer IDs', async () => {
    const abort = new AbortController();
    const writes: ResponsesRunnerCheckpoint[] = [];
    const ledger = {
      runId: 'fixture',
      save(value: ResponsesRunnerCheckpoint) {
        writes.push(value);
      },
    };
    const first = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'record', parameters: {}, strict: false },
          execute() {
            abort.abort();
            return 'effect returned';
          },
        },
      ],
    });
    const h = harness([{ output: [wireCall('record', {})] }]);
    await expect(first.run(h.client, input, { ledger, signal: abort.signal })).rejects.toMatchObject({
      attemptedCallIds: ['call_record'],
      completedCallIds: ['call_record'],
    });
    expect(writes.slice(-1)).toMatchObject([
      {
        phase: 'pending',
        returned_outputs: [{ output: 'effect returned' }],
      },
    ]);
    const inner = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'inner', parameters: {}, strict: false },
          execute() {
            throw new Error('private');
          },
        },
      ],
    });
    const outer = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'record', parameters: {}, strict: false },
          async execute() {
            await inner.run(harness([{ output: [wireCall('inner', {})] }]).client, input);
            return 'unexpected';
          },
        },
      ],
    });
    const h2 = harness([{ output: [wireCall('record', {})] }]);
    await expect(outer.run(h2.client, input, { ledger })).rejects.toMatchObject({
      attemptedCallIds: ['call_record'],
      completedCallIds: [],
    });
    expect(writes.slice(-1)).toMatchObject([
      { phase: 'pending', attempted_call_ids: ['call_record'], returned_call_ids: [] },
    ]);
  });

  test.each([false, true])('the last allowed request never mutates (eager=%s)', async (eager) => {
    const execute = vi.fn(() => 'filed');
    const runner = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'record', parameters: {}, strict: false },
          execute,
        },
      ],
    });
    const writes: ResponsesRunnerCheckpoint[] = [];
    const ledger = {
      runId: 'fixture',
      save(value: ResponsesRunnerCheckpoint) {
        writes.push(value);
      },
    };
    const h = harness([{ output: [wireCall('record', {})] }]);
    await expect(runner.run(h.client, input, { stream: true, eager, maxSteps: 1, ledger })).rejects.toThrow(
      'maxSteps',
    );
    expect(execute).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(1);
    expect(writes.every((value) => value.attempted_call_ids.length === 0)).toBe(true);
  });
});

describe('ResponsesToolRunner iteration', () => {
  test.each([undefined, null, {}])(
    'accepts enabled result replacements after server-tool deferral (policy=%j)',
    async (earlyExecution) => {
      const execute = vi.fn(() => 'automatic');
      const runner = new ResponsesToolRunner({
        earlyExecution,
        functions: [
          {
            tool: { type: 'function', name: 'record', parameters: {}, strict: false },
            execute,
            allowOutputOverride: true,
          },
        ],
      });
      const h = harness([
        {
          output: [
            wireCall('record', {}),
            {
              type: 'web_search_call',
              id: 'search',
              status: 'completed',
              action: { type: 'search', query: 'fixture' },
            },
          ],
        },
        { output: [message] },
      ]);
      const turns = runner.iterate(
        h.client,
        { ...input, tools: [{ type: 'web_search' }] },
        {
          stream: true,
          eager: true,
        },
      );
      try {
        const first = await turns.next();
        if (first.done) {
          throw new Error('Missing deferred turn');
        }
        expect(first.value.attemptedCallIds).toEqual([]);
        expect(first.value.completedCallIds).toEqual([]);
        expect(execute).not.toHaveBeenCalled();
        expect(() =>
          first.value.supplyOutputs([{ type: 'function_call_output', call_id: 'search', output: 'bad' }]),
        ).toThrow();
        first.value.supplyOutputs([
          { type: 'function_call_output', call_id: 'call_record', output: 'human result' },
        ]);
        const last = await turns.next();
        expect(last.value).toMatchObject({ final: true, completedCallIds: ['call_record'] });
        expect(execute).not.toHaveBeenCalled();
        expect(h.bodies[1]?.['input']).toContainEqual({
          type: 'function_call_output',
          call_id: 'call_record',
          output: 'human result',
        });
        expect(() => first.value.supplyOutputs([])).toThrow();
      } finally {
        await turns.return();
      }
    },
  );

  test.each([false, true])(
    'yields before effects and for-await break closes the turn (stream=%s)',
    async (stream) => {
      const execute = vi.fn(() => 'ran');
      const runner = new ResponsesToolRunner({
        functions: [
          {
            tool: { type: 'function', name: 'record', parameters: {}, strict: false },
            execute,
            allowOutputOverride: true,
          },
        ],
      });
      const h = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
      let supply: ((values: []) => void) | undefined;
      for await (const turn of runner.iterate(h.client, input, { stream })) {
        expect(turn.step).toBe(1);
        expect(turn.final).toBe(false);
        expect(turn.toolsExecuted).toBe(false);
        expect(turn.attemptedCallIds).toEqual([]);
        expect(execute).not.toHaveBeenCalled();
        supply = turn.supplyOutputs;
        if (!turn.final) {
          break;
        }
      }
      expect(h.bodies).toHaveLength(1);
      expect(execute).not.toHaveBeenCalled();
      expect(() => supply?.([])).toThrow('does not accept');
    },
  );

  test('supplies permitted native results without changing call IDs, mixed order or pending arguments', async () => {
    const effects: string[] = [];
    const browser = new BrowserToolset(
      {
        state,
        click: ({ target }) => {
          effects.push(target);
        },
      },
      { confirm: () => true },
    );
    const execute = vi.fn(() => 'automatic');
    const runner = new ResponsesToolRunner({
      browser,
      functions: [
        {
          tool: { type: 'function', name: 'record', parameters: {}, strict: false },
          execute,
          allowOutputOverride: true,
        },
      ],
    });
    const h = harness([
      { output: [wireCall('record', {}), wireCall('browser_click', { target: 'original', tab_id: null })] },
      { output: [message] },
    ]);
    const iterator = runner.iterate(h.client, input);
    const first = await iterator.next();
    expect(first.done).toBe(false);
    if (first.done) {
      throw new Error('Missing turn');
    }
    const supplied = [
      {
        type: 'input_text' as const,
        text: 'human result',
        prompt_cache_breakpoint: { mode: 'explicit' as const },
      },
      {
        type: 'input_image' as const,
        image_url: 'https://fixture.invalid/image',
        detail: 'original' as const,
      },
      { type: 'input_file' as const, file_id: 'file_fixture' },
    ];
    first.value.supplyOutputs([{ type: 'function_call_output', call_id: 'call_record', output: supplied }]);
    const [text] = supplied;
    if (text?.type !== 'input_text') {
      throw new Error('Missing text output');
    }
    text.text = 'changed later';
    const [, pending] = first.value.response.output;
    if (pending?.type !== 'function_call') {
      throw new Error('Missing pending call');
    }
    pending.arguments = JSON.stringify({ target: 'retargeted', tab_id: null });
    pending.call_id = 'changed';
    const final = await iterator.next();
    expect(final.value).toMatchObject({
      step: 2,
      final: true,
      attemptedCallIds: ['call_record', 'call_browser_click'],
      completedCallIds: ['call_record', 'call_browser_click'],
    });
    expect(execute).not.toHaveBeenCalled();
    expect(effects).toEqual(['original']);
    expect(h.bodies[1]?.['input']).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_record',
      output: [
        { type: 'input_text', text: 'human result', prompt_cache_breakpoint: { mode: 'explicit' } },
        { type: 'input_image', image_url: 'https://fixture.invalid/image', detail: 'original' },
        { type: 'input_file', file_id: 'file_fixture' },
      ],
    });
    expect(JSON.stringify(h.bodies[1]?.['input'])).not.toContain('retargeted');
    expect(() => first.value.supplyOutputs([])).toThrow('does not accept');
    await iterator.return();
  });

  test.each(['executor', 'supplied'] as const)('rejects hidden output fields from %s', async (source) => {
    const block = Object.defineProperty(
      { type: 'input_image' as const, file_id: 'file_synthetic' },
      'image_url',
      { value: 'https://example.com/private-fixture', enumerable: false },
    );
    const execute = vi.fn(() => [block]);
    const runner = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'record', parameters: {}, strict: false },
          execute,
          allowOutputOverride: true,
        },
      ],
    });
    const h = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
    if (source === 'executor') {
      await expect(runner.run(h.client, input)).rejects.toBeInstanceOf(ResponsesToolRunnerError);
      expect(execute).toHaveBeenCalledTimes(1);
    } else {
      const iterator = runner.iterate(h.client, input);
      const first = await iterator.next();
      if (first.done) {
        throw new Error('Missing turn');
      }
      expect(() =>
        first.value.supplyOutputs([
          { type: 'function_call_output', call_id: 'call_record', output: [block] },
        ]),
      ).toThrow();
      await iterator.return();
      expect(execute).not.toHaveBeenCalled();
    }
    expect(h.bodies).toHaveLength(1);
  });

  test('rejects unpermitted, duplicate and malformed replacements atomically before effects', async () => {
    const execute = vi.fn(() => 'ran');
    const click = vi.fn();
    const browser = new BrowserToolset({ state, click }, { confirm: () => true });
    const runner = new ResponsesToolRunner({
      browser,
      functions: [
        {
          tool: { type: 'function', name: 'record', parameters: {}, strict: false },
          execute,
          allowOutputOverride: true,
        },
        { tool: { type: 'function', name: 'locked', parameters: {}, strict: false }, execute },
      ],
    });
    const h = harness([
      {
        output: [
          wireCall('record', {}),
          wireCall('locked', {}),
          wireCall('browser_click', { target: 'r1', tab_id: null }),
        ],
      },
    ]);
    const iterator = runner.iterate(h.client, input);
    const first = await iterator.next();
    if (first.done) {
      throw new Error('Missing turn');
    }
    const allowed = { type: 'function_call_output', call_id: 'call_record', output: 'safe' };
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    const getter = vi.fn(() => 'private');
    const accessor = Object.defineProperty(
      { type: 'function_call_output', call_id: 'call_record' },
      'output',
      { get: getter, enumerable: true },
    );
    const invalid = [
      [{ ...allowed, call_id: 'unknown' }],
      [{ ...allowed, call_id: 'call_locked' }],
      [{ ...allowed, call_id: 'call_browser_click' }],
      [allowed, allowed],
      [allowed, { ...allowed, call_id: 'unknown' }],
      [{ ...allowed, output: [{ type: 'input_text', text: 42 }] }],
      [{ ...allowed, output: [{ type: 'input_image', image_url: { private: true } }] }],
      [{ ...allowed, output: cyclic }],
      [{ ...allowed, toJSON: () => ({}) }],
      [accessor],
    ];
    for (const values of invalid) {
      // SAFETY: Malformed native outputs deliberately bypass types to verify rejection before effects.
      expect(() =>
        first.value.supplyOutputs(values as Parameters<typeof first.value.supplyOutputs>[0]),
      ).toThrow();
      expect(execute).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    }
    expect(getter).not.toHaveBeenCalled();
    await iterator.return();
  });

  test('eager receipts report prior execution and cannot replace results', async () => {
    const execute = vi.fn(() => 'automatic');
    const runner = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'record', parameters: {}, strict: false },
          execute,
          allowOutputOverride: true,
        },
      ],
    });
    const h = harness([{ output: [wireCall('record', {})] }]);
    const options = { stream: true, eager: true };
    const iterator = runner.iterate(h.client, input, options);
    const first = await iterator.next();
    if (first.done) {
      throw new Error('Missing turn');
    }
    expect(first.value).toMatchObject({
      toolsExecuted: true,
      attemptedCallIds: ['call_record'],
      completedCallIds: ['call_record'],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    options.eager = false;
    expect(() => first.value.supplyOutputs([])).toThrow('does not accept');
    await iterator.return();
    expect(h.bodies).toHaveLength(1);
  });

  test.each([false, true])(
    'eager lifecycle replacements stop with truthful effect receipts (tool=%s)',
    async (toolDone) => {
      const execute = vi.fn(() => 'automatic');
      const runner = new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
      });
      const item = wireCall('record', {});
      const h = harness([
        { output: toolDone ? [item] : [message], completedOutput: toolDone ? [message] : [item] },
        { output: [message] },
      ]);
      const iterator = runner.iterate(h.client, input, { stream: true, eager: true });
      await expect(iterator.next()).rejects.toMatchObject({
        attemptedCallIds: toolDone ? ['call_record'] : [],
        completedCallIds: toolDone ? ['call_record'] : [],
      });
      expect(execute).toHaveBeenCalledTimes(toolDone ? 1 : 0);
      expect(h.bodies).toHaveLength(1);
      await iterator.return();
    },
  );

  test('replacement sets are atomic, replace previous sets and snapshot registration permissions', async () => {
    const effects: string[] = [];
    const record = {
      tool: { type: 'function' as const, name: 'record', parameters: {}, strict: false },
      allowOutputOverride: true,
      execute: () => {
        effects.push('record');
        return 'automatic record';
      },
    };
    const other = {
      tool: { type: 'function' as const, name: 'other', parameters: {}, strict: false },
      allowOutputOverride: true,
      execute: () => {
        effects.push('other');
        return 'automatic other';
      },
    };
    const runner = new ResponsesToolRunner({ functions: [record, other] });
    record.allowOutputOverride = false;
    const h = harness([{ output: [wireCall('record', {}), wireCall('other', {})] }, { output: [message] }]);
    const iterator = runner.iterate(h.client, input);
    const first = await iterator.next();
    if (first.done) {
      throw new Error('Missing turn');
    }
    first.value.supplyOutputs([
      { type: 'function_call_output', call_id: 'call_record', output: 'old record' },
      { type: 'function_call_output', call_id: 'call_other', output: 'old other' },
    ]);
    first.value.supplyOutputs([]);
    first.value.supplyOutputs([{ type: 'function_call_output', call_id: 'call_record', output: 'current' }]);
    expect(() =>
      first.value.supplyOutputs([{ type: 'function_call_output', call_id: 'unknown', output: 'bad' }]),
    ).toThrow();
    await iterator.next();
    expect(effects).toEqual(['other']);
    expect(h.bodies[1]?.['input']).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_record',
      output: 'current',
    });
    expect(h.bodies[1]?.['input']).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_other',
      output: 'automatic other',
    });
    await iterator.return();
  });

  test('cancellation while paused prevents effects and another request', async () => {
    const execute = vi.fn(() => 'automatic');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const h = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
    const control = new AbortController();
    const iterator = runner.iterate(h.client, input, { signal: control.signal });
    const first = await iterator.next();
    if (first.done) {
      throw new Error('Missing turn');
    }
    control.abort();
    await expect(iterator.next()).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(1);
    expect(() => first.value.supplyOutputs([])).toThrow('does not accept');
  });

  test('computer results cannot bypass the native action and approval paths', async () => {
    const click = vi.fn();
    const approve = vi.fn(() => true);
    const screenshot = vi.fn(() => ({
      type: 'computer_screenshot' as const,
      image_url: 'data:image/png;base64,cG5n',
    }));
    const computer = new ComputerToolset({
      click,
      screenshot,
      double_click: vi.fn(),
      drag: vi.fn(),
      keypress: vi.fn(),
      move: vi.fn(),
      scroll: vi.fn(),
      type: vi.fn(),
      wait: vi.fn(),
    });
    const h = harness([
      {
        output: [
          {
            type: 'computer_call',
            id: 'native',
            call_id: 'native',
            status: 'completed',
            action: { type: 'click', x: 1, y: 2, button: 'left' },
            pending_safety_checks: [{ id: 'approval', code: 'malicious_instructions', message: 'Confirm' }],
          },
        ],
      },
      { output: [message] },
    ]);
    const iterator = new ResponsesToolRunner({ computer }).iterate(h.client, input, {
      computerOptions: { approveSafetyChecks: approve },
    });
    const first = await iterator.next();
    if (first.done) {
      throw new Error('Missing turn');
    }
    expect(() =>
      first.value.supplyOutputs([{ type: 'function_call_output', call_id: 'native', output: 'bypass' }]),
    ).toThrow();
    expect(click).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    await iterator.next();
    expect(approve).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(screenshot).toHaveBeenCalledTimes(1);
    await iterator.return();
  });

  test('closes the actual SDK stream before yielding a normal turn', async () => {
    const execute = vi.fn(() => 'automatic');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute }],
    });
    const h = harness([{ output: [wireCall('record', {})] }]);
    const stream = vi.spyOn(h.client.responses, 'stream');
    const iterator = runner.iterate(h.client, input, { stream: true });
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.results[0]?.value.controller.signal.aborted).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    await iterator.return();
    expect(h.bodies).toHaveLength(1);
  });

  test('run returns the original final response and retains ordinary executor receivers', async () => {
    const record = {
      tool: { type: 'function' as const, name: 'record', parameters: {}, strict: false },
      value: 'original receiver',
      execute() {
        return this.value;
      },
    };
    const h = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
    const create = vi.spyOn(h.client.responses, 'create');
    const result = await new ResponsesToolRunner({ functions: [record] }).run(h.client, input);
    expect(result).toBe(await create.mock.results[1]?.value);
    expect(h.bodies[1]?.['input']).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_record',
      output: 'original receiver',
    });
  });

  test('prepared ordinary executor keeps its identity and receiver while the turn is yielded', async () => {
    const record = {
      tool: { type: 'function' as const, name: 'record', parameters: {}, strict: false },
      value: 'original receiver',
      execute() {
        return this.value;
      },
    };
    const replacement = vi.fn(() => 'replacement');
    const h = harness([{ output: [wireCall('record', {})] }, { output: [message] }]);
    const iterator = new ResponsesToolRunner({ functions: [record] }).iterate(h.client, input);
    const first = await iterator.next();
    expect(first.done).toBe(false);
    record.execute = replacement;
    await iterator.next();
    await iterator.return();
    expect(replacement).not.toHaveBeenCalled();
    expect(h.bodies[1]?.['input']).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_record',
      output: 'original receiver',
    });
  });
});

describe('BrowserToolset', () => {
  test('selects fixed capabilities without reading excluded driver methods and snapshots the list', async () => {
    const readState = vi.fn(state);
    const selected: NonNullable<BrowserOptions['members']>[number][] = ['screenshot', 'get_page_text'];
    const browser = new BrowserToolset(
      {
        state: readState,
        get_page_text: () => 'Hello',
        screenshot: () => ({ type: 'input_image', image_url: 'data:image/png;base64,cG5n', detail: 'auto' }),
        get click(): never {
          throw new Error('Excluded method must not be read');
        },
      },
      { members: selected },
    );
    selected.splice(0, selected.length, 'click');
    expect(browser.tools().map((tool) => tool.name)).toEqual(['browser_get_page_text', 'browser_screenshot']);
    const result = await browser.execute(call('browser_get_page_text', { tab_id: null }));
    expect(result.output).toEqual([expect.objectContaining({ text: expect.stringContaining('"tabs":[') })]);
    readState.mockClear();
    await expect(browser.execute(call('browser_click', { target: 'r1', tab_id: null }))).rejects.toThrow(
      'registered',
    );
    await expect(browser.execute(call('browser_list_tabs', {}))).rejects.toThrow('registered');
    expect(readState).not.toHaveBeenCalled();
    expect(new BrowserToolset({ state }, { members: [] }).tools()).toEqual([]);
  });

  test('rejects invalid member selections before inspecting the driver', () => {
    const driver: BrowserDriver = {
      state,
      get navigate(): never {
        throw new Error('Driver must not be inspected');
      },
    };
    const sparse: unknown[] = [];
    sparse.length = 1;
    for (const members of ['click', ['click', 'click'], ['toString'], ['unknown'], [1], sparse]) {
      // SAFETY: Invalid caller values deliberately bypass static types to test runtime validation before driver access.
      expect(
        () => new BrowserToolset(driver, { members: members as NonNullable<BrowserOptions['members']> }),
      ).toThrow('unique fixed');
    }
    expect(() => new BrowserToolset({ state }, { members: ['click'] })).toThrow('not implemented');
  });
  test('partial drivers require consent only for exposed actions and reject duplicate runner functions', () => {
    const browser = new BrowserToolset({ state, get_page_text: () => 'Hello' });
    expect(browser.tools().map((tool) => tool.name)).toEqual(['browser_get_page_text', 'browser_list_tabs']);
    expect(() => new BrowserToolset({ state, click: () => 'ok' })).toThrow('confirm');
    expect(() => new BrowserToolset({ state, navigate: () => 'ok' }, { confirm: () => true })).toThrow(
      'urlPolicy',
    );
    expect(
      () =>
        new ResponsesToolRunner({
          browser,
          functions: [
            {
              tool: { type: 'function', name: 'browser_list_tabs', strict: false, parameters: {} },
              execute: () => '',
            },
          ],
        }),
    ).toThrow('unique');
  });

  test('validates exact keys and value types before any driver effects', async () => {
    const scroll = vi.fn(() => 'ok');
    const browser = new BrowserToolset({ state, scroll }, { confirm: () => true });
    for (const args of [
      { direction: 'down', amount: -1, tab_id: null },
      { direction: 'down', amount: 1.5, tab_id: null },
      { direction: 'sideways', amount: 1, tab_id: null },
      { direction: 'down', amount: 1 },
      { direction: 'down', amount: 1, tab_id: null, extra: true },
      { direction: 'down', amount: true, tab_id: null },
    ]) {
      // Invalid wire cases deliberately run serially against the same driver.
      // oxlint-disable-next-line no-await-in-loop
      const result = await browser.execute(call('browser_scroll', args));
      expect(result.output).toEqual([
        expect.objectContaining({ text: expect.stringContaining('"ok":false') }),
      ]);
    }
    expect(scroll).not.toHaveBeenCalled();
    await browser.execute(call('browser_scroll', { direction: 'down', amount: 0, tab_id: null }));
    expect(scroll).toHaveBeenCalledWith(
      { direction: 'down', amount: 0, tab_id: null },
      { signal: undefined },
    );
  });

  test('policy, URL checks and driver input use separate snapshots', async () => {
    const navigate = vi.fn(() => 'ok');
    const browser = new BrowserToolset(
      { state, navigate },
      {
        urlPolicy: (context, url) => {
          Object.assign(context.arguments, { url: 'https://unexpected.invalid' });
          return url === 'https://fixture.invalid/';
        },
        confirm: (context) => {
          Object.assign(context.arguments, { tab_id: 'other' });
          context.state.tabs.splice(0);
          return true;
        },
      },
    );
    await browser.execute(call('browser_navigate', { url: 'https://fixture.invalid/', tab_id: null }));
    expect(navigate).toHaveBeenCalledWith(
      { url: 'https://fixture.invalid/', tab_id: null },
      { signal: undefined },
    );
    const denied = await browser.execute(
      call('browser_navigate', { url: 'https://denied.invalid/', tab_id: null }),
    );
    expect(denied.output).toEqual([
      expect.objectContaining({ text: expect.stringContaining('URL policy declined') }),
    ]);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  test('execute snapshots the entire call before awaited state reporting', async () => {
    let release: (() => void) | undefined;
    // A controllable first state observation lets the caller mutate its original item in flight.
    // oxlint-disable-next-line avoid-new
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const click = vi.fn(() => 'ok');
    let count = 0;
    const browser = new BrowserToolset(
      {
        click,
        state: async () => {
          count += 1;
          if (count === 1) {
            await ready;
          }
          return state();
        },
      },
      { confirm: () => true },
    );
    const item = call('browser_click', { target: 'r1', tab_id: null });
    const pending = browser.execute(item);
    item.arguments = JSON.stringify({ target: 'attacker', tab_id: null });
    item.call_id = 'attacker';
    release?.();
    const result = await pending;
    expect(click).toHaveBeenCalledExactlyOnceWith({ target: 'r1', tab_id: null }, { signal: undefined });
    expect(result.call_id).toBe('call_browser_click');
  });

  test.each([
    ['null', null],
    ['missing tabs', {}],
    ['tabs must be an array', { tabs: null }],
    ['malformed tab', { tabs: [{ id: 'one', title: 'secret-state-value', url: 1, active: true }] }],
    ['active must be boolean', { tabs: [{ id: 'one', title: '', url: '', active: 'true' }] }],
    ['duplicate IDs', { tabs: [state().tabs[0], { ...state().tabs[0], active: false }] }],
    ['no active tab', { tabs: [{ ...state().tabs[0], active: false }] }],
    ['two active tabs', { tabs: [state().tabs[0], { ...state().tabs[0], id: 'two' }] }],
  ])('invalid %s state stops the actual runner initially or after an effect', async (_label, malformed) => {
    for (const at of ['before', 'after']) {
      let observations = 0;
      const click = vi.fn(() => 'ok');
      const browser = new BrowserToolset(
        {
          click,
          state: () => {
            observations += 1;
            // SAFETY: Fixtures intentionally simulate malformed browser integrations at the public driver boundary.
            return (at === 'before' || observations > 1 ? malformed : state()) as ReturnType<typeof state>;
          },
        },
        { confirm: () => true },
      );
      const h = harness([
        { output: [wireCall('browser_click', { target: 'r1', tab_id: null })] },
        { output: [message] },
      ]);
      // Observations intentionally run serially to distinguish before and after effect behavior.
      // oxlint-disable-next-line no-await-in-loop
      await expect(new ResponsesToolRunner({ browser }).run(h.client, input)).rejects.toMatchObject({
        attemptedCallIds: ['call_browser_click'],
        completedCallIds: [],
      });
      expect(click).toHaveBeenCalledTimes(at === 'before' ? 0 : 1);
      expect(h.bodies).toHaveLength(1);
      expect(JSON.stringify(h.bodies)).not.toContain('secret-state-value');
    }
  });

  test('captures only selected handler getters once and keeps the correct driver receiver', async () => {
    let reads = 0;
    const driver = {
      state,
      value: 'original',
      get get_page_text() {
        reads += 1;
        return function readPageText(this: { value: string }) {
          return this.value;
        };
      },
      get click(): never {
        throw new Error('Excluded getter must not run');
      },
    };
    const browser = new BrowserToolset(driver, { members: ['get_page_text'] });
    expect(reads).toBe(1);
    const result = await browser.execute(call('browser_get_page_text', { tab_id: null }));
    expect(reads).toBe(1);
    expect(JSON.stringify(result)).toContain('original');
  });

  test('read-only and built-in tabs do not inspect irrelevant policy callbacks', async () => {
    const options: BrowserOptions = {
      get confirm(): never {
        throw new Error('SYNTHETIC private session detail');
      },
      get urlPolicy(): never {
        throw new Error('SYNTHETIC private session detail');
      },
    };
    const browser = new BrowserToolset({ state, get_page_text: () => 'Hello' }, options);
    const h = harness([
      { output: [wireCall('browser_get_page_text', { tab_id: null }), wireCall('browser_list_tabs', {})] },
      { output: [message] },
    ]);
    const response = await new ResponsesToolRunner({ browser }).run(h.client, input);
    expect(response.output_text).toBe('done');
    expect(h.bodies).toHaveLength(2);
    expect(JSON.stringify(h.bodies[1]?.['input'])).toContain('Hello');
    expect(JSON.stringify(h.bodies)).not.toContain('SYNTHETIC private session detail');
  });

  test('skipped browser actions observe state without reading even a required mutation policy', async () => {
    let reads = 0;
    const click = vi.fn(() => 'ok');
    const options: BrowserOptions = {
      get confirm() {
        reads += 1;
        if (reads > 1) {
          throw new Error('SYNTHETIC private session detail');
        }
        return () => false;
      },
      get urlPolicy(): never {
        throw new Error('SYNTHETIC private session detail');
      },
    };
    const browser = new BrowserToolset({ state, click }, options);
    reads = 0;
    const h = harness([
      {
        output: [
          wireCall('browser_click', { target: 'denied', tab_id: null }, 'first'),
          wireCall('browser_click', { target: 'skipped', tab_id: null }, 'second'),
        ],
      },
      { output: [message] },
    ]);
    const response = await new ResponsesToolRunner({ browser }).run(h.client, input);
    expect(response.output_text).toBe('done');
    expect(reads).toBe(1);
    expect(click).not.toHaveBeenCalled();
    expect(JSON.stringify(h.bodies[1]?.['input'])).toContain('Skipped because');
  });

  test.each(
    [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].flatMap((counter) =>
      [1, 2, 3, 4].map((at) => ({ counter, at })),
    ),
  )(
    'V1 rejects an in-memory nonfinite counter $counter at read $at, including skipped calls',
    async ({ counter, at }) => {
      let reports = 0;
      const click = vi.fn(() => 'ok');
      const browser = new BrowserToolset(
        {
          state() {
            reports += 1;
            return {
              ...state(),
              observation: {
                version: 1,
                sequence: reports === at ? counter : 0,
                dropped_changes: 0,
                title_truncated: false,
                changes: [],
              },
            } satisfies BrowserState;
          },
          click,
        },
        { confirm: () => false },
      );
      const h = harness([
        {
          output: [
            wireCall('browser_click', { target: 'denied', tab_id: null }, 'first'),
            wireCall('browser_click', { target: 'skipped', tab_id: null }, 'second'),
          ],
        },
        { output: [message] },
      ]);
      await expect(new ResponsesToolRunner({ browser }).run(h.client, input)).rejects.toBeInstanceOf(
        ResponsesToolRunnerError,
      );
      expect(reports).toBe(at);
      expect(click).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );

  test.each(['confirm', 'urlPolicy'] as const)(
    'a relevant %s getter failure is sanitized before state or actions',
    async (name) => {
      const observation = vi.fn(state);
      const navigate = vi.fn(() => 'ok');
      const options: BrowserOptions = { confirm: () => true, urlPolicy: () => true };
      const browser = new BrowserToolset({ state: observation, navigate }, options);
      Object.defineProperty(options, name, {
        get() {
          throw new Error('SYNTHETIC private session detail');
        },
      });
      await expect(
        browser.execute(call('browser_navigate', { url: 'https://fixture.invalid/', tab_id: null })),
      ).rejects.toThrow('Browser operation failed.');
      expect(observation).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  test('already cancelled browser execution never reads state or policy accessors', async () => {
    const options: BrowserOptions = { confirm: () => true };
    const driver: BrowserDriver = { state, click: () => 'ok' };
    const browser = new BrowserToolset(driver, options);
    Object.defineProperty(driver, 'state', {
      get() {
        throw new Error('state accessor must not run');
      },
    });
    Object.defineProperty(options, 'confirm', {
      get() {
        throw new Error('confirm accessor must not run');
      },
    });
    const control = new AbortController();
    control.abort(new Error('already cancelled'));
    await expect(
      browser.execute(call('browser_click', { target: 'r1', tab_id: null }), { signal: control.signal }),
    ).rejects.toThrow('already cancelled');
  });

  test('snapshots handlers at selection and policies and state for each execution before waiting', async () => {
    const original = vi.fn(() => 'original');
    const injected = vi.fn(() => 'injected');
    const deny = vi.fn(() => false);
    let first = true;
    const options: BrowserOptions = { confirm: () => true, urlPolicy: () => true };
    const driver: BrowserDriver = {
      navigate: original,
      state: async () => {
        if (first) {
          first = false;
          await Promise.resolve();
          driver.navigate = injected;
          driver.state = () => {
            throw new Error('secret-state-value');
          };
          options.urlPolicy = deny;
          options.confirm = deny;
        }
        return state();
      },
    };
    const browser = new BrowserToolset(driver, options);
    const result = await browser.execute(
      call('browser_navigate', { url: 'https://fixture.invalid/', tab_id: null }),
    );
    expect(result.output).toEqual([expect.objectContaining({ text: expect.stringContaining('"ok":true') })]);
    expect(original).toHaveBeenCalledExactlyOnceWith(
      { url: 'https://fixture.invalid/', tab_id: null },
      { signal: undefined },
    );
    expect(injected).not.toHaveBeenCalled();
    expect(deny).not.toHaveBeenCalled();
    driver.state = state;
    const refused = await browser.execute(
      call('browser_navigate', { url: 'https://fixture.invalid/', tab_id: null }),
    );
    expect(JSON.stringify(refused)).toContain('URL policy declined');
    expect(deny).toHaveBeenCalledOnce();
    expect(original).toHaveBeenCalledOnce();
  });

  test('a state getter cannot change the consent policy of a call that already started', async () => {
    const click = vi.fn(() => 'ok');
    const options: BrowserOptions = { confirm: () => false };
    const driver: BrowserDriver = {
      click,
      get state() {
        options.confirm = () => true;
        return state;
      },
    };
    const browser = new BrowserToolset(driver, options);
    const request = call('browser_click', { target: 'r1', tab_id: null });
    const refused = await browser.execute(request);
    expect(refused.output).toEqual([
      expect.objectContaining({ text: expect.stringContaining('Action declined') }),
    ]);
    expect(click).not.toHaveBeenCalled();
    const allowed = await browser.execute(request);
    expect(allowed.output).toEqual([expect.objectContaining({ text: expect.stringContaining('"ok":true') })]);
    expect(click).toHaveBeenCalledExactlyOnceWith({ target: 'r1', tab_id: null }, { signal: undefined });
  });

  test('an awaited URL policy cannot replace confirmation or the selected handler for its call', async () => {
    const original = vi.fn(() => 'original');
    const injected = vi.fn(() => 'injected');
    const deny = vi.fn(() => false);
    const driver: BrowserDriver = { state, navigate: original };
    const options: BrowserOptions = {
      confirm: () => true,
      urlPolicy: async () => {
        await Promise.resolve();
        options.confirm = deny;
        driver.navigate = injected;
        return true;
      },
    };
    const browser = new BrowserToolset(driver, options);
    const request = call('browser_navigate', { url: 'https://fixture.invalid/', tab_id: null });
    const result = await browser.execute(request);
    expect(result.output).toEqual([expect.objectContaining({ text: expect.stringContaining('"ok":true') })]);
    expect(original).toHaveBeenCalledOnce();
    expect(injected).not.toHaveBeenCalled();
    expect(deny).not.toHaveBeenCalled();
    expect(JSON.stringify(await browser.execute(request))).toContain('Action declined');
    expect(deny).toHaveBeenCalledOnce();
  });

  test('controlled errors only; state failures stop execution instead of inventing state', async () => {
    const secret = 'private fixture debug value';
    let controlled = false;
    const driver: BrowserDriver = {
      state,
      click: () => {
        if (controlled) {
          throw new BrowserError('Element is stale. Read the page again.');
        }
        throw new Error(secret);
      },
    };
    const browser = new BrowserToolset(driver, { confirm: () => true });
    const invoke = () => browser.execute(call('browser_click', { target: 'r1', tab_id: null }));
    expect(JSON.stringify(await invoke())).not.toContain(secret);
    controlled = true;
    expect(JSON.stringify(await invoke())).toContain('Element is stale');
    driver.state = () => {
      throw new Error('fixture unavailable');
    };
    await expect(invoke()).rejects.toThrow('Browser state report failed');
  });
});

describe('ResponsesToolRunner', () => {
  test.each([false, true])(
    'replays native browser image, normal function and reasoning (stream=%s)',
    async (stream) => {
      const performed: string[] = [];
      const browser = new BrowserToolset(
        {
          state,
          read_page: () => {
            performed.push('read');
            return 'r1: Name';
          },
          type: ({ text }) => {
            performed.push(text);
            return 'ok';
          },
          screenshot: () => ({
            type: 'input_image',
            detail: 'auto',
            image_url: 'data:image/png;base64,fixture',
          }),
        },
        { confirm: () => true },
      );
      const runner = new ResponsesToolRunner({
        browser,
        functions: [
          {
            tool: { type: 'function', name: 'record', parameters: {}, strict: false },
            execute: (args) => {
              performed.push(String(args['value']));
              return 'recorded';
            },
          },
        ],
      });
      const h = harness([
        {
          output: [
            {
              id: 'rs_fixture',
              type: 'reasoning',
              summary: [],
              encrypted_content: 'fixture-reasoning',
            },
            wireCall('browser_read_page', { tab_id: null, filter: 'interactive' }),
            wireCall('browser_type', { target: 'r1', text: 'Ada', tab_id: null }),
            wireCall('record', { value: 'confirmation' }),
            wireCall('browser_screenshot', { tab_id: null }),
          ],
        },
        { output: [message] },
      ]);
      const observed: string[] = [];
      const result = await runner.run(h.client, input, {
        stream,
        onEvent: (event) => {
          observed.push(event.type);
        },
      });
      expect(result.output_text).toBe('done');
      expect(performed).toEqual(['read', 'Ada', 'confirmation']);
      expect(h.bodies[1]?.['input']).toContainEqual({
        type: 'function_call_output',
        call_id: 'call_browser_screenshot',
        output: [
          {
            type: 'input_text',
            text: JSON.stringify({
              ok: true,
              state: {
                tabs: [{ id: 'one', title: 'Fixture', url: 'https://fixture.invalid', active: true }],
              },
            }),
          },
          { type: 'input_image', detail: 'auto', image_url: 'data:image/png;base64,fixture' },
        ],
      });
      expect(JSON.stringify(h.bodies[1]?.['input'])).not.toContain('created_by');
      expect(h.bodies[0]?.['include']).toEqual(['reasoning.encrypted_content']);
      expect(observed.includes('response.output_item.done')).toBe(stream);
    },
  );

  test('refused action has no effect, later browser calls are skipped but functions run and next turn replans', async () => {
    const effects: string[] = [];
    const browser = new BrowserToolset(
      {
        state,
        click: ({ target }) => {
          effects.push(target);
          return 'ok';
        },
      },
      {
        confirm: ({ arguments: args }) => args['target'] !== 'forbidden',
      },
    );
    const runner = new ResponsesToolRunner({
      browser,
      functions: [
        {
          tool: { type: 'function', name: 'record', strict: false, parameters: {} },
          execute: () => {
            effects.push('record');
            return 'ok';
          },
        },
      ],
    });
    const h = harness([
      {
        output: [
          wireCall('browser_click', { target: 'forbidden', tab_id: null }, 'denied'),
          wireCall('browser_click', { target: 'skip', tab_id: null }, 'skipped'),
          wireCall('record', {}),
        ],
      },
      { output: [wireCall('browser_click', { target: 'safe', tab_id: null }, 'safe')] },
      { output: [message] },
    ]);
    await runner.run(h.client, input);
    expect(effects).toEqual(['record', 'safe']);
    expect(JSON.stringify(h.bodies[1]?.['input'])).toContain('Action declined');
    expect(JSON.stringify(h.bodies[1]?.['input'])).toContain('Skipped because');
  });

  test.each(['inherited', 'nonenumerable'] as const)(
    'mixed runner preserves the original %s computer policy',
    async (kind) => {
      const effect = vi.fn();
      const computer = new ComputerToolset({
        click: effect,
        double_click: effect,
        drag: effect,
        keypress: effect,
        move: effect,
        scroll: effect,
        type: effect,
        wait: effect,
        screenshot: () => ({ type: 'computer_screenshot', file_id: 'file_fixture' }),
      });
      const item: ResponseOutputItem = {
        type: 'computer_call',
        id: 'cu_one',
        call_id: 'native_one',
        status: 'completed',
        pending_safety_checks: [{ id: 'pending' }],
        actions: [{ type: 'wait' }],
      };
      const calls: string[] = [];
      const policy: ComputerExecutionOptions & { label: string } = { label: 'original' };
      const methods = {
        approveSafetyChecks(this: typeof policy) {
          calls.push(`${this.label}: safety`);
          return true;
        },
        beforeAction(this: typeof policy) {
          calls.push(`${this.label}: action`);
          return false;
        },
      };
      if (kind === 'inherited') {
        Object.setPrototypeOf(policy, methods);
      } else {
        Object.defineProperties(policy, {
          approveSafetyChecks: { value: methods.approveSafetyChecks },
          beforeAction: { value: methods.beforeAction },
        });
      }
      const env = harness([{ output: [item] }]);
      await expect(
        new ResponsesToolRunner({ computer }).run(env.client, input, {
          computerOptions: policy,
          stream: true,
          eager: true,
        }),
      ).rejects.toMatchObject({ attemptedCallIds: ['native_one'], completedCallIds: [] });
      expect(calls).toEqual(['original: safety', 'original: action']);
      expect(effect).not.toHaveBeenCalled();
      expect(env.bodies).toHaveLength(1);
    },
  );

  test('native computer actions keep safety approvals and are never turned into function errors', async () => {
    const effects = vi.fn();
    const computer = new ComputerToolset({
      click: effects,
      double_click: effects,
      drag: effects,
      keypress: effects,
      move: effects,
      scroll: effects,
      type: effects,
      wait: effects,
      screenshot: () => ({ type: 'computer_screenshot', file_id: 'file_fixture' }),
    });
    const item: ResponseOutputItem = {
      type: 'computer_call',
      id: 'cu_one',
      call_id: 'native_one',
      status: 'completed',
      pending_safety_checks: [{ id: 'pending' }],
      actions: [{ type: 'wait' }],
    };
    const runner = new ResponsesToolRunner({ computer });
    const denied = harness([{ output: [item] }]);
    await expect(runner.run(denied.client, input)).rejects.toMatchObject({
      attemptedCallIds: ['native_one'],
      completedCallIds: [],
    });
    expect(effects).not.toHaveBeenCalled();
    const allowed = harness([{ output: [item] }, { output: [message] }]);
    await runner.run(allowed.client, input, { computerOptions: { approveSafetyChecks: () => true } });
    expect(effects).toHaveBeenCalledTimes(1);
    expect(allowed.bodies[1]?.['input']).toContainEqual({
      type: 'computer_call_output',
      call_id: 'native_one',
      output: { type: 'computer_screenshot', file_id: 'file_fixture' },
      acknowledged_safety_checks: [{ id: 'pending' }],
    });
  });

  test('mixed runner accepts a modern native call without checks, then runs ordinary functions', async () => {
    const effect = vi.fn();
    const computer = new ComputerToolset({
      click: effect,
      double_click: effect,
      drag: effect,
      keypress: effect,
      move: effect,
      scroll: effect,
      type: effect,
      wait: effect,
      screenshot: () => ({ type: 'computer_screenshot', file_id: 'file_fixture' }),
    });
    const record = vi.fn(() => 'recorded');
    // SAFETY: An observed modern Responses wire call omits pending_safety_checks, unlike the generated type.
    const modern = {
      type: 'computer_call',
      id: 'cu_one',
      call_id: 'native_one',
      status: 'completed',
      actions: [{ type: 'screenshot' }],
    } as ResponseOutputItem;
    const h = harness([{ output: [modern, wireCall('record', {})] }, { output: [message] }]);
    const runner = new ResponsesToolRunner({
      computer,
      functions: [
        { tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute: record },
      ],
    });
    const result = await runner.run(h.client, input);
    expect(result.output_text).toBe('done');
    expect(record).toHaveBeenCalledExactlyOnceWith({});
    expect(h.bodies[1]?.['input']).toContainEqual({
      type: 'computer_call_output',
      call_id: 'native_one',
      output: { type: 'computer_screenshot', file_id: 'file_fixture' },
    });
  });

  test('mixed runner preflights all native checklists before executing a valid earlier call', async () => {
    const effect = vi.fn();
    const screenshot = vi.fn(() => ({ type: 'computer_screenshot' as const, file_id: 'file_fixture' }));
    const computer = new ComputerToolset({
      click: effect,
      double_click: effect,
      drag: effect,
      keypress: effect,
      move: effect,
      scroll: effect,
      type: effect,
      wait: effect,
      screenshot,
    });
    // SAFETY: The observed modern wire shape omits checks despite the generated type requiring them.
    const first = {
      type: 'computer_call',
      id: 'cu_one',
      call_id: 'native_one',
      status: 'completed',
      actions: [{ type: 'wait' }],
    } as Extract<ResponseOutputItem, { type: 'computer_call' }>;
    const malformed = { ...first, id: 'cu_two', call_id: 'native_two' };
    // Model an explicitly malformed wire property; it must be rejected before the earlier valid call.
    Object.defineProperty(malformed, 'pending_safety_checks', { value: null, enumerable: true });
    const output = [first, malformed];
    const h = harness([{ output }]);
    await expect(new ResponsesToolRunner({ computer }).run(h.client, input)).rejects.toMatchObject({
      attemptedCallIds: [],
      completedCallIds: [],
    });
    expect(effect).not.toHaveBeenCalled();
    expect(screenshot).not.toHaveBeenCalled();
  });

  test.each([
    { kind: 'inherited', eager: false },
    { kind: 'nonenumerable', eager: false },
    { kind: 'inherited', eager: true },
    { kind: 'nonenumerable', eager: true },
  ])(
    'mixed runner refuses $kind checks before cloning its API result, eager=$eager',
    async ({ kind, eager }) => {
      const effect = vi.fn();
      const screenshot = vi.fn(() => ({ type: 'computer_screenshot' as const, file_id: 'file_fixture' }));
      const computer = new ComputerToolset({
        click: effect,
        double_click: effect,
        drag: effect,
        keypress: effect,
        move: effect,
        scroll: effect,
        type: effect,
        wait: effect,
        screenshot,
      });
      const wire = {
        type: 'computer_call',
        id: 'cu_one',
        call_id: 'native_one',
        status: 'completed',
        actions: [{ type: 'wait' }],
      };
      const pending = [{ id: 'requires_approval' }];
      const item =
        kind === 'inherited'
          ? Object.assign(Object.create({ pending_safety_checks: pending }), wire)
          : Object.defineProperty(wire, 'pending_safety_checks', { value: pending, enumerable: false });
      const { client } = harness([]);
      const response = { status: 'completed', output: [item] };
      // An SDK subclass or wrapper can supply richer response objects than the JSON transport.
      Object.defineProperty(client.responses, 'create', { value: async () => response });
      Object.defineProperty(client.responses, 'stream', {
        value: () => ({
          async *[Symbol.asyncIterator]() {
            yield { type: 'response.output_item.done', output_index: 0, item };
          },
          async finalResponse() {
            return response;
          },
          abort() {},
        }),
      });
      await expect(
        new ResponsesToolRunner({ computer }).run(client, input, { stream: eager, eager }),
      ).rejects.toMatchObject({ attemptedCallIds: [], completedCallIds: [] });
      expect(effect).not.toHaveBeenCalled();
      expect(screenshot).not.toHaveBeenCalled();
    },
  );

  test('uses native computerOptions.signal when no runner signal overrides it', async () => {
    const controller = new AbortController();
    controller.abort();
    const effect = vi.fn();
    const computer = new ComputerToolset({
      click: effect,
      double_click: effect,
      drag: effect,
      keypress: effect,
      move: effect,
      scroll: effect,
      type: effect,
      wait: effect,
      screenshot: () => ({ type: 'computer_screenshot', file_id: 'file_fixture' }),
    });
    const h = harness([
      {
        output: [
          {
            type: 'computer_call',
            id: 'cu_one',
            call_id: 'native_one',
            status: 'completed',
            pending_safety_checks: [],
            actions: [{ type: 'wait' }],
          },
        ],
      },
    ]);
    await expect(
      new ResponsesToolRunner({ computer }).run(h.client, input, {
        computerOptions: { signal: controller.signal },
      }),
    ).rejects.toMatchObject({ attemptedCallIds: [], completedCallIds: [] });
    expect(h.bodies).toEqual([]);
    expect(effect).not.toHaveBeenCalled();
  });

  test('invalid first eager computer completion persists nonresumable ledger without unsafe data', async () => {
    const effect = vi.fn();
    const screenshot = vi.fn(() => ({ type: 'computer_screenshot' as const, file_id: 'file_fixture' }));
    const computer = new ComputerToolset({
      click: effect,
      double_click: effect,
      drag: effect,
      keypress: effect,
      move: effect,
      scroll: effect,
      type: effect,
      wait: effect,
      screenshot,
    });
    const first: Extract<ResponseOutputItem, { type: 'computer_call' }> = {
      type: 'computer_call',
      id: 'cu_one',
      call_id: 'native_one',
      status: 'completed',
      pending_safety_checks: [],
      actions: [{ type: 'wait' }],
    };
    // Model an explicitly invalid JSON safety-check property as it arrives on the wire.
    Reflect.set(first, 'pending_safety_checks', null);
    const runner = new ResponsesToolRunner({ computer });
    const h = harness([{ output: [first] }]);
    const { writes, ledger } = recording();
    await expect(runner.run(h.client, input, { stream: true, eager: true, ledger })).rejects.toMatchObject({
      attemptedCallIds: [],
      completedCallIds: [],
    });
    expect(effect).not.toHaveBeenCalled();
    expect(screenshot).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(1);
    const [saved] = writes.slice(-1);
    expect(saved).toMatchObject({
      phase: 'pending',
      consumed_requests: 1,
      pending_items: [],
      returned_outputs: [],
      attempted_call_ids: [],
      returned_call_ids: [],
    });
    if (!saved) {
      throw new Error('Expected a persisted pending ledger');
    }
    const restored = harness([]);
    await expect(
      runner.run(
        restored.client,
        { ...input, input: 'Fresh observed state' },
        {
          stream: true,
          eager: true,
          ledger: { ...ledger, resumeFrom: saved },
        },
      ),
    ).rejects.toThrow('Invalid or unresolved ledger boundary');
    expect(restored.bodies).toHaveLength(0);
    expect(effect).not.toHaveBeenCalled();
  });

  test('failed server output before malformed computer keeps the non-eager ledger pending', async () => {
    const effect = vi.fn();
    const screenshot = vi.fn(() => ({ type: 'computer_screenshot' as const, file_id: 'file_fixture' }));
    const computer = new ComputerToolset({
      click: effect,
      double_click: effect,
      drag: effect,
      keypress: effect,
      move: effect,
      scroll: effect,
      type: effect,
      wait: effect,
      screenshot,
    });
    const malformed: Extract<ResponseOutputItem, { type: 'computer_call' }> = {
      type: 'computer_call',
      id: 'cu_bad',
      call_id: 'native_bad',
      status: 'completed',
      pending_safety_checks: [],
      actions: [{ type: 'wait' }],
    };
    Reflect.set(malformed, 'pending_safety_checks', null);
    const failed: ResponseOutputItem = {
      type: 'mcp_list_tools',
      id: 'mcp_failed',
      server_label: 'desk',
      tools: [],
      error: '',
    };
    const runner = new ResponsesToolRunner({ computer });
    const h = harness([{ output: [failed, malformed] }]);
    const { writes, ledger } = recording();
    const params: ResponseCreateParamsNonStreaming = {
      ...input,
      tools: [{ type: 'mcp', server_label: 'desk', server_url: 'https://fixture.invalid/mcp' }],
    };
    await expect(runner.run(h.client, params, { ledger })).rejects.toMatchObject({
      attemptedCallIds: [],
      completedCallIds: [],
    });
    expect(h.bodies).toHaveLength(1);
    expect(effect).not.toHaveBeenCalled();
    expect(screenshot).not.toHaveBeenCalled();
    const [saved] = writes.slice(-1);
    expect(saved).toMatchObject({ phase: 'pending', pending_items: [], returned_call_ids: [] });
    if (!saved) {
      throw new Error('Expected a persisted pending ledger');
    }
    const restored = harness([]);
    await expect(
      runner.run(
        restored.client,
        { ...params, input: 'Fresh observed state' },
        {
          ledger: { ...ledger, resumeFrom: saved },
        },
      ),
    ).rejects.toThrow('Invalid or unresolved ledger boundary');
    expect(restored.bodies).toHaveLength(0);
  });

  test.each([false, true])('interrupted stream records early calls only if eager (%s)', async (eager) => {
    const click = vi.fn(() => 'ok');
    const browser = new BrowserToolset({ state, click }, { confirm: () => true });
    const h = harness([
      { output: [wireCall('browser_click', { target: 'r1', tab_id: null })], interrupt: true },
    ]);
    await expect(
      new ResponsesToolRunner({ browser }).run(h.client, input, { stream: true, eager }),
    ).rejects.toMatchObject({
      attemptedCallIds: eager ? ['call_browser_click'] : [],
      completedCallIds: eager ? ['call_browser_click'] : [],
    });
    expect(click).toHaveBeenCalledTimes(eager ? 1 : 0);
    expect(h.bodies).toHaveLength(1);
  });

  test('eager runs exactly once and ignores callback mutation of completed items', async () => {
    const click = vi.fn(() => 'ok');
    const browser = new BrowserToolset({ state, click }, { confirm: () => true });
    const h = harness([
      { output: [wireCall('browser_click', { target: 'r1', tab_id: null })] },
      { output: [message] },
    ]);
    await new ResponsesToolRunner({ browser }).run(h.client, input, {
      stream: true,
      eager: true,
      onEvent: (event) => {
        if (event.type === 'response.output_item.done' && event.item.type === 'function_call') {
          event.item.arguments = '{"target":"unexpected","tab_id":null}';
        }
      },
    });
    expect(click).toHaveBeenCalledExactlyOnceWith({ target: 'r1', tab_id: null }, { signal: undefined });
  });

  test.each([{ stream: false }, { stream: true }, { stream: true, eager: true }])(
    'no effects at final request limit %o',
    async (options) => {
      const click = vi.fn(() => 'ok');
      const browser = new BrowserToolset({ state, click }, { confirm: () => true });
      const h = harness([{ output: [wireCall('browser_click', { target: 'r1', tab_id: null })] }]);
      await expect(
        new ResponsesToolRunner({ browser }).run(h.client, input, { ...options, maxSteps: 1 }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('maxSteps'),
        attemptedCallIds: [],
        completedCallIds: [],
      });
      expect(click).not.toHaveBeenCalled();
    },
  );

  test('unknown client calls preflight before any effects when the completed response is available', async () => {
    const click = vi.fn(() => 'ok');
    const browser = new BrowserToolset({ state, click }, { confirm: () => true });
    const h = harness([
      { output: [wireCall('browser_click', { target: 'r1', tab_id: null }), wireCall('unregistered', {})] },
    ]);
    await expect(new ResponsesToolRunner({ browser }).run(h.client, input)).rejects.toMatchObject({
      attemptedCallIds: [],
      completedCallIds: [],
    });
    expect(click).not.toHaveBeenCalled();
  });

  test('disabled browser calls preflight before earlier ordinary function effects', async () => {
    const effect = vi.fn(() => 'ok');
    const browser = new BrowserToolset({ state, click: effect }, { members: [] });
    const h = harness([
      { output: [wireCall('record', {}), wireCall('browser_click', { target: 'r1', tab_id: null })] },
    ]);
    const runner = new ResponsesToolRunner({
      browser,
      functions: [
        { tool: { type: 'function', name: 'record', strict: false, parameters: {} }, execute: effect },
      ],
    });
    await expect(runner.run(h.client, input)).rejects.toMatchObject({
      attemptedCallIds: [],
      completedCallIds: [],
    });
    expect(effect).not.toHaveBeenCalled();
  });

  test.each([
    { name: 'ordinary error', failure: () => new Error('private payload') },
    {
      name: 'foreign runner error',
      failure: () => new ResponsesToolRunnerError('private payload', ['forged'], ['forged']),
    },
    { name: 'spoofed step limit', failure: () => new OpenAIError('ResponsesToolRunner reached maxSteps.') },
  ])('mutate then throw keeps $name private and stops later actions', async ({ failure }) => {
    const effects: string[] = [];
    const h = harness([{ output: [wireCall('effect', {}), wireCall('effect', {}, 'later')] }]);
    const runner = new ResponsesToolRunner({
      functions: [
        {
          tool: { type: 'function', name: 'effect', strict: false, parameters: {} },
          execute: () => {
            effects.push('effect');
            throw failure();
          },
        },
      ],
    });
    try {
      await runner.run(h.client, input);
      expect.fail('Must stop on failed function');
    } catch (error) {
      expect(error).toBeInstanceOf(ResponsesToolRunnerError);
      expect(error).toMatchObject({ attemptedCallIds: ['call_effect'], completedCallIds: [] });
      expect(error).toMatchObject({
        message:
          'ResponsesToolRunner stopped. Inspect attemptedCallIds and completedCallIds before retrying.',
      });
      expect(error).not.toHaveProperty('cause');
      expect(String(error)).not.toContain('private payload');
    }
    expect(effects).toEqual(['effect']);
  });

  test('late cancellation blocks later actions and reports in-flight attempts', async () => {
    const controller = new AbortController();
    const effects: string[] = [];
    const browser = new BrowserToolset(
      {
        state,
        click: ({ target }) => {
          effects.push(target);
          controller.abort();
          return 'ok';
        },
      },
      { confirm: () => true },
    );
    const h = harness([
      {
        output: [
          wireCall('browser_click', { target: 'first', tab_id: null }, 'first'),
          wireCall('browser_click', { target: 'later', tab_id: null }, 'later'),
        ],
      },
    ]);
    await expect(
      new ResponsesToolRunner({ browser }).run(h.client, input, { signal: controller.signal }),
    ).rejects.toMatchObject({ attemptedCallIds: ['call_first'], completedCallIds: [] });
    expect(effects).toEqual(['first']);
  });
});

test.each([false, true])('eager reconciliation permits optional ID enrichment (ledger=%s)', async (saved) => {
  const tool = { type: 'function' as const, name: 'record', parameters: {}, strict: false };
  const { id: _id, ...early } = call('record', { value: 'original' });
  const completed = { ...early, id: 'item_assigned_later' };
  const execute = vi.fn(() => 'saved once');
  const runner = new ResponsesToolRunner({ functions: [{ tool, execute }] });
  const h = harness([{ output: [early], completedOutput: [completed] }, { output: [message] }]);
  const options = { stream: true, eager: true, ...(saved ? { ledger: recording().ledger } : {}) };
  const result = await runner.run(h.client, input, options);
  expect(result.output_text).toBe('done');
  expect(execute).toHaveBeenCalledExactlyOnceWith({ value: 'original' });
  expect(h.bodies[1]?.['input']).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call',
        id: 'item_assigned_later',
        call_id: early.call_id,
      }),
      { type: 'function_call_output', call_id: early.call_id, output: 'saved once' },
    ]),
  );
});

describe.each(['ledger', 'budget'] as const)('replay call IDs with %s', (mode) => {
  test.each([
    { kind: 'function', missing: 'call' },
    { kind: 'function', missing: 'output' },
    { kind: 'function', missing: 'none' },
    { kind: 'computer', missing: 'call' },
    { kind: 'computer', missing: 'output' },
    { kind: 'computer', missing: 'none' },
  ])('$kind history with $missing ID missing', async ({ kind, missing }) => {
    const effect = vi.fn();
    const computer = new ComputerToolset({
      click: effect,
      double_click: effect,
      drag: effect,
      keypress: effect,
      move: effect,
      scroll: effect,
      type: effect,
      wait: effect,
      screenshot: () => ({ type: 'computer_screenshot', file_id: 'file_fixture' }),
    });
    const history: [ResponseInputItem, ResponseInputItem] =
      kind === 'function'
        ? [call('record', {}), { type: 'function_call_output', call_id: 'call_record', output: 'saved' }]
        : [
            {
              type: 'computer_call',
              id: 'computer_item',
              call_id: 'computer_call',
              status: 'completed',
              pending_safety_checks: [],
              actions: [{ type: 'wait' }],
            },
            {
              type: 'computer_call_output',
              call_id: 'computer_call',
              output: { type: 'computer_screenshot', file_id: 'file_fixture' },
            },
          ];
    if (missing !== 'none') {
      Reflect.deleteProperty(history[missing === 'call' ? 0 : 1], 'call_id');
    }
    const runner = new ResponsesToolRunner({
      computer,
      functions: [
        { tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute: effect },
      ],
    });
    const h = harness([{ output: [message] }]);
    const save = vi.fn();
    const result = runner.run(
      h.client,
      { ...input, input: history },
      mode === 'ledger'
        ? { ledger: { runId: 'replay-identity', save } }
        : { contextBudget: { maxInputBytes: 10_000, maxInputImages: 1 } },
    );
    if (missing === 'none') {
      await expect(result).resolves.toHaveProperty('output_text', 'done');
      expect(h.bodies).toHaveLength(1);
      expect(h.bodies[0]?.['input']).toEqual(history);
    } else {
      await expect(result).rejects.toBeInstanceOf(Error);
      expect(h.bodies).toHaveLength(0);
      expect(save).not.toHaveBeenCalled();
    }
    expect(effect).not.toHaveBeenCalled();
  });
});

describe('fresh local and observation replay', () => {
  const variants: ResponseOutputItem[] = [
    wireCall('record', {}, 'first'),
    contextNative('first'),
    { type: 'reasoning', id: 'reasoning', summary: [] },
    { ...message, id: 'first_message' },
    { type: 'compaction', id: 'compact', encrypted_content: 'opaque' },
  ];

  test.each(
    variants.flatMap((item) =>
      ['scalar', 'nested', 'json', 'created_by'].map((extension) => ({ item, extension })),
    ),
  )('preflights nonserver $item.type with $extension extras before effects', async ({ item, extension }) => {
    const env = harness([{ output: [item, wireCall('record', {}, 'second')] }, { output: [message] }]);
    const create = env.client.responses.create.bind(env.client.responses);
    vi.spyOn(env.client.responses, 'create').mockImplementation((params, options) =>
      create(params, options)._thenUnwrap((response) => {
        if ('output' in response) {
          const returned = response.output.find((entry) => entry.id === item.id);
          if (returned) {
            let value: bigint | { value: number | bigint } = { value: 1n };
            if (extension === 'json') {
              value = { value: 1 };
            } else if (extension === 'scalar') {
              value = 1n;
            }
            Reflect.set(returned, extension === 'created_by' ? 'created_by' : 'extension', value);
          }
        }
        return response;
      }),
    );
    const execute = vi.fn(() => 'recorded');
    const screenshot = vi.fn(() => ({
      type: 'computer_screenshot' as const,
      image_url: 'data:image/png;base64,AAAA',
    }));
    const runner = new ResponsesToolRunner({
      computer: new ComputerToolset({ ...nativeActions, screenshot }),
      functions: [{ tool: functionTool('record'), execute }],
    });
    const result = runner.run(env.client, input);
    if (extension === 'scalar' || extension === 'nested') {
      await expect(result).rejects.toBeInstanceOf(ResponsesToolRunnerError);
      expect(execute).not.toHaveBeenCalled();
      expect(screenshot).not.toHaveBeenCalled();
      expect(env.bodies).toHaveLength(1);
    } else {
      await expect(result).resolves.toHaveProperty('output_text', 'done');
      expect(execute).toHaveBeenCalledTimes(item.type === 'function_call' ? 2 : 1);
      expect(screenshot).toHaveBeenCalledTimes(item.type === 'computer_call' ? 1 : 0);
      expect(env.bodies[1]?.['input']).toContainEqual({
        ...item,
        ...(extension === 'json' ? { extension: { value: 1 } } : {}),
      });
    }
  });

  test.each(['function', 'message'])(
    'omits SDK parsed %s metadata before replay validation',
    async (kind) => {
      const item =
        kind === 'function' ? wireCall('record', {}, 'first') : { ...message, id: 'first_message' };
      const env = harness([{ output: [item, wireCall('record', {}, 'second')] }, { output: [message] }]);
      const create = env.client.responses.create.bind(env.client.responses);
      vi.spyOn(env.client.responses, 'create').mockImplementation((params, options) =>
        create(params, options)._thenUnwrap((response) => {
          if ('output' in response) {
            const returned = response.output.find((entry) => entry.id === item.id);
            if (returned?.type === 'function_call') {
              Reflect.set(returned, 'parsed_arguments', { value: 1n });
            } else if (returned?.type === 'message' && returned.content[0]) {
              Reflect.set(returned.content[0], 'parsed', { value: 1n });
            }
          }
          return response;
        }),
      );
      const execute = vi.fn(() => 'recorded');
      await new ResponsesToolRunner({ functions: [{ tool: functionTool('record'), execute }] }).run(
        env.client,
        input,
      );
      expect(execute).toHaveBeenCalledTimes(kind === 'function' ? 2 : 1);
      expect(env.bodies[1]?.['input']).toContainEqual(item);
    },
  );
});

describe.each(['input', 'resume', 'budget'] as const)('strict replay history via %s', (mode) => {
  test.each([
    ['duplicate native ids', false],
    ['missing call status', false],
    ['output id', false],
    ['output status', false],
    ['ack list', false],
    ['ack id', false],
    ['ack code', false],
    ['ack message', false],
    ['omitted optionals', true],
    ['nullable optionals', true],
    ['valid optional status and acks', true],
    // oxlint-disable-next-line complexity -- One native replay fixture exercises field variants without duplicating runner setup.
  ] as const)('%s', async (variant, valid) => {
    const effect = vi.fn();
    const runner = new ResponsesToolRunner({ computer: recordingComputer(effect) });
    const saved = recording();
    const original = harness([{ output: [message] }]);
    let resumeFrom: ResponsesRunnerCheckpoint | undefined;
    if (mode === 'resume') {
      await runner.run(original.client, input, { ledger: saved.ledger });
      resumeFrom = saved.writes.find((entry) => entry.phase === 'boundary');
      expect(resumeFrom).toBeDefined();
    }
    const native: ResponseInputItem = {
      type: 'computer_call',
      id: 'native-one',
      call_id: 'call-one',
      status: 'completed',
      pending_safety_checks: [],
      actions: [{ type: 'wait' }],
    };
    const output: ResponseInputItem.ComputerCallOutput = {
      type: 'computer_call_output',
      call_id: 'call-one',
      output: { type: 'computer_screenshot', file_id: 'file-fixture' },
    };
    const history: ResponseInputItem[] = [native, output];
    switch (variant) {
      case 'duplicate native ids': {
        history.push(
          { ...native, id: 'native-one', call_id: 'call-two' },
          { ...output, call_id: 'call-two' },
        );
        break;
      }
      case 'missing call status': {
        Reflect.deleteProperty(native, 'status');
        break;
      }
      case 'output id': {
        Reflect.set(output, 'id', 31);
        break;
      }
      case 'output status': {
        Reflect.set(output, 'status', 'failed');
        break;
      }
      case 'ack list': {
        Reflect.set(output, 'acknowledged_safety_checks', 'not-an-array');
        break;
      }
      case 'ack id': {
        Reflect.set(output, 'acknowledged_safety_checks', [{ id: 7 }]);
        break;
      }
      case 'ack code': {
        Reflect.set(output, 'acknowledged_safety_checks', [{ id: 'check', code: true }]);
        break;
      }
      case 'ack message': {
        Reflect.set(output, 'acknowledged_safety_checks', [{ id: 'check', message: [] }]);
        break;
      }
      case 'nullable optionals': {
        Object.assign(output, { id: null, status: null, acknowledged_safety_checks: null });
        break;
      }
      case 'valid optional status and acks': {
        Object.assign(output, {
          id: 'output-one',
          status: 'in_progress',
          acknowledged_safety_checks: [
            { id: 'check', code: null, message: 'reviewed', future_field: 'keep' },
          ],
        });
        break;
      }
      default: {
        break;
      }
    }
    const env = harness([{ output: [{ ...message, id: 'new-answer' }] }]);
    const save = vi.fn();
    if (resumeFrom) {
      resumeFrom.history = history;
    }
    const promise = runner.run(
      env.client,
      { ...input, input: mode === 'resume' ? 'fresh task' : history },
      mode === 'budget'
        ? { contextBudget: { maxInputBytes: 30_000, maxInputImages: 4 } }
        : { ledger: { runId: 'context', save, ...(resumeFrom ? { resumeFrom } : {}) } },
    );
    if (valid) {
      await expect(promise).resolves.toHaveProperty('output_text', 'done');
      expect(env.bodies).toHaveLength(1);
      const posted = env.bodies[0]?.['input'];
      expect(posted).toEqual(
        mode === 'resume' ? [...history, { role: 'user', content: 'fresh task' }] : history,
      );
    } else {
      await expect(promise).rejects.toBeInstanceOf(Error);
      expect(env.bodies).toHaveLength(0);
      expect(save).not.toHaveBeenCalled();
    }
    expect(effect).not.toHaveBeenCalled();
  });
});

test.each(['duplicate definitions', 'repeated references'] as const)(
  'ordinary prior native IDs: %s',
  async (kind) => {
    const effect = vi.fn(() => 'recorded');
    const first = wireCall('record', {}, 'first');
    const second = wireCall('record', {}, 'second');
    Reflect.set(second, 'id', first.id);
    const history: ResponseInputItem[] =
      kind === 'duplicate definitions'
        ? [
            first,
            { type: 'function_call_output', call_id: first.call_id, output: 'first' },
            second,
            { type: 'function_call_output', call_id: 'call_second', output: 'second' },
          ]
        : [
            { type: 'item_reference', id: 'ref-one' },
            { type: 'item_reference', id: 'ref-one' },
          ];
    const h = harness([{ output: [wireCall('record', {}, 'fresh')] }, { output: [message] }]);
    const runner = new ResponsesToolRunner({
      functions: [
        { tool: { type: 'function', name: 'record', parameters: {}, strict: false }, execute: effect },
      ],
    });
    const promise = runner.run(h.client, { ...input, input: history });
    if (kind === 'duplicate definitions') {
      await expect(promise).rejects.toBeInstanceOf(Error);
      expect(effect).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(0);
    } else {
      await expect(promise).resolves.toHaveProperty('output_text', 'done');
      expect(effect).toHaveBeenCalledTimes(1);
    }
  },
);

describe.each(['input', 'resume', 'budget'] as const)('replay result metadata via %s', (mode) => {
  test.each([
    ['id', 7, false],
    ['status', 'failed', false],
    ['name', false, false],
    ['namespace', {}, false],
    ['caller', 'direct', false],
    ['caller', { type: 'program', caller_id: 7 }, false],
    ['nullable fields', null, true],
    ['input status and program caller', null, true],
  ] as const)('function output %s: %j', async (field, value, valid) => {
    const effect = vi.fn(() => 'should not replay');
    const runner = new ResponsesToolRunner({
      functions: [{ tool: functionTool('record'), execute: effect }],
    });
    const saved = recording();
    let resumeFrom: ResponsesRunnerCheckpoint | undefined;
    if (mode === 'resume') {
      await runner.run(harness([{ output: [message] }]).client, input, { ledger: saved.ledger });
      resumeFrom = saved.writes.find((entry) => entry.phase === 'boundary');
      expect(resumeFrom).toBeDefined();
    }
    const native = wireCall('record', {}, 'historic');
    const output: ResponseInputItem.FunctionCallOutput = {
      type: 'function_call_output',
      call_id: native.call_id,
      output: 'historic result',
    };
    if (field === 'nullable fields') {
      Object.assign(output, { id: null, status: null, name: null, namespace: null, caller: null });
    } else if (field === 'input status and program caller') {
      Object.assign(output, {
        id: 'native-result',
        status: 'in_progress',
        name: 'record',
        namespace: 'fixture',
        caller: { type: 'program', caller_id: 'program' },
        async: 'unowned-extension',
      });
    } else {
      Reflect.set(output, field, value);
    }
    const history: ResponseInputItem[] = [native, output];
    if (resumeFrom) {
      resumeFrom.history = history;
    }
    const env = harness([{ output: [{ ...message, id: 'new-answer' }] }]);
    const save = vi.fn();
    const promise = runner.run(
      env.client,
      { ...input, input: mode === 'resume' ? 'fresh task' : history },
      mode === 'budget'
        ? { contextBudget: { maxInputBytes: 30_000, maxInputImages: 4 } }
        : { ledger: { runId: 'context', save, ...(resumeFrom ? { resumeFrom } : {}) } },
    );
    if (valid) {
      await expect(promise).resolves.toHaveProperty('output_text', 'done');
      expect(env.bodies[0]?.['input']).toContainEqual(output);
    } else {
      await expect(promise).rejects.toBeInstanceOf(Error);
      expect(env.bodies).toHaveLength(0);
      expect(save).not.toHaveBeenCalled();
    }
    expect(effect).not.toHaveBeenCalled();
  });

  test.each([
    ['id', 7, false],
    ['reason', ['secret'], false],
    ['nullable fields', null, true],
    ['native fields', null, true],
  ] as const)('MCP approval response %s: %j', async (field, value, valid) => {
    const effect = vi.fn(() => 'should not replay');
    const approveMcp = vi.fn(() => true);
    const runner = new ResponsesToolRunner({
      functions: [{ tool: functionTool('record'), execute: effect }],
    });
    const mcp: Tool = { type: 'mcp', server_label: 'owned', server_url: 'https://fixture.invalid/mcp' };
    const approval: ResponseOutputItem.McpApprovalRequest = {
      type: 'mcp_approval_request',
      id: 'approval_actual',
      name: 'read',
      server_label: 'owned',
      arguments: '{}',
    };
    const saved = recording();
    let resumeFrom: ResponsesRunnerCheckpoint | undefined;
    if (mode === 'resume') {
      await runner.run(
        harness([{ output: [approval] }, { output: [message] }]).client,
        { ...input, tools: [mcp] },
        { ledger: saved.ledger, approveMcp: () => false },
      );
      resumeFrom = saved.writes.find((entry) => entry.phase === 'boundary');
      expect(resumeFrom).toBeDefined();
    }
    const output: ResponseInputItem.McpApprovalResponse = {
      type: 'mcp_approval_response',
      approval_request_id: 'approval_actual',
      approve: false,
    };
    if (field === 'nullable fields') {
      Object.assign(output, { id: null, reason: null });
    } else if (field === 'native fields') {
      Object.assign(output, { id: 'receipt', reason: 'operator declined', future: 'keep' });
    } else {
      Reflect.set(output, field, value);
    }
    const history: ResponseInputItem[] = [approval, output];
    if (resumeFrom) {
      resumeFrom.history = history;
    }
    const env = harness([{ output: [{ ...message, id: 'new-answer' }] }]);
    const save = vi.fn();
    const promise = runner.run(
      env.client,
      { ...input, tools: [mcp], input: mode === 'resume' ? 'fresh task' : history },
      mode === 'budget'
        ? { contextBudget: { maxInputBytes: 30_000, maxInputImages: 4 }, approveMcp }
        : { ledger: { runId: 'context', save, ...(resumeFrom ? { resumeFrom } : {}) }, approveMcp },
    );
    if (valid) {
      await expect(promise).resolves.toHaveProperty('output_text', 'done');
      expect(env.bodies[0]?.['input']).toContainEqual(output);
    } else {
      await expect(promise).rejects.toBeInstanceOf(Error);
      expect(env.bodies).toHaveLength(0);
      expect(save).not.toHaveBeenCalled();
    }
    expect(approveMcp).not.toHaveBeenCalled();
    expect(effect).not.toHaveBeenCalled();
  });
});
