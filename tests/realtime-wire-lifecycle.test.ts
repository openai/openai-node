import { once } from 'node:events';
import { Agent, createServer } from 'node:https';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';

import OpenAI, { AzureOpenAI } from 'openai';
import { OpenAIRealtimeWS as StableWS } from 'openai/realtime/ws';
import { OpenAIRealtimeWebSocket as StableNative } from 'openai/realtime/websocket';
import { OpenAIRealtimeWS as BetaWS } from 'openai/beta/realtime/ws';
import { OpenAIRealtimeWebSocket as BetaNative } from 'openai/beta/realtime/websocket';
import { WebSocket, WebSocketServer } from 'ws';
import { createX509TestLab } from './utils/x509-test-lab';

const lab = createX509TestLab();
const originalCAs = getCACertificates();
const server = createServer({ cert: lab.server.certificate, key: lab.server.privateKey });
const peers = new WebSocketServer({ server });
let baseURL: string;
const settings = { model: 'gpt-realtime', options: { ca: lab.certificateAuthority } };

// Beta and GA have different mapped callback generics. Use only their checked
// shared signatures here; each assignment must be implemented by all four SDK clients.
interface RealtimeWire {
  socket: WebSocket | globalThis.WebSocket;
  on: {
    (event: 'event', listener: (event: { type: string }) => void): void;
    (event: 'error', listener: (error: Error) => void): void;
  };
  off: (event: 'event', listener: (event: { type: string }) => void) => void;
  emitted: (
    event: 'error' | 'event' | 'session.created' | 'session.updated' | 'response.done',
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- Beta/GA mapped generics have no common emitted result type. Each test checks the public wire payload before using it.
  ) => Promise<unknown>;
  send: (event: { type: 'response.cancel' | 'response.create'; event_id: string }) => void;
  close: (props?: { code: number; reason: string }) => void;
}

// node:events overloads Node's EventEmitter and native EventTarget separately.
function rawEvent(socket: RealtimeWire['socket'], name: string): Promise<unknown[]> {
  const options = { signal: AbortSignal.timeout(5000) };
  return socket instanceof WebSocket ? once(socket, name, options) : once(socket, name, options);
}

beforeAll(async () => {
  // Trust this generated loopback CA for native Node WebSockets as well as ws.
  // Keep the original roots, and restore them before leaving this test worker.
  setDefaultCACertificates([...originalCAs, lab.certificateAuthority.toString()]);
  await once(server.listen(0, '127.0.0.1'), 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing loopback server address');
  }
  baseURL = `https://127.0.0.1:${address.port}/v1/`;
});

afterEach(() => {
  for (const peer of peers.clients) {
    peer.terminate();
  }
});

afterAll(async () => {
  setDefaultCACertificates(originalCAs);
  const closed = once(peers, 'close');
  peers.close();
  await closed;
  const stopped = once(server, 'close');
  server.close();
  await stopped;
});

