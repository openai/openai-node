import { describe, expect, test, vi } from 'vitest';
import OpenAI from 'openai';
import { AgentTurnResultError } from 'openai/lib/beta/agents/agent-turn-result-error';
import { Stream } from 'openai/core/streaming';
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
    {
      name: 'null phase',
      events: [created(), message('ambiguous', null), completed(), idle()],
      reason: 'output_selection',
    },
    {
      name: 'unfinished message',
      events: [created(), message('partial', 'final_answer', 'a', 0, false), completed(), idle()],
      reason: 'output_selection',
    },
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
    await expect(collect(stream)).rejects.toThrow('later failure');
    const result = await stream.finalResult();
    expect(result.output_text).toBe('Final answer');
  });
});
