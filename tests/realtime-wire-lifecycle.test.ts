import { once } from 'node:events';
import { createServer } from 'node:https';
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
