import { describe, expect, test, vi } from 'vitest';
import OpenAI from 'openai';
import { Stream } from 'openai/core/streaming';
import { zodResponsesFunction } from 'openai/helpers/zod';
import { zodAgentTextFormat } from 'openai/helpers/beta/agents/zod';
import { functionTool } from 'openai/lib/beta/agents/function-tool';
import { z } from 'zod/v4';

const sessionID = 'session_creation';
const turnID = 'turn_creation';
let eventID = 0;
function event(type: string, fields: Record<string, unknown> = {}) {
  eventID += 1;
  return { type, event_id: `event_${eventID}`, session_id: sessionID, turn_id: turnID, ...fields };
}
function call(callID = 'call_lookup', name = 'lookup') {
  return event('agent.session.turn.item.added', {
    item: {
      type: 'function_call',
      id: callID,
      call_id: callID,
      turn_id: turnID,
      name,
      arguments: { id: 'A123' },
    },
  });
}
function initial() {
  return [
    event('agent.session.created', { session: { id: sessionID } }),
    event('agent.session.turn.created', { turn: { id: turnID, subagent_id: null, session_id: sessionID } }),
  ];
}
function ending() {
  return [
    event('agent.session.turn.item.done', {
      output_index: 0,
      item: {
        type: 'message',
        id: 'answer',
        turn_id: turnID,
        role: 'assistant',
        phase: 'final_answer',
        status: 'completed',
        content: [{ type: 'output_text', text: '{"answer":"found"}', annotations: [] }],
      },
    }),
    event('agent.session.turn.completed', {
      turn: { id: turnID, subagent_id: null, session_id: sessionID, status: 'completed' },
    }),
    event('agent.session.idle', { session: { id: sessionID, required_actions: [] } }),
  ];
}
function setup(events = [...initial(), call(), ...ending()], retry = false) {
  const requests: Request[] = [];
  const bodies: unknown[] = [];
  const cancel = vi.fn();
  let failures = 0;
  const client = new OpenAI({
    apiKey: 'synthetic',
    maxRetries: 0,
    fetch: async (url, init) => {
      const request = new Request(url, init);
      requests.push(request);
      bodies.push(await request.json());
      if (new URL(request.url).pathname.endsWith('/events')) {
        if (retry && failures === 0) {
          failures += 1;
          return Response.json(
            { error: { code: 'invalid_request_error', message: 'Unknown pending tool call: call_lookup' } },
            { status: 400 },
          );
        }
        return new Response(null, { status: 204 });
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const value of events) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
            }
          },
          cancel,
        }),
        { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'creation_request' } },
      );
    },
  });
  return { client, requests, bodies, cancel };
}

const params = {
  agent: { model: 'gpt-6-astra' },
  environment: { type: 'none' as const },
  input: 'Look up A123',
  stream: true as const,
};

