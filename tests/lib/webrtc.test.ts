/* oxlint-disable max-classes-per-file -- The native event, channel, and peer fakes form one deterministic fixture. */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { LiveDataChannel, OpenAILiveWebRTC, WebRTCError } from 'openai/live/webrtc';
import { OpenAIRealtimeWebRTC, RealtimeDataChannel } from 'openai/realtime/webrtc';
import type { ServerEvent } from 'openai/resources/live/live';
import { DataChannel } from '../../src/lib/webrtc/data-channel';
import { WebRTCConnection } from '../../src/lib/webrtc/connection';
import type {
  WebRTCConnectionEvent,
  WebRTCDataChannel,
  WebRTCPeerConnection,
} from '../../src/lib/webrtc/types';

class NativeEvents {
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  addEventListener(type: string, listener: (event: unknown) => void): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, event: unknown = {}): void {
    const snapshot = [...(this.listeners.get(type) ?? [])];
    for (const listener of snapshot) {
      listener(event);
    }
  }
  countListeners(): number {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

class FakeChannel extends NativeEvents implements WebRTCDataChannel {
  readyState = 'connecting';
  readonly send = vi.fn<(data: string) => void>();
  readonly close = vi.fn(() => {
    this.readyState = 'closed';
    this.emit('close');
  });
  open(): void {
    this.readyState = 'open';
    this.emit('open');
  }
  message(value: unknown): void {
    this.emit('message', { data: JSON.stringify(value) });
  }
}

class FakePeer extends NativeEvents implements WebRTCPeerConnection {
  static latest: FakePeer;
  readonly channel = new FakeChannel();
  connectionState = 'new';
  localDescription: { sdp: string } | null = null;
  readonly createDataChannel = vi.fn(() => this.channel);
  readonly createOffer = vi.fn<WebRTCPeerConnection['createOffer']>(async () => ({
    type: 'offer',
    sdp: 'original-offer',
  }));
  readonly setLocalDescription = vi.fn(async () => {
    this.localDescription = { sdp: 'native-offer' };
  });
  readonly setRemoteDescription = vi.fn(async (_description: { type: 'answer'; sdp: string }) => {});
  readonly close = vi.fn(() => {
    this.connectionState = 'closed';
    this.channel.close();
    this.emit('connectionstatechange');
  });
  readonly configuration: object | undefined;
  constructor(configuration?: object) {
    super();
    this.configuration = configuration;
    FakePeer.latest = this;
  }
  state(state: string): void {
    this.connectionState = state;
    this.emit('connectionstatechange');
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  // oxlint-disable-next-line promise/avoid-new, promise/param-names -- Tests deliberately control settlement of native operations.
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Drain successive microtask generations without introducing real timers.
    await Promise.resolve();
  }
}

async function open(connection: OpenAILiveWebRTC | OpenAIRealtimeWebRTC): Promise<void> {
  const pending = connection.connect({ exchangeSdp: async () => 'answer' });
  await flush();
  FakePeer.latest.state('connected');
  FakePeer.latest.channel.open();
  await pending;
}

beforeEach(() => {
  vi.stubGlobal('RTCPeerConnection', FakePeer);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe.each([
  { name: 'Live', Connection: OpenAILiveWebRTC, Adapter: LiveDataChannel },
  { name: 'Realtime', Connection: OpenAIRealtimeWebRTC, Adapter: RealtimeDataChannel },
])('$name WebRTC', ({ Connection, Adapter }) => {
  it('creates no network request and uses one native data channel', () => {
    const connection = new Connection();
    const peer = FakePeer.latest;
    expect(peer.createDataChannel).toHaveBeenCalledExactlyOnceWith('oai-events');
    expect(peer.createOffer).not.toHaveBeenCalled();
    expect(connection.peerConnection).toBe(peer);
    expect(connection.dataChannel).toBe(peer.channel);
    expect(connection.state).toBe('new');
    expect(typeof connection.on).toBe('function');
    connection.close();
  });

  it('exchanges native SDP, observes initial events, and waits for both readiness conditions', async () => {
    const connection = new Connection();
    const peer = FakePeer.latest;
    const events: unknown[] = [];
    connection.onEvent((event) => {
      events.push(event);
    });
    const exchangeSdp = vi.fn(async () => 'answer');
    let resolved = false;
    const pending = connection.connect({ exchangeSdp }).then(() => {
      resolved = true;
    });
    await flush();
    expect(exchangeSdp).toHaveBeenCalledWith('native-offer', { signal: expect.any(AbortSignal) });
    expect(peer.setRemoteDescription).toHaveBeenCalledExactlyOnceWith({ type: 'answer', sdp: 'answer' });
    peer.channel.open();
    peer.channel.message({ type: 'future.initial', value: 1 });
    await flush();
    expect(resolved).toBe(false);
    expect(events).toEqual([{ type: 'future.initial', value: 1 }]);
    peer.state('connected');
    await pending;
    expect(connection.state).toBe('connected');
    connection.close();
    expect(peer.countListeners()).toBe(0);
    expect(peer.channel.countListeners()).toBe(0);
  });

  it('does not resolve until applying the answer has completed', async () => {
    const connection = new Connection();
    const peer = FakePeer.latest;
    const answer = deferred<undefined>();
    peer.setRemoteDescription.mockImplementation(() => answer.promise);
    const pending = connection.connect({ exchangeSdp: async () => 'answer' });
    await flush();
    peer.channel.open();
    peer.state('connected');
    expect(connection.state).toBe('connecting');
    // oxlint-disable-next-line unicorn/no-useless-undefined -- The deferred resolver requires its typed argument.
    answer.resolve(undefined);
    await pending;
    expect(connection.state).toBe('connected');
    connection.close();
  });

  it('delivers raw server errors only to the protocol feed, without failing setup', async () => {
    const connection = new Connection();
    const protocol: unknown[] = [];
    const transport: WebRTCConnectionEvent[] = [];
    connection.onEvent((event) => {
      protocol.push(event);
    });
    connection.onConnectionEvent((event) => {
      transport.push(event);
    });
    const pending = connection.connect({ exchangeSdp: async () => 'answer' });
    await flush();
    const apiError = {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'bad event', event_id: 'client_1' },
    };
    FakePeer.latest.channel.message(apiError);
    FakePeer.latest.state('connected');
    FakePeer.latest.channel.open();
    await pending;
    expect(protocol).toEqual([apiError]);
    expect(transport.filter((event) => event.type === 'error')).toEqual([]);
    expect(connection.state).toBe('connected');
    connection.close();
  });

  it('rejects signaling once, retains the cause, aborts the callback signal, and releases resources', async () => {
    const connection = new Connection();
    const cause = new Error('application signaling failed');
    const notifications: WebRTCConnectionEvent[] = [];
    connection.onConnectionEvent((event) => {
      notifications.push(event);
    });
    let signal: AbortSignal | undefined;
    await expect(
      connection.connect({
        exchangeSdp: async (_offer, options) => {
          ({ signal } = options);
          throw cause;
        },
      }),
    ).rejects.toMatchObject({ code: 'signaling_failed', phase: 'signaling', cause });
    expect(signal?.aborted).toBe(true);
    expect(connection.state).toBe('closed');
    expect(notifications).toEqual([
      { type: 'state.changed', state: 'connecting' },
      { type: 'closed', reason: 'failed' },
    ]);
    expect(FakePeer.latest.channel.countListeners()).toBe(0);
  });

  it.each(['offer', 'answer'] as const)('reports native %s failure through connect()', async (phase) => {
    const connection = new Connection();
    const cause = new Error('native failure');
    if (phase === 'offer') {
      FakePeer.latest.createOffer.mockRejectedValue(cause);
    } else {
      FakePeer.latest.setRemoteDescription.mockRejectedValue(cause);
    }
    await expect(connection.connect({ exchangeSdp: async () => 'answer' })).rejects.toMatchObject({
      code: 'negotiation_failed',
      phase,
      cause,
    });
    expect(connection.state).toBe('closed');
  });

  it('does not begin signaling for an already aborted signal', async () => {
    const connection = new Connection();
    const controller = new AbortController();
    controller.abort('user cancellation');
    const exchangeSdp = vi.fn();
    await expect(connection.connect({ exchangeSdp, signal: controller.signal })).rejects.toMatchObject({
      code: 'aborted',
      cause: 'user cancellation',
    });
    expect(exchangeSdp).not.toHaveBeenCalled();
    expect(FakePeer.latest.createOffer).not.toHaveBeenCalled();
  });

  it.each(['abort', 'close', 'timeout'] as const)(
    'handles %s while a callback ignores cancellation',
    async (action) => {
      vi.useFakeTimers();
      const connection = new Connection();
      const peer = FakePeer.latest;
      const answer = deferred<string>();
      const controller = new AbortController();
      const pending = connection.connect({
        exchangeSdp: () => answer.promise,
        signal: controller.signal,
        timeoutMs: 100,
      });
      const rejection = expect(pending).rejects.toMatchObject({
        code: action === 'timeout' ? 'timeout' : 'aborted',
      });
      await flush();
      if (action === 'abort') {
        controller.abort();
      } else if (action === 'close') {
        connection.close();
      } else {
        await vi.advanceTimersByTimeAsync(100);
      }
      await rejection;
      answer.resolve('late answer');
      await flush();
      expect(peer.setRemoteDescription).not.toHaveBeenCalled();
      expect(peer.close).toHaveBeenCalledTimes(1);
      expect(connection.state).toBe('closed');
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('handles cancellation while creating the native offer', async () => {
    const connection = new Connection();
    const offer = deferred<{ type: 'offer'; sdp: string }>();
    FakePeer.latest.createOffer.mockImplementation(() => offer.promise);
    const exchangeSdp = vi.fn();
    const pending = connection.connect({ exchangeSdp });
    const rejection = expect(pending).rejects.toMatchObject({ code: 'aborted' });
    connection.close();
    await rejection;
    offer.reject(new Error('late native rejection'));
    await flush();
    expect(exchangeSdp).not.toHaveBeenCalled();
  });

  it('supports close from the synchronous connecting notification', async () => {
    const connection = new Connection();
    connection.onConnectionEvent((event) => {
      if (event.type === 'state.changed') {
        connection.close();
      }
    });
    const exchangeSdp = vi.fn();
    await expect(connection.connect({ exchangeSdp })).rejects.toMatchObject({ code: 'aborted' });
    expect(exchangeSdp).not.toHaveBeenCalled();
  });

  it('detaches setup cancellation and timeouts after success', async () => {
    vi.useFakeTimers();
    const connection = new Connection();
    const controller = new AbortController();
    const pending = connection.connect({
      exchangeSdp: async () => 'answer',
      signal: controller.signal,
      timeoutMs: 100,
    });
    await flush();
    FakePeer.latest.state('connected');
    FakePeer.latest.channel.open();
    await pending;
    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    expect(connection.state).toBe('connected');
    expect(vi.getTimerCount()).toBe(0);
    connection.close();
  });

  it('rejects a second attempt without damaging the first', async () => {
    const connection = new Connection();
    await open(connection);
    await expect(connection.connect({ exchangeSdp: async () => 'answer' })).rejects.toMatchObject({
      code: 'invalid_state',
    });
    expect(connection.state).toBe('connected');
    connection.close();
  });

  it('deduplicates terminal native events and tolerates a transient disconnection', async () => {
    const connection = new Connection();
    await open(connection);
    const events: WebRTCConnectionEvent[] = [];
    connection.onConnectionEvent((event) => {
      events.push(event);
    });
    const peer = FakePeer.latest;
    peer.state('disconnected');
    expect(connection.state).toBe('connected');
    expect(events).toEqual([]);
    peer.state('failed');
    peer.channel.emit('error');
    peer.channel.emit('close');
    connection.close();
    expect(events).toEqual([
      { type: 'error', fatal: true, error: expect.objectContaining({ code: 'transport_failed' }) },
      { type: 'closed', reason: 'failed' },
    ]);
    expect(peer.close).toHaveBeenCalledTimes(1);
  });

  it('terminates once when the established data channel fails before the peer', async () => {
    const connection = new Connection();
    await open(connection);
    const events: WebRTCConnectionEvent[] = [];
    connection.onConnectionEvent((event) => {
      events.push(event);
    });
    const peer = FakePeer.latest;
    peer.channel.emit('error');
    expect(connection.state).toBe('closed');
    peer.channel.emit('close');
    peer.state('failed');
    connection.close();
    expect(events).toEqual([
      { type: 'error', fatal: true, error: expect.objectContaining({ code: 'transport_failed' }) },
      { type: 'closed', reason: 'failed' },
    ]);
    expect(peer.close).toHaveBeenCalledTimes(1);
  });

  it('reports premature closure only through the pending operation and close notification', async () => {
    const connection = new Connection();
    const events: WebRTCConnectionEvent[] = [];
    connection.onConnectionEvent((event) => {
      events.push(event);
    });
    const pending = connection.connect({ exchangeSdp: async () => 'answer' });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'connection_closed' });
    await flush();
    FakePeer.latest.channel.close();
    await rejected;
    expect(events.filter((event) => event.type === 'error')).toEqual([]);
    // oxlint-disable-next-line unicorn/prefer-at -- The repository type-checks tests against ES2020.
    expect(events[events.length - 1]).toEqual({ type: 'closed', reason: 'remote' });
  });

  it('borrows a channel without taking ownership and releases subscriptions on disposal', () => {
    const channel = new FakeChannel();
    const adapter = new Adapter(channel);
    expect(typeof adapter.on).toBe('function');
    adapter.dispose();
    adapter.dispose();
    expect(channel.close).not.toHaveBeenCalled();
    expect(channel.countListeners()).toBe(0);
    expect(() => adapter.onEvent(() => {})).toThrow(WebRTCError);
  });

  it('drops malformed messages without retaining their contents and accepts future event types', () => {
    const channel = new FakeChannel();
    const adapter = new Adapter(channel);
    const events: unknown[] = [];
    const diagnostics: WebRTCConnectionEvent[] = [];
    adapter.onEvent((event) => {
      events.push(event);
    });
    adapter.onConnectionEvent((event) => {
      diagnostics.push(event);
    });
    for (const data of ['PRIVATE malformed JSON', 'null', '[]', '{"type":1}', '{}', new Uint8Array([1])]) {
      channel.emit('message', { data });
    }
    channel.message({ type: '__proto__', extra: 'future event' });
    expect(events).toEqual([{ type: '__proto__', extra: 'future event' }]);
    expect(diagnostics).toHaveLength(6);
    for (const event of diagnostics) {
      expect(event).toMatchObject({
        type: 'error',
        fatal: false,
        error: { code: 'invalid_message', cause: undefined },
      });
      if (event.type === 'error') {
        expect(event.error.message).not.toContain('PRIVATE');
      }
    }
    adapter.dispose();
  });

  it('isolates thrown and rejected application callbacks and supports independent unsubscribe', async () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const channel = new FakeChannel();
    const adapter = new Adapter(channel);
    const syncError = new Error('sync callback');
    const asyncError = new Error('async callback');
    adapter.onEvent(() => {
      throw syncError;
    });
    adapter.onEvent(async () => {
      throw asyncError;
    });
    const listener = vi.fn();
    const unsubscribe = adapter.onEvent(listener);
    adapter.onEvent(listener);
    unsubscribe();
    unsubscribe();
    channel.message({ type: 'future.event' });
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls).toEqual([[syncError], [asyncError]]);
    adapter.dispose();
  });
});

