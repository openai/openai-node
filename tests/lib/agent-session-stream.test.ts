import { describe, expect, test, vi } from 'vitest';

import OpenAI, { APIUserAbortError, BadRequestError } from 'openai';
import { outputText } from 'openai/lib/agents/output-text';
import type { AgentSessionEvent, AgentSessionMessage } from 'openai/resources/beta/agents/agents';
import type { AgentToolHandler } from 'openai/lib/agents/agent-session-stream';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  // oxlint-disable-next-line promise/avoid-new -- Tests explicitly control completion of pending transport and handler work.
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return { promise, resolve, reject };
}

const session = { id: 'session_test', status: 'idle' };
function event(type: string, id = type, fields: Record<string, unknown> = {}) {
  return { type, event_id: id, session, ...fields };
}
function turn(type = 'created', id = 'turn_main', subagentID: string | null = null) {
  return event(`agent.session.turn.${type}`, `${type}_${id}`, {
    turn_id: id,
    turn: { id, subagent_id: subagentID },
  });
}
function call(id = 'call_test', arguments_: unknown = '{"value":1}', turnID = 'turn_main', name = 'lookup') {
  return event('agent.session.turn.item.added', `event_${turnID}_${id}`, {
    turn_id: turnID,
    item: {
      id: `item_${id}`,
      type: 'function_call',
      call_id: id,
      turn_id: turnID,
      name,
      arguments: arguments_,
      status: 'in_progress',
    },
  });
}
const idle = () => event('agent.session.idle', 'idle_final');
const ending = () => [turn('completed'), idle()];
type WireEvent = ReturnType<typeof event>;

interface RecordedRequest {
  request: Request;
  body: { events?: Record<string, unknown>[] };
}
function transport(
  events: WireEvent[],
  config: {
    status?: string;
    eof?: boolean;
    post?: (entry: RecordedRequest, index: number) => Response | Promise<Response>;
  } = {},
) {
  const requests: RecordedRequest[] = [];
  const cancel = vi.fn();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel,
  });
  const encoder = new TextEncoder();
  let postIndex = 0;
  const client = new OpenAI({
    apiKey: 'sk-synthetic-agents-test',
    maxRetries: 0,
    fetch: async (url, init) => {
      const request = new Request(url, init);
      const entry: RecordedRequest = {
        request,
        body: request.method === 'POST' ? ((await request.json()) as RecordedRequest['body']) : {},
      };
      requests.push(entry);
      if (request.method === 'GET') {
        if (new URL(request.url).pathname.endsWith('/events')) {
          return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
        }
        return Response.json({ ...session, status: config.status ?? 'idle' });
      }
      postIndex += 1;
      if (postIndex === 1) {
        for (const value of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
        }
        if (config.eof) {
          controller.close();
        }
      }
      return config.post ? await config.post(entry, postIndex) : new Response(null, { status: 204 });
    },
  });
  return { client, requests, cancel, body };
}
async function collect(events: AsyncIterable<AgentSessionEvent>): Promise<AgentSessionEvent[]> {
  const result: AgentSessionEvent[] = [];
  for await (const value of events) {
    result.push(value);
  }
  return result;
}
function posts(requests: RecordedRequest[]) {
  return requests.filter(({ request }) => request.method === 'POST');
}
function badRequest(message: string, code = 'invalid_request_error') {
  return Response.json({ error: { message, code } }, { status: 400 });
}

