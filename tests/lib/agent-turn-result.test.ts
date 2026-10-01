import * as mini from 'zod/v4-mini';
import { inspect } from 'node:util';
import { zodTextFormat, zodResponsesFunction } from 'openai/helpers/zod';
import { standardTextFormat, standardResponsesFunction } from 'openai/helpers/standard-schema';
import { functionTool } from 'openai/lib/beta/agents/function-tool';
import { standardAgentTextFormat } from 'openai/helpers/beta/agents/standard-schema';
import { z as z3 } from 'zod/v3';
import { z as z4 } from 'zod/v4';
import { zodAgentTextFormat } from 'openai/helpers/beta/agents/zod';
import { AgentOutputParseError, agentOutputFormat } from 'openai/lib/beta/agents/output-format';
import { describe, expect, test, vi } from 'vitest';
import OpenAI, { BadRequestError } from 'openai';
import type { JSONSchema } from 'openai/lib/jsonschema';
import { AgentTurnResultError } from 'openai/lib/beta/agents/agent-turn-result-error';
import { Stream } from 'openai/core/streaming';
import { AgentSessionStream } from 'openai/lib/agents/agent-session-stream';
import type { AgentSessionStreamParams } from 'openai/lib/agents/agent-session-stream';
import type { AgentSessionEvent } from 'openai/resources/beta/agents/agents';
import type { Turn } from 'openai/resources/beta/agents/sessions/turns';

const turn: Turn = {
  id: 'turn_test',
  agent_id: 'agent_test',
  completed_at: null,
  created_at: 1,
  error: null,
  object: 'agent.session.turn',
  session_id: 'session_test',
  started_at: 1,
  status: 'in_progress',
  subagent_id: null,
  usage: null,
};
let eventID = 0;
function event(type: string, data: Record<string, unknown> = {}) {
  eventID += 1;
  return { type, event_id: `event_${eventID}`, session_id: turn.session_id, turn_id: turn.id, ...data };
}
const created = () => event('agent.session.turn.created', { turn });
const completed = (status = 'completed') =>
  event(`agent.session.turn.${status}`, { turn: { ...turn, status, completed_at: 2 } });