describe.each([
  { label: 'GA ws', Realtime: StableWS, native: false, beta: false },
  { label: 'beta ws', Realtime: BetaWS, native: false, beta: true },
  { label: 'GA native', Realtime: StableNative, native: true, beta: false },
  { label: 'beta native', Realtime: BetaNative, native: true, beta: true },
])('$label actual local upgrade', ({ Realtime, native, beta }) => {
  test('delivers cancellation and future lifecycle events while an independent consumer detaches', async () => {
    const incoming = once(peers, 'connection');
    const realtime: RealtimeWire = new Realtime(
      settings,
      new OpenAI({ baseURL, apiKey: 'ek_synthetic_wire' }),
    );
    // The public raw socket is the one dialed, not an SDK facade.
    expect(realtime.socket).toBeInstanceOf(native ? globalThis.WebSocket : WebSocket);
    const opened = rawEvent(realtime.socket, 'open');
    const seen: string[] = [];
    const detached: string[] = [];
    realtime.on('event', (event) => seen.push(event.type));
    const remove = (event: { type: string }) => detached.push(event.type);
    realtime.on('event', remove);
    const errors: Error[] = [];
    realtime.on('error', (err) => errors.push(err));

    try {
      const [peer, request] = await incoming;
      await opened;
      expect(request.url).toBe('/v1/realtime?model=gpt-realtime');
      if (native) {
        expect(request.headers['sec-websocket-protocol']).toBe(
          [
            'realtime',
            'openai-insecure-api-key.ek_synthetic_wire',
            ...(beta ? ['openai-beta.realtime-v1'] : []),
          ].join(', '),
        );
        expect(request.headers).not.toHaveProperty('authorization');
      } else {
        expect(request.headers.authorization).toBe('Bearer ek_synthetic_wire');
        expect(request.headers['openai-beta']).toBe(beta ? 'realtime=v1' : undefined);
      }

      const created = realtime.emitted('session.created');
      peer.send(JSON.stringify({ type: 'session.created', event_id: 'ses_1', session: { id: 's_1' } }));
      expect(await created).toMatchObject({ event_id: 'ses_1', session: { id: 's_1' } });
      realtime.off('event', remove);

      const canceled = once(peer, 'message');
      expect(realtime.send({ type: 'response.cancel', event_id: 'cancel_1' })).toBeUndefined();
      const [cancelWire] = await canceled;
      expect(JSON.parse(String(cancelWire))).toEqual({ type: 'response.cancel', event_id: 'cancel_1' });
      const done = realtime.emitted('response.done');
      peer.send(
        JSON.stringify({
          type: 'response.done',
          event_id: 'end_1',
          response: { id: 'resp_1', status: 'cancelled', output: [] },
        }),
      );
      expect(await done).toMatchObject({ response: { id: 'resp_1', status: 'cancelled' } });

      const future = realtime.emitted('event');
      const envelope = {
        type: 'session.future_event',
        event_id: 'future_1',
        new_field: null,
        data: { v: 2 },
      };
      peer.send(JSON.stringify(envelope));
      expect(await future).toEqual(envelope);
      expect(seen).toEqual(['session.created', 'response.done', 'session.future_event']);
      expect(detached).toEqual(['session.created']);
      expect(errors).toEqual([]);

      // Cancellation/detaching one consumer does not end the session's socket.
      const followup = once(peer, 'message');
      realtime.send({ type: 'response.create', event_id: 'followup' });
      const [nextWire] = await followup;
      expect(JSON.parse(String(nextWire))).toMatchObject({ event_id: 'followup' });
      const closed = once(peer, 'close');
      realtime.close();
      const [code, reason] = await closed;
      expect([code, String(reason)]).toEqual([1000, 'OK']);
    } finally {
      realtime.close();
    }
  });

  test('refreshes only when the caller recreates after disconnect, without replaying previous writes', async () => {
    let key = 'ek_first_wire';
    let resolutions = 0;
    const client = new OpenAI({
      baseURL,
      apiKey: async () => {
        resolutions += 1;
        return key;
      },
    });
    const incoming = once(peers, 'connection');
    const original: RealtimeWire = await Realtime.create(client, settings);
    original.on('error', () => {});
    const opened = rawEvent(original.socket, 'open');
    const [firstPeer, firstRequest] = await incoming;
    await opened;
    expect(resolutions).toBe(1);
    const firstWire = once(firstPeer, 'message');
    original.send({ type: 'response.create', event_id: 'old_delivery_uncertain' });
    const [firstData] = await firstWire;
    expect(JSON.parse(String(firstData))).toMatchObject({ event_id: 'old_delivery_uncertain' });
    const disconnected = rawEvent(original.socket, 'close');
    firstPeer.terminate();
    const [close] = await disconnected;
    expect(close).toEqual(native ? expect.objectContaining({ code: 1006 }) : 1006);
    expect(resolutions).toBe(1);

    key = 'ek_second_wire';
    const newConnection = once(peers, 'connection');
    const commands: unknown[] = [];
    peers.once('connection', (peer) => peer.on('message', (data) => commands.push(JSON.parse(String(data)))));
    const replacement: RealtimeWire = await Realtime.create(client, settings);
    replacement.on('error', () => {});
    const replacementOpened = rawEvent(replacement.socket, 'open');
    try {
      const [nextPeer, request] = await newConnection;
      await replacementOpened;
      expect(resolutions).toBe(2);
      expect(request.url).toBe(firstRequest.url);
      if (native) {
        expect(firstRequest.headers['sec-websocket-protocol']).toContain(
          'openai-insecure-api-key.ek_first_wire',
        );
        expect(request.headers['sec-websocket-protocol']).toContain('openai-insecure-api-key.ek_second_wire');
      } else {
        expect(firstRequest.headers.authorization).toBe('Bearer ek_first_wire');
        expect(request.headers.authorization).toBe('Bearer ek_second_wire');
      }
      const callerWrite = once(nextPeer, 'message');
      replacement.send({ type: 'response.create', event_id: 'caller_decided_next' });
      await callerWrite;
      const closing = once(nextPeer, 'close');
      replacement.close({ code: 1000, reason: 'caller done' });
      const [code] = await closing;
      expect(code).toBe(1000);
      expect(commands).toEqual([{ type: 'response.create', event_id: 'caller_decided_next' }]);
    } finally {
      original.close();
      replacement.close();
    }
  });

  test('preserves raw binary bytes and reports a parse error without disconnecting other consumers', async () => {
    const incoming = once(peers, 'connection');
    const realtime: RealtimeWire = new Realtime(
      settings,
      new OpenAI({ baseURL, apiKey: 'ek_synthetic_wire' }),
    );
    const opened = rawEvent(realtime.socket, 'open');
    const seen: string[] = [];
    realtime.on('event', (event) => seen.push(event.type));
    try {
      const [peer] = await incoming;
      await opened;
      const raw = rawEvent(realtime.socket, 'message');
      const sdkError = realtime.emitted('error');
      const binary = Buffer.from([0xff, 0, 0x7f]);
      peer.send(binary, { binary: true });
      const [frame] = await raw;
      if (native) {
        expect(frame).toBeInstanceOf(MessageEvent);
        if (!(frame instanceof MessageEvent) || !(frame.data instanceof Blob)) {
          throw new Error('Expected the native default binary MessageEvent Blob');
        }
        expect(Buffer.from(await frame.data.arrayBuffer())).toEqual(binary);
      } else {
        expect(frame).toEqual(binary);
      }
      expect(await sdkError).toMatchObject({
        name: 'OpenAIRealtimeError',
        message: 'could not parse websocket event',
      });
      expect(seen).toEqual([]);
      const updated = realtime.emitted('session.updated');
      peer.send(
        JSON.stringify({ type: 'session.updated', event_id: 'after_binary', session: { id: 's_1' } }),
      );
      expect(await updated).toMatchObject({ event_id: 'after_binary', session: { id: 's_1' } });
      expect(seen).toEqual(['session.updated']);
      const closing = once(peer, 'close');
      realtime.close();
      const [code] = await closing;
      expect(code).toBe(1000);
    } finally {
      realtime.close();
    }
  });
});

