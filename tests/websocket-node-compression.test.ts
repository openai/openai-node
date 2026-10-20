import { once } from 'node:events';
import OpenAI from 'openai';
import { LiveWS } from 'openai/resources/live/ws';
import { ForksWS } from 'openai/resources/live/forks/ws';
import { SidebandWS } from 'openai/resources/live/sideband/ws';
import { ResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import { WebSocketServer } from 'ws';
import type { ClientOptions } from 'ws';

let server: WebSocketServer;
let baseURL: string;
const session = { type: 'session.created', session: { id: 'session-local' } };
const response = { type: 'response.created', sequence_number: 0, response: { id: 'resp_local' } };

beforeAll(async () => {
  server = new WebSocketServer({ host: '127.0.0.1', port: 0, perMessageDeflate: true });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new TypeError('Missing loopback server address');
  }
  baseURL = `http://127.0.0.1:${address.port}/v1/`;
});

afterEach(() => {
  for (const peer of server.clients) {
    peer.terminate();
  }
});

afterAll(async () => {
  const closed = once(server, 'close');
  server.close();
  await closed;
});

const variants: {
  name: string;
  connect: (
    client: OpenAI,
    options: ClientOptions,
  ) => Pick<LiveWS, 'socket' | 'close'> & { emitted: (event: 'event') => Promise<{ type: string }> };
  event: typeof session | typeof response;
}[] = [
  {
    name: 'Live',
    connect: (client: OpenAI, options: ClientOptions) => new LiveWS(client, options),
    event: session,
  },
  {
    name: 'Live Forks',
    connect: (client: OpenAI, options: ClientOptions) =>
      new ForksWS(client, { session_id: 'session-local' }, options),
    event: session,
  },
  {
    name: 'Live Sideband',
    connect: (client: OpenAI, options: ClientOptions) =>
      new SidebandWS(client, { session_id: 'session-local' }, options),
    event: session,
  },
  {
    name: 'Responses',
    connect: (client: OpenAI, options: ClientOptions) => new ResponsesWS(client, options),
    event: response,
  },
  {
    name: 'Beta Responses',
    connect: (client: OpenAI, options: ClientOptions) => new BetaResponsesWS(client, options),
    event: response,
  },
];

describe.each(variants)('$name Node WebSocket compression', ({ connect, event }) => {
  test.each([
    { label: 'default', options: {}, extension: '' },
    {
      label: 'explicit undefined defaults',
      options: { maxPayload: undefined, perMessageDeflate: undefined },
      extension: '',
    },
    { label: 'default with finite payload limit', options: { maxPayload: 1024 }, extension: '' },
    { label: 'explicitly disabled', options: { perMessageDeflate: false }, extension: '' },
    { label: 'explicitly enabled', options: { perMessageDeflate: true }, extension: 'permessage-deflate' },
    {
      label: 'configured with finite payload limit',
      options: { perMessageDeflate: { clientNoContextTakeover: true }, maxPayload: 1024 },
      extension: 'permessage-deflate',
    },
  ])('honors $label and delivers a small event', async ({ options, extension }) => {
    const incoming = once(server, 'connection');
    const connection = connect(new OpenAI({ baseURL, apiKey: 'synthetic-local-key' }), options);
    const opened = once(connection.socket.platformSocket, 'open');
    try {
      const [peer, request] = await incoming;
      await opened;
      expect(peer.extensions).toBe(extension);
      expect(connection.socket.platformSocket.extensions).toBe(extension);
      if (typeof options.perMessageDeflate === 'object') {
        expect(request.headers['sec-websocket-extensions']).toContain('client_no_context_takeover');
      }
      const received = connection.emitted('event');
      peer.send(JSON.stringify(event));
      expect(await received).toEqual(event);
    } finally {
      connection.close();
    }
  });

  test('delivers messages above the native default limit when no options are supplied', async () => {
    const incoming = once(server, 'connection');
    const connection = connect(new OpenAI({ baseURL, apiKey: 'synthetic-local-key' }), {});
    const opened = once(connection.socket.platformSocket, 'open');
    try {
      const [peer] = await incoming;
      await opened;
      expect(peer.extensions).toBe('');
      const received = connection.emitted('event');
      // The wire event, including its ordinary JSON envelope, exceeds ws's 100 MiB default.
      peer.send(JSON.stringify({ ...event, padding: 'a'.repeat(100 * 1024 * 1024) }));
      const actual = await received;
      expect(actual).toMatchObject(event);
      expect(actual).toHaveProperty('padding.length', 100 * 1024 * 1024);
    } finally {
      connection.close();
    }
  }, 30_000);

  test('captures the supplied payload and compression values on construction', async () => {
    let payloadReads = 0;
    let compressionReads = 0;
    const options = {
      get maxPayload() {
        payloadReads += 1;
        return payloadReads === 1 ? 1024 : 128;
      },
      get perMessageDeflate() {
        compressionReads += 1;
        return compressionReads !== 1;
      },
    };
    const incoming = once(server, 'connection');
    const connection = connect(new OpenAI({ baseURL, apiKey: 'synthetic-local-key' }), options);
    const opened = once(connection.socket.platformSocket, 'open');
    try {
      const [peer] = await incoming;
      await opened;
      expect(peer.extensions).toBe('');
      const sample = { ...event, padding: 'ordinary sample data '.repeat(22) };
      const received = connection.emitted('event');
      peer.send(JSON.stringify(sample));
      expect(await received).toEqual(sample);
      expect(payloadReads).toBe(1);
      expect(compressionReads).toBe(1);
    } finally {
      connection.close();
    }
  });

  test.each([
    { label: 'default', options: { maxPayload: 128 } },
    { label: 'explicit opt-in', options: { maxPayload: 128, perMessageDeflate: true } },
  ])('preserves finite payload limits with $label', async ({ options }) => {
    const incoming = once(server, 'connection');
    const connection = connect(new OpenAI({ baseURL, apiKey: 'synthetic-local-key' }), options);
    const opened = once(connection.socket.platformSocket, 'open');
    try {
      const [peer] = await incoming;
      await opened;
      const received = expect(connection.emitted('event')).rejects.toThrow(/Max payload size exceeded/u);
      peer.send(
        JSON.stringify({
          ...event,
          metadata: {
            note: 'This ordinary sample event has extra descriptive text so it exceeds the caller-selected 128-byte receive limit.',
          },
        }),
      );
      await received;
    } finally {
      connection.close();
    }
  });
});
