// oxlint-disable eslint/max-classes-per-file -- Separate small transport subclasses exercise custom emission and uncertain writes at their public boundaries.
import { once } from 'node:events';
import { expectTypeOf, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';
import OpenAI from 'openai';
import { ResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWebSocketSession } from 'openai/lib/responses/responses-websocket-session';
import type { ResponsesWebSocketLane } from 'openai/lib/responses/responses-websocket-session';
import { ResponsesWebSocketAccumulator } from 'openai/lib/responses/responses-websocket-accumulator';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type { Response, ResponseInputItem, ResponsesServerEvent } from 'openai/resources/responses/responses';
import { rawByteLength } from 'openai/internal/ws';
import * as webSocketInternals from 'openai/internal/ws';
import scenarios from './fixtures/websocket_scenarios.json';
import { measureElementMovement } from '../helpers/measure-element-movement';

const limits = { maxLanes: 8, maxBufferedEvents: 128, maxBufferedBytes: 32 * 1024 * 1024 };

test('lane types distinguish WebSocket requests, raw events, and normalized responses', () => {
  type Request = Parameters<ResponsesWebSocketLane['create']>[0];
  type Event = Awaited<ReturnType<ResponsesWebSocketLane['receive']>>;
  type Completed = Extract<Event, { type: 'response.completed' }>['response'];
  expectTypeOf<Extract<keyof Request, 'stream' | 'background'>>().toEqualTypeOf<never>();
  expectTypeOf<Completed['output']>().toEqualTypeOf<Response['output'] | undefined>();
  expectTypeOf<Completed['output_text']>().toEqualTypeOf<string | undefined>();
  expectTypeOf<{ type: 'response.future_event'; payload: string }>().toExtend<Event>();
  expectTypeOf<Awaited<ReturnType<ResponsesWebSocketLane['finalResponse']>>>().toEqualTypeOf<Response>();
});

class CustomResponsesWS extends ResponsesWS {
  emitCustomEvent(event: ResponsesServerEvent): void {
    this._emit('event', event);
  }
}

async function withSocket(
  run: (connection: CustomResponsesWS, peer: WebSocket) => Promise<void>,
): Promise<void> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing local server address');
  }
  const incoming = once(server, 'connection');
  const connection = new CustomResponsesWS(
    new OpenAI({ apiKey: 'synthetic-key', baseURL: `http://127.0.0.1:${address.port}/v1` }),
  );
  connection.on('error', () => {});
  const [peer] = await incoming;
  await once(connection.socket.platformSocket, 'open');
  try {
    await run(connection, peer);
  } finally {
    connection.close();
    for (const socket of server.clients) {
      socket.terminate();
    }
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
}

function response(id: string, status: Response['status'] = 'completed') {
  return {
    id,
    status,
    object: 'response',
    created_at: 0,
    model: 'test-model',
    output: [],
    parallel_tool_calls: false,
    tool_choice: 'auto',
    tools: [],
  };
}

test('caller-fed provisional output borrows no reader and leaves other lanes and raw events available', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const previewLane = session.lane('preview');
    const defaultLane = session.lane('default');
    const preview = new ResponsesWebSocketAccumulator();
    const raw: string[] = [];
    connection.on('event', (event) => raw.push(event.type));
    const signal = AbortSignal.timeout(3000);
    try {
      peer.send(JSON.stringify({ type: 'response.created', response: { id: 'p' }, stream_id: 'preview' }));
      peer.send(
        JSON.stringify({
          type: 'response.output_item.added',
          output_index: 0,
          stream_id: 'preview',
          item: {
            type: 'function_call',
            id: 'fc_preview',
            name: 'never_run',
            call_id: 'call_p',
            arguments: '',
          },
        }),
      );
      peer.send(
        JSON.stringify({
          type: 'response.function_call_arguments.delta',
          item_id: 'fc_preview',
          output_index: 0,
          delta: '{"preview":true}',
          stream_id: 'preview',
        }),
      );
      peer.send(
        JSON.stringify({ type: 'response.completed', response: response('default'), stream_id: 'default' }),
      );
      preview.add(await previewLane.receive({ signal }));
      preview.add(await previewLane.receive({ signal }));
      preview.add(await previewLane.receive({ signal }));
      expect(preview.current).toMatchObject({
        phase: 'provisional',
        snapshot: { output: [{ arguments: '{"preview":true}' }] },
      });
      expect(await defaultLane.finalResponse({ signal })).toMatchObject({ id: 'default', output: [] });
      preview.reset();
      expect(preview.current).toBeUndefined();
      const terminal = {
        type: 'response.failed',
        response: { id: 'p', error: { message: 'synthetic failure' } },
        stream_id: 'preview',
      };
      peer.send(JSON.stringify(terminal));
      const rawTerminal = await previewLane.receive({ signal });
      preview.add(rawTerminal);
      expect(preview.current).toEqual({ phase: 'terminal', event: terminal });
      expect(raw).toEqual([
        'response.created',
        'response.output_item.added',
        'response.function_call_arguments.delta',
        'response.completed',
        'response.failed',
      ]);
      preview.reset();
      peer.send(
        JSON.stringify({ type: 'response.completed', response: response('next'), stream_id: 'preview' }),
      );
      expect(await previewLane.finalResponse({ signal })).toMatchObject({ id: 'next', output: [] });
    } finally {
      session.close();
    }
  });
});

test('idle and reset previews ignore non-output wire events but still reject unscaffolded output', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane('preview');
    const preview = new ResponsesWebSocketAccumulator();
    const signal = AbortSignal.timeout(3000);
    try {
      for (const frame of [
        { type: 'keepalive', sequence_number: 1, stream_id: 'preview' },
        { type: 'response.compaction.compacting', sequence_number: 2, stream_id: 'preview' },
        { type: 'response.future_event', extra: { visible: true }, stream_id: 'preview' },
      ]) {
        peer.send(JSON.stringify(frame));
        // oxlint-disable-next-line eslint/no-await-in-loop -- The lane permits one reader, and each event must leave the idle preview unchanged.
        const received = await lane.receive({ signal });
        expect(received).toEqual(frame);
        preview.add(received);
        expect(preview.current).toBeUndefined();
      }
      peer.send(JSON.stringify({ type: 'response.created', response: { id: 'r' }, stream_id: 'preview' }));
      preview.add(await lane.receive({ signal }));
      expect(preview.current).toEqual({ phase: 'provisional', snapshot: { output: [], output_text: '' } });
      preview.reset();
      peer.send(JSON.stringify({ type: 'keepalive', sequence_number: 3, stream_id: 'preview' }));
      preview.add(await lane.receive({ signal }));
      expect(preview.current).toBeUndefined();
      peer.send(
        JSON.stringify({
          type: 'response.output_text.delta',
          item_id: 'missing',
          output_index: 0,
          content_index: 0,
          delta: 'actual unscaffolded output',
          stream_id: 'preview',
        }),
      );
      preview.add(await lane.receive({ signal }));
      expect(preview.current?.phase).toBe('unavailable');
      const terminal = {
        type: 'response.completed',
        response: { id: 'r', output: [] },
        stream_id: 'preview',
      };
      peer.send(JSON.stringify(terminal));
      preview.add(await lane.receive({ signal }));
      expect(preview.current).toEqual({ phase: 'terminal', event: terminal });
    } finally {
      session.close();
    }
  });
});