describe.each([
  { label: 'GA', Realtime: StableWS, beta: false },
  { label: 'beta', Realtime: BetaWS, beta: true },
])('$label Azure ws upgrade', ({ Realtime, beta }) => {
  test.each(['api key', 'token provider'])(
    'routes and authenticates %s only in expected headers',
    async (credential) => {
      const client = new AzureOpenAI({
        baseURL,
        apiVersion: '2025-04-01-preview',
        deployment: 'synthetic-deployment',
        ...(credential === 'api key'
          ? { apiKey: 'synthetic-azure-wire' }
          : { azureADTokenProvider: async () => 'synthetic-azure-wire' }),
      });
      const incoming = once(peers, 'connection');
      const realtime: RealtimeWire = await Realtime.azure(client, {
        options: { ca: lab.certificateAuthority },
      });
      realtime.on('error', () => {});
      const opened = rawEvent(realtime.socket, 'open');
      try {
        const [peer, request] = await incoming;
        await opened;
        if (!request.url) {
          throw new Error('Missing upgrade request URL');
        }
        const url = new URL(request.url, baseURL);
        expect(url.pathname).toBe('/v1/realtime');
        expect(url.searchParams.get(beta ? 'deployment' : 'model')).toBe('synthetic-deployment');
        expect(url.searchParams.get('api-version')).toBe(beta ? '2025-04-01-preview' : null);
        expect(url.href).not.toContain('synthetic-azure-wire');
        expect(request.headers['api-key']).toBe(
          credential === 'api key' ? 'synthetic-azure-wire' : undefined,
        );
        expect(request.headers.authorization).toBe(
          credential === 'token provider' ? 'Bearer synthetic-azure-wire' : undefined,
        );
        expect(request.headers['openai-beta']).toBe(beta ? 'realtime=v1' : undefined);
        const closing = once(peer, 'close');
        realtime.close();
        const [code] = await closing;
        expect(code).toBe(1000);
      } finally {
        realtime.close();
      }
    },
  );
});

