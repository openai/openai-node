import { once } from 'node:events';
import { createServer } from 'node:https';
import { vi } from 'vitest';
import { OpenAI } from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import { OpenAIRealtimeWS as BetaRealtimeWS } from 'openai/beta/realtime/ws';
import { WebSocketServer } from 'ws';
import { createX509TestLab } from './utils/x509-test-lab';

const lab = createX509TestLab();
const server = createServer({ cert: lab.server.certificate, key: lab.server.privateKey });
const peers = new WebSocketServer({ server, perMessageDeflate: true });
const message = { type: 'session.created', event_id: 'event-local', session: { id: 'session-local' } };
let baseURL: string;

beforeAll(async () => {
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
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
  const closed = once(peers, 'close');
  peers.close();
  await closed;
  const stopped = once(server, 'close');
  server.close();
  await stopped;
});

describe.each([
  ['stable', OpenAIRealtimeWS],
  ['beta', BetaRealtimeWS],
] as const)('%s Realtime compression negotiation', (_name, Realtime) => {
  test.each([
    { label: 'default', options: {}, extension: '' },
    {
      label: 'explicit undefined defaults',
      options: { maxPayload: undefined, perMessageDeflate: undefined },
      extension: '',
    },
    { label: 'default with finite payload limit', options: { maxPayload: 32 * 1024 }, extension: '' },
    { label: 'explicitly disabled', options: { perMessageDeflate: false }, extension: '' },
    { label: 'explicitly enabled', options: { perMessageDeflate: true }, extension: 'permessage-deflate' },
    {
      label: 'configured with finite payload limit',
      options: { perMessageDeflate: { clientNoContextTakeover: true }, maxPayload: 32 * 1024 },
      extension: 'permessage-deflate',
    },
  ])('honors $label and delivers a small message', async ({ options, extension }) => {
    const incoming = once(peers, 'connection');
    const realtime = new Realtime(
      { model: 'gpt-realtime', options: { ca: lab.certificateAuthority, ...options } },
      new OpenAI({ apiKey: 'synthetic-client-key', baseURL }),
    );
    const opened = once(realtime.socket, 'open');
    try {
      const [peer] = await incoming;
      await opened;
      expect(peer.extensions).toBe(extension);
      expect(realtime.socket.extensions).toBe(extension);
      const received =
        realtime instanceof OpenAIRealtimeWS ? realtime.emitted('event') : realtime.emitted('event');
      peer.send(JSON.stringify(message));
      expect(await received).toEqual(message);
    } finally {
      realtime.close();
    }
  });

  test('uses each supplied payload and compression value once', async () => {
    let payloadReads = 0;
    let compressionReads = 0;
    const options = {
      ca: lab.certificateAuthority,
      get maxPayload() {
        payloadReads += 1;
        return payloadReads === 1 ? 1024 : 128;
      },
      get perMessageDeflate() {
        compressionReads += 1;
        return compressionReads !== 1;
      },
    };
    const incoming = once(peers, 'connection');
    const realtime = new Realtime(
      { model: 'gpt-realtime', options },
      new OpenAI({ apiKey: 'synthetic-client-key', baseURL }),
    );
    const opened = once(realtime.socket, 'open');
    try {
      const [peer] = await incoming;
      await opened;
      expect(peer.extensions).toBe('');
      const sample = { ...message, padding: 'ordinary sample data '.repeat(22) };
      const received =
        realtime instanceof OpenAIRealtimeWS ? realtime.emitted('event') : realtime.emitted('event');
      peer.send(JSON.stringify(sample));
      expect(await received).toEqual(sample);
      expect(payloadReads).toBe(1);
      expect(compressionReads).toBe(1);
    } finally {
      realtime.close();
    }
  });

  test.each(['inherited', 'non-enumerable'] as const)(
    'preserves an existing %s payload setting',
    async (placement) => {
      const readMaxPayload = vi.fn(() => 4096);
      const options = { ca: lab.certificateAuthority };
      const target = placement === 'inherited' ? {} : options;
      Object.defineProperty(target, 'maxPayload', { get: readMaxPayload });
      if (placement === 'inherited') {
        Object.setPrototypeOf(options, target);
      }
      const incoming = once(peers, 'connection');
      const realtime = new Realtime(
        { model: 'gpt-realtime', options },
        new OpenAI({ apiKey: 'synthetic-client-key', baseURL }),
      );
      const opened = once(realtime.socket, 'open');
      try {
        const [peer] = await incoming;
        await opened;
        const received =
          realtime instanceof OpenAIRealtimeWS ? realtime.emitted('event') : realtime.emitted('event');
        peer.send(JSON.stringify(message));
        expect(await received).toEqual(message);
        expect(readMaxPayload).toHaveBeenCalledTimes(1);
      } finally {
        realtime.close();
      }
    },
  );
});