test.each([
  ['missing arguments', { type: 'function_call', id: 'fc', name: 'data', call_id: 'c' }],
  ['numeric arguments', { type: 'function_call', id: 'fc', name: 'data', call_id: 'c', arguments: 1 }],
  ['null arguments', { type: 'function_call', id: 'fc', name: 'data', call_id: 'c', arguments: null }],
  ['missing name', { type: 'function_call', id: 'fc', call_id: 'c', arguments: '' }],
  ['non-string name', { type: 'function_call', id: 'fc', name: 123, call_id: 'c', arguments: '' }],
  ['custom non-string input', { type: 'custom_tool_call', id: 'fc', name: 'data', call_id: 'c', input: {} }],
  ['custom missing input', { type: 'custom_tool_call', id: 'fc', name: 'data', call_id: 'c' }],
  ['MCP missing arguments', { type: 'mcp_call', id: 'fc', name: 'data', server_label: 'synthetic' }],
  [
    'MCP numeric arguments',
    { type: 'mcp_call', id: 'fc', name: 'data', server_label: 'synthetic', arguments: 1 },
  ],
  [
    'MCP null arguments',
    { type: 'mcp_call', id: 'fc', name: 'data', server_label: 'synthetic', arguments: null },
  ],
  ['MCP missing name', { type: 'mcp_call', id: 'fc', server_label: 'synthetic', arguments: '' }],
  [
    'MCP non-string name',
    { type: 'mcp_call', id: 'fc', name: 123, server_label: 'synthetic', arguments: '' },
  ],
  ['MCP missing server label', { type: 'mcp_call', id: 'fc', name: 'data', arguments: '' }],
  [
    'MCP non-string server label',
    { type: 'mcp_call', id: 'fc', name: 'data', server_label: false, arguments: '' },
  ],
  ['future discriminator', { type: 'future_item', id: 'x' }],
  ['Object prototype discriminator', { type: 'constructor', id: 'x' }],
  ['non-string discriminator', { type: 123, id: 'x' }],
])('raw output with %s never enters a typed provisional snapshot', async (_label, item) => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane();
    const preview = new ResponsesWebSocketAccumulator();
    const signal = AbortSignal.timeout(3000);
    try {
      // Both lifecycle output and output-item frames cross the same raw boundary.
      const created = { type: 'response.created', response: { id: 'r', output: [item] } };
      peer.send(JSON.stringify(created));
      const raw = await lane.receive({ signal });
      expect(raw).toEqual(created);
      preview.add(raw);
      expect(preview.current?.phase).toBe('unavailable');
      peer.send(JSON.stringify({ type: 'response.created', response: { id: 'r2' } }));
      preview.add(await lane.receive({ signal }));
      const added = { type: 'response.output_item.added', output_index: 0, item };
      peer.send(JSON.stringify(added));
      const rawAdded = await lane.receive({ signal });
      expect(rawAdded).toEqual(added);
      preview.add(rawAdded);
      expect(preview.current?.phase).toBe('unavailable');
      peer.send(JSON.stringify({ type: 'response.created', response: { id: 'r3' } }));
      preview.add(await lane.receive({ signal }));
      const done = { type: 'response.output_item.done', output_index: 0, item };
      peer.send(JSON.stringify(done));
      const rawDone = await lane.receive({ signal });
      expect(rawDone).toEqual(done);
      preview.add(rawDone);
      expect(preview.current?.phase).toBe('unavailable');
      const terminal = { type: 'response.failed', response: { id: 'r2', error: { message: 'synthetic' } } };
      peer.send(JSON.stringify(terminal));
      preview.add(await lane.receive({ signal }));
      expect(preview.current).toEqual({ phase: 'terminal', event: terminal });
    } finally {
      session.close();
    }
  });
});

test.each([
  ['function_call', 'response.function_call_arguments.delta', { delta: 123 }],
  ['function_call', 'response.function_call_arguments.done', { arguments: 123 }],
  ['function_call', 'response.function_call_arguments.done', { arguments: null }],
  ['function_call', 'response.function_call_arguments.done', {}],
  ['mcp_call', 'response.mcp_call_arguments.delta', { delta: 123 }],
  ['mcp_call', 'response.mcp_call_arguments.done', { arguments: 1 }],
  ['mcp_call', 'response.mcp_call_arguments.done', { arguments: null }],
  ['mcp_call', 'response.mcp_call_arguments.done', {}],
  ['custom_tool_call', 'response.custom_tool_call_input.delta', { delta: null }],
  ['custom_tool_call', 'response.custom_tool_call_input.done', { input: {} }],
  ['custom_tool_call', 'response.custom_tool_call_input.done', {}],
])('%s with invalid %s raw payload leaves the preview unavailable', async (itemType, type, payload) => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane();
    const preview = new ResponsesWebSocketAccumulator();
    const signal = AbortSignal.timeout(3000);
    try {
      peer.send(
        JSON.stringify({
          type: 'response.created',
          response: {
            id: 'r',
            output: [
              {
                type: itemType,
                id: 'tool_1',
                call_id: 'call_1',
                name: 'as_data',
                server_label: 'synthetic-mcp',
                arguments: '',
                input: '',
              },
            ],
          },
        }),
      );
      preview.add(await lane.receive({ signal }));
      expect(preview.current?.phase).toBe('provisional');
      const invalid = { type, item_id: 'tool_1', output_index: 0, ...payload };
      peer.send(JSON.stringify(invalid));
      const raw = await lane.receive({ signal });
      expect(raw).toEqual(invalid);
      preview.add(raw);
      expect(preview.current?.phase).toBe('unavailable');
      const final = { type: 'response.incomplete', response: { id: 'r' } };
      peer.send(JSON.stringify(final));
      preview.add(await lane.receive({ signal }));
      expect(preview.current).toEqual({ phase: 'terminal', event: final });
    } finally {
      session.close();
    }
  });
});

test.each([
  ['null content', { content: null }],
  ['missing content', {}],
  ['non-array content', { content: { type: 'output_text', text: 'not an array' } }],
  ['null content part', { content: [null] }],
  ['numeric text', { content: [{ type: 'output_text', text: 123, annotations: [] }] }],
  ['missing text', { content: [{ type: 'output_text', annotations: [] }] }],
])('message with %s cannot invalidate a later provisional output_text read', async (_label, fields) => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane();
    const preview = new ResponsesWebSocketAccumulator();
    const signal = AbortSignal.timeout(3000);
    try {
      const initial = {
        type: 'response.created',
        response: { id: 'r', output_text: 'from wire', output: [{ type: 'message', id: 'm', ...fields }] },
      };
      peer.send(JSON.stringify(initial));
      const received = await lane.receive({ signal });
      expect(received).toEqual(initial);
      preview.add(received);
      peer.send(
        JSON.stringify({
          type: 'response.output_item.added',
          output_index: 1,
          item: { type: 'message', id: 'later', content: [] },
        }),
      );
      preview.add(await lane.receive({ signal }));
      expect(preview.current?.phase).toBe('unavailable');
      const terminal = { type: 'response.failed', response: { id: 'r', error: { message: 'synthetic' } } };
      peer.send(JSON.stringify(terminal));
      preview.add(await lane.receive({ signal }));
      expect(preview.current).toEqual({ phase: 'terminal', event: terminal });
    } finally {
      session.close();
    }
  });
});

test.each(['response.content_part.added', 'response.content_part.done'])(
  'raw numeric output_text in %s never becomes an aggregate string',
  async (type) => {
    await withSocket(async (connection, peer) => {
      const session = new ResponsesWebSocketSession(connection, limits);
      const lane = session.lane();
      const preview = new ResponsesWebSocketAccumulator();
      const signal = AbortSignal.timeout(3000);
      try {
        const original = { type: 'output_text', text: 'previous', annotations: [] };
        peer.send(
          JSON.stringify({
            type: 'response.created',
            response: { id: 'r', output: [{ type: 'message', id: 'm', content: [original] }] },
          }),
        );
        preview.add(await lane.receive({ signal }));
        const before = preview.current;
        expect(before).toMatchObject({ phase: 'provisional', snapshot: { output_text: 'previous' } });
        const frame = {
          type,
          item_id: 'm',
          output_index: 0,
          content_index: type === 'response.content_part.added' ? 1 : 0,
          part: { type: 'output_text', text: 123, annotations: [] },
        };
        peer.send(JSON.stringify(frame));
        const received = await lane.receive({ signal });
        expect(received).toEqual(frame);
        preview.add(received);
        expect(preview.current?.phase).toBe('unavailable');
        expect(before).toMatchObject({
          snapshot: { output_text: 'previous', output: [{ content: [original] }] },
        });
        const terminal = { type: 'response.completed', response: { id: 'r' } };
        peer.send(JSON.stringify(terminal));
        preview.add(await lane.receive({ signal }));
        expect(preview.current).toEqual({ phase: 'terminal', event: terminal });
      } finally {
        session.close();
      }
    });
  },
);