test.each([StableWS, StableNative])(
  'recovery only retains sends after a disconnect (%s)',
  async (Realtime) => {
    const connected = once(peers, 'connection');
    const realtime = new Realtime(
      { ...settings, reconnect: true, maxQueueBytes: 1024 },
      new OpenAI({ baseURL, apiKey: 'ek_initial' }),
    );
    const errors: Error[] = [];
    realtime.on('error', (error) => errors.push(error));
    const opened = rawEvent(realtime.socket, 'open');
    realtime.send({ type: 'response.create' });
    try {
      await connected;
      await opened;
      expect({ errors: errors.length, pending: realtime.takePending() }).toEqual({ errors: 1, pending: [] });
    } finally {
      realtime.close();
    }
  },
);

test.each([StableWS, StableNative])(
  'opt-in model recovery refreshes credentials and holds unsent events until explicit flush (%s)',
  async (Realtime) => {
    let resolutions = 0;
    const client = new OpenAI({ baseURL, apiKey: async () => `ek_recovery_${(resolutions += 1)}` });
    let cachedKey: string | null = null;
    Object.defineProperty(client, 'apiKey', {
      get: () => (cachedKey === null ? null : `${cachedKey}_committed`),
      set: (value: string | null) => {
        cachedKey = value;
      },
    });
    const connected = once(peers, 'connection');
    const realtime = await Realtime.create(client, {
      ...settings,
      reconnect: true,
      maxQueueBytes: 1024,
      reconnectInitialDelay: 1,
    });
    realtime.on('error', () => {});
    const [first] = await connected;
    await rawEvent(realtime.socket, 'open');
    const oldSocket = realtime.socket;
    const initialBinaryType = oldSocket.binaryType;
    const sent = once(first, 'message');
    realtime.send({ type: 'response.create', event_id: 'already_sent' });
    await sent;
    realtime.on('reconnecting', () => realtime.send({ type: 'response.create', event_id: 'held' }));
    const replacement = once(peers, 'connection');
    const recovered = realtime.emitted('reconnected');
    first.close(1012);
    const [next, request] = await replacement;
    const commands: unknown[] = [];
    next.on('message', (data: Buffer) => commands.push(JSON.parse(String(data))));
    await recovered;
    try {
      expect(resolutions).toBe(2);
      if (Realtime === StableWS) {
        expect(request.headers.authorization).toBe('Bearer ek_recovery_2_committed');
      } else {
        expect(request.headers['sec-websocket-protocol']).toContain('ek_recovery_2_committed');
        expect([initialBinaryType, realtime.socket.binaryType]).toEqual(['blob', 'blob']);
      }
      expect(realtime.socket).not.toBe(oldSocket);
      expect(commands).toEqual([]);
      realtime.send({ type: 'session.update', session: { type: 'realtime' } });
      realtime.flushPending();
      // oxlint-disable-next-line promise/avoid-new -- Wait for both ordered wire messages, independent of their scheduling.
      await new Promise<void>((resolve) => {
        const check = () => {
          if (commands.length === 2) {
            resolve();
          }
        };
        next.on('message', check);
        check();
      });
      expect(commands).toEqual([
        { type: 'session.update', session: { type: 'realtime' } },
        { type: 'response.create', event_id: 'held' },
      ]);
      expect(realtime.takePending()).toEqual([]);
      const closed = realtime.emitted('close');
      next.close(1000, 'peer done');
      await expect(closed).resolves.toEqual([1000, 'peer done', []]);
    } finally {
      realtime.close();
    }
  },
);