it('sends typed client messages and reports local failures synchronously, without notifications', () => {
  const channel = new FakeChannel();
  const live = new LiveDataChannel(channel);
  const diagnostics = vi.fn();
  live.onConnectionEvent(diagnostics);
  expect(() => live.send({ type: 'session.close' })).toThrow(expect.objectContaining({ code: 'not_open' }));
  channel.open();
  diagnostics.mockClear();
  live.send({ type: 'session.close' });
  expect(channel.send).toHaveBeenCalledWith('{"type":"session.close"}');
  channel.send.mockImplementation(() => {
    throw new Error('buffer full');
  });
  expect(() => live.send({ type: 'session.close' })).toThrow(
    expect.objectContaining({ code: 'send_failed' }),
  );
  expect(diagnostics).not.toHaveBeenCalled();
  live.dispose();
});

it('infers named payloads from each public helper’s generated server-event union', () => {
  const live = new OpenAILiveWebRTC();
  const realtime = new OpenAIRealtimeWebRTC();
  const liveChannel = new LiveDataChannel(new FakeChannel());
  const realtimeChannel = new RealtimeDataChannel(new FakeChannel());
  const unsubscribe = live.on('session.input_transcript.delta', (event) => {
    expectTypeOf(event.type).toEqualTypeOf<'session.input_transcript.delta'>();
    expectTypeOf(event.delta).toEqualTypeOf<string>();
    expectTypeOf(event.start_ms).toEqualTypeOf<number>();
    // @ts-expect-error A transcript event has no API error payload.
    expect(event.error).toBeUndefined();
  });
  expectTypeOf(unsubscribe).toEqualTypeOf<() => void>();
  liveChannel.on('session.delegation.created', (event) => {
    expectTypeOf(event.delegation.target).toEqualTypeOf<'client' | 'responses'>();
  });
  realtime.on('session.created', (event) => {
    expectTypeOf(event.type).toEqualTypeOf<'session.created'>();
    expectTypeOf(event.session).not.toBeAny();
  });
  realtimeChannel.on('response.output_audio_transcript.delta', (event) => {
    expectTypeOf(event.delta).toEqualTypeOf<string>();
  });
  // @ts-expect-error Unknown names are not widened to string.
  live.on('not.a.server.event', () => {});
  // @ts-expect-error Realtime event names do not become Live event names.
  live.on('session.created', () => {});
  // @ts-expect-error Client-only messages cannot be subscribed to as server events.
  realtime.on('response.create', () => {});
  live.onEvent((event) => {
    if (event.type === 'session.delegation.created') {
      expectTypeOf(event.event_id).toEqualTypeOf<string>();
    }
  });
  realtime.onEvent((event) => {
    if (event.type === 'session.created') {
      expectTypeOf(event.session).not.toBeAny();
    }
  });
  live.close();
  realtime.close();
  liveChannel.dispose();
  realtimeChannel.dispose();
});