test.each([
  ['output_text', 'response.output_text.delta', { delta: 1 }],
  ['output_text', 'response.output_text.done', { text: 1 }],
  ['output_text', 'response.output_text.done', { text: null }],
  ['output_text', 'response.output_text.done', {}],
  ['refusal', 'response.refusal.delta', { delta: 1 }],
  ['refusal', 'response.refusal.done', { refusal: {} }],
])('malformed %s %s stays raw instead of becoming message text', async (partType, type, payload) => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane();
    const preview = new ResponsesWebSocketAccumulator();
    const signal = AbortSignal.timeout(3000);
    try {
      const content =
        partType === 'output_text'
          ? { type: 'output_text', text: 'previous', annotations: [], logprobs: [] }
          : { type: 'refusal', refusal: 'previous' };
      peer.send(
        JSON.stringify({
          type: 'response.created',
          response: {
            id: 'r',
            output: [
              { type: 'message', id: 'm', role: 'assistant', status: 'in_progress', content: [content] },
            ],
          },
        }),
      );
      preview.add(await lane.receive({ signal }));
      const before = preview.current;
      expect(before?.phase).toBe('provisional');
      const frame = { type, item_id: 'm', output_index: 0, content_index: 0, ...payload };
      peer.send(JSON.stringify(frame));
      const raw = await lane.receive({ signal });
      expect(raw).toEqual(frame);
      preview.add(raw);
      expect(preview.current?.phase).toBe('unavailable');
      expect(before).toMatchObject({ snapshot: { output: [{ content: [content] }] } });
    } finally {
      session.close();
    }
  });
});

test.each([null, 123, { toString: () => 'coerced' }])(
  'rejects non-string lane ID %j',
  async (value: unknown) => {
    await withSocket(async (connection) => {
      const session = new ResponsesWebSocketSession(connection, limits);
      try {
        // SAFETY: Exercise the public JavaScript boundary without TypeScript's argument checking.
        expect(() => session.lane(value as string)).toThrow('Invalid Responses WebSocket stream ID');
      } finally {
        session.close();
      }
    });
  },
);

test.each(['stream_id', 'streamID'])(
  'defines lane routing without invoking an inherited %s setter',
  async (property) => {
    await withSocket(async (connection, peer) => {
      const session = new ResponsesWebSocketSession(connection, limits);
      const received = once(peer, 'message');
      const previous = Object.getOwnPropertyDescriptor(Object.prototype, property);
      try {
        // oxlint-disable-next-line eslint/no-extend-native -- Reproduce inherited routing pollution at the actual JavaScript boundary, restoring it synchronously.
        Object.defineProperty(Object.prototype, property, {
          configurable: true,
          get() {
            return 'inherited';
          },
          set(value) {
            Object.defineProperty(this, property, { value: `redirected-${value}`, enumerable: true });
          },
        });
        session.lane('owned').create({ model: 'test-model', input: 'request' });
      } finally {
        if (previous) {
          // oxlint-disable-next-line eslint/no-extend-native -- Restore the exact descriptor after the synthetic pollution regression.
          Object.defineProperty(Object.prototype, property, previous);
        } else {
          Reflect.deleteProperty(Object.prototype, property);
        }
      }
      try {
        const [wire] = await received;
        expect(JSON.parse(String(wire)).stream_id).toBe('owned');
      } finally {
        session.close();
      }
    });
  },
);

test('does not expose a mutable routing snapshot to earlier observers', async () => {
  await withSocket(async (connection, peer) => {
    connection.on('event', (event) => {
      // oxlint-disable-next-line anti-slop/no-reflect-get -- Probe a removed internal export so the same regression can exercise the vulnerable baseline.
      const snapshots: unknown = Reflect.get(webSocketInternals, 'webSocketEventPayloads');
      if (snapshots instanceof WeakMap) {
        snapshots.set(event, JSON.stringify({ ...event, stream_id: 'redirected' }));
      }
    });
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane('owned');
    session.lane('redirected');
    try {
      const result = lane.finalResponse({ signal: AbortSignal.timeout(3000) });
      peer.send(
        JSON.stringify({ type: 'response.completed', stream_id: 'owned', response: response('owned') }),
      );
      expect(await result).toMatchObject({ id: 'owned' });
    } finally {
      session.close();
    }
  });
});

test.each(['session', 'lane', 'response'] as const)(
  'keeps %s byte accounting private from earlier observers',
  async (budget) => {
    await withSocket(async (connection, peer) => {
      connection.on('event', (event) => {
        // oxlint-disable-next-line anti-slop/no-reflect-get -- Probe a removed internal export to exercise the vulnerable baseline without requiring it in the fixed implementation.
        const sizes: unknown = Reflect.get(webSocketInternals, 'webSocketEventBytes');
        if (sizes instanceof WeakMap) {
          sizes.set(event, 1);
        }
      });
      const session = new ResponsesWebSocketSession(connection, {
        ...limits,
        maxBufferedBytes: budget === 'session' ? 1024 : limits.maxBufferedBytes,
      });
      const lane = session.lane('owned', budget === 'lane' ? { maxBufferedBytes: 1024 } : {});
      try {
        const result = lane.finalResponse({
          signal: AbortSignal.timeout(3000),
          ...(budget === 'response' ? { maxResponseBytes: 1024 } : {}),
        });
        const rejected = expect(result).rejects.toThrow('limit exceeded');
        peer.send(
          JSON.stringify({
            type: 'response.completed',
            stream_id: 'owned',
            response: { ...response('large'), metadata: { padding: 'x'.repeat(2048) } },
          }),
        );
        await rejected;
      } finally {
        session.close();
      }
    });
  },
);

test.each([-1, 0.5])('fails the lane after output index %s corrupts accumulation', async (output_index) => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane('invalid');
    const other = session.lane('other');
    try {
      const first = expect(lane.finalResponse()).rejects.toThrow('output index');
      peer.send(
        JSON.stringify({
          type: 'response.output_item.done',
          stream_id: 'invalid',
          output_index,
          item: { type: 'message', id: 'item', role: 'assistant', status: 'completed', content: [] },
        }),
      );
      await first;
      const arrived = connection.emitted('response.completed');
      peer.send(
        JSON.stringify({ type: 'response.completed', stream_id: 'invalid', response: response('old') }),
      );
      await arrived;
      await expect(lane.finalResponse()).rejects.toThrow('output index');
      expect(() => lane.create({ model: 'test-model', input: 'new' })).toThrow('output index');
      const next = other.finalResponse({ signal: AbortSignal.timeout(3000) });
      peer.send(
        JSON.stringify({ type: 'response.completed', stream_id: 'other', response: response('other') }),
      );
      expect(await next).toMatchObject({ id: 'other' });
    } finally {
      session.close();
    }
  });
});

test('keeps a detached lane reserved after terminal events and automatic successors', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, { ...limits, maxLanes: 1 });
    const lane = session.lane('reused');
    try {
      lane.create({ model: 'test-model', input: 'old-one' });
      lane.create({ model: 'test-model', input: 'old-two' });
      lane.close();
      expect(() => session.lane('reused')).toThrow('already registered');
      const first = connection.emitted('event');
      peer.send(
        JSON.stringify({ type: 'response.completed', stream_id: 'reused', response: response('old-one') }),
      );
      await first;
      expect(() => session.lane('reused')).toThrow('already registered');
      const second = connection.emitted('event');
      peer.send(
        JSON.stringify({ type: 'response.completed', stream_id: 'reused', response: response('old-two') }),
      );
      await second;
      expect(() => session.lane('reused')).toThrow('already registered');
      expect(() => session.lane('another')).toThrow('lane limit exceeded');
      const successor = connection.emitted('event');
      peer.send(
        JSON.stringify({ type: 'response.created', stream_id: 'reused', response: response('successor') }),
      );
      await expect(successor).resolves.toMatchObject({ response: { id: 'successor' } });
      expect(() => session.lane('reused')).toThrow('already registered');
    } finally {
      session.close();
    }
  });
});

test('collects final responses when socket deltas omit SSE setup events', async () => {
  const scenario = scenarios.scenarios.find((item) => item.id === 'completed_then_completed');
  if (!scenario) {
    throw new Error('Missing shared completion scenario');
  }
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane('lane-test');
    for (const turn of scenario.turns) {
      for (const frame of turn.frames) {
        peer.send(JSON.stringify(frame));
      }
      const terminal = turn.frames.find(
        (frame) => typeof frame !== 'string' && frame.type === 'response.completed',
      );
      if (!terminal || typeof terminal === 'string' || !('response' in terminal)) {
        throw new Error('Missing terminal response');
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each terminal response completes a separate turn on the same socket.
      expect(await lane.finalResponse()).toMatchObject(terminal.response);
    }
    session.close();
  });
});

test('collects finalized output items when the terminal response omits output', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane();
    const item = {
      id: 'message',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'collected', annotations: [] }],
    };
    peer.send(
      JSON.stringify({ type: 'response.output_item.done', output_index: 0, item, sequence_number: 0 }),
    );
    const terminal = { ...response('collected'), output: undefined };
    peer.send(JSON.stringify({ type: 'response.completed', response: terminal, sequence_number: 1 }));
    expect(await lane.finalResponse()).toMatchObject({ output: [item], output_text: 'collected' });
    session.close();
  });
});