test('recovery captures ws options before refreshing credentials', async () => {
  const options = {
    ca: Buffer.from(lab.certificateAuthority),
    headers: { 'x-recovery-snapshot': 'original' },
  };
  let resolutions = 0;
  const client = new OpenAI({
    baseURL,
    apiKey: async () => {
      if ((resolutions += 1) === 2) {
        options.ca.fill(0);
        options.headers['x-recovery-snapshot'] = 'mutated';
      }
      return `ek_snapshot_${resolutions}`;
    },
  });
  const connected = once(peers, 'connection');
  const realtime = await StableWS.create(client, {
    model: settings.model,
    options,
    reconnect: true,
    maxReconnectAttempts: 1,
    reconnectInitialDelay: 1,
  });
  realtime.on('error', () => {});
  const [first] = await connected;
  await rawEvent(realtime.socket, 'open');
  const incoming = once(peers, 'connection', { signal: AbortSignal.timeout(5000) });
  const recovered = realtime.emitted('reconnected');
  first.close(1012);
  try {
    const [[, request]] = await Promise.all([incoming, recovered]);
    expect(request.headers['x-recovery-snapshot']).toBe('original');
  } finally {
    realtime.close();
  }
});

test('opt-in recovery can be canceled during backoff without opening another socket', async () => {
  const connected = once(peers, 'connection');
  const realtime = new StableWS(
    { ...settings, reconnect: true, reconnectInitialDelay: 60_000 },
    new OpenAI({ baseURL, apiKey: 'ek_cancel' }),
  );
  realtime.on('error', () => {});
  const [first] = await connected;
  const originalSocket = realtime.socket;
  await rawEvent(originalSocket, 'open');
  const closed = realtime.emitted('close');
  const reconnecting = realtime.emitted('reconnecting');
  first.close(1012);
  await reconnecting;
  realtime.close();
  expect(await closed).toEqual([1000, 'OK', []]);
  expect(realtime.socket).toBe(originalSocket);
});

test.each([StableWS, StableNative])('recovery uses one URL per lifetime attempt (%s)', async (Realtime) => {
  let builtURLs = 0;
  const connected = once(peers, 'connection');
  const realtime = new Realtime(
    {
      ...settings,
      reconnect: true,
      maxReconnectAttempts: 2,
      reconnectInitialDelay: 1,
      buildRealtimeURL: () => {
        const url = new URL('realtime', baseURL);
        url.protocol = 'wss:';
        url.searchParams.set('target', String((builtURLs += 1)));
        return url;
      },
    },
    new OpenAI({ baseURL, apiKey: 'ek_attempt' }),
  );
  realtime.on('error', () => {});
  const attempts: number[] = [];
  realtime.on('reconnecting', ({ attempt }) => attempts.push(attempt));
  const reconnect = async (peer: WebSocket) => {
    const incoming = once(peers, 'connection');
    const recovered = realtime.emitted('reconnected');
    peer.close(1012);
    const [replacement, request] = await incoming;
    await recovered;
    return {
      peer: replacement,
      target: new URL(request.url, baseURL).searchParams.get('target'),
      reported: realtime.url.searchParams.get('target'),
    };
  };
  try {
    const [first] = await connected;
    await rawEvent(realtime.socket, 'open');
    const second = await reconnect(first);
    const third = await reconnect(second.peer);
    expect({
      attempts,
      targets: [second.target, third.target],
      reported: [second.reported, third.reported],
    }).toEqual({
      attempts: [1, 2],
      targets: ['2', '3'],
      reported: ['2', '3'],
    });
  } finally {
    realtime.close();
  }
});