it('delivers named and catch-all subscriptions in registration order with the same payload', () => {
  const channel = new FakeChannel();
  const live = new LiveDataChannel(channel);
  const order: string[] = [];
  let received: ServerEvent | undefined;
  live.onEvent((event) => {
    received = event;
    order.push('all first');
  });
  live.on('session.input_transcript.delta', (event) => {
    expect(event).toBe(received);
    order.push(event.delta);
  });
  const unrelated = vi.fn();
  live.on('session.output_transcript.delta', unrelated);
  live.onEvent(() => order.push('all last'));
  channel.message({ type: 'session.input_transcript.delta', delta: 'input' });
  expect(order).toEqual(['all first', 'input', 'all last']);
  expect(unrelated).not.toHaveBeenCalled();
  live.dispose();
});

it('selects named listeners using the received discriminator before application callbacks run', () => {
  const channel = new FakeChannel();
  const live = new LiveDataChannel(channel);
  live.onEvent((event) => {
    Object.assign(event, { type: 'session.output_transcript.delta' });
  });
  const input = vi.fn();
  const output = vi.fn();
  live.on('session.input_transcript.delta', input);
  live.on('session.output_transcript.delta', output);
  channel.message({ type: 'session.input_transcript.delta', delta: 'input' });
  expect(input).toHaveBeenCalledOnce();
  expect(output).not.toHaveBeenCalled();
  live.dispose();
});