test('receive preserves omitted output and output_text in raw terminal responses', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane();
    const terminal = { ...response('raw'), output: undefined };
    peer.send(JSON.stringify({ type: 'response.completed', response: terminal, sequence_number: 0 }));
    const event = await lane.receive();
    if (event.type !== 'response.completed') {
      throw new Error('Expected terminal response');
    }
    expect(event).toMatchObject({ type: 'response.completed', response: { id: 'raw' } });
    expect(event['response']).not.toHaveProperty('output');
    expect(event['response']).not.toHaveProperty('output_text');
    session.close();
  });
});

test('routes interleaved lanes, preserves canceled waits, and detaches without closing the socket', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const left = session.lane('left');
    const right = session.lane('right');
    const abort = new AbortController();
    const reason = new Error('canceled local wait');
    const canceled = left.receive({ signal: abort.signal });
    abort.abort(reason);
    await expect(canceled).rejects.toBe(reason);
    const second = {
      type: 'response.completed',
      stream_id: 'right',
      sequence_number: 1,
      response: response('right'),
    };
    const first = {
      type: 'response.completed',
      stream_id: 'left',
      sequence_number: 1,
      response: response('left'),
    };
    peer.send(JSON.stringify(second));
    peer.send(JSON.stringify(first));
    expect(await left.receive()).toEqual(first);
    expect(await right.receive()).toEqual(second);
    left.close();
    const received = once(peer, 'message');
    right.create({ model: 'test-model', input: 'continue', previous_response_id: 'left' });
    const [wire] = await received;
    expect(JSON.parse(String(wire))).toEqual({
      type: 'response.create',
      stream_id: 'right',
      model: 'test-model',
      input: 'continue',
      previous_response_id: 'left',
    });
    session.close();
    const raw = connection.emitted('event');
    peer.send(JSON.stringify(first));
    await expect(raw).resolves.toEqual(first);
  });
});

test('continues a generate:false warmup from its returned terminal ID on the same socket', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane('warmup');
    try {
      const warming = once(peer, 'message');
      const warmupRequest = { model: 'test-model', input: 'Remember Tuesday.', generate: false };
      lane.create(warmupRequest);
      const [warmupWire] = await warming;
      expect(JSON.parse(String(warmupWire))).toEqual({
        type: 'response.create',
        stream_id: 'warmup',
        model: 'test-model',
        input: 'Remember Tuesday.',
        generate: false,
      });
      peer.send(
        JSON.stringify({
          type: 'response.completed',
          stream_id: 'warmup',
          response: response('server_warmup'),
        }),
      );
      const warmup = await lane.finalResponse();
      expect(warmup.output).toEqual([]);

      const continuing = once(peer, 'message');
      lane.create({ model: 'test-model', input: 'Which day?', previous_response_id: warmup.id });
      const [continuationWire] = await continuing;
      expect(JSON.parse(String(continuationWire))).toEqual({
        type: 'response.create',
        stream_id: 'warmup',
        model: 'test-model',
        input: 'Which day?',
        previous_response_id: 'server_warmup',
      });
      peer.send(
        JSON.stringify({
          type: 'response.completed',
          stream_id: 'warmup',
          response: response('server_answer'),
        }),
      );
      expect(await lane.finalResponse()).toMatchObject({ id: 'server_answer', status: 'completed' });
    } finally {
      session.close();
    }
  });
});

test('forks from a completed response while the source lane continues independently', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const source = session.lane('source');
    const fork = session.lane('fork');
    try {
      const original = once(peer, 'message');
      source.create({ model: 'test-model', input: 'Choose a day.', store: false });
      await original;
      peer.send(
        JSON.stringify({
          type: 'response.completed',
          stream_id: 'source',
          response: response('server_parent'),
        }),
      );
      const parent = await source.finalResponse();

      const forking = once(peer, 'message');
      fork.create({
        model: 'test-model',
        input: 'Try another answer.',
        previous_response_id: parent.id,
        store: false,
      });
      const [forkWire] = await forking;
      expect(JSON.parse(String(forkWire))).toEqual({
        type: 'response.create',
        stream_id: 'fork',
        model: 'test-model',
        input: 'Try another answer.',
        previous_response_id: 'server_parent',
        store: false,
      });
      peer.send(
        JSON.stringify({
          type: 'response.created',
          stream_id: 'fork',
          response: response('server_fork', 'in_progress'),
        }),
      );
      expect(await fork.receive()).toMatchObject({ type: 'response.created', stream_id: 'fork' });

      const advancing = once(peer, 'message');
      source.create({
        model: 'test-model',
        input: 'Continue.',
        previous_response_id: parent.id,
        store: false,
      });
      const [sourceWire] = await advancing;
      expect(JSON.parse(String(sourceWire))).toEqual({
        type: 'response.create',
        stream_id: 'source',
        model: 'test-model',
        input: 'Continue.',
        previous_response_id: 'server_parent',
        store: false,
      });
      peer.send(
        JSON.stringify({
          type: 'response.completed',
          stream_id: 'fork',
          response: response('server_fork'),
        }),
      );
      peer.send(
        JSON.stringify({
          type: 'response.completed',
          stream_id: 'source',
          response: response('server_source_next'),
        }),
      );
      expect(await source.finalResponse()).toMatchObject({ id: 'server_source_next' });
      expect(await fork.finalResponse()).toMatchObject({ id: 'server_fork' });
    } finally {
      session.close();
    }
  });
});

test('sends the complete standalone compaction output on a new response chain', async () => {
  const compaction = {
    type: 'compaction' as const,
    id: 'compaction_item',
    encrypted_content: 'synthetic-opaque-compaction',
    future_field: { preserve: [1, 'two'] },
  };
  const userMessage = {
    type: 'message' as const,
    id: 'message_retained',
    role: 'user' as const,
    status: 'completed' as const,
    content: [{ type: 'input_text' as const, text: 'Remember Tuesday.' }],
  };
  const output: ResponseInputItem[] = [userMessage, compaction];
  const client = new OpenAI({
    apiKey: 'synthetic-key',
    fetch: async () =>
      globalThis.Response.json({
        id: 'compaction_result',
        created_at: 1,
        object: 'response.compaction',
        output,
        usage: {
          input_tokens: 1,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
          output_tokens: 1,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 2,
        },
      }),
  });
  const compacted = await client.responses.compact({ model: 'test-model', input: [userMessage] });
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    try {
      const lane = session.lane('compacted');
      const beginning = once(peer, 'message');
      lane.create({ model: 'test-model', input: toResponseInputItems(compacted.output) });
      const [wire] = await beginning;
      expect(JSON.parse(String(wire))).toEqual({
        type: 'response.create',
        stream_id: 'compacted',
        model: 'test-model',
        input: output,
      });
      peer.send(
        JSON.stringify({
          type: 'response.completed',
          stream_id: 'compacted',
          response: response('server_fresh'),
        }),
      );
      expect(await lane.finalResponse()).toMatchObject({ id: 'server_fresh', status: 'completed' });
    } finally {
      session.close();
    }
  });
});

test.each([true, false])(
  'restores on a new connection using caller-owned history: store=%s',
  async (store) => {
    await withSocket(async (connection, peer) => {
      const session = new ResponsesWebSocketSession(connection, limits);
      const initial = { type: 'message' as const, role: 'user' as const, content: 'Remember Tuesday.' };
      try {
        const lane = session.lane('turn');
        const beginning = once(peer, 'message');
        lane.create({ model: 'test-model', input: [initial], store });
        await beginning;
        peer.send(
          JSON.stringify({
            type: 'response.completed',
            stream_id: 'turn',
            response: {
              ...response('server_previous'),
              output: [
                {
                  type: 'message',
                  id: 'message_answer',
                  role: 'assistant',
                  status: 'completed',
                  content: [{ type: 'output_text', text: 'Tuesday.', annotations: [] }],
                },
              ],
            },
          }),
        );
        const previous = await lane.finalResponse();
        session.close();
        connection.close();
        await withSocket(async (nextConnection, nextPeer) => {
          const nextSession = new ResponsesWebSocketSession(nextConnection, limits);
          try {
            const followup = { type: 'message' as const, role: 'user' as const, content: 'Which day?' };
            const input = store ? [followup] : toResponseInputItems([initial, ...previous.output, followup]);
            const sending = once(nextPeer, 'message');
            const nextLane = nextSession.lane('turn');
            nextLane.create({
              model: 'test-model',
              input,
              store,
              ...(store ? { previous_response_id: previous.id } : {}),
            });
            const [wire] = await sending;
            expect(JSON.parse(String(wire))).toEqual({
              type: 'response.create',
              stream_id: 'turn',
              model: 'test-model',
              input: store ? [followup] : [initial, ...previous.output, followup],
              store,
              ...(store ? { previous_response_id: 'server_previous' } : {}),
            });
            nextPeer.send(
              JSON.stringify({
                type: 'response.completed',
                stream_id: 'turn',
                response: response('server_restored'),
              }),
            );
            expect(await nextLane.finalResponse()).toMatchObject({
              id: 'server_restored',
              status: 'completed',
            });
          } finally {
            nextSession.close();
          }
        });
      } finally {
        session.close();
      }
    });
  },
);