test.each([StableWS, StableNative])(
  'recovery rejects overflow and keeps wire events separate from lifecycle (%s)',
  async (Realtime) => {
    const connected = once(peers, 'connection');
    const realtime = new Realtime(
      { ...settings, reconnect: true, maxReconnectAttempts: 1, reconnectInitialDelay: 1 },
      new OpenAI({ baseURL, apiKey: 'ek_limits' }),
    );
    const errors: Error[] = [];
    realtime.on('error', (error) => errors.push(error));
    const [first] = await connected;
    await rawEvent(realtime.socket, 'open');
    let closes = 0;
    realtime.on('close', () => {
      closes += 1;
    });
    for (const type of ['close', 'reconnected', 'reconnecting']) {
      const event = realtime.emitted('event');
      first.send(JSON.stringify({ type }));
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each event acts as a barrier before checking the next wire type.
      expect(await event).toEqual({ type });
    }
    expect(closes).toBe(0);
    realtime.on('reconnecting', () => {
      realtime.send({ type: 'response.create' });
      const unserializable = {
        type: 'response.create' as const,
        toJSON() {
          throw new Error('serialization failed');
        },
      };
      realtime.send(unserializable);
      // oxlint-disable-next-line unicorn/no-useless-undefined -- Exercise JSON.stringify returning undefined.
      const omitted = { type: 'response.create' as const, toJSON: () => undefined };
      realtime.send(omitted);
    });
    const replacement = once(peers, 'connection');
    // oxlint-disable-next-line promise/avoid-new -- Expected admission errors must not reject this lifecycle wait.
    const recovered = new Promise<void>((resolve) => {
      realtime.on('reconnected', resolve);
    });
    first.close(1012);
    const [next] = await replacement;
    await recovered;
    expect(errors).toHaveLength(3);
    expect(realtime.takePending()).toEqual([]);
    // oxlint-disable-next-line promise/avoid-new -- Wait for terminal cleanup while also observing expected error events.
    const closed = new Promise<void>((resolve) => {
      realtime.on('close', () => resolve());
    });
    next.close(1012);
    await closed;
    expect(closes).toBe(1);
    expect(errors).toHaveLength(4);
    expect(errors[3]?.message).toContain('1 attempts');
    realtime.close();
  },
);

test.each([StableWS, StableNative])(
  'failed physical close ends transport and logical recovery (%s)',
  async (Realtime) => {
    const connected = once(peers, 'connection');
    const realtime = new Realtime(
      { ...settings, reconnect: true },
      new OpenAI({ baseURL, apiKey: 'ek_close' }),
    );
    const errors: Error[] = [];
    realtime.on('error', (error) => errors.push(error));
    const [first] = await connected;
    await rawEvent(realtime.socket, 'open');
    const physicalClose = once(first, 'close', { signal: AbortSignal.timeout(5000) });
    const rawClose = rawEvent(realtime.socket, 'close');
    const notifications: string[] = [];
    realtime.on('event', ({ type }) => {
      notifications.push(type);
      if (type === 'session.created') {
        realtime.close({ code: 1, reason: 'invalid physical close' });
      }
    });
    realtime.on('session.created', () => notifications.push('session.created callback'));
    // oxlint-disable-next-line promise/avoid-new -- Wait for terminal cleanup while also observing expected error events.
    const closed = new Promise<void>((resolve) => {
      realtime.on('close', () => {
        notifications.push('close');
        resolve();
      });
    });
    first.send(JSON.stringify({ type: 'session.created' }));
    first.send(JSON.stringify({ type: 'session.updated' }));
    await Promise.all([closed, physicalClose, rawClose]);
    expect(notifications).toEqual(['session.created', 'close']);
    realtime.send({ type: 'response.create' });
    expect(errors).toHaveLength(2);
    expect(errors[1]?.message).toContain('closed WebSocket');
  },
);