it('supports independent named unsubscribe and additions or removals during dispatch', () => {
  const channel = new FakeChannel();
  const live = new LiveDataChannel(channel);
  const duplicate = vi.fn();
  const added = vi.fn();
  const removeFirst = live.on('session.input_transcript.delta', duplicate);
  let removeLater: () => void = vi.fn();
  live.onEvent(() => {
    removeLater();
    live.on('session.input_transcript.delta', added);
  });
  removeLater = live.on('session.input_transcript.delta', duplicate);
  live.on('session.input_transcript.delta', duplicate);
  removeFirst();
  removeFirst();
  channel.message({ type: 'session.input_transcript.delta' });
  expect(duplicate).toHaveBeenCalledOnce();
  expect(added).not.toHaveBeenCalled();
  channel.message({ type: 'session.input_transcript.delta' });
  expect(duplicate).toHaveBeenCalledTimes(2);
  expect(added).toHaveBeenCalledOnce();
  live.dispose();
  removeLater();
  expect(() => live.on('session.input_transcript.delta', added)).toThrow(WebRTCError);
});

it('isolates exceptions and rejected promises from named handlers without special API error behavior', async () => {
  const reportError = vi.fn();
  vi.stubGlobal('reportError', reportError);
  const channel = new FakeChannel();
  const live = new LiveDataChannel(channel);
  const syncError = new Error('sync named callback');
  const asyncError = new Error('async named callback');
  live.on('error', () => {
    throw syncError;
  });
  live.on('error', async () => {
    throw asyncError;
  });
  const received = vi.fn();
  live.on('error', received);
  const protocolError = { type: 'error', error: { message: 'Synthetic API error' } };
  channel.message(protocolError);
  await flush();
  expect(received).toHaveBeenCalledExactlyOnceWith(protocolError);
  expect(reportError.mock.calls).toEqual([[syncError], [asyncError]]);
  live.dispose();
});