test('binds untyped create input to the default lane without accepting its stream_id', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const defaultLane = session.lane();
    const named = session.lane('named');
    const input = { model: 'test-model', input: 'default request', stream_id: 'named' };
    const sent = once(peer, 'message');
    defaultLane.create(input);
    const [wire] = await sent;
    expect(JSON.parse(String(wire))).toEqual({
      type: 'response.create',
      model: 'test-model',
      input: 'default request',
    });
    expect(input.stream_id).toBe('named');
    const signal = AbortSignal.timeout(3000);
    peer.send(
      JSON.stringify({ type: 'response.completed', response: response('default'), sequence_number: 0 }),
    );
    expect(await defaultLane.finalResponse({ signal })).toMatchObject({ id: 'default' });
    peer.send(
      JSON.stringify({
        type: 'response.completed',
        stream_id: 'named',
        response: response('named'),
        sequence_number: 1,
      }),
    );
    expect(await named.finalResponse({ signal })).toMatchObject({ id: 'named' });
    session.close();
  });
});

test.each([undefined, 'bound'])('binds serialized create commands to lane %s', async (streamID) => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const input = Object.freeze({
      model: 'test-model',
      input: 'request',
      generate: false,
      stream: false,
      background: true,
      stream_id: 'other',
      future_field: { toJSON: () => ({ nested: 'preserved' }) },
      toJSON: () => ({ type: 'response.steer', stream_id: 'other' }),
    });
    const sent = once(peer, 'message');
    session.lane(streamID).create(input);
    const [wire] = await sent;
    expect(JSON.parse(String(wire))).toEqual({
      type: 'response.create',
      model: 'test-model',
      input: 'request',
      generate: false,
      future_field: { nested: 'preserved' },
      ...(streamID === undefined ? {} : { stream_id: streamID }),
    });
    expect(input.stream_id).toBe('other');
    expect(input.stream).toBe(false);
    expect(input.background).toBe(true);
    expect(input.toJSON()).toEqual({ type: 'response.steer', stream_id: 'other' });
    session.close();
  });
});

test.each(['completed', 'failed', 'incomplete'] as const)(
  'returns %s final snapshots and leaves another lane usable',
  async (status) => {
    await withSocket(async (connection, peer) => {
      const session = new ResponsesWebSocketSession(connection, limits);
      const lane = session.lane('result');
      const other = session.lane('other');
      const result = lane.finalResponse();
      peer.send(
        JSON.stringify({
          type: 'response.created',
          stream_id: 'result',
          sequence_number: 0,
          response: response('final', 'in_progress'),
        }),
      );
      peer.send(
        JSON.stringify({ type: 'response.future_event', stream_id: 'result', detail: { preserved: true } }),
      );
      const final = {
        ...response('final', status),
        output: [
          {
            id: 'call_1',
            type: 'function_call',
            call_id: 'call_1',
            name: 'lookup',
            arguments: '{"q":"test"}',
            status: 'completed',
          },
        ],
      };
      peer.send(
        JSON.stringify({
          type: `response.${status}`,
          stream_id: 'result',
          sequence_number: 2,
          response: final,
        }),
      );
      expect(await result).toMatchObject(final);
      peer.send(
        JSON.stringify({
          type: 'response.completed',
          stream_id: 'other',
          sequence_number: 0,
          response: response('other'),
        }),
      );
      expect(await other.finalResponse()).toMatchObject({ id: 'other' });
      session.close();
    });
  },
);

test('isolates nested API errors to their lane', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane('error');
    const other = session.lane();
    const nested = {
      type: 'error',
      stream_id: 'error',
      error: {
        type: 'invalid_request_error',
        code: 'invalid_value',
        message: 'Synthetic error',
        param: 'input',
      },
    };
    const result = expect(
      lane.finalResponse({ maxResponseBytes: Buffer.byteLength(JSON.stringify(nested)) }),
    ).rejects.toMatchObject({ error: nested });
    peer.send(JSON.stringify(nested));
    await result;
    peer.send(
      JSON.stringify({ type: 'response.completed', sequence_number: 0, response: response('default') }),
    );
    expect(await other.finalResponse()).toMatchObject({ id: 'default' });
    peer.send(
      JSON.stringify({
        type: 'response.completed',
        stream_id: 'error',
        sequence_number: 1,
        response: response('reused'),
      }),
    );
    expect(await lane.finalResponse()).toMatchObject({ id: 'reused' });
    session.close();
  });
});

test('bounds lane queues without terminating independent consumers', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const slow = session.lane('slow', { maxBufferedEvents: 1 });
    const active = session.lane('active');
    const event = { type: 'response.completed', sequence_number: 0, response: response('active') };
    peer.send(JSON.stringify({ ...event, stream_id: 'slow' }));
    peer.send(JSON.stringify({ ...event, stream_id: 'slow' }));
    peer.send(JSON.stringify({ ...event, stream_id: 'active' }));
    expect(await active.finalResponse()).toMatchObject({ id: 'active' });
    await expect(slow.receive()).rejects.toThrow('lane buffer limit');
    expect(() => session.lane('slow')).toThrow('already registered');
    const fresh = session.lane('fresh');
    peer.send(JSON.stringify({ ...event, stream_id: 'fresh' }));
    expect(await fresh.finalResponse()).toMatchObject({ id: 'active' });
    session.close();
  });
});

test('holds the reader lease throughout accumulation and releases it after cancellation', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane();
    const abort = new AbortController();
    const waiting = lane.finalResponse({ signal: abort.signal });
    await expect(lane.receive()).rejects.toThrow('already has a reader');
    abort.abort(new Error('stop result helper'));
    await expect(waiting).rejects.toThrow('stop result helper');
    peer.send(
      JSON.stringify({ type: 'response.completed', sequence_number: 0, response: response('after') }),
    );
    expect(await lane.finalResponse()).toMatchObject({ id: 'after' });
    session.close();
  });
});

test.each([false, true])(
  'drains after socket close unless session is explicitly closed: %s',
  async (closeSession) => {
    await withSocket(async (connection, peer) => {
      const session = new ResponsesWebSocketSession(connection, limits);
      const lane = session.lane();
      const closed = once(connection.socket.platformSocket, 'close');
      peer.send(
        JSON.stringify({ type: 'response.completed', sequence_number: 0, response: response('last') }),
      );
      peer.close();
      await closed;
      if (closeSession) {
        session.close();
        await expect(lane.finalResponse()).rejects.toThrow('connection closed');
      } else {
        expect(await lane.finalResponse()).toMatchObject({ id: 'last' });
      }
      await expect(lane.receive()).rejects.toThrow('connection closed');
      expect(() => lane.create({ model: 'test-model', input: 'after close' })).toThrow('connection closed');
    });
  },
);

test.each(['closing', 'closed'])('rejects attaching a session to a %s socket', async (state) => {
  await withSocket(async (connection) => {
    const closed = once(connection.socket.platformSocket, 'close');
    connection.close();
    if (state === 'closed') {
      await closed;
    }
    expect(() => new ResponsesWebSocketSession(connection, limits)).toThrow(/closing or closed/u);
    await closed;
  });
});