describe('creation-stream tool handlers', () => {
  test('uses typed tools and output, retries registration, and does not resubmit initial input', async () => {
    const handler = vi.fn(({ id }: { id: string }) => ({ id, status: 'found' }));
    const tool = functionTool(
      zodResponsesFunction({ name: 'lookup', parameters: z.object({ id: z.string() }), function: handler }),
    );
    const firstCall = call();
    const { client, requests, bodies, cancel } = setup(
      [...initial(), firstCall, firstCall, call('call_second'), ...ending()],
      true,
    );
    const { data: stream, request_id } = await client.beta.agents.sessions
      .create(
        {
          ...params,
          agent: {
            model: 'gpt-6-astra',
            tools: [tool.definition],
            text: { format: zodAgentTextFormat(z.object({ answer: z.string() })) },
          },
          toolHandlers: { [tool.name]: tool.handler },
        },
        { headers: { 'Idempotency-Key': 'creation-key', 'X-Application': 'example' } },
      )
      .withResponse();
    expect(stream).toBeInstanceOf(Stream);
    expect(request_id).toBe('creation_request');
    const result = await stream.finalResult();
    expect(result.output_parsed).toEqual({ answer: 'found' });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(bodies[0]).not.toHaveProperty('toolHandlers');
    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      'POST /v1/agents/sessions',
      ...Array.from({ length: 3 }, () => `POST /v1/agents/sessions/${sessionID}/events`),
    ]);
    expect(requests.every((r) => r.headers.get('x-application') === 'example')).toBe(true);
    const keys = requests.map((r) => r.headers.get('idempotency-key'));
    expect(keys[0]).toBe('creation-key');
    expect(keys[1]).toBeTruthy();
    expect(keys[1]).toBe(keys[2]);
    expect(new Set([keys[0], keys[1], keys[3]]).size).toBe(3);
    expect(bodies[1]).toEqual({
      events: [
        {
          type: 'agent.session.input.tool_result',
          turn_id: turnID,
          call_id: 'call_lookup',
          success: true,
          output: '{"id":"A123","status":"found"}',
        },
      ],
    });
    expect(await stream.finalResult()).toBe(result);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test('captures routing and arguments before yielding and redacts handler failures', async () => {
    const handler = vi.fn(() => {
      throw new Error('private application detail');
    });
    const { client, bodies } = setup();
    const stream = await client.beta.agents.sessions.create({ ...params, toolHandlers: { lookup: handler } });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    const next = await iterator.next();
    if (
      !next.done &&
      next.value.type === 'agent.session.turn.item.added' &&
      next.value.item.type === 'function_call'
    ) {
      next.value.item.arguments = { id: 'changed' };
      next.value.item.call_id = 'changed';
    }
    await iterator.next();
    await iterator.return?.();
    expect(handler).toHaveBeenCalledWith({ id: 'A123' });
    expect(bodies[1]).toEqual({
      events: [
        {
          type: 'agent.session.input.tool_result',
          turn_id: turnID,
          call_id: 'call_lookup',
          success: false,
          error: 'Tool handler failed.',
        },
      ],
    });
  });

  test.each(['break', 'abort'] as const)('does not run a yielded tool after %s', async (close) => {
    const handler = vi.fn(() => 'found');
    const { client, requests, cancel } = setup();
    const stream = await client.beta.agents.sessions.create({ ...params, toolHandlers: { lookup: handler } });
    for await (const item of stream) {
      if (item.type === 'agent.session.turn.item.added') {
        if (close === 'abort') {
          stream.controller.abort();
        }
        break;
      }
    }
    expect(handler).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test('aborting a pending handler stops collection without posting its result', async () => {
    const { client, requests, cancel } = setup();
    const controller = new AbortController();
    const stream = await client.beta.agents.sessions.create(
      {
        ...params,
        toolHandlers: {
          lookup: () => {
            controller.abort();
            // oxlint-disable-next-line promise/avoid-new -- A callback that never settles exercises cancellation independently of transport.
            return new Promise<null>(() => {});
          },
        },
      },
      { signal: controller.signal },
    );
    await expect(stream.finalResult()).rejects.toHaveProperty('reason', 'observation');
    expect(requests).toHaveLength(1);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test.each([true, false])('collects with a registered required action: %s', async (handled) => {
    const required = event('agent.session.requires_action', {
      session: {
        id: sessionID,
        required_actions: [
          { type: 'function_call', name: 'lookup', call_id: 'call_lookup', turn_id: turnID },
        ],
      },
    });
    const { client } = setup([...initial(), required, call(), ...ending()]);
    const stream = await client.beta.agents.sessions.create({
      ...params,
      toolHandlers: handled ? { lookup: () => 'found' } : {},
    });
    await (handled
      ? expect(stream.finalResult()).resolves.toHaveProperty('output_text', '{"answer":"found"}')
      : expect(stream.finalResult()).rejects.toHaveProperty('reason', 'requires_action'));
  });

  test('snapshots streaming mode and shared header values before the request', async () => {
    const { client, requests, bodies } = setup();
    const streamGetter = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const headerGetter = vi.fn().mockReturnValueOnce('initial').mockReturnValue('changed');
    const body = { ...params, toolHandlers: { lookup: () => 'found' } };
    Object.defineProperty(body, 'stream', { enumerable: true, get: streamGetter });
    const stream = await client.beta.agents.sessions.create(body, {
      headers: {
        get 'x-application'() {
          return headerGetter();
        },
      },
    });
    await stream.finalResult();
    expect(streamGetter).toHaveBeenCalledOnce();
    expect(headerGetter).toHaveBeenCalledOnce();
    expect(bodies[0]).toHaveProperty('stream', true);
    expect(requests).toHaveLength(2);
    expect(requests.every((r) => r.headers.get('x-application') === 'initial')).toBe(true);
  });

  test('an undefined registry preserves ordinary body identity and deferred option evaluation', async () => {
    const { client } = setup();
    const body = { ...params };
    Object.defineProperty(body, 'toolHandlers', { value: undefined, enumerable: true });
    const timeout = vi.fn(() => 1000);
    const prepare = vi.fn((options: { body?: unknown }) => {
      expect(options.body).toBe(body);
    });
    Object.defineProperty(client, 'prepareOptions', { value: prepare });
    const promise = client.beta.agents.sessions.create(body, {
      get timeout() {
        return timeout();
      },
    });
    expect(timeout).not.toHaveBeenCalled();
    const stream = await promise;
    await stream.finalResult();
    expect(prepare).toHaveBeenCalledOnce();
  });

  test('does not enable handlers inherited from the request prototype', async () => {
    const { client, requests } = setup();
    const handler = vi.fn(() => 'unexpected');
    const body = Object.setPrototypeOf({ ...params }, { toolHandlers: { lookup: handler } });
    const stream = await client.beta.agents.sessions.create(body);
    await stream.finalResult();
    expect(handler).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });

  test('rejects body serialization overrides that could send local handler data', () => {
    const { client, requests } = setup();
    const handler = Object.assign(() => null, { toJSON: () => 'private callback data' });
    const body = { ...params, toolHandlers: { lookup: handler } };
    const custom = { ...body, toJSON: () => body };
    expect(() => client.beta.agents.sessions.create(custom)).toThrow(
      'cannot customize request body serialization',
    );
    expect(() => client.beta.agents.sessions.create(body, { body })).toThrow(
      'cannot customize request body serialization',
    );
    expect(requests).toHaveLength(0);
  });

  test('rejects handlers without streaming before sending a request', () => {
    const { client, requests } = setup();
    expect(() =>
      // @ts-expect-error Local handlers require an explicitly streaming creation.
      client.beta.agents.sessions.create({ ...params, stream: false, toolHandlers: { lookup: () => null } }),
    ).toThrow('toolHandlers requires stream: true');
    expect(requests).toHaveLength(0);
  });
});