const terminalFailures = ['initial authentication', 'authentication', 'TLS'];
test.each(terminalFailures)('recovery reports a terminal %s rejection', async (failure) => {
  const tls = failure === 'TLS';
  const initial = failure === 'initial authentication';
  const endpoint = createServer({ cert: lab.server.certificate, key: lab.server.privateKey });
  let attempts = 0;
  const sockets = new WebSocketServer({
    server: endpoint,
    verifyClient: () => (attempts += 1) === 1 && !initial,
  });
  await once(endpoint.listen(0, '127.0.0.1'), 'listening');
  const address = endpoint.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing server address');
  }
  const connected = initial ? undefined : once(sockets, 'connection');
  const agent = new Agent({ maxCachedSessions: 0 });
  const realtime = new StableWS(
    {
      ...settings,
      options: { ...settings.options, agent },
      reconnect: true,
      reconnectInitialDelay: 1,
      maxReconnectAttempts: tls ? 5 : 1,
    },
    new OpenAI({ baseURL: `https://127.0.0.1:${address.port}/v1`, apiKey: 'ek_rejected' }),
  );
  const errors: Error[] = [];
  realtime.on('error', (error) => errors.push(error));
  // oxlint-disable-next-line promise/avoid-new -- Authentication errors must not reject the cleanup wait.
  const closed = new Promise<void>((resolve) => {
    realtime.on('close', () => resolve());
  });
  try {
    if (connected) {
      const [first] = await connected;
      await rawEvent(realtime.socket, 'open');
      if (tls) {
        endpoint.setSecureContext({ cert: lab.proxyServer.certificate, key: lab.proxyServer.privateKey });
      }
      first.close(1012);
    }
    await closed;
    expect(attempts).toBe(initial || tls ? 1 : 2);
    const diagnostic = tls ? /certificate|verify/iu : /401/u;
    expect(errors).toEqual([
      expect.objectContaining({
        message: expect.stringMatching(diagnostic),
        cause: expect.objectContaining({ message: expect.stringMatching(diagnostic) }),
      }),
    ]);
    expect(realtime.socket.readyState).toBe(WebSocket.CLOSED);
  } finally {
    realtime.close();
    agent.destroy();
    sockets.close();
    endpoint.close();
  }
});

test.each([StableWS, StableNative])(
  'recovery reports the latest credential failure (%s)',
  async (Realtime) => {
    const failures = [new Error('first refresh failed'), new Error('latest refresh failed')];
    let resolutions = 0;
    const client = new OpenAI({
      baseURL,
      apiKey: async () => {
        resolutions += 1;
        if (resolutions === 1) {
          return 'ek_refresh';
        }
        throw failures[resolutions - 2];
      },
    });
    const connected = once(peers, 'connection');
    const realtime = await Realtime.create(client, {
      ...settings,
      reconnect: true,
      maxReconnectAttempts: 2,
      reconnectInitialDelay: 1,
    });
    const errors: Error[] = [];
    realtime.on('error', (error) => errors.push(error));
    // oxlint-disable-next-line promise/avoid-new -- Expected credential errors must not reject the cleanup wait.
    const closed = new Promise<void>((resolve) => {
      realtime.on('close', () => resolve());
    });
    try {
      const [first] = await connected;
      await rawEvent(realtime.socket, 'open');
      first.close(1012);
      await closed;
      expect(resolutions).toBe(3);
      expect(errors).toEqual([
        expect.objectContaining({
          message: expect.stringContaining('2 attempts'),
          cause: expect.objectContaining({ cause: failures[1] }),
        }),
      ]);
    } finally {
      realtime.close();
    }
  },
);

test.each([StableWS, StableNative])('recovery rejects sideband selectors in custom URLs (%s)', (Realtime) => {
  expect(
    () =>
      new Realtime(
        {
          ...settings,
          reconnect: true,
          buildRealtimeURL: () => new URL('wss://localhost/realtime?call_id=existing'),
        },
        new OpenAI({ apiKey: 'ek_sideband' }),
      ),
  ).toThrow('requires a model session');
});

test.each([StableWS, StableNative])('recovery rejects delays outside the timer range (%s)', (Realtime) => {
  for (const delay of [{ reconnectInitialDelay: 2_147_483_648 }, { reconnectMaxDelay: 2_147_483_648 }]) {
    expect(
      () =>
        new Realtime(
          {
            ...settings,
            ...delay,
            reconnect: true,
            buildRealtimeURL: () => {
              throw new Error('URL should not be built');
            },
          },
          new OpenAI({ apiKey: 'ek_timer' }),
        ),
    ).toThrow('2147483647');
  }
});