test('rejects sends while connecting without placing a request in the legacy queue', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing server address');
  }
  const incoming = once(server, 'connection');
  const connection = new ResponsesWS(
    new OpenAI({ apiKey: 'synthetic-key', baseURL: `http://127.0.0.1:${address.port}/v1` }),
  );
  connection.on('error', () => {});
  const session = new ResponsesWebSocketSession(connection, limits);
  const lane = session.lane();
  try {
    expect(() => lane.create({ model: 'test-model', input: 'too early' })).toThrow('Wait for an open');
    const [peer] = await incoming;
    const messages: string[] = [];
    peer.on('message', (data: RawData) => messages.push(String(data)));
    await once(connection.socket.platformSocket, 'open');
    const received = once(peer, 'message');
    lane.create({ model: 'test-model', input: 'accepted' });
    await received;
    expect(messages.map((value) => JSON.parse(value).input)).toEqual(['accepted']);
  } finally {
    session.close();
    connection.close();
    for (const peer of server.clients) {
      peer.terminate();
    }
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('never queues or replays an uncertain send during the replacement socket open callback', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing server address');
  }
  const messages: string[] = [];
  const progress = new EventTarget();
  const barrier = once(progress, 'barrier');
  server.on('connection', (peer) => {
    peer.on('message', (data) => {
      const input: unknown = JSON.parse(String(data)).input;
      if (typeof input !== 'string') {
        throw new TypeError('Missing request input');
      }
      messages.push(input);
      if (input === 'barrier') {
        progress.dispatchEvent(new Event('barrier'));
      }
    });
  });
  let physicalConnections = 0;
  let sendError: unknown;
  class UncertainSendConnection extends ResponsesWS {
    session?: ResponsesWebSocketSession;

    protected override _createSocket(url: URL, headers: Record<string, string>) {
      const socket = super._createSocket(url, headers);
      physicalConnections += 1;
      if (physicalConnections === 2) {
        const originalSend = socket.send.bind(socket);
        let first = true;
        socket.send = (data) => {
          originalSend(data);
          if (first) {
            first = false;
            throw new Error('Synthetic failure after write');
          }
        };
        socket.on('open', () => {
          try {
            if (!this.session) {
              throw new Error('Missing test session');
            }
            this.session.lane('replacement').create({ model: 'test-model', input: 'uncertain request' });
          } catch (error) {
            sendError = error;
          }
        });
      }
      return socket;
    }
  }
  const incoming = once(server, 'connection');
  const connection = new UncertainSendConnection(
    new OpenAI({ apiKey: 'synthetic-key', baseURL: `http://127.0.0.1:${address.port}/v1` }),
    { reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} } },
  );
  connection.on('error', () => {});
  connection.on('reconnected', () => progress.dispatchEvent(new Event('reconnected')));
  const session = new ResponsesWebSocketSession(connection, limits);
  connection.session = session;
  try {
    const [peer] = await incoming;
    await once(connection.socket.platformSocket, 'open');
    const reconnected = once(progress, 'reconnected');
    connection.socket.platformSocket.emit('error', new Error('synthetic prior transport failure'));
    peer.close(1011);
    await reconnected;
    connection.socket.send(JSON.stringify({ type: 'response.create', input: 'barrier' }));
    await barrier;
    expect(messages).toEqual(['uncertain request', 'barrier']);
    expect(sendError).toEqual(new Error('Synthetic failure after write'));
    expect(physicalConnections).toBe(2);
  } finally {
    session.close();
    connection.close();
    for (const peer of server.clients) {
      peer.terminate();
    }
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('accepts large events within caller-selected budgets', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane();
    const event = {
      type: 'response.output_text.delta',
      item_id: 'message',
      output_index: 0,
      content_index: 0,
      sequence_number: 0,
      delta: 'x'.repeat(20 * 1024 * 1024),
    };
    peer.send(JSON.stringify(event));
    expect(await lane.receive()).toEqual(event);
    session.close();
  });
});

test.each([undefined, '', 'supplied'])(
  'normalizes a terminal-only snapshot with output_text %s without mutating the raw event',
  async (outputText) => {
    await withSocket(async (connection, peer) => {
      const session = new ResponsesWebSocketSession(connection, limits);
      const lane = session.lane();
      const rawEvent = connection.emitted('event');
      const final = {
        ...response('terminal-only'),
        ...(outputText === undefined ? {} : { output_text: outputText }),
        output: [
          {
            id: 'message',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [
              { type: 'output_text', text: 'first', annotations: [], logprobs: [] },
              { type: 'output_text', text: 'second', annotations: [], logprobs: [] },
            ],
          },
        ],
      };
      peer.send(JSON.stringify({ type: 'response.completed', sequence_number: 0, response: final }));
      expect(await lane.finalResponse()).toMatchObject({
        output_text: outputText ?? 'firstsecond',
        output: final.output,
      });
      expect(await rawEvent).toEqual({ type: 'response.completed', sequence_number: 0, response: final });
      session.close();
    });
  },
);

test.each([false, true])(
  'reconnect retains headers and fresh lane capacity after transport error: %s',
  async (transportError) => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const handshakes: Record<string, string | string[] | undefined>[] = [];
    const messages: string[] = [];
    const progress = new EventTarget();
    const restored = once(progress, 'restored');
    server.on('connection', (peer, request) => {
      handshakes.push({
        authorization: request.headers.authorization,
        custom: request.headers['x-session-test'],
        client: request.headers['x-client-only'],
        organization: request.headers['openai-organization'],
        project: request.headers['openai-project'],
        userAgent: request.headers['user-agent'],
      });
      peer.on('message', (data) => {
        messages.push(String(data));
        progress.dispatchEvent(new Event('restored'));
      });
    });
    const defaults = {
      'X-Client-Only': 'client-first',
      'x-session-test': 'client-default',
      'User-Agent': null,
    };
    const client = new OpenAI({
      apiKey: 'synthetic-first',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      organization: 'org-first',
      project: 'project-first',
      defaultHeaders: defaults,
    });
    const headers = { 'X-Session-Test': 'first' };
    const incoming = once(server, 'connection');
    const connection = new ResponsesWS(client, {
      headers,
      reconnect: {
        maxRetries: 1,
        initialDelay: 0,
        maxDelay: 0,
        onReconnecting() {
          client.apiKey = 'synthetic-second';
          client.organization = 'org-second';
          client.project = 'project-second';
          defaults['X-Client-Only'] = 'client-second';
          headers['X-Session-Test'] = 'second';
        },
      },
    });
    connection.on('error', () => {});
    let restoredLane: ResponsesWebSocketLane | undefined;
    let restoreError: unknown;
    // Run before the session's own reconnected listener.
    connection.on('reconnected', () => {
      try {
        // oxlint-disable-next-line eslint/no-use-before-define -- Register before session construction to exercise the application's earlier recovery listener.
        restoredLane = session.lane('turn');
        restoredLane.create({ model: 'test-model', input: 'restored state' });
      } catch (error) {
        restoreError = error;
      }
    });
    const session = new ResponsesWebSocketSession(connection, { ...limits, maxBufferedEvents: 1 });
    try {
      const [peer] = await incoming;
      await once(connection.socket.platformSocket, 'open');
      const oldLane = session.lane('turn');
      const pending = expect(oldLane.receive()).rejects.toThrow(
        transportError ? undefined : 'restored explicitly',
      );
      if (transportError) {
        session.lane('abandoned');
        const queued = connection.emitted('event');
        peer.send(
          JSON.stringify({
            type: 'response.created',
            stream_id: 'abandoned',
            response: response('old'),
            sequence_number: 0,
          }),
        );
        await queued;
        connection.socket.platformSocket.emit('error', new Error('synthetic transport failure'));
      }
      const reconnected = connection.emitted('reconnected');
      const nextConnection = once(server, 'connection');
      peer.close(1011);
      await pending;
      await reconnected;
      const [nextPeer] = await nextConnection;
      expect(() => oldLane.create({ model: 'test-model', input: 'never' })).toThrow(
        transportError ? undefined : 'restored explicitly',
      );
      expect(restoreError).toBeUndefined();
      if (!restoredLane) {
        throw new Error('Missing restored lane');
      }
      const lane = restoredLane;
      oldLane.close();
      await restored;
      expect(messages.map((value) => JSON.parse(value).input)).toEqual(['restored state']);
      nextPeer.send(
        JSON.stringify({
          type: 'response.completed',
          stream_id: 'turn',
          response: response('replacement'),
          sequence_number: 0,
        }),
      );
      expect(await lane.finalResponse()).toMatchObject({ id: 'replacement' });
      expect(handshakes).toEqual([
        {
          authorization: 'Bearer synthetic-first',
          custom: 'first',
          client: 'client-first',
          organization: 'org-first',
          project: 'project-first',
          userAgent: undefined,
        },
        {
          authorization: 'Bearer synthetic-second',
          custom: 'second',
          client: 'client-second',
          organization: 'org-second',
          project: 'project-second',
          userAgent: undefined,
        },
      ]);
    } finally {
      session.close();
      connection.close();
      for (const peer of server.clients) {
        peer.terminate();
      }
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  },
);