it('stops named delivery when a callback disposes the adapter', () => {
  const channel = new FakeChannel();
  const live = new LiveDataChannel(channel);
  const later = vi.fn();
  live.on('session.input_transcript.delta', () => live.dispose());
  live.on('session.input_transcript.delta', later);
  live.onEvent(later);
  channel.message({ type: 'session.input_transcript.delta' });
  expect(later).not.toHaveBeenCalled();
  expect(channel.countListeners()).toBe(0);
});

it('delivers named API errors through all four public helpers without normalizing or throwing them', () => {
  const reportError = vi.fn();
  vi.stubGlobal('reportError', reportError);
  const live = new OpenAILiveWebRTC();
  const livePeer = FakePeer.latest;
  const realtime = new OpenAIRealtimeWebRTC();
  const realtimePeer = FakePeer.latest;
  const liveChannel = new FakeChannel();
  const realtimeChannel = new FakeChannel();
  const borrowedLive = new LiveDataChannel(liveChannel);
  const borrowedRealtime = new RealtimeDataChannel(realtimeChannel);
  const received = vi.fn();
  live.on('error', received);
  realtime.on('error', received);
  borrowedLive.on('error', received);
  borrowedRealtime.on('error', received);
  const event = { type: 'error', error: { message: 'Synthetic API error' } };
  for (const channel of [livePeer.channel, realtimePeer.channel, liveChannel, realtimeChannel]) {
    channel.message(event);
  }
  expect(received).toHaveBeenCalledTimes(4);
  for (const [value] of received.mock.calls) {
    expect(value).toEqual(event);
  }
  expect(reportError).not.toHaveBeenCalled();
  live.close();
  realtime.close();
  borrowedLive.dispose();
  borrowedRealtime.dispose();
});

