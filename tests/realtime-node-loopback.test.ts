import { once } from 'node:events';
import { createServer } from 'node:https';
import { OpenAI } from 'openai';
import { OpenAIRealtimeError } from 'openai/realtime';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import { WebSocketServer } from 'ws';
import { createX509TestLab } from './utils/x509-test-lab';

const lab = createX509TestLab();
const server = createServer({ cert: lab.server.certificate, key: lab.server.privateKey });
const peers = new WebSocketServer({ server });
let baseURL: string;

beforeAll(async () => {
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing loopback server address');
  }
  baseURL = `https://127.0.0.1:${address.port}/gateway/v1/`;
});

afterEach(() => {
  for (const peer of peers.clients) {
    peer.terminate();
  }
});

afterAll(async () => {
  const closed = once(peers, 'close');
  peers.close();
  await closed;
  const stopped = once(server, 'close');
  server.close();
  await stopped;
});

test('GA Realtime WSS preserves handshake options and accepts another command after an API error', async () => {
  const incoming = once(peers, 'connection');
  const realtime = new OpenAIRealtimeWS(
    {
      model: 'gpt-realtime',
      options: {
        ca: lab.certificateAuthority,
        headers: { 'X-Trace': 'synthetic-session', Authorization: 'Bearer synthetic-override' },
      },
    },
    new OpenAI({ apiKey: 'synthetic-client-key', baseURL }),
  );
  const opened = once(realtime.socket, 'open');
  try {
    const [peer, request] = await incoming;
    await opened;
    expect(request.url).toBe('/gateway/v1/realtime?model=gpt-realtime');
    expect(request.headers).toMatchObject({
      'x-trace': 'synthetic-session',
      authorization: 'Bearer synthetic-client-key',
    });
    expect(request.headers).not.toHaveProperty('openai-beta');

    const first = once(peer, 'message');
    realtime.send({
      type: 'session.update',
      event_id: 'client_update',
      session: { type: 'realtime', instructions: 'Synthetic session configuration.' },
    });
    const [firstWire] = await first;
    expect(JSON.parse(String(firstWire))).toEqual({
      type: 'session.update',
      event_id: 'client_update',
      session: { type: 'realtime', instructions: 'Synthetic session configuration.' },
    });

    const events: string[] = [];
    realtime.on('event', (event) => events.push(event.type));
    const rejection = realtime.emitted('error');
    peer.send(
      JSON.stringify({
        type: 'error',
        event_id: 'server_error',
        error: {
          type: 'invalid_request_error',
          message: 'Synthetic request rejected',
          code: 'invalid_value',
          param: 'session.instructions',
          event_id: 'client_update',
        },
      }),
    );
    const error = await rejection;
    expect(error).toBeInstanceOf(OpenAIRealtimeError);
    expect(error).toMatchObject({
      event_id: 'server_error',
      error: { code: 'invalid_value', param: 'session.instructions', event_id: 'client_update' },
    });

    const next = once(peer, 'message');
    realtime.send({
      type: 'response.create',
      event_id: 'client_retry',
      response: { output_modalities: ['text'] },
    });
    const [nextWire] = await next;
    expect(JSON.parse(String(nextWire))).toEqual({
      type: 'response.create',
      event_id: 'client_retry',
      response: { output_modalities: ['text'] },
    });
    const accepted = realtime.emitted('response.created');
    peer.send(
      JSON.stringify({
        type: 'response.created',
        event_id: 'server_created',
        response: { id: 'response_after_error', status: 'in_progress' },
      }),
    );
    expect(await accepted).toMatchObject({
      event_id: 'server_created',
      response: { id: 'response_after_error' },
    });
    expect(events).toEqual(['error', 'response.created']);

    const closing = once(peer, 'close');
    realtime.close();
    const [code, reason] = await closing;
    expect([code, String(reason)]).toEqual([1000, 'OK']);
  } finally {
    realtime.close();
  }
});

test('GA Realtime replacement refreshes function credentials and sends only caller-restored state', async () => {
  let credential = 'synthetic-first';
  const client = new OpenAI({ apiKey: async () => credential, baseURL });
  const incoming = once(peers, 'connection');
  const original = await OpenAIRealtimeWS.create(client, {
    intent: 'transcription',
    options: { ca: lab.certificateAuthority, headers: { 'X-Trace': 'synthetic-first-session' } },
  });
  const opened = once(original.socket, 'open');
  try {
    const [firstPeer, firstRequest] = await incoming;
    await opened;
    expect(firstRequest.url).toBe('/gateway/v1/realtime?intent=transcription');
    expect(firstRequest.headers).toMatchObject({
      authorization: 'Bearer synthetic-first',
      'x-trace': 'synthetic-first-session',
    });
    expect(firstRequest.headers).not.toHaveProperty('openai-beta');
    const first = once(firstPeer, 'message');
    original.send({
      type: 'session.update',
      event_id: 'original_command',
      session: { type: 'transcription' },
    });
    const [wire] = await first;
    expect(JSON.parse(String(wire))).toMatchObject({ event_id: 'original_command' });

    const disconnected = once(original.socket, 'close');
    firstPeer.terminate();
    const [code] = await disconnected;
    expect(code).toBe(1006);

    credential = 'synthetic-refreshed';
    const reconnected = once(peers, 'connection');
    const replacementCommands: unknown[] = [];
    peers.once('connection', (peer) => {
      peer.on('message', (data) => replacementCommands.push(JSON.parse(String(data))));
    });
    const replacement = await OpenAIRealtimeWS.create(client, {
      intent: 'transcription',
      options: { ca: lab.certificateAuthority, headers: { 'X-Trace': 'synthetic-replacement' } },
    });
    const replacementOpened = once(replacement.socket, 'open');
    try {
      const [secondPeer, secondRequest] = await reconnected;
      await replacementOpened;
      expect(secondRequest.url).toBe(firstRequest.url);
      expect(secondRequest.headers).toMatchObject({
        authorization: 'Bearer synthetic-refreshed',
        'x-trace': 'synthetic-replacement',
      });
      const restored = once(secondPeer, 'message');
      replacement.send({
        type: 'session.update',
        event_id: 'caller_restored',
        session: { type: 'transcription' },
      });
      await restored;
      const closing = once(secondPeer, 'close');
      replacement.close({ code: 1000, reason: 'caller finished' });
      const [closeCode, closeReason] = await closing;
      expect([closeCode, String(closeReason)]).toEqual([1000, 'caller finished']);
      expect(replacementCommands).toEqual([
        {
          type: 'session.update',
          event_id: 'caller_restored',
          session: { type: 'transcription' },
        },
      ]);
    } finally {
      replacement.close();
    }
  } finally {
    original.close();
  }
});