test.each(['value', 'getter'] as const)(
  'ignores an inherited stream_id %s when routing events',
  async (kind) => {
    await withSocket(async (connection, peer) => {
      let getterCalls = 0;
      const prototype = Object.create(null);
      Object.defineProperty(
        prototype,
        'stream_id',
        kind === 'value'
          ? { value: 'named' }
          : {
              get() {
                getterCalls += 1;
                return 'named';
              },
            },
      );
      connection.on('event', (event) => Object.setPrototypeOf(event, prototype));
      const session = new ResponsesWebSocketSession(connection, limits);
      const untagged = session.lane();
      const named = session.lane('named');
      const signal = AbortSignal.timeout(3000);
      const defaultEvent = untagged.receive({ signal });
      const namedEvent = named.receive({ signal });
      const received = Promise.all([defaultEvent, namedEvent]);
      peer.send(
        JSON.stringify({ type: 'response.completed', sequence_number: 0, response: response('default') }),
      );
      peer.send(
        JSON.stringify({
          type: 'response.completed',
          stream_id: 'named',
          sequence_number: 1,
          response: response('named'),
        }),
      );
      try {
        expect(await received).toMatchObject([
          { response: { id: 'default' } },
          { response: { id: 'named' } },
        ]);
        expect(getterCalls).toBe(0);
      } finally {
        session.close();
      }
    });
  },
);

test('drains a large lane backlog in order with linear element movement', async () => {
  await withSocket(async (connection, peer) => {
    const count = 2048;
    const session = new ResponsesWebSocketSession(connection, { ...limits, maxBufferedEvents: count * 2 });
    const lane = session.lane('backlog');
    const events = Array.from({ length: count * 2 }, (_, index) => ({
      type: 'response.output_text.delta',
      stream_id: 'backlog',
      sequence_number: index,
      output_index: 0,
      content_index: 0,
      item_id: 'message',
      logprobs: [],
      delta: String(index),
    }));
    const sendBatch = async (start: number, end: number) => {
      const arrived = connection.emitted('response.completed');
      for (const event of events.slice(start, end)) {
        peer.send(JSON.stringify(event));
      }
      peer.send(
        JSON.stringify({ type: 'response.completed', sequence_number: end, response: response('barrier') }),
      );
      await arrived;
    };
    let elementMoves = 0;
    try {
      await sendBatch(0, count);
      for (let index = 0; index < events.length; index += 1) {
        if (index === count / 2 + 3) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- Refill after crossing a queue compaction boundary.
          await sendBatch(count, events.length);
        }
        const measured = measureElementMovement(() => lane.receive());
        elementMoves += measured.elementMoves;
        // oxlint-disable-next-line eslint/no-await-in-loop -- A lane permits one ordered consumer.
        expect(await measured.result).toEqual(events[index]);
      }
      expect(elementMoves).toBeLessThanOrEqual(events.length * 8);
    } finally {
      session.close();
    }
  });
});

test.each(['', 'plain text', '\u00E9', '\u4E16\u754C', '\uD83D\uDE00', '\uD800', '\uDC00', '\uD800x\uDC00'])(
  'counts UTF-8 wire bytes for %j',
  (value) => {
    expect(rawByteLength(value)).toBe(Buffer.byteLength(value, 'utf-8'));
  },
);

test('accounts for a large received event without encoding another payload buffer', async () => {
  await withSocket(async (connection, peer) => {
    const event = { type: 'response.future_event', payload: 'x'.repeat(8 * 1024 * 1024) };
    const wire = JSON.stringify(event);
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    try {
      const received = connection.emitted('event');
      peer.send(wire);
      expect(await received).toEqual(event);
      expect(encode.mock.calls.some(([value]) => value === wire)).toBe(false);
    } finally {
      encode.mockRestore();
    }
  });
});

test.each(['hide', 'throw'])('measures wire bytes before an observer can %s them', async (mode) => {
  await withSocket(async (connection, peer) => {
    let calls = 0;
    connection.on('event', (event) => {
      Object.defineProperty(event, 'toJSON', {
        value: () => {
          calls += 1;
          if (mode === 'throw') {
            throw new Error('Observer serialization hook');
          }
          return {};
        },
      });
    });
    const session = new ResponsesWebSocketSession(connection, { ...limits, maxBufferedBytes: 128 });
    const lane = session.lane();
    const rejected = expect(lane.receive()).rejects.toThrow('buffer limit exceeded');
    peer.send(JSON.stringify({ type: 'response.future_event', payload: 'x'.repeat(256) }));
    await rejected;
    expect(calls).toBe(0);
    session.close();
  });
});

test.each(['session', 'lane', 'response'] as const)(
  'measures custom event snapshots without inherited serialization hooks for the %s budget',
  async (budget) => {
    await withSocket(async (connection) => {
      const session = new ResponsesWebSocketSession(connection, {
        ...limits,
        maxBufferedBytes: budget === 'session' ? 128 : limits.maxBufferedBytes,
      });
      const lane = session.lane(undefined, budget === 'lane' ? { maxBufferedBytes: 128 } : {});
      const toJSON = vi.fn(() => ({}));
      const event: Extract<ResponsesServerEvent, { type: 'response.output_text.delta' }> = {
        type: 'response.output_text.delta',
        sequence_number: 0,
        output_index: 0,
        content_index: 0,
        item_id: 'message',
        logprobs: [],
        delta: 'x'.repeat(1024),
      };
      Object.setPrototypeOf(event, { toJSON });
      try {
        const pending =
          budget === 'response'
            ? lane.finalResponse({ maxResponseBytes: 128, signal: AbortSignal.timeout(3000) })
            : lane.receive();
        const rejected = expect(pending).rejects.toThrow('limit exceeded');
        connection.emitCustomEvent(event);
        await rejected;
        expect(toJSON).not.toHaveBeenCalled();
      } finally {
        session.close();
      }
    });
  },
);

test.each([null, [], {}, { type: null }, { type: 1 }, Object.create({ type: 'response.future' })])(
  'rejects malformed custom event %j without throwing from the emitter',
  async (event: unknown) => {
    await withSocket(async (connection) => {
      const session = new ResponsesWebSocketSession(connection, limits);
      const lane = session.lane();
      const other = session.lane('other');
      try {
        connection.emitCustomEvent({
          type: 'response.output_text.delta',
          sequence_number: 0,
          output_index: 0,
          content_index: 0,
          item_id: 'message',
          logprobs: [],
          delta: 'queued',
        });
        // SAFETY: Exercise untyped JavaScript input at the supported custom-emitter boundary.
        expect(() => connection.emitCustomEvent(event as ResponsesServerEvent)).not.toThrow();
        await expect(lane.receive()).rejects.toThrow('Cannot snapshot custom WebSocket event');
        await expect(other.receive()).rejects.toThrow('Cannot snapshot custom WebSocket event');
        expect(connection.socket.readyState).toBe(1);
      } finally {
        session.close();
      }
    });
  },
);

test('measures and retains one custom event snapshot when a getter changes values', async () => {
  await withSocket(async (connection) => {
    const session = new ResponsesWebSocketSession(connection, { ...limits, maxBufferedBytes: 256 });
    const lane = session.lane();
    let reads = 0;
    const event: Extract<ResponsesServerEvent, { type: 'response.output_text.delta' }> = {
      type: 'response.output_text.delta',
      sequence_number: 0,
      output_index: 0,
      content_index: 0,
      item_id: 'message',
      logprobs: [],
      get delta() {
        reads += 1;
        return reads === 1 ? 'small' : 'x'.repeat(1024);
      },
    };
    try {
      connection.emitCustomEvent(event);
      expect(await lane.receive()).toMatchObject({ type: event.type, delta: 'small' });
      expect(reads).toBe(1);
    } finally {
      session.close();
    }
  });
});

test.each(['Map', 'ArrayBuffer'] as const)(
  'retains only the accounted JSON representation of a custom %s payload',
  async (kind) => {
    await withSocket(async (connection) => {
      const session = new ResponsesWebSocketSession(connection, { ...limits, maxBufferedBytes: 256 });
      const lane = session.lane();
      const event = {
        type: 'response.output_text.delta' as const,
        sequence_number: 0,
        output_index: 0,
        content_index: 0,
        item_id: 'message',
        logprobs: [],
        delta: 'small',
        payload: kind === 'Map' ? new Map([['large', 'x'.repeat(4096)]]) : new ArrayBuffer(4096),
      };
      try {
        connection.emitCustomEvent(event);
        expect(await lane.receive()).toEqual({ ...event, payload: {} });
      } finally {
        session.close();
      }
    });
  },
);