describe('agents sessions.stream public transport', () => {
  test('subscribes before normalized input and waits for selected coordinator terminal then idle', async () => {
    const events = [
      event('agent.session.idle', 'initial_idle'),
      turn('created', 'child', 'subagent'),
      turn(),
      turn('completed', 'child', 'subagent'),
      event('agent.session.idle', 'child_idle'),
      ...ending(),
    ];
    const { client, requests, cancel, body } = transport(events);
    const stream = client.beta.agents.sessions.stream('session_test', { input: 'Hello' });
    expect(requests).toHaveLength(0);
    const seen = await collect(stream);
    expect(seen).toEqual(events);
    expect(requests.map(({ request }) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'GET /v1/agents/sessions/session_test',
      'GET /v1/agents/sessions/session_test/events',
      'POST /v1/agents/sessions/session_test/events',
    ]);
    expect(posts(requests)[0]?.body).toEqual({
      events: [
        {
          type: 'agent.session.input.message',
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
        },
      ],
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(() => stream[Symbol.asyncIterator]()).toThrow('only be consumed once');
  });

  test.each(['completed', 'failed', 'cancelled'])('yields %s turn and final idle', async (status) => {
    const events = [turn(), turn(status), idle()];
    const { client } = transport(events);
    expect(await collect(client.beta.agents.sessions.stream('session_test', { input: 'x' }))).toEqual(events);
  });

  test('session failure terminates without a turn', async () => {
    const events = [event('agent.session.failed')];
    const { client, cancel } = transport(events);
    expect(await collect(client.beta.agents.sessions.stream('session_test', { input: 'x' }))).toEqual(events);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test('rejects unexpected EOF after initial idle', async () => {
    const { client, body } = transport([event('agent.session.idle')], { eof: true });
    await expect(collect(client.beta.agents.sessions.stream('session_test', { input: 'x' }))).rejects.toThrow(
      'ended before',
    );
    expect(body.locked).toBe(false);
  });

  test('rejects empty input or an active session before subscribing', async () => {
    const { client, requests } = transport([], { status: 'in_progress' });
    expect(() => client.beta.agents.sessions.stream('session_test', { input: '' })).toThrow(
      'must not be empty',
    );
    expect(() => client.beta.agents.sessions.stream('session_test', { input: [] })).toThrow(
      'must not be empty',
    );
    await expect(collect(client.beta.agents.sessions.stream('session_test', { input: 'x' }))).rejects.toThrow(
      'requires an idle session',
    );
    expect(requests).toHaveLength(1);
  });

  test('runs async handlers sequentially, preserves events, and leaves unknown names manual', async () => {
    const first = call('a', { nested: { value: 1 } });
    const events = [turn(), first, call('unknown', {}, 'turn_main', 'toString'), call('b'), ...ending()];
    const order: string[] = [];
    const handler: AgentToolHandler = async (args) => {
      order.push('handler');
      await Promise.resolve();
      if (args['nested']) {
        (args['nested'] as Record<string, unknown>)['value'] = 2;
      }
      return { answer: 'ok' };
    };
    const { client, requests } = transport(events);
    const seen: AgentSessionEvent[] = [];
    for await (const value of client.beta.agents.sessions.stream('session_test', {
      input: 'x',
      toolHandlers: { lookup: handler },
    })) {
      order.push(value.event_id);
      seen.push(value);
    }
    expect(seen).toEqual(events);
    expect(order.indexOf('event_turn_main_a')).toBeLessThan(order.indexOf('handler'));
    expect(order.filter((value) => value === 'handler')).toHaveLength(2);
    expect(posts(requests).map(({ body }) => body.events?.[0]?.['output'])).toEqual([
      undefined,
      '{"answer":"ok"}',
      '{"answer":"ok"}',
    ]);
  });

  test('consumer mutation of a yielded call cannot change dispatch or result identity', async () => {
    const handler = vi.fn(() => 'original result');
    const redirected = vi.fn(() => 'wrong result');
    const { client, requests } = transport([turn(), call('original', { nested: { value: 1 } }), ...ending()]);
    for await (const value of client.beta.agents.sessions.stream('session_test', {
      input: 'x',
      toolHandlers: { lookup: handler, redirected },
    })) {
      if (value.type === 'agent.session.turn.item.added' && value.item.type === 'function_call') {
        value.item.name = 'redirected';
        value.item.turn_id = 'wrong_turn';
        value.item.call_id = 'wrong_call';
        (value.item.arguments as { nested: { value: number } }).nested.value = 99;
      }
    }
    expect(handler).toHaveBeenCalledWith({ nested: { value: 1 } });
    expect(redirected).not.toHaveBeenCalled();
    expect(posts(requests)[1]?.body.events?.[0]).toMatchObject({
      turn_id: 'turn_main',
      call_id: 'original',
      output: 'original result',
      success: true,
    });
  });

  test('accepts interface-typed JSON object handler results', async () => {
    interface SumResult {
      sum: number;
    }
    const { client, requests } = transport([turn(), call(), ...ending()]);
    await collect(
      client.beta.agents.sessions.stream('session_test', {
        input: 'x',
        toolHandlers: {
          lookup: async (): Promise<SumResult> => ({ sum: 4 }),
        },
      }),
    );
    expect(posts(requests)[1]?.body.events?.[0]).toMatchObject({ success: true, output: '{"sum":4}' });
  });

  test.each([null, '', 'text', [{ type: 'input_text', text: 'content' }]])(
    'preserves supported output %j',
    async (output) => {
      const { client, requests } = transport([turn(), call(), ...ending()]);
      await collect(
        client.beta.agents.sessions.stream('session_test', {
          input: 'x',
          toolHandlers: { lookup: () => output },
        }),
      );
      expect(posts(requests)[1]?.body.events?.[0]).toMatchObject({ success: true, output });
    },
  );

  test('redacts unsupported function results accepted by the broad object type', async () => {
    const { client, requests } = transport([turn(), call(), ...ending()]);
    await collect(
      client.beta.agents.sessions.stream('session_test', {
        input: 'x',
        toolHandlers: { lookup: () => () => 'unsupported' },
      }),
    );
    expect(posts(requests)[1]?.body.events?.[0]).toMatchObject({
      success: false,
      error: 'Tool handler failed.',
    });
  });

  test.each([
    { output: [1] },
    { output: [null] },
    { output: [{ type: 'unknown' }] },
    { output: [{ type: 'input_text' }] },
    { output: [{ type: 'input_text', text: 1 }] },
    { output: [{ type: 'input_image', image_url: null }] },
    { output: [Object.create({ type: 'input_text', text: 'inherited' })] },
  ])('redacts malformed serialized content arrays %j', async ({ output }) => {
    const { client, requests } = transport([turn(), call(), ...ending()]);
    await collect(
      client.beta.agents.sessions.stream('session_test', {
        input: 'x',
        toolHandlers: { lookup: () => output },
      }),
    );
    expect(posts(requests)[1]?.body.events?.[0]).toMatchObject({
      success: false,
      error: 'Tool handler failed.',
    });
  });

  test('accepts valid image and text content after serialization', async () => {
    const output = [
      { type: 'input_image', image_url: 'data:image/png;base64,AAA=' },
      { type: 'input_text', text: '' },
    ];
    const { client, requests } = transport([turn(), call(), ...ending()]);
    await collect(
      client.beta.agents.sessions.stream('session_test', {
        input: 'x',
        toolHandlers: { lookup: () => output },
      }),
    );
    expect(posts(requests)[1]?.body.events?.[0]).toMatchObject({ success: true, output });
  });

  test.each([new Error('synthetic reason'), 'stopped', null])(
    'preserves an already-aborted signal reason %j',
    async (reason) => {
      const controller = new AbortController();
      controller.abort(reason);
      const { client, requests } = transport([]);
      const stream = client.beta.agents.sessions.stream(
        'session_test',
        { input: 'x' },
        { signal: controller.signal },
      );
      await expect(collect(stream)).rejects.toMatchObject({ cause: reason });
      expect(requests).toHaveLength(0);
    },
  );

  test('cancellation interrupts registration backoff, clears its timer, and preserves the reason', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const controller = new AbortController();
      const reason = new Error('synthetic backoff cancellation');
      const { client, requests, cancel } = transport([turn(), call()], {
        post: (_entry, index) =>
          index === 1
            ? new Response(null, { status: 204 })
            : badRequest('Unknown pending tool call: call_test'),
      });
      const observed = (async () => {
        try {
          await collect(
            client.beta.agents.sessions.stream(
              'session_test',
              { input: 'x', toolHandlers: { lookup: () => 'ok' } },
              { signal: controller.signal },
            ),
          );
        } catch (error) {
          return error;
        }
        return null;
      })();
      await vi.advanceTimersByTimeAsync(0);
      expect(posts(requests)).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(1);
      controller.abort(reason);
      await vi.advanceTimersByTimeAsync(0);
      const pending = Symbol('backoff still pending');
      const error = await Promise.race([observed, Promise.resolve(pending)]);
      expect(error).toBeInstanceOf(APIUserAbortError);
      expect(Object.getOwnPropertyDescriptor(error, 'cause')).toEqual({
        value: reason,
        writable: true,
        enumerable: false,
        configurable: true,
      });
      expect(vi.getTimerCount()).toBe(0);
      expect(posts(requests)).toHaveLength(2);
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  test('deduplicates recent deliveries and full-invocation tool calls after event ID eviction', async () => {
    const first = call();
    const events = [
      turn(),
      first,
      first,
      ...Array.from({ length: 1025 }, (_, index) => event('agent.session.in_progress', `progress_${index}`)),
      first,
      call('call_test', '{}', 'child'),
      ...ending(),
    ];
    const handler = vi.fn(() => 'ok');
    const { client, requests } = transport(events);
    const seen = await collect(
      client.beta.agents.sessions.stream('session_test', { input: 'x', toolHandlers: { lookup: handler } }),
    );
    expect(seen).toHaveLength(events.length - 1);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(posts(requests)).toHaveLength(3);
  });

  test.each(['invalid JSON', '[]', 'null', '3'])('redacts invalid arguments %s', async (arguments_) => {
    const handler = vi.fn(() => 'ok');
    const { client, requests } = transport([turn(), call('a', arguments_), ...ending()]);
    await collect(
      client.beta.agents.sessions.stream('session_test', { input: 'x', toolHandlers: { lookup: handler } }),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(posts(requests)[1]?.body.events?.[0]).toMatchObject({
      success: false,
      error: 'Tool handler failed.',
    });
  });

  test('redacts handler exceptions and serialization failures', async () => {
    const handler = vi
      .fn<AgentToolHandler>()
      .mockRejectedValueOnce(new Error('synthetic-secret'))
      .mockReturnValueOnce({ number: 1n });
    const { client, requests } = transport([turn(), call('a'), call('b'), ...ending()]);
    await collect(
      client.beta.agents.sessions.stream('session_test', { input: 'x', toolHandlers: { lookup: handler } }),
    );
    expect(
      posts(requests)
        .slice(1)
        .map(({ body }) => body.events?.[0]?.['error']),
    ).toEqual(['Tool handler failed.', 'Tool handler failed.']);
    expect(JSON.stringify(requests.map(({ body }) => body))).not.toContain('synthetic-secret');
  });

  test('reuses distinct input/result keys across ambiguous delivery and registration race retries', async () => {
    const attempts = new Map<string, number>();
    const { client, requests } = transport([turn(), call(), ...ending()], {
      post: (entry) => {
        const type = String(entry.body.events?.[0]?.['type']);
        const count = (attempts.get(type) ?? 0) + 1;
        attempts.set(type, count);
        if (count === 1) {
          return new Response(null, { status: 500, headers: { 'retry-after-ms': '1' } });
        }
        if (type === 'agent.session.input.tool_result' && count === 2) {
          return badRequest('Unknown pending tool call: call_test');
        }
        return new Response(null, { status: 204 });
      },
    });
    const headers = new Headers({ 'iDeMpOtEnCy-KeY': 'input-header-key', 'x-test': 'retained' });
    await collect(
      client.beta.agents.sessions.stream(
        'session_test',
        { input: 'x', idempotencyKey: 'named-key', toolHandlers: { lookup: () => 'ok' } },
        {
          headers,
          maxRetries: 1,
          timeout: 5000,
          query: { trace: 'yes' },
          fetchOptions: { cache: 'no-store' },
        },
      ),
    );
    const submitted = posts(requests);
    expect(submitted.map(({ request }) => request.headers.get('idempotency-key')).slice(0, 2)).toEqual([
      'input-header-key',
      'input-header-key',
    ]);
    const toolKeys = submitted.slice(2).map(({ request }) => request.headers.get('idempotency-key'));
    expect(toolKeys).toHaveLength(3);
    expect(new Set(toolKeys).size).toBe(1);
    expect(toolKeys[0]).not.toBe('input-header-key');
    for (const { request } of requests) {
      expect(request.headers.get('x-test')).toBe('retained');
      expect(request.headers.get('openai-beta')).toBe('agents=v1');
      expect(new URL(request.url).searchParams.get('trace')).toBe('yes');
      expect(request.cache).toBe('no-store');
    }
    expect(headers.get('idempotency-key')).toBe('input-header-key');
    expect(requests[0]?.request.headers.get('idempotency-key')).toBeNull();
  });

  test.each([
    ['Unknown pending tool call: different', 'invalid_request_error'],
    ['Unknown pending tool call: call_test', 'different_code'],
  ])('does not retry unrelated 400 %s/%s', async (message, code) => {
    const { client, requests, cancel } = transport([turn(), call(), ...ending()], {
      post: (_entry, index) =>
        index === 1 ? new Response(null, { status: 204 }) : badRequest(message, code),
    });
    await expect(
      collect(
        client.beta.agents.sessions.stream('session_test', {
          input: 'x',
          toolHandlers: { lookup: () => 'ok' },
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(posts(requests)).toHaveLength(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test('closes subscription when input fails before the event iterator starts', async () => {
    const { client, cancel, body } = transport([], { post: () => badRequest('invalid input') });
    await expect(
      collect(client.beta.agents.sessions.stream('session_test', { input: 'x' })),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  test('early break closes the reader without dispatching the yielded tool', async () => {
    const handler = vi.fn(() => 'ok');
    const { client, cancel, requests, body } = transport([call()]);
    const stream = client.beta.agents.sessions.stream('session_test', {
      input: 'x',
      toolHandlers: { lookup: handler },
    });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    expect(cancel).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
    expect(posts(requests)).toHaveLength(1);
    expect(body.locked).toBe(false);
  });

  test('external cancellation interrupts a pending handler and sends no result', async () => {
    const started = deferred<boolean>();
    const pending = deferred<string>();
    const controller = new AbortController();
    const { client, cancel, requests, body } = transport([turn(), call()]);
    const stream = client.beta.agents.sessions.stream(
      'session_test',
      {
        input: 'x',
        toolHandlers: {
          lookup: () => {
            started.resolve(true);
            return pending.promise;
          },
        },
      },
      { signal: controller.signal },
    );
    const result = collect(stream);
    await started.promise;
    controller.abort();
    await expect(result).rejects.toBeInstanceOf(APIUserAbortError);
    pending.resolve('late');
    expect(cancel).toHaveBeenCalledOnce();
    expect(posts(requests)).toHaveLength(1);
    expect(body.locked).toBe(false);
  });

  test('a synchronous handler may abort and throw without an unhandled rejection', async () => {
    const controller = new AbortController();
    const { client, requests, cancel } = transport([turn(), call()]);
    const stream = client.beta.agents.sessions.stream(
      'session_test',
      {
        input: 'x',
        toolHandlers: {
          lookup: () => {
            controller.abort();
            throw new Error('synthetic callback cancellation');
          },
        },
      },
      { signal: controller.signal },
    );
    await expect(collect(stream)).rejects.toBeInstanceOf(APIUserAbortError);
    expect(posts(requests)).toHaveLength(1);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test('abort during input submission closes the unread subscription', async () => {
    const started = deferred<boolean>();
    const pending = deferred<Response>();
    const { client, cancel, body } = transport([], {
      post: ({ request }) => {
        request.signal.addEventListener(
          'abort',
          () => pending.reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
        started.resolve(true);
        return pending.promise;
      },
    });
    const stream = client.beta.agents.sessions.stream('session_test', { input: 'x' });
    const result = collect(stream);
    await started.promise;
    stream.abort();
    await expect(result).rejects.toBeInstanceOf(APIUserAbortError);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  test('aborts an event read and a pre-aborted invocation', async () => {
    const { client, requests, cancel } = transport([turn()]);
    const stream = client.beta.agents.sessions.stream('session_test', { input: 'x' });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    const next = iterator.next();
    stream.controller.abort();
    await expect(next).rejects.toBeInstanceOf(APIUserAbortError);
    expect(cancel).toHaveBeenCalledOnce();
    const unopened = client.beta.agents.sessions.stream('session_test', { input: 'x' });
    unopened.abort();
    await expect(collect(unopened)).rejects.toBeInstanceOf(APIUserAbortError);
    expect(requests).toHaveLength(3);
  });
});

test('outputText joins only output_text in order without mutation or phase filtering', () => {
  const message: AgentSessionMessage = {
    id: 'message',
    type: 'message',
    role: 'assistant',
    phase: 'commentary',
    status: 'completed',
    turn_id: 'turn',
    content: [
      { type: 'output_text', text: 'Hello' },
      { type: 'input_text', text: 'ignored' },
      { type: 'output_text', text: ' world' },
    ],
  };
  const before = JSON.stringify(message);
  expect(outputText(message)).toBe('Hello world');
  expect(JSON.stringify(message)).toBe(before);
  expect(outputText({ ...message, phase: 'final_answer', content: [] })).toBe('');
});