it('supports future generated event shapes through the generic types and runtime alone', () => {
  type FutureServerEvent =
    | ServerEvent
    | { type: 'foo.bar'; value: number }
    | { type: '__proto__'; value: number };
  const channel = new FakeChannel();
  const borrowed = new DataChannel<never, FutureServerEvent>(channel);
  const managed = new WebRTCConnection<never, FutureServerEvent>();
  const received: number[] = [];
  for (const client of [borrowed, managed]) {
    client.on('foo.bar', (event) => {
      expectTypeOf(event).toEqualTypeOf<{ type: 'foo.bar'; value: number }>();
      received.push(event.value);
    });
    client.on('__proto__', (event) => received.push(event.value));
  }
  channel.message({ type: 'foo.bar', value: 1 });
  FakePeer.latest.channel.message({ type: 'foo.bar', value: 2 });
  channel.message({ type: '__proto__', value: 3 });
  FakePeer.latest.channel.message({ type: '__proto__', value: 4 });
  expect(received).toEqual([1, 2, 3, 4]);
  borrowed.dispose();
  managed.close();
  expect(() => managed.on('foo.bar', () => {})).toThrow(WebRTCError);
});

it('imports without browser globals and fails clearly only when a managed connection is constructed', () => {
  vi.stubGlobal('RTCPeerConnection', null);
  expect(() => new OpenAILiveWebRTC()).toThrow(expect.objectContaining({ code: 'unsupported_environment' }));
  const channel = new FakeChannel();
  const adapter = new LiveDataChannel(channel);
  adapter.dispose();
});