test('receives unknown event tags and leaves their fields unknown to TypeScript', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane();
    try {
      peer.send(JSON.stringify({ type: 'response.future_event', payload: 'future value' }));
      const event = await lane.receive();
      if (event.type === 'response.future_event') {
        expectTypeOf(event['payload']).toBeUnknown();
        expect(event['payload']).toBe('future value');
      } else {
        throw new Error('Expected the future event tag');
      }
    } finally {
      session.close();
    }
  });
});

test('collects steadily consumed responses larger than the queue byte budget', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, {
      ...limits,
      maxBufferedEvents: 1,
      maxBufferedBytes: 1024,
    });
    const lane = session.lane();
    const final = lane.finalResponse().then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    try {
      for (let index = 0; index < 16; index += 1) {
        const arrived = connection.emitted('event');
        peer.send(
          JSON.stringify({
            type: 'response.output_text.delta',
            sequence_number: index,
            output_index: 0,
            content_index: 0,
            item_id: 'message',
            logprobs: [],
            delta: 'x',
          }),
        );
        // oxlint-disable-next-line eslint/no-await-in-loop -- Let the active consumer drain each small event before the next arrives.
        await arrived;
      }
      const completed = {
        ...response('large-total'),
        output: [
          {
            type: 'message',
            id: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'x'.repeat(16), annotations: [] }],
          },
        ],
      };
      peer.send(JSON.stringify({ type: 'response.completed', sequence_number: 16, response: completed }));
      expect(await final).toMatchObject({ value: { id: 'large-total', output_text: 'x'.repeat(16) } });
    } finally {
      session.close();
    }
  });
});

test('enforces an explicit cumulative response cap without closing the lane', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane();
    try {
      const rejected = expect(lane.finalResponse({ maxResponseBytes: 1 })).rejects.toThrow(
        'accumulated response limit',
      );
      peer.send(
        JSON.stringify({ type: 'response.completed', sequence_number: 0, response: response('over-limit') }),
      );
      await rejected;
      peer.send(
        JSON.stringify({ type: 'response.completed', sequence_number: 1, response: response('next') }),
      );
      expect(await lane.finalResponse({ maxResponseBytes: 4096 })).toMatchObject({ id: 'next' });
    } finally {
      session.close();
    }
  });
});

test.each(['single', 'cumulative'] as const)(
  'caps a %s API error before exposing its payload and keeps the lane reusable',
  async (kind) => {
    await withSocket(async (connection, peer) => {
      const session = new ResponsesWebSocketSession(connection, limits);
      const lane = session.lane();
      const diagnostic = {
        type: 'error',
        error: { type: 'invalid_request_error', message: 'x'.repeat(512) },
      };
      const created = { type: 'response.created', sequence_number: 0, response: response('first') };
      const errorBytes = Buffer.byteLength(JSON.stringify(diagnostic));
      const maxResponseBytes = kind === 'single' ? errorBytes - 1 : errorBytes;
      try {
        const rejected = expect(lane.finalResponse({ maxResponseBytes })).rejects.toThrow(
          'accumulated response limit',
        );
        if (kind === 'cumulative') {
          peer.send(JSON.stringify(created));
        }
        peer.send(JSON.stringify(diagnostic));
        await rejected;
        const requested = once(peer, 'message');
        lane.create({ input: 'next' });
        await requested;
        peer.send(
          JSON.stringify({ type: 'response.completed', sequence_number: 1, response: response('next') }),
        );
        expect(await lane.finalResponse()).toMatchObject({ id: 'next' });
      } finally {
        session.close();
      }
    });
  },
);

test('releases only unread lane events when a partially consumed lane closes', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, { ...limits, maxBufferedEvents: 2 });
    const old = session.lane('old');
    const fresh = session.lane('fresh');
    const event = (streamID: string, id: string) => ({
      type: 'response.completed',
      stream_id: streamID,
      sequence_number: 0,
      response: response(id),
    });
    try {
      const arrived = connection.emitted('response.completed');
      peer.send(JSON.stringify(event('old', 'first')));
      await arrived;
      expect(await old.receive()).toMatchObject({ response: { id: 'first' } });
      const buffered = connection.emitted('response.completed');
      peer.send(JSON.stringify(event('old', 'remaining')));
      await buffered;
      old.close();
      peer.send(JSON.stringify(event('fresh', 'one')));
      peer.send(JSON.stringify(event('fresh', 'two')));
      expect(await fresh.receive()).toMatchObject({ response: { id: 'one' } });
      expect(await fresh.receive()).toMatchObject({ response: { id: 'two' } });
    } finally {
      session.close();
    }
  });
});

test.each([undefined, 'original'])(
  'snapshots routing before observers replace stream_id %j',
  async (streamID) => {
    await withSocket(async (connection, peer) => {
      connection.on('event', (event) => {
        Object.assign(event, { stream_id: 'other' });
      });
      const session = new ResponsesWebSocketSession(connection, limits);
      const original = session.lane(streamID);
      const other = session.lane('other');
      const received = connection.emitted('event');
      peer.send(
        JSON.stringify({
          type: 'response.completed',
          stream_id: streamID,
          response: response('original'),
          sequence_number: 0,
        }),
      );
      await received;
      // Ending the socket makes incorrect routing fail promptly rather than hanging.
      const closed = once(connection.socket.platformSocket, 'close');
      peer.close();
      await closed;
      expect(await original.finalResponse()).toMatchObject({ id: 'original' });
      await expect(other.receive()).rejects.toThrow('connection closed');
    });
  },
);

test.each(['before', 'after'])(
  'buffers a snapshot isolated from observers registered %s the session',
  async (order) => {
    await withSocket(async (connection, peer) => {
      const mutate = (event: ResponsesServerEvent) => {
        Object.assign(event, {
          type: 'reconnecting',
          payload: 'x'.repeat(4096),
          response: response('mutated'),
        });
      };
      if (order === 'before') {
        connection.on('event', mutate);
      }
      const session = new ResponsesWebSocketSession(connection, { ...limits, maxBufferedBytes: 1024 });
      const lane = session.lane();
      if (order === 'after') {
        connection.on('event', mutate);
      }
      const received = connection.emitted('event');
      const expected = { type: 'response.completed', response: response('original'), sequence_number: 0 };
      peer.send(JSON.stringify(expected));
      await received;
      expect(await lane.receive()).toEqual(expected);
      session.close();
    });
  },
);

test('preserves a queued terminal response before a transport error', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, { ...limits, maxBufferedEvents: 1 });
    const lane = session.lane();
    const received = connection.emitted('event');
    peer.send(
      JSON.stringify({ type: 'response.completed', response: response('completed'), sequence_number: 0 }),
    );
    await received;
    connection.socket.platformSocket.emit('error', new Error('synthetic transport failure'));
    const ignored = connection.emitted('event');
    peer.send(
      JSON.stringify({ type: 'response.completed', response: response('ignored'), sequence_number: 1 }),
    );
    await ignored;
    expect(await lane.finalResponse()).toMatchObject({ id: 'completed' });
    await expect(lane.receive()).rejects.toThrow();
    session.close();
  });
});

test('cannot resume the same response after a nonterminal event exceeds its cap', async () => {
  await withSocket(async (connection, peer) => {
    const session = new ResponsesWebSocketSession(connection, limits);
    const lane = session.lane();
    const rejected = expect(lane.finalResponse({ maxResponseBytes: 1 })).rejects.toThrow(
      'accumulated response limit',
    );
    peer.send(
      JSON.stringify({ type: 'response.created', response: response('over-limit'), sequence_number: 0 }),
    );
    await rejected;
    expect(() => session.lane()).toThrow('already registered');
    const received = connection.emitted('event');
    peer.send(
      JSON.stringify({ type: 'response.completed', response: response('over-limit'), sequence_number: 1 }),
    );
    await received;
    await expect(lane.finalResponse()).rejects.toThrow('accumulated response limit');
    expect(() => lane.create({ model: 'test-model', input: 'next' })).toThrow('accumulated response limit');
    expect(() => session.lane()).toThrow('already registered');
    const replacement = session.lane('next');
    peer.send(
      JSON.stringify({
        type: 'response.completed',
        stream_id: 'next',
        response: response('next'),
        sequence_number: 2,
      }),
    );
    expect(await replacement.finalResponse()).toMatchObject({ id: 'next' });
    session.close();
  });
});