test.each([
  { label: 'default', options: {}, extension: '' },
  { label: 'explicitly enabled', options: { perMessageDeflate: true }, extension: 'permessage-deflate' },
])('GA reconnect keeps $label compression behavior', async ({ options, extension }) => {
  const incoming = once(peers, 'connection');
  const realtime = new OpenAIRealtimeWS(
    {
      model: 'gpt-realtime',
      options: { ca: lab.certificateAuthority, ...options },
      reconnect: true,
      maxReconnectAttempts: 1,
      reconnectInitialDelay: 1,
    },
    new OpenAI({ apiKey: 'synthetic-client-key', baseURL }),
  );
  const opened = once(realtime.socket, 'open');
  try {
    const [first] = await incoming;
    await opened;
    const incomingAgain = once(peers, 'connection');
    const recovered = realtime.emitted('reconnected');
    first.close(1012);
    const [replacement] = await incomingAgain;
    await recovered;
    expect(replacement.extensions).toBe(extension);
    expect(realtime.socket.extensions).toBe(extension);
    const received = realtime.emitted('event');
    replacement.send(JSON.stringify(message));
    expect(await received).toEqual(message);
  } finally {
    realtime.close();
  }
});

test.each(['inherited', 'non-enumerable'] as const)(
  'GA reconnect preserves an existing %s payload setting at each attempt',
  async (placement) => {
    const readMaxPayload = vi.fn(() => 4096);
    const readHeaders = vi.fn(() => ({ 'X-Ordinary-Setting': 'preserved' }));
    const options = { ca: lab.certificateAuthority };
    const target = placement === 'inherited' ? {} : options;
    Object.defineProperties(target, { maxPayload: { get: readMaxPayload }, headers: { get: readHeaders } });
    if (placement === 'inherited') {
      Object.setPrototypeOf(options, target);
    }
    const incoming = once(peers, 'connection');
    const realtime = new OpenAIRealtimeWS(
      {
        model: 'gpt-realtime',
        options,
        reconnect: true,
        maxReconnectAttempts: 1,
        reconnectInitialDelay: 1,
      },
      new OpenAI({ apiKey: 'synthetic-client-key', baseURL }),
    );
    const opened = once(realtime.socket, 'open');
    try {
      const [first, firstRequest] = await incoming;
      await opened;
      expect(firstRequest.headers['x-ordinary-setting']).toBe('preserved');
      expect(readMaxPayload).toHaveBeenCalledTimes(1);
      expect(readHeaders).toHaveBeenCalledTimes(1);
      const incomingAgain = once(peers, 'connection');
      const recovered = realtime.emitted('reconnected');
      first.close(1012);
      const [replacement, secondRequest] = await incomingAgain;
      await recovered;
      expect(secondRequest.headers['x-ordinary-setting']).toBe('preserved');
      const received = realtime.emitted('event');
      replacement.send(JSON.stringify(message));
      expect(await received).toEqual(message);
      expect(readMaxPayload).toHaveBeenCalledTimes(2);
      expect(readHeaders).toHaveBeenCalledTimes(2);
    } finally {
      realtime.close();
    }
  },
);