const idle = () => event('agent.session.idle', { session: { id: turn.session_id, required_actions: [] } });
function message(
  text = 'Final answer',
  phase: string | null = 'final_answer',
  id = 'message_test',
  output_index = 0,
  done = true,
  turnID = turn.id,
) {
  return event(`agent.session.turn.item.${done ? 'done' : 'added'}`, {
    output_index,
    turn_id: turnID,
    item: {
      id,
      type: 'message',
      role: 'assistant',
      turn_id: turnID,
      phase,
      status: done ? 'completed' : 'in_progress',
      content: [{ type: 'output_text', text, annotations: [] }],
    },
  });
}
function setup(events: ReturnType<typeof event>[], { followup = false, eof = false } = {}) {
  const requests: Request[] = [];
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const item of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`));
      }
      if (eof) {
        controller.close();
      }
    },
    cancel,
  });
  const client = new OpenAI({
    apiKey: 'synthetic',
    maxRetries: 0,
    fetch: async (url, init) => {
      const request = new Request(url, init);
      requests.push(request);
      if (request.method === 'GET' && !new URL(request.url).pathname.endsWith('/events')) {
        return Response.json({ id: turn.session_id, status: 'idle' });
      }
      if (followup && request.method === 'POST') {
        return new Response(null, { status: 204 });
      }
      return new Response(body, {
        headers: { 'content-type': 'text/event-stream', 'x-request-id': 'request_test' },
      });
    },
  });
  return { client, requests, cancel, body };
}

async function collect(branch: Stream<AgentSessionEvent>) {
  const items = [];
  for await (const item of branch) {
    items.push(item);
  }
  return items;
}

class CustomStream<Item> extends Stream<Item> {
  static last: unknown;
  customState = { retained: true };
  customMethod(): string {
    return this.customState.retained ? 'custom' : 'missing';
  }
  static override fromSSEResponse<Item>(
    response: Response,
    controller: AbortController,
    client?: OpenAI,
    synthesizeEventData?: boolean,
  ): CustomStream<Item> {
    const source = Stream.fromSSEResponse<Item>(response, controller, client, synthesizeEventData);
    const custom = new CustomStream(() => source[Symbol.asyncIterator](), controller, client);
    CustomStream.last = custom;
    return custom;
  }
}

describe('beta Agents finalResult', () => {
  test('creation collects its answer without waiting for the still-live stream to close', async () => {
    const { client, cancel, requests } = setup([created(), message(), completed(), idle()]);
    const request = client.beta.agents.sessions.create({
      environment: { type: 'none' },
      input: 'Question',
      stream: true,
    });
    const { data: stream, response, request_id } = await request.withResponse();
    const compatible: Stream<AgentSessionEvent> = stream;
    expect(compatible).toBeInstanceOf(Stream);
    expect(response.headers.get('x-request-id')).toBe('request_test');
    expect(request_id).toBe('request_test');
    const result = await stream.finalResult();
    expect(result.output_text).toBe('Final answer');
    expect(result.session_id).toBe(turn.session_id);
    expect(result.turn_id).toBe(turn.id);
    expect(result.turn.status).toBe('completed');
    expect(await stream.finalResult()).toBe(result);
    expect(requests).toHaveLength(1);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test('follow-up is lazy, retains snapshots before event mutation, and getter works after iteration', async () => {
    const { client, requests } = setup([created(), message(), completed(), idle()], { followup: true });
    const stream = client.beta.agents.sessions.stream(turn.session_id, { input: 'Follow up' });
    expect(requests).toHaveLength(0);
    stream.withResultCollection();
    for await (const item of stream) {
      if (item.type === 'agent.session.turn.item.done' && item.item.type === 'message') {
        const [content] = item.item.content;
        if (content) {
          content.text = 'mutated';
        }
      }
    }
    const result = await stream.finalResult();
    expect(result.output_text).toBe('Final answer');
    expect(requests.map((request) => request.method)).toEqual(['GET', 'GET', 'POST']);
  });

  test('getter continues the same manually advanced iterator and preserves output order', async () => {
    const { client } = setup([
      created(),
      message('later', 'final_answer', 'b', 2),
      message('ignored', 'commentary', 'c', 0),
      message('first', 'final_answer', 'a', 1),
      completed(),
      idle(),
    ]);
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    stream.withResultCollection();
    await stream[Symbol.asyncIterator]().next();
    const result = await stream.finalResult();
    expect(result.output_text).toBe('firstlater');
    expect(result.messages.map((item) => item.id)).toEqual(['a', 'b']);
  });

  test.each(['failed', 'cancelled'])(
    'rejects %s with turn identity and partial final output',
    async (status) => {
      const { client } = setup([created(), message(), completed(status), idle()]);
      const stream = await client.beta.agents.sessions.create({
        environment: { type: 'none' },
        stream: true,
      });
      await expect(stream.finalResult()).rejects.toMatchObject({
        reason: status,
        turn_id: turn.id,
        session_id: turn.session_id,
        messages: [expect.objectContaining({ id: 'message_test' })],
      });
    },
  );

  test.each([
    { name: 'truncated turn', events: [created(), message()], reason: 'observation' },
    { name: 'missing idle', events: [created(), message(), completed()], reason: 'observation' },
  ])('rejects $name', async ({ events, reason }) => {
    const { client } = setup(events, { eof: true });
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    await expect(stream.finalResult()).rejects.toMatchObject({ reason });
  });

  test('supports completed text-free turns', async () => {
    const { client } = setup([created(), completed(), idle()]);
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    const result = await stream.finalResult();
    expect(result.output_text).toBe('');
  });

  test('reports an unhandled required action without hanging', async () => {
    const { client, cancel } = setup([
      created(),
      event('agent.session.requires_action', {
        session: {
          id: turn.session_id,
          required_actions: [{ type: 'environment_connection', environment_id: 'environment_test' }],
        },
      }),
    ]);
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    await expect(stream.finalResult()).rejects.toBeInstanceOf(AgentTurnResultError);
    await expect(stream.finalResult()).rejects.toMatchObject({
      reason: 'requires_action',
      required_actions: [{ type: 'environment_connection', environment_id: 'environment_test' }],
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  test('explicit abort cannot turn partial output into a final answer', async () => {
    const { client } = setup([created(), message()]);
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    stream.withResultCollection();
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    stream.controller.abort();
    await expect(stream.finalResult()).rejects.toMatchObject({ reason: 'observation' });
  });
  test('follow-up getter dispatches a registered handler once and caches its result', async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const call = event('agent.session.turn.item.added', {
      output_index: 0,
      item: {
        id: 'item_call',
        type: 'function_call',
        name: 'lookup',
        call_id: 'call_test',
        turn_id: turn.id,
        arguments: '{"order":"A123"}',
        status: 'in_progress',
      },
    });
    const { client, requests } = setup([created(), call, message(), completed(), idle()], { followup: true });
    const stream = client.beta.agents.sessions.stream(turn.session_id, {
      input: 'Question',
      toolHandlers: { lookup: handler },
    });
    const result = await stream.finalResult();
    expect(result.output_text).toBe('Final answer');
    expect(await stream.finalResult()).toBe(result);
    expect(handler).toHaveBeenCalledExactlyOnceWith({ order: 'A123' });
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(2);
  });

  test('ignores child output, deduplicates done items, and keeps the selected result after later events', async () => {
    const answer = message();
    const child = message('child', 'final_answer', 'child_message', 0, true, 'child_turn');
    const { client } = setup(
      [
        created(),
        message('partial', 'final_answer', 'message_test', 0, false),
        child,
        answer,
        answer,
        completed(),
        idle(),
        event('agent.session.failed', { session: { id: turn.session_id } }),
      ],
      { eof: true },
    );
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    stream.withResultCollection();
    for await (const item of stream) {
      expect(item.type).toBeTruthy();
    }
    const result = await stream.finalResult();
    expect(result.messages).toHaveLength(1);
    expect(result.output_text).toBe('Final answer');
  });

  test('preserves a delivery error as the collection error cause', async () => {
    const { client } = setup([
      created(),
      message(),
      event('error', { error: { message: 'synthetic failure' } }),
    ]);
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    await expect(stream.finalResult()).rejects.toMatchObject({
      reason: 'observation',
      cause: expect.objectContaining({ message: 'synthetic failure' }),
      turn_id: turn.id,
    });
  });

  test('preserves tee consumption and collection after both branches reach EOF', async () => {
    const { client } = setup([created(), message(), completed(), idle()], { eof: true });
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    stream.withResultCollection();
    const [left, right] = stream.tee();
    const [a, b] = await Promise.all([collect(left), collect(right)]);
    expect(a).toEqual(b);
    const result = await stream.finalResult();
    expect(result.output_text).toBe('Final answer');
  });
  test('uses the item turn identity when the nullable event turn ID is absent', async () => {
    const item = event('agent.session.turn.item.done', { ...message(), turn_id: null });
    const { client } = setup([created(), item, completed(), idle()]);
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    const result = await stream.finalResult();
    expect(result.output_text).toBe('Final answer');
  });
  test('a later raw transport failure does not poison the already completed selected turn', async () => {
    const { client } = setup([
      created(),
      message(),
      completed(),
      idle(),
      event('error', { error: { message: 'later failure' } }),
    ]);
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    stream.withResultCollection();
    await expect(collect(stream)).rejects.toThrow('later failure');
    const result = await stream.finalResult();
    expect(result.output_text).toBe('Final answer');
  });
  test.each(['iterate', 'tee', 'readable'])(
    'preserves custom stream identity and methods through %s consumption',
    async (mode) => {
      const { client } = setup([created(), message(), completed(), idle()], { eof: true });
      const { data: stream, request_id } = await client.beta.agents.sessions
        .create({ environment: { type: 'none' }, stream: true }, { __streamClass: CustomStream })
        .withResponse();
      expect(stream).toBe(CustomStream.last);
      expect(stream).toBeInstanceOf(CustomStream);
      expect(request_id).toBe('request_test');
      if (!(stream instanceof CustomStream)) {
        throw new Error('Expected configured stream class');
      }
      expect(stream.customState).toEqual({ retained: true });
      expect(stream.customMethod()).toBe('custom');
      expect(stream.withResultCollection()).toBe(stream);
      if (mode === 'tee') {
        stream.withResultCollection();
        const [left, right] = stream.tee();
        await Promise.all([collect(left), collect(right)]);
      } else if (mode === 'readable') {
        await collect(
          Stream.fromReadableStream<AgentSessionEvent>(stream.toReadableStream(), stream.controller),
        );
      } else {
        await collect(stream);
      }
      const result = await stream.finalResult();
      expect(result.output_text).toBe('Final answer');
    },
  );

  test('excludes known unfinished commentary while preserving completed final output', async () => {
    const commentary = message('Thinking', 'commentary', 'commentary', 0, false);
    const delta = event('agent.session.turn.output_text.delta', {
      item_id: 'commentary',
      delta: '...',
      content_index: 0,
      output_index: 0,
    });
    const { client } = setup([
      created(),
      commentary,
      delta,
      message('Answer', 'final_answer', 'final', 1),
      completed(),
      idle(),
    ]);
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    const result = await stream.finalResult();
    expect(result.output_text).toBe('Answer');
  });

  test('a done commentary snapshot resolves an initially unclassified message', async () => {
    const { client } = setup([
      created(),
      message('', null, 'commentary', 0, false),
      message('Thinking', 'commentary', 'commentary'),
      message('Answer', 'final_answer', 'final', 1),
      completed(),
      idle(),
    ]);
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    const result = await stream.finalResult();
    expect(result.output_text).toBe('Answer');
  });

  test('preserves explicit creation abort reason in the observation error', async () => {
    const { client } = setup([created(), message()]);
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    stream.withResultCollection();
    await stream[Symbol.asyncIterator]().next();
    const cause = new Error('Stopped by caller');
    stream.controller.abort(cause);
    await expect(stream.finalResult()).rejects.toMatchObject({ reason: 'observation', cause });
  });
  test('breaking progress iteration preserves normal stream cancellation', async () => {
    const { client, cancel } = setup([created(), message(), completed(), idle()]);
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    stream.withResultCollection();
    for await (const item of stream) {
      if (item.type === 'agent.session.turn.created') {
        break;
      }
    }
    expect(cancel).toHaveBeenCalledOnce();
    await expect(stream.finalResult()).rejects.toMatchObject({ reason: 'observation' });
  });
  test('collects completed legacy null-phase messages and ignores partial snapshots', async () => {
    const { client } = setup([
      created(),
      message('partial', 'final_answer', 'partial', 0, false),
      message('Answer', null, 'answer', 1),
      completed(),
      idle(),
    ]);
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    const result = await stream.finalResult();
    expect(result.output_text).toBe('Answer');
  });
  test.each([false, true])('raw iteration retains no result copies (follow-up: %s)', async (followup) => {
    const events = [
      created(),
      ...Array.from({ length: 128 }, (_, index) =>
        message('x'.repeat(16_384), 'final_answer', `message_${index}`, index),
      ),
      completed(),
      idle(),
    ];
    const { client } = setup(events, { followup, eof: true });
    const stream = followup
      ? client.beta.agents.sessions.stream(turn.session_id, { input: 'Question' })
      : await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      let count = 0;
      for await (const item of stream) {
        expect(item.type).toBeTruthy();
        count += 1;
      }
      expect(count).toBe(events.length);
      expect(clone).not.toHaveBeenCalled();
      expect(() => stream.withResultCollection()).toThrow('before consuming events');
      await expect(stream.finalResult()).rejects.toThrow('before consuming events');
    } finally {
      clone.mockRestore();
    }
  });

  test.each(['tee', 'readable'])('raw %s consumption does not implicitly collect output', async (mode) => {
    const { client } = setup([created(), message('x'.repeat(1024 * 1024)), completed(), idle()], {
      eof: true,
    });
    const stream = await client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      if (mode === 'tee') {
        const [left, right] = stream.tee();
        await Promise.all([collect(left), collect(right)]);
      } else {
        await collect(
          Stream.fromReadableStream<AgentSessionEvent>(stream.toReadableStream(), stream.controller),
        );
      }
      expect(clone).not.toHaveBeenCalled();
      await expect(stream.finalResult()).rejects.toThrow('before consuming events');
    } finally {
      clone.mockRestore();
    }
  });

  test.each([false, true])(
    'enabled collection retains large completed output (progress: %s)',
    async (progress) => {
      const text = 'x'.repeat(1024 * 1024);
      const { client } = setup([created(), message(text), completed(), idle()], { eof: true });
      const stream = await client.beta.agents.sessions.create({
        environment: { type: 'none' },
        stream: true,
      });
      if (progress) {
        expect(stream.withResultCollection()).toBe(stream);
        await collect(stream);
      }
      const result = await stream.finalResult();
      expect(result.output_text).toBe(text);
      expect(await stream.finalResult()).toBe(result);
      const [assistant] = result.messages;
      if (assistant) {
        const id: string = assistant.id;
        const role: 'assistant' = assistant.role;
        expect(id).toBe('message_test');
        expect(role).toBe('assistant');
      }
    },
  );
  test.each([false, true])('collects from a separate SDK module stream (progress: %s)', async (progress) => {
    vi.resetModules();
    const { Stream: ForeignStream } = await import('openai/core/streaming');
    expect(ForeignStream).not.toBe(Stream);
    const { client } = setup([created(), message(), completed(), idle()], { eof: true });
    const { data: stream, request_id } = await client.beta.agents.sessions
      .create({ environment: { type: 'none' }, stream: true }, { __streamClass: ForeignStream })
      .withResponse();
    expect(stream).toBeInstanceOf(ForeignStream);
    expect(stream).not.toBeInstanceOf(Stream);
    expect(request_id).toBe('request_test');
    if (progress) {
      expect(stream.withResultCollection()).toBe(stream);
      await collect(stream);
    }
    const result = await stream.finalResult();
    expect(result.output_text).toBe('Final answer');
  });
});

describe('beta Agents typed output', () => {
  test.each([
    ['v3', z3.object({ summary: z3.string(), findings: z3.array(z3.string()) })],
    ['v4', z4.object({ summary: z4.string(), findings: z4.array(z4.string()) })],
    ['v4-mini', mini.object({ summary: mini.string(), findings: mini.array(mini.string()) })],
  ] as const)('binds %s schema, request, and typed result', async (_version, schema) => {
    const format = zodAgentTextFormat(schema);
    const callback = vi.fn((args) => args);
    const tool = functionTool(
      zodResponsesFunction({ name: 'summarize', parameters: schema, function: callback }),
    );
    const answer = { summary: 'Report', findings: ['First'] };
    const { client, requests } = setup([created(), message(JSON.stringify(answer)), completed(), idle()]);
    const stream = await client.beta.agents.sessions.create({
      agent: { model: 'gpt-6-astra', tools: [tool.definition], text: { format } },
      environment: { type: 'none' },
      input: 'Research',
      stream: true,
    });
    const result = await stream.finalResult();
    const summary: string = result.output_parsed.summary;
    expect(summary).toBe('Report');
    expect(result.output_parsed).toEqual(answer);
    expect(result.raw_result.messages).toBe(result.messages);
    expect(await stream.finalResult()).toBe(result);
    const request = await requests[0]?.json();
    expect(request).toMatchObject({
      agent: {
        text: { format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false } } },
      },
    });
    expect(request).toMatchObject({ agent: { tools: [tool.definition] } });
    expect(tool.definition.parameters).toEqual(format.schema);
    expect(callback).not.toHaveBeenCalled();
    expect(JSON.stringify(request)).not.toMatch(/parseRaw|strict|callback/u);
  });

  test.each(['zod', 'standard'] as const)(
    'dispatches a typed tool and parses its final %s output',
    async (adapter) => {
      const schema = z4.object({ summary: z4.string() });
      const jsonSchema = {
        type: 'object' as const,
        properties: { summary: { type: 'string' as const } },
        required: ['summary'],
      };
      const callback = vi.fn(({ summary }: { summary: string }) => ({ summary: summary.toUpperCase() }));
      const options = { name: 'summarize', parameters: schema, function: callback };
      const tool = functionTool(
        adapter === 'zod'
          ? zodResponsesFunction(options)
          : standardResponsesFunction({ ...options, schema: jsonSchema }),
      );
      const format =
        adapter === 'zod' ? zodAgentTextFormat(schema) : standardAgentTextFormat(schema, jsonSchema);
      const { client, requests } = setup(
        [
          created(),
          event('agent.session.turn.item.added', {
            item: {
              id: 'item_tool',
              type: 'function_call',
              call_id: 'call_tool',
              turn_id: turn.id,
              name: tool.name,
              arguments: { summary: 'notes' },
              status: 'in_progress',
            },
          }),
          message('{"summary":"NOTES"}'),
          completed(),
          idle(),
        ],
        { followup: true },
      );
      const result = await client.beta.agents.sessions
        .stream(turn.session_id, {
          input: 'Summarize the notes.',
          toolHandlers: { [tool.name]: tool.handler },
          outputFormat: format,
        })
        .finalResult();
      const summary: string = result.output_parsed.summary;
      expect(summary).toBe('NOTES');
      expect(callback).toHaveBeenCalledExactlyOnceWith({ summary: 'notes' });
      const posts = requests.filter((request) => request.method === 'POST');
      expect(posts).toHaveLength(2);
      expect(await posts[1]?.json()).toMatchObject({
        events: [{ call_id: 'call_tool', success: true, output: '{"summary":"NOTES"}' }],
      });
      await expect(tool.handler({ summary: 42 })).rejects.toThrow();
      expect(() => format.$parseRaw('{"summary":42}')).toThrow();
      expect(callback).toHaveBeenCalledOnce();
    },
  );

  test('follow-up parses locally without changing the hosted schema', async () => {
    const format = zodAgentTextFormat(z4.object({ summary: z4.string() }));
    const { client, requests } = setup([created(), message('{"summary":"Followup"}'), completed(), idle()], {
      followup: true,
    });
    const stream = client.beta.agents.sessions
      .stream(turn.session_id, { input: 'Again', outputFormat: format })
      .withResultCollection();
    for await (const _event of stream) {
      /* show progress */
    }
    const result = await stream.finalResult();
    const summary: string = result.output_parsed.summary;
    expect(summary).toBe('Followup');
    const posts = requests.filter((request) => request.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(JSON.stringify(await posts[0]?.json())).not.toMatch(/outputFormat|schema|parseRaw/u);
  });

  test.each(['not JSON', '{"summary":42}'])(
    'parsing failure preserves the completed raw result: %s',
    async (text) => {
      const { client } = setup([created(), message(text), completed(), idle()]);
      const format = zodAgentTextFormat(z4.object({ summary: z4.string() }));
      const stream = await client.beta.agents.sessions.create({
        agent: { text: { format } },
        environment: { type: 'none' },
        input: 'Report',
        stream: true,
      });
      const failure = await stream.finalResult().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AgentOutputParseError);
      if (!(failure instanceof AgentOutputParseError)) {
        throw new Error('Expected parse failure');
      }
      expect(failure.raw_result.turn.status).toBe('completed');
      expect(failure.raw_result.output_text).toBe(text);
      expect(failure).not.toHaveProperty('cause');
      expect(failure.message).not.toContain(text);
      expect(await stream.finalResult().catch((error: unknown) => error)).toBe(failure);
    },
  );

  describe.each([false, true])('per-item parsing (follow-up: %s)', (followup) => {
    test.each(['messages', 'parts', 'invalid later', 'empty text', 'no text'] as const)(
      'parses final output text independently: %s',
      async (mode) => {
        const first = '{"summary":"First"}';
        const second = mode === 'invalid later' ? '{"summary":42}' : '{"summary":"Second"}';
        let items: ReturnType<typeof event>[];
        if (mode === 'no text') {
          items = [];
        } else if (mode === 'empty text') {
          items = [message('')];
        } else if (mode === 'parts') {
          items = [
            event('agent.session.turn.item.done', {
              output_index: 0,
              item: {
                id: 'message_parts',
                type: 'message',
                role: 'assistant',
                turn_id: turn.id,
                phase: 'final_answer',
                status: 'completed',
                content: [first, second].map((text) => ({ type: 'output_text', text, annotations: [] })),
              },
            }),
          ];
        } else {
          items = [message(first, 'final_answer', 'first', 0), message(second, 'final_answer', 'second', 1)];
        }
        const { client } = setup([created(), ...items, completed(), idle()], { followup });
        const native = zodAgentTextFormat(z4.object({ summary: z4.string() }));
        const parse = vi.fn(native.$parseRaw);
        const format = agentOutputFormat(native.schema, parse);
        const stream = followup
          ? client.beta.agents.sessions.stream(turn.session_id, { input: 'Again', outputFormat: format })
          : await client.beta.agents.sessions.create({
              agent: { text: { format } },
              environment: { type: 'none' },
              stream: true,
            });
        if (mode === 'invalid later' || mode === 'empty text' || mode === 'no text') {
          const failure = await stream.finalResult().catch((error: unknown) => error);
          expect(failure).toBeInstanceOf(AgentOutputParseError);
          if (!(failure instanceof AgentOutputParseError)) {
            throw new Error('Expected parse failure');
          }
          expect(failure.raw_result.output_text).toBe(mode === 'invalid later' ? first + second : '');
          const expectedCalls = mode === 'empty text' ? [''] : [];
          expect(parse.mock.calls.map(([text]) => text)).toEqual(
            mode === 'invalid later' ? [first, second] : expectedCalls,
          );
        } else {
          const result = await stream.finalResult();
          expect(result.output_parsed).toEqual({ summary: 'First' });
          expect(result.output_text).toBe(first + second);
          expect(result.messages).toHaveLength(mode === 'parts' ? 1 : 2);
          expect(result.messages).toBe(result.raw_result.messages);
          expect(parse.mock.calls.map(([text]) => text)).toEqual([first, second]);
        }
      },
    );

    test.each([false, null, undefined])('preserves the first parsed value: %s', async (value) => {
      const parse = vi.fn().mockReturnValueOnce(value).mockReturnValueOnce('second');
      const format = agentOutputFormat({ type: 'object' }, parse);
      const { client } = setup(
        [
          created(),
          message('{}', 'final_answer', 'first', 0),
          message('{}', 'final_answer', 'second', 1),
          completed(),
          idle(),
        ],
        { followup },
      );
      const stream = followup
        ? client.beta.agents.sessions.stream(turn.session_id, { input: 'Again', outputFormat: format })
        : await client.beta.agents.sessions.create({
            agent: { text: { format } },
            environment: { type: 'none' },
            stream: true,
          });
      const result = await stream.finalResult();
      expect(result.output_parsed).toBe(value);
      expect(parse).toHaveBeenCalledTimes(2);
    });
  });

  test('hosted failure does not run the parser', async () => {
    const parse = vi.fn(() => ({ summary: 'unused' }));
    const format = agentOutputFormat(
      { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      parse,
    );
    const { client } = setup([created(), completed('failed'), idle()]);
    const stream = await client.beta.agents.sessions.create({
      agent: { text: { format } },
      environment: { type: 'none' },
      input: 'Report',
      stream: true,
    });
    await expect(stream.finalResult()).rejects.toBeInstanceOf(AgentTurnResultError);
    expect(parse).not.toHaveBeenCalled();
  });

  test.each([
    ['v3 URLs', z3.object({ links: z3.array(z3.string().url()) })],
    ['v4 URLs', z4.object({ nested: z4.object({ link: z4.url() }) })],
    ['v4-mini', mini.object({ summary: mini.string() })],
    ['v3 array root', z3.array(z3.string())],
    ['v4 union root', z4.union([z4.object({ a: z4.string() }), z4.object({ b: z4.number() })])],
  ] as const)('preserves native Responses conversion for %s', (_name, schema) => {
    let native;
    try {
      native = zodTextFormat(schema, 'agent_output');
    } catch (error) {
      expect(() => zodAgentTextFormat(schema)).toThrow(error instanceof Error ? error.message : undefined);
      return;
    }
    const format = zodAgentTextFormat(schema);
    expect(format.schema).toEqual(native.schema);
    expect(JSON.stringify(format)).toBe(JSON.stringify({ type: 'json_schema', schema: native.schema }));
  });

  test('preserves Standard Schema conversion and parsing from Responses', () => {
    const schema = z4.object({ link: z4.url() });
    const native = standardTextFormat(schema, 'agent_output');
    const format = standardAgentTextFormat(schema);
    expect(format.schema).toEqual(native.schema);
    expect(format.$parseRaw('{"link":"https://example.com"}')).toEqual(
      native.$parseRaw('{"link":"https://example.com"}'),
    );
    expect(() => format.$parseRaw('{"link":42}')).toThrow();
  });
  test.each(['agent', 'text', 'format'] as const)(
    'does not promote an inherited %s into the request',
    async (key) => {
      const parse = vi.fn(() => ({ summary: 'Unexpected' }));
      const format = agentOutputFormat({ type: 'object' }, parse);
      const agent = { text: { format } };
      const body = {
        agent,
        environment: { type: 'none' as const },
        input: 'Question',
        stream: true as const,
      };
      const { target, value } = {
        agent: { target: body, value: agent },
        text: { target: agent, value: agent.text },
        format: { target: agent.text, value: format },
      }[key];
      Reflect.deleteProperty(target, key);
      Object.setPrototypeOf(target, { [key]: value });
      const { client, requests } = setup([created(), message('Raw answer'), completed(), idle()]);
      const stream = await client.beta.agents.sessions.create(body);
      const result = await stream.finalResult();
      expect(result).not.toHaveProperty('output_parsed');
      expect(parse).not.toHaveBeenCalled();
      // oxlint-disable-next-line unicorn/prefer-structured-clone -- Compare JSON wire semantics, which omit inherited fields.
      expect(await requests[0]?.json()).toEqual(JSON.parse(JSON.stringify(body)));
    },
  );

  test.each(['agent', 'text', 'format'] as const)(
    'captures a typed %s getter once for both request and result',
    async (key) => {
      const format = zodAgentTextFormat(z4.object({ summary: z4.string() }));
      const alternate = zodAgentTextFormat(z4.object({ different: z4.number() }));
      const agent = { text: { format } };
      const body = {
        agent,
        environment: { type: 'none' as const },
        input: 'Question',
        stream: true as const,
      };
      const { target, first, second } = {
        agent: { target: body, first: agent, second: { text: { format: alternate } } },
        text: { target: agent, first: agent.text, second: { format: alternate } },
        format: { target: agent.text, first: format, second: alternate },
      }[key];
      const getter = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
      Object.defineProperty(target, key, { get: getter, enumerable: true });
      const { client, requests } = setup([created(), message('{"summary":"Captured"}'), completed(), idle()]);
      const stream = await client.beta.agents.sessions.create(body);
      const result = await stream.finalResult();
      const summary: string = result.output_parsed.summary;
      expect(summary).toBe('Captured');
      expect(getter).toHaveBeenCalledOnce();
      expect(await requests[0]?.json()).toEqual({
        agent: { text: { format: { type: 'json_schema', schema: format.schema } } },
        environment: { type: 'none' },
        input: 'Question',
        stream: true,
      });
    },
  );

  test.each(['agent', 'text', 'format'] as const)('does not read a non-enumerable %s getter', async (key) => {
    const format = zodAgentTextFormat(z4.object({ summary: z4.string() }));
    const agent = { text: { format } };
    const body = { agent, environment: { type: 'none' as const }, stream: true as const };
    const { target, value } = {
      agent: { target: body, value: agent },
      text: { target: agent, value: agent.text },
      format: { target: agent.text, value: format },
    }[key];
    const getter = vi.fn(() => value);
    Object.defineProperty(target, key, { get: getter, enumerable: false });
    const { client, requests } = setup([created(), message('Raw answer'), completed(), idle()]);
    const stream = await client.beta.agents.sessions.create(body);
    expect(await stream.finalResult()).not.toHaveProperty('output_parsed');
    expect(getter).not.toHaveBeenCalled();
    // oxlint-disable-next-line unicorn/prefer-structured-clone -- Assert JSON omission of non-enumerable fields.
    expect(await requests[0]?.json()).toEqual(JSON.parse(JSON.stringify(body)));
  });

  test.each(['agent', 'text', 'format', 'type', 'schema'] as const)(
    'leaves the %s getter to ordinary request serialization',
    async (key) => {
      const format = { type: 'json_schema' as const, schema: { type: 'object' } };
      const agent = { text: { format } };
      const body = {
        agent,
        environment: { type: 'none' as const },
        input: 'Question',
        stream: true as const,
      };
      const { target, value } = {
        agent: { target: body, value: agent },
        text: { target: agent, value: agent.text },
        format: { target: agent.text, value: format },
        type: { target: format, value: format.type },
        schema: { target: format, value: format.schema },
      }[key];
      const getter = vi.fn(() => value);
      Object.defineProperty(target, key, { get: getter, enumerable: true });
      const { client } = setup([created(), message('Raw answer'), completed(), idle()]);
      const stream = await client.beta.agents.sessions.create(body);
      const result = await stream.finalResult();
      expect(result).not.toHaveProperty('output_parsed');
      expect(getter).toHaveBeenCalledOnce();
    },
  );

  test.each([
    { type: 'object', additionalProperties: true, properties: { link: { type: 'string', format: 'uri' } } },
    { type: 'object', enum: [{}] },
    { type: 'array', items: { type: 'string' } },
    { anyOf: [{ type: 'object' }, { type: 'string' }] },
    { oneOf: [{ type: 'object' }, { type: 'string' }] },
    {
      type: 'object',
      allOf: [{ not: { required: ['disabled'] } }],
      patternProperties: { '^x': { type: 'number' } },
    },
  ] satisfies JSONSchema[])(
    'forwards custom schema unchanged and propagates API rejection: %j',
    async (schema) => {
      const before = structuredClone(schema);
      const parse = vi.fn(JSON.parse);
      const format = agentOutputFormat(schema, parse);
      expect(format.schema).toEqual(before);
      let dispatched: unknown;
      const client = new OpenAI({
        apiKey: 'synthetic',
        maxRetries: 0,
        fetch: async (url, init) => {
          dispatched = await new Request(url, init).json();
          return Response.json(
            {
              error: {
                message: 'Schema is not supported by this API',
                type: 'invalid_request_error',
                code: 'unsupported_schema',
              },
            },
            { status: 400 },
          );
        },
      });
      await expect(
        client.beta.agents.sessions.create({
          agent: { text: { format } },
          environment: { type: 'none' },
          input: 'Question',
          stream: true,
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(dispatched).toEqual({
        agent: { text: { format: { type: 'json_schema', schema: before } } },
        environment: { type: 'none' },
        input: 'Question',
        stream: true,
      });
      expect(schema).toEqual(before);
      expect(parse).not.toHaveBeenCalled();
    },
  );

  test('ignores inherited and accessor parsers on ordinary formats', async () => {
    const parse = vi.fn(() => ({ summary: 'Injected' }));
    const getter = vi.fn(() => parse);
    for (const format of [
      Object.assign(Object.create({ $parseRaw: parse }), { type: 'json_schema', schema: { type: 'object' } }),
      Object.defineProperty({ type: 'json_schema' as const, schema: { type: 'object' } }, '$parseRaw', {
        get: getter,
      }),
    ]) {
      const { client } = setup([created(), message('Raw answer'), completed(), idle()]);
      // oxlint-disable-next-line no-await-in-loop -- Each case owns an independent stream and parser spy.
      const stream = await client.beta.agents.sessions.create({
        agent: { text: { format } },
        environment: { type: 'none' },
        input: 'Question',
        stream: true,
      });
      // oxlint-disable-next-line no-await-in-loop -- Each stream must settle before checking its parser spy.
      const result = await stream.finalResult();
      expect(result).not.toHaveProperty('output_parsed');
      expect(result.output_text).toBe('Raw answer');
    }
    expect(parse).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  test('snapshots the format before dispatch and ignores later replacement', async () => {
    const original = zodAgentTextFormat(z4.object({ summary: z4.string() }));
    const replacement = zodAgentTextFormat(z4.object({ different: z4.number() }));
    const body = {
      agent: { text: { format: original } },
      environment: { type: 'none' as const },
      input: 'Report',
      stream: true as const,
    };
    const client = new OpenAI({
      apiKey: 'synthetic',
      maxRetries: 0,
      fetch: async (url, init) => {
        const request = await new Request(url, init).json();
        expect(request).toMatchObject({ agent: { text: { format: { schema: original.schema } } } });
        Object.assign(body.agent.text, { format: replacement });
        const events = [created(), message('{"summary":"Report"}'), completed(), idle()];
        return new Response(events.map((item) => `data: ${JSON.stringify(item)}\n\n`).join(''), {
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });
    const stream = await client.beta.agents.sessions.create(body);
    const result = await stream.finalResult();
    expect(result.output_parsed.summary).toBe('Report');
  });
  test('Standard Schema shares inferred creation output and validation', async () => {
    const schema = z4.object({ summary: z4.string() });
    const format = standardAgentTextFormat(schema, {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
      additionalProperties: false,
    });
    const { client } = setup([created(), message('{"summary":"Standard"}'), completed(), idle()]);
    const stream = await client.beta.agents.sessions.create({
      agent: { text: { format } },
      environment: { type: 'none' },
      input: 'Report',
      stream: true,
    });
    const result = await stream.finalResult();
    const summary: string = result.output_parsed.summary;
    expect(summary).toBe('Standard');
    expect(() => format.$parseRaw('{"summary":1}')).toThrow();
  });
  test('ordinary parse-error logging does not expose response or validator diagnostics', async () => {
    const canary = 'private-output-canary';
    const format = agentOutputFormat({ type: 'object', properties: {} }, (text) => {
      throw new Error(`Invalid output: ${text}`);
    });
    const { client } = setup([created(), message(canary), completed(), idle()]);
    const stream = await client.beta.agents.sessions.create({
      agent: { text: { format } },
      environment: { type: 'none' },
      input: 'Report',
      stream: true,
    });
    const failure = await stream.finalResult().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentOutputParseError);
    expect(inspect(failure)).not.toContain(canary);
    expect(String(failure)).not.toContain(canary);
    expect(JSON.stringify(failure)).not.toContain(canary);
    if (!(failure instanceof AgentOutputParseError)) {
      throw new Error('Expected parse error');
    }
    expect(failure.stack).not.toContain(canary);
    expect(failure.raw_result.output_text).toBe(canary);
  });

  test('snapshots the streaming flag with the submitted typed request', async () => {
    const format = zodAgentTextFormat(z4.object({ summary: z4.string() }));
    const body = {
      agent: { text: { format } },
      environment: { type: 'none' as const },
      input: 'Report',
      stream: true as const,
    };
    const { client, requests } = setup([created(), message('{"summary":"Captured"}'), completed(), idle()]);
    const pending = client.beta.agents.sessions.create(body);
    Object.assign(body, { stream: false });
    const stream = await pending;
    const result = await stream.finalResult();
    expect(result.output_parsed.summary).toBe('Captured');
    expect(await requests[0]?.json()).toMatchObject({ stream: true });
  });
  test('shallow-copied formats retain inferred parsing and serialize only API fields', async () => {
    const format = { ...zodAgentTextFormat(z4.object({ summary: z4.string() })) };
    const { client, requests } = setup([created(), message('{"summary":"Copied"}'), completed(), idle()]);
    const stream = await client.beta.agents.sessions.create({
      agent: { text: { format } },
      environment: { type: 'none' },
      input: 'Report',
      stream: true,
    });
    const result = await stream.finalResult();
    const summary: string = result.output_parsed.summary;
    expect(summary).toBe('Copied');
    expect(JSON.stringify(await requests[0]?.json())).not.toContain('$parseRaw');
    expect(JSON.stringify(format)).not.toContain('$parseRaw');
  });
  test('follow-up validates and captures its local parser before any requests', async () => {
    const format = zodAgentTextFormat(z4.object({ summary: z4.string() }));
    const injected = vi.fn(() => ({ summary: 'Injected' }));
    const getter = vi.fn(() => injected);
    const { client, requests } = setup([created(), message('{"summary":"Captured"}'), completed(), idle()], {
      followup: true,
    });
    for (const invalid of [
      Object.assign(Object.create({ $parseRaw: injected }), { type: 'json_schema', schema: format.schema }),
      Object.defineProperty({ ...format }, '$parseRaw', { get: getter }),
    ]) {
      expect(() =>
        client.beta.agents.sessions.stream(turn.session_id, { input: 'Again', outputFormat: invalid }),
      ).toThrow('own parser function');
    }
    expect(requests).toHaveLength(0);
    const stream = client.beta.agents.sessions.stream(turn.session_id, {
      input: 'Again',
      outputFormat: format,
    });
    format.$parseRaw = injected;
    const result = await stream.finalResult();
    expect(result.output_parsed.summary).toBe('Captured');
    expect(injected).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });
  test('custom schema binding ignores ambient prototype properties', () => {
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'enum');
    try {
      // oxlint-disable-next-line no-extend-native -- Reproduce ambient prototype pollution and restore it in finally.
      Object.defineProperty(Object.prototype, 'enum', { value: [], configurable: true });
      expect(() => agentOutputFormat({ type: 'object', properties: {} }, JSON.parse)).not.toThrow();
    } finally {
      if (previous) {
        // oxlint-disable-next-line no-extend-native -- Restore the exact descriptor after this regression.
        Object.defineProperty(Object.prototype, 'enum', previous);
      } else {
        Reflect.deleteProperty(Object.prototype, 'enum');
      }
    }
  });
  test.each(['body', 'agent', 'text'] as const)(
    'rejects a custom %s serialization hook before typed dispatch',
    (level) => {
      const format = zodAgentTextFormat(z4.object({ summary: z4.string() }));
      const { client, requests } = setup([created(), message('{"summary":"unused"}'), completed(), idle()]);
      const body = {
        agent: { text: { format } },
        environment: { type: 'none' as const },
        input: 'Report',
        stream: true as const,
      };
      const envelope = { body, agent: body.agent, text: body.agent.text }[level];
      const hook = vi.fn(() => ({ agent: { text: { format: { type: 'text' } } } }));
      Object.defineProperty(envelope, 'toJSON', { value: hook, enumerable: true });
      expect(() => client.beta.agents.sessions.create(body)).toThrow('cannot customize');
      expect(hook).not.toHaveBeenCalled();
      expect(requests).toHaveLength(0);
    },
  );
  test.each(['inherited', 'non-enumerable', 'own'] as const)(
    'matches native option spread for %s body getters',
    async (kind) => {
      const getter = vi.fn(() => (kind === 'own' ? undefined : { input: 'Unexpected' }));
      const options = {};
      if (kind === 'inherited') {
        Object.setPrototypeOf(options, Object.defineProperty({}, 'body', { get: getter, enumerable: true }));
      } else {
        Object.defineProperty(options, 'body', { get: getter, enumerable: kind === 'own' });
      }
      const format = zodAgentTextFormat(z4.object({ summary: z4.string() }));
      const { client } = setup([created(), message('{"summary":"Expected"}'), completed(), idle()]);
      const stream = await client.beta.agents.sessions.create(
        { agent: { text: { format } }, environment: { type: 'none' }, input: 'Question', stream: true },
        options,
      );
      const result = await stream.finalResult();
      expect(result.output_parsed.summary).toBe('Expected');
      expect(getter).toHaveBeenCalledTimes(kind === 'own' ? 1 : 0);
    },
  );

  test('captures the schema before request-option getters run', async () => {
    const format = zodAgentTextFormat(z4.object({ summary: z4.string() }));
    const schema = structuredClone(format.schema);
    const { client, requests } = setup([created(), message('{"summary":"Expected"}'), completed(), idle()]);
    const stream = await client.beta.agents.sessions.create(
      { agent: { text: { format } }, environment: { type: 'none' }, input: 'Question', stream: true },
      {
        get headers() {
          Object.assign(format.schema, {
            properties: { changed: { type: 'number' } },
            required: ['changed'],
          });
          return {};
        },
      },
    );
    const result = await stream.finalResult();
    expect(result.output_parsed.summary).toBe('Expected');
    expect(await requests[0]?.json()).toMatchObject({ agent: { text: { format: { schema } } } });
  });

  test.each(['type', 'schema'] as const)('rejects an explicit parser with an accessor-backed %s', (key) => {
    const format = zodAgentTextFormat(z4.object({ summary: z4.string() }));
    const getter = vi.fn(() => (key === 'type' ? 'json_schema' : { type: 'object' }));
    Object.defineProperty(format, key, { get: getter, enumerable: true });
    const { client, requests } = setup([]);
    expect(() =>
      client.beta.agents.sessions.create({
        agent: { text: { format } },
        environment: { type: 'none' },
        input: 'Question',
        stream: true,
      }),
    ).toThrow(/data properties/u);
    expect(getter).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  test('typed creation rejects a request-options body override before dispatch', () => {
    const format = zodAgentTextFormat(z4.object({ summary: z4.string() }));
    const { client, requests } = setup([]);
    expect(() =>
      client.beta.agents.sessions.create(
        { agent: { text: { format } }, environment: { type: 'none' }, input: 'Report', stream: true },
        { body: { agent: { text: { format: { type: 'text' } } } } },
      ),
    ).toThrow('cannot override the body');
    expect(requests).toHaveLength(0);
  });
  test('typed creation rejects inherited envelope serialization hooks without invoking them', () => {
    const format = zodAgentTextFormat(z4.object({ summary: z4.string() }));
    const { client, requests } = setup([]);
    const hook = vi.fn();
    const agent = Object.assign(Object.create({ toJSON: hook }), { text: { format } });
    expect(() =>
      client.beta.agents.sessions.create({
        agent,
        environment: { type: 'none' },
        input: 'Report',
        stream: true,
      }),
    ).toThrow('cannot customize');
    expect(hook).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });
  test('parser serialization hooks stay local through agent create and update formats', () => {
    const hook = vi.fn(() => 'private-parser-output');
    const parse = Object.assign(JSON.parse.bind(JSON), { toJSON: hook });
    const format = agentOutputFormat({ type: 'object', properties: {}, required: [] }, parse);
    const serialized = JSON.stringify({ text: { format: { ...format } } });
    expect(serialized).not.toContain('$parseRaw');
    expect(serialized).not.toContain('private-parser-output');
    expect(hook).not.toHaveBeenCalled();
    expect(format.$parseRaw('{}')).toEqual({});
  });
  test('typed stream parameters require the parser that their result type promises', () => {
    const { client } = setup([]);
    const checkTypes = () => {
      // @ts-expect-error A parsed result cannot be requested without its parser.
      const params: AgentSessionStreamParams<{ summary: string }> = { input: 'Report' };
      // @ts-expect-error Explicit generic type arguments do not supply a parser.
      client.beta.agents.sessions.stream<{ summary: string }>(turn.session_id, { input: 'Report' });
      const stream = new AgentSessionStream<{ summary: string }>(
        client.beta.agents.sessions,
        turn.session_id,
        // @ts-expect-error Direct typed construction requires the same parser contract.
        {
          input: 'Report',
        },
      );
      return { params, stream };
    };
    expect(checkTypes).toBeTypeOf('function');
  });
});
