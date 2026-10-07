import { once, getEventListeners } from 'node:events';
import { execFileSync } from 'node:child_process';
import { compiledFixture } from '../../utils/compiled-fixtures';
import { createServer } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { vi } from 'vitest';
import { WebSocketServer } from 'ws';
import OpenAI, { AzureOpenAI } from 'openai';
import { BedrockOpenAI } from 'openai/bedrock';
import { createProvider } from 'openai/internal/provider';
import { OpenAIRealtimeTranslationWS } from 'openai/realtime/translations/ws';
import type { RealtimeTranslationClientEvent } from 'openai/resources/realtime/realtime';
import { createX509TestLab } from '../../utils/x509-test-lab';

const lab = createX509TestLab();

async function withServer(
  run: (server: WebSocketServer, baseURL: string) => Promise<void>,
  perMessageDeflate = false,
): Promise<void> {
  const https = createServer({ cert: lab.server.certificate, key: lab.server.privateKey });
  const server = new WebSocketServer({ server: https, perMessageDeflate });
  const listening = once(https, 'listening');
  https.listen(0, '127.0.0.1');
  await listening;
  const address = https.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected local server');
  }
  try {
    await run(server, `https://127.0.0.1:${address.port}/v1`);
  } finally {
    for (const socket of server.clients) {
      socket.terminate();
    }
    const closed = once(server, 'close');
    server.close();
    await closed;
    const stopped = once(https, 'close');
    https.close();
    await stopped;
  }
}

async function open(client: OpenAI): Promise<OpenAIRealtimeTranslationWS> {
  const connection = await OpenAIRealtimeTranslationWS.create(client, {
    model: 'translation-test',
    options: { ca: lab.certificateAuthority },
  });
  await once(connection.socket.platformSocket, 'open');
  return connection;
}

const terminal = { type: 'session.closed', event_id: 'terminal' };

describe('realtime translation WebSocket', () => {
  test('dispatches complete known events and keeps incomplete known or future envelopes raw', async () => {
    await withServer(async (server, baseURL) => {
      const session = {
        id: 'sess_test',
        audio: {},
        expires_at: 1_800_000_000,
        model: 'translation-test',
        type: 'translation',
      };
      const frames = [
        { type: 'session.input_transcript.delta', event_id: 'input', delta: 'hello' },
        { type: 'session.input_transcript.delta', event_id: 42, delta: 'not typed' },
        { type: 'session.output_transcript.delta', event_id: 'output', delta: 'bonjour' },
        { type: 'session.output_transcript.delta', event_id: 'missing delta' },
        { type: 'session.output_audio.delta', event_id: 'audio', delta: 'AA==' },
        { type: 'session.output_audio.delta', event_id: 'bad delta', delta: null },
        { type: 'session.created', event_id: 'created', session },
        { type: 'session.created', event_id: 'missing session' },
        { type: 'session.updated', event_id: 'updated', session },
        {
          type: 'session.updated',
          event_id: 'missing required nested fields',
          session: { type: 'translation' },
        },
        { type: 'error', event_id: 'valid', error: { message: 'synthetic', type: 'test' } },
        { type: 'error', event_id: 'missing nested type', error: { message: 'bad' } },
        { type: 'future.translation.event', content: 'preserved' },
        terminal,
      ];
      server.on('connection', (peer) =>
        peer.on('message', () => {
          for (const frame of frames) {
            peer.send(JSON.stringify(frame));
          }
        }),
      );
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const raw: unknown[] = [];
      const typed: string[] = [];
      connection.on('event', (event) => raw.push(event));
      connection.on('session.input_transcript.delta', (event) => typed.push(event.delta));
      connection.on('session.output_transcript.delta', (event) => typed.push(event.delta));
      connection.on('session.output_audio.delta', (event) => typed.push(event.delta));
      connection.on('session.created', (event) => typed.push(event.session?.id));
      connection.on('session.updated', (event) => typed.push(event.session?.id));
      connection.on('error', (error) => typed.push(error.error?.type ?? 'missing'));
      connection.on('session.closed', (event) => typed.push(event.event_id));
      await connection.finish({ timeoutMs: 2000 });
      expect(raw).toEqual(frames);
      expect(typed).toEqual(['hello', 'bonjour', 'AA==', 'sess_test', 'sess_test', 'test', 'terminal']);
    });
  });

  test('raw listeners cannot change validated typed payloads or close decisions', async () => {
    await withServer(async (server, baseURL) => {
      const frames = [
        { type: 'session.output_transcript.delta', event_id: 'text', delta: 'bonjour' },
        {
          type: 'session.created',
          event_id: 'created',
          session: { id: 'sess', audio: {}, expires_at: 42, model: 'translation-test', type: 'translation' },
        },
        { type: 'error', event_id: 'api', error: { message: 'synthetic', type: 'test' } },
        terminal,
      ];
      server.on('connection', (peer) =>
        peer.on('message', () => {
          for (const frame of frames) {
            peer.send(JSON.stringify(frame));
          }
        }),
      );
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const typed: string[] = [];
      connection.on('event', (event) => {
        Reflect.deleteProperty(event, 'event_id');
        if ('delta' in event) {
          Reflect.deleteProperty(event, 'delta');
        }
        if ('session' in event && typeof event.session === 'object' && event.session !== null) {
          Reflect.deleteProperty(event.session, 'model');
        }
        if ('error' in event && typeof event.error === 'object' && event.error !== null) {
          Reflect.deleteProperty(event.error, 'type');
        }
        event.type = 'listener-mutated';
      });
      connection.on('session.output_transcript.delta', (event) =>
        typed.push(event.type, event.event_id, event.delta),
      );
      connection.on('session.created', (event) =>
        typed.push(event.type, event.event_id, event.session.model),
      );
      connection.on('error', (error) => typed.push(error.event_id ?? '', error.error?.type ?? ''));
      connection.on('session.closed', (event) => typed.push(event.type, event.event_id));
      await connection.finish({ timeoutMs: 2000 });
      expect(typed).toEqual([
        'session.output_transcript.delta',
        'text',
        'bonjour',
        'session.created',
        'created',
        'translation-test',
        'api',
        'test',
        'session.closed',
        'terminal',
      ]);
    });
  });

  test('receives valid audio above the ws dependency default without an SDK payload cap', async () => {
    await withServer(async (server, baseURL) => {
      const size = 101 * 1024 * 1024;
      server.on('connection', (peer) =>
        peer.on('message', () => {
          peer.send(
            JSON.stringify({
              type: 'session.output_audio.delta',
              event_id: 'large',
              delta: 'A'.repeat(size),
            }),
          );
          peer.send(JSON.stringify(terminal));
        }),
      );
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      let receivedSize = 0;
      let rawSize = 0;
      connection.on('event', (event) => {
        if (event.type === 'session.output_audio.delta' && typeof event.delta === 'string') {
          rawSize = event.delta.length;
          event.delta = 'changed by raw listener';
        }
      });
      connection.on('session.output_audio.delta', (event) => {
        receivedSize = event.delta.length;
        expect(event.delta[0]).toBe('A');
        expect(event.delta[size - 1]).toBe('A');
      });
      await connection.finish({ timeoutMs: 30_000 });
      expect(rawSize).toBe(size);
      expect(receivedSize).toBe(size);
    });
  }, 45_000);

  test.each([
    { label: 'default', options: {}, compression: '' },
    { label: 'disabled', options: { perMessageDeflate: false }, compression: '' },
    { label: 'explicitly enabled', options: { perMessageDeflate: true }, compression: 'permessage-deflate' },
    {
      label: 'configured with caller options',
      options: { perMessageDeflate: { clientNoContextTakeover: true }, maxPayload: 32 * 1024 },
      compression: 'permessage-deflate',
    },
  ])('negotiates translation compression only when requested: $label', async ({ options, compression }) => {
    await withServer(async (server, baseURL) => {
      const peerConnected = once(server, 'connection');
      server.on('connection', (peer) =>
        peer.on('message', () => {
          peer.send(
            JSON.stringify({
              type: 'session.output_audio.delta',
              event_id: 'audio',
              delta: 'A'.repeat(16 * 1024),
            }),
          );
          peer.send(JSON.stringify(terminal));
        }),
      );
      const connection = await OpenAIRealtimeTranslationWS.create(
        new OpenAI({ apiKey: 'synthetic-key', baseURL }),
        {
          model: 'translation-test',
          options: { ca: lab.certificateAuthority, ...options },
        },
      );
      await once(connection.socket.platformSocket, 'open');
      const [peer] = await peerConnected;
      const received: string[] = [];
      connection.on('session.output_audio.delta', (event) => received.push(event.delta));
      await connection.finish({ timeoutMs: 2000 });
      expect(peer.extensions).toBe(compression);
      expect(connection.socket.platformSocket.extensions).toBe(compression);
      expect(received).toEqual(['A'.repeat(16 * 1024)]);
    }, true);
  });

  test.each([false, true])(
    'closing while connecting is intentional cleanup (SDK error listener: %s)',
    async (observeErrors) => {
      await withServer(async (_server, baseURL) => {
        const connection = await OpenAIRealtimeTranslationWS.create(
          new OpenAI({ apiKey: 'synthetic-key', baseURL }),
          { model: 'translation-test', options: { ca: lab.certificateAuthority } },
        );
        const failures: Error[] = [];
        if (observeErrors) {
          connection.on('error', (error) => failures.push(error));
        }
        expect(connection.socket.readyState).toBe(0);
        // ws reports a transport error when a CONNECTING socket is closed.
        // Wait for cleanup without node:events.once rejecting on that raw error.
        // oxlint-disable-next-line promise/avoid-new -- No library promise waits past an expected raw ws error without rejecting.
        const closed = new Promise<void>((resolve) => {
          connection.socket.platformSocket.once('close', () => resolve());
        });
        connection.close();
        connection.close();
        await closed;
        expect(failures).toEqual([]);
        await expect(connection.finish({ timeoutMs: 1000 })).rejects.toThrow('closed before session.closed');
        expect(connection.socket.platformSocket.listenerCount('message')).toBe(0);
      });
    },
  );

  test('reports a normal peer close before any terminal or finish without losing the failure', async () => {
    await withServer(async (server, baseURL) => {
      server.on('connection', (peer) => peer.on('message', () => peer.close(1000, 'test premature peer')));
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const messages: string[] = [];
      connection.on('error', (error) => messages.push(error.message));
      const closed = once(connection.socket.platformSocket, 'close');
      connection.send({ type: 'session.update', session: {} });
      await closed;
      expect(messages).toEqual([expect.stringContaining('before session.closed')]);
      await expect(connection.finish({ timeoutMs: 2000 })).rejects.toThrow('before session.closed');
      expect(messages).toHaveLength(1);
    });
  });

  test('incomplete optional audio settings remain raw; API errors include the validated reason', async () => {
    await withServer(async (server, baseURL) => {
      const session = { id: 'sess', model: 'test', type: 'translation', expires_at: 42 };
      const malformed = [
        { input: { transcription: {} } },
        { input: { noise_reduction: {} } },
        { input: { transcription: { model: 17 } } },
        { input: { noise_reduction: { type: 42 } } },
      ];
      server.on('connection', (peer) =>
        peer.on('message', () => {
          for (const phase of ['created', 'updated']) {
            for (const audio of malformed) {
              peer.send(
                JSON.stringify({
                  type: `session.${phase}`,
                  event_id: 'incomplete',
                  session: { ...session, audio },
                }),
              );
            }
          }
          peer.send(
            JSON.stringify({
              type: 'session.updated',
              event_id: 'good',
              session: {
                ...session,
                audio: { input: { transcription: { model: 'test' }, noise_reduction: null } },
              },
            }),
          );
          peer.send(
            JSON.stringify({
              type: 'error',
              event_id: 'invalid',
              error: {
                type: 'invalid_request_error',
                message: 'Invalid translation language.',
              },
            }),
          );
          peer.send(JSON.stringify(terminal));
        }),
      );
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const raw: unknown[] = [];
      const typed: string[] = [];
      const errors: string[] = [];
      connection.on('event', (event) => raw.push(event));
      connection.on('session.created', (event) => typed.push(event.event_id));
      connection.on('session.updated', (event) => typed.push(event.event_id));
      connection.on('error', (error) => errors.push(error.message));
      await connection.finish({ timeoutMs: 2000 });
      expect(raw).toHaveLength(malformed.length * 2 + 3);
      expect(typed).toEqual(['good']);
      expect(errors).toEqual(['Translation API error: Invalid translation language.']);
    });
  });

  test('typed audio, transcript and error events accept only their generated optional field values', async () => {
    await withServer(async (server, baseURL) => {
      const frames = [
        { type: 'session.output_audio.delta', event_id: 'bad_rate', delta: 'AA==', sample_rate: 'invalid' },
        { type: 'session.output_audio.delta', event_id: 'bad_channels', delta: 'AA==', channels: null },
        { type: 'session.output_audio.delta', event_id: 'bad_format', delta: 'AA==', format: 'unknown' },
        { type: 'session.input_transcript.delta', event_id: 'bad_input', delta: 'one', elapsed_ms: '200' },
        { type: 'session.output_transcript.delta', event_id: 'bad_output', delta: 'un', elapsed_ms: [] },
        { type: 'session.output_audio.delta', event_id: 'bad_elapsed', delta: 'AA==', elapsed_ms: true },
        ...['code', 'event_id', 'param'].map((field) => ({
          type: 'error',
          event_id: `bad_${field}`,
          error: { type: 'invalid_request_error', message: 'synthetic', [field]: 42 },
        })),
        {
          type: 'session.output_audio.delta',
          event_id: 'pcm',
          delta: 'AA==',
          channels: 1,
          format: 'pcm16',
          sample_rate: 24_000,
          elapsed_ms: 0,
        },
        { type: 'session.output_audio.delta', event_id: 'audio_omitted', delta: 'AA==' },
        { type: 'session.input_transcript.delta', event_id: 'input_null', delta: 'one', elapsed_ms: null },
        { type: 'session.output_transcript.delta', event_id: 'output_zero', delta: 'un', elapsed_ms: 0 },
        {
          type: 'error',
          event_id: 'error_nullable',
          error: {
            type: 'invalid_request_error',
            message: 'synthetic',
            code: null,
            event_id: null,
            param: null,
          },
        },
        {
          type: 'error',
          event_id: 'error_strings',
          error: {
            type: 'invalid_request_error',
            message: 'synthetic',
            code: '',
            event_id: 'source',
            param: 'model',
          },
        },
        terminal,
      ];
      server.on('connection', (peer) =>
        peer.on('message', () => {
          for (const frame of frames) {
            peer.send(JSON.stringify(frame));
          }
        }),
      );
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const raw: unknown[] = [];
      const typed: string[] = [];
      connection.on('event', (event) => raw.push(event));
      connection.on('session.output_audio.delta', (event) => typed.push(event.event_id));
      connection.on('session.input_transcript.delta', (event) => typed.push(event.event_id));
      connection.on('session.output_transcript.delta', (event) => typed.push(event.event_id));
      connection.on('error', (event) => typed.push(event.event_id ?? 'transport'));
      connection.on('session.closed', (event) => typed.push(event.event_id));
      await connection.finish({ timeoutMs: 2000 });
      expect(raw).toEqual(frames);
      expect(typed).toEqual([
        'pcm',
        'audio_omitted',
        'input_null',
        'output_zero',
        'error_nullable',
        'error_strings',
        'terminal',
      ]);
    });
  });

  test('unhandled API errors are reported while handled API errors still allow finishing', async () => {
    await withServer(async (_server, baseURL) => {
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const errors: unknown[] = [];
      // SAFETY: As with the established Realtime error tests, capture the rejection without causing an unrelated unhandled rejection in the test runner.
      const rejected = vi.spyOn(Promise, 'reject').mockImplementation((error: unknown) => {
        errors.push(error);
        // SAFETY: Nothing consumes this resolved placeholder; it only prevents test-runner unhandled rejections.
        return Promise.resolve(undefined as never);
      });
      try {
        const frame = { type: 'error', event_id: 'api-error', error: { type: 'test', message: 'synthetic' } };
        connection.socket.platformSocket.emit('message', Buffer.from(JSON.stringify(frame)), false);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
          name: 'OpenAIRealtimeError',
          event_id: 'api-error',
          error: frame.error,
        });
        expect(String(errors[0])).toContain("on('error'");
        const handled: string[] = [];
        connection.on('error', (error) => handled.push(error.event_id ?? 'missing'));
        connection.socket.platformSocket.emit('message', Buffer.from(JSON.stringify(frame)), false);
        expect(errors).toHaveLength(1);
        expect(handled).toEqual(['api-error']);
      } finally {
        rejected.mockRestore();
        connection.close();
      }
    });
  });

  test('reports unhandled malformed frames during finish and continues delivering valid output', async () => {
    await withServer(async (server, baseURL) => {
      server.on('connection', (peer) =>
        peer.on('message', () => {
          peer.send('private malformed content');
          peer.send('{"type":42,"data":"private invalid content"}');
          peer.send(
            JSON.stringify({ type: 'session.output_transcript.delta', event_id: 'output', delta: 'bonjour' }),
          );
          peer.send(JSON.stringify(terminal));
        }),
      );
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const raw: string[] = [];
      const output: string[] = [];
      connection.on('event', (event) => raw.push(event.type));
      connection.on('session.output_transcript.delta', (event) => output.push(event.delta));
      const errors: unknown[] = [];
      // SAFETY: Capture the deliberate unhandled rejections without causing unrelated test-runner failures.
      const rejected = vi.spyOn(Promise, 'reject').mockImplementation((error: unknown) => {
        errors.push(error);
        // SAFETY: No consumer awaits this placeholder; it isolates the SDK error-reporting boundary.
        return Promise.resolve(undefined as never);
      });
      try {
        await connection.finish({ timeoutMs: 2000 });
        expect(errors).toHaveLength(2);
        for (const error of errors) {
          expect(error).toMatchObject({ name: 'OpenAIRealtimeError' });
          expect(String(error)).toContain("on('error'");
          expect(String(error)).not.toContain('private');
        }
        expect(raw).toEqual(['session.output_transcript.delta', 'session.closed']);
        expect(output).toEqual(['bonjour']);
      } finally {
        rejected.mockRestore();
        connection.close();
      }
    });
  });

  test('reports a real TLS failure before finish when there is no SDK error listener', async () => {
    await withServer(async (_server, baseURL) => {
      const failures: unknown[] = [];
      // SAFETY: Capture the deliberately unhandled rejection without producing an unrelated test-runner failure.
      const rejected = vi.spyOn(Promise, 'reject').mockImplementation((error: unknown) => {
        failures.push(error);
        // SAFETY: This placeholder is never consumed; it prevents the test runner from receiving an unrelated rejection.
        return Promise.resolve(undefined as never);
      });
      let connection: OpenAIRealtimeTranslationWS | undefined;
      try {
        // Do not trust this fixture's CA: exercise an actual TLS handshake failure before calling finish.
        const created = await OpenAIRealtimeTranslationWS.create(
          new OpenAI({ apiKey: 'synthetic-key', baseURL }),
          {
            model: 'translation-test',
          },
        );
        connection = created;
        // Unlike events.once, this does not turn an earlier socket error into another failure path.
        // oxlint-disable-next-line promise/avoid-new -- Wait for transport closure even after the expected TLS error; events.once rejects on that error instead.
        await new Promise<void>((resolve) => {
          created.socket.platformSocket.once('close', () => resolve());
        });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({
          name: 'OpenAIRealtimeError',
          error: undefined,
          cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
        });
        expect(String(failures[0])).toContain('Translation WebSocket transport failed.');
        expect(String(failures[0])).toContain("on('error'");
        expect(String(failures[0])).not.toContain('synthetic-key');
      } finally {
        rejected.mockRestore();
        connection?.close();
      }
      // The first operation still observes the original failure if called after transport closure.
      await expect(connection.finish({ timeoutMs: 1000 })).rejects.toBe(failures[0]);
    });
  });

  test.each([1000, 1001, 1005, 1008, 1011])(
    'recognizes peer close status %s after delivering the terminal',
    async (code) => {
      await withServer(async (server, baseURL) => {
        server.on('connection', (peer) =>
          peer.on('message', () => {
            peer.send(JSON.stringify(terminal));
            peer.close(code === 1005 ? undefined : code);
          }),
        );
        const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
        const delivered: string[] = [];
        connection.on('session.closed', (event) => delivered.push(event.event_id));
        const finished = connection.finish({ timeoutMs: 2000 });
        await (code === 1008 || code === 1011
          ? expect(finished).rejects.toThrow('closed abnormally')
          : expect(finished).resolves.toBeUndefined());
        expect(delivered).toEqual(['terminal']);
        expect(connection.socket.platformSocket.listenerCount('message')).toBe(0);
      });
    },
  );

  test('incomplete terminal envelopes remain raw and do not discard subsequent translation output', async () => {
    await withServer(async (server, baseURL) => {
      const malformed = [
        { type: 'session.closed' },
        { type: 'session.closed', event_id: 42 },
        { type: 'session.closed', event_id: null },
      ];
      const trailing = { type: 'session.output_transcript.delta', event_id: 'output', delta: 'bonjour' };
      server.on('connection', (peer) => {
        peer.on('message', () => {
          for (const frame of [...malformed, trailing, terminal]) {
            peer.send(JSON.stringify(frame));
          }
        });
      });
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const raw: unknown[] = [];
      const typedTerminal: string[] = [];
      const transcripts: string[] = [];
      connection.on('event', (event) => raw.push(event));
      connection.on('session.closed', (event) => typedTerminal.push(event.event_id));
      connection.on('session.output_transcript.delta', (event) => transcripts.push(event.delta));
      await connection.finish({ timeoutMs: 1000 });
      expect(raw).toEqual([...malformed, trailing, terminal]);
      expect(typedTerminal).toEqual(['terminal']);
      expect(transcripts).toEqual(['bonjour']);
    });
  });

  test('inherited wire fields never dispatch typed events or end a session early', async () => {
    await withServer(async (_server, baseURL) => {
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const raw: unknown[] = [];
      const typed: string[] = [];
      connection.on('event', (event) => raw.push(event));
      connection.on('session.closed', (event) => typed.push(event.event_id));
      connection.on('session.output_transcript.delta', (event) => typed.push(event.delta));
      connection.on('session.created', (event) => typed.push(event.session.id));
      connection.on('error', (error) => typed.push(error.error?.type ?? 'transport'));
      const session = { id: 's', audio: {}, expires_at: 1, model: 'm', type: 'translation' };
      const samples = [
        { key: 'event_id', value: 'inherited', frame: { type: 'session.closed' } },
        {
          key: 'delta',
          value: 'inherited',
          frame: { type: 'session.output_transcript.delta', event_id: 'delta' },
        },
        { key: 'session', value: session, frame: { type: 'session.created', event_id: 'session' } },
        {
          key: 'id',
          value: 'inherited',
          frame: {
            type: 'session.created',
            event_id: 'id',
            session: { audio: {}, expires_at: 1, model: 'm', type: 'translation' },
          },
        },
        {
          key: 'error',
          value: { type: 'test', message: 'inherited' },
          frame: { type: 'error', event_id: 'error' },
        },
        {
          key: 'message',
          value: 'inherited',
          frame: { type: 'error', event_id: 'message', error: { type: 'test' } },
        },
      ];
      try {
        for (const { key, value, frame } of samples) {
          // Serialize first, so the fixture represents only actual peer fields.
          const data = Buffer.from(JSON.stringify(frame));
          const original = Object.getOwnPropertyDescriptor(Object.prototype, key);
          try {
            // oxlint-disable-next-line eslint/no-extend-native -- Exercise omitted wire fields in a polluted host; restore the exact descriptor immediately below.
            Object.defineProperty(Object.prototype, key, { value, configurable: true, writable: true });
            connection.socket.platformSocket.emit('message', data, false);
          } finally {
            if (original) {
              // oxlint-disable-next-line eslint/no-extend-native -- Restore the original host descriptor after the deliberate pollution regression.
              Object.defineProperty(Object.prototype, key, original);
            } else {
              Reflect.deleteProperty(Object.prototype, key);
            }
          }
        }
        const trailing = { type: 'session.output_transcript.delta', event_id: 'output', delta: 'bonjour' };
        connection.socket.platformSocket.emit('message', Buffer.from(JSON.stringify(trailing)), false);
        connection.socket.platformSocket.emit('message', Buffer.from(JSON.stringify(terminal)), false);
        await connection.finish({ timeoutMs: 1000 });
        expect(raw).toEqual([...samples.map(({ frame }) => frame), trailing, terminal]);
        expect(typed).toEqual(['bonjour', 'terminal']);
      } finally {
        connection.close();
      }
    });
  });

  test('one terminal ends delivery even when the peer buffered duplicate or post-terminal output', async () => {
    await withServer(async (server, baseURL) => {
      server.on('connection', (peer) => {
        peer.on('message', () => {
          peer.send(JSON.stringify(terminal));
          peer.send(JSON.stringify(terminal));
          peer.send(JSON.stringify({ type: 'session.output_audio.delta', delta: 'must not leak' }));
        });
      });
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const events: string[] = [];
      const terminals: string[] = [];
      connection.on('event', (event) => events.push(event.type));
      connection.on('session.closed', (event) => terminals.push(event.event_id));
      await connection.finish({ timeoutMs: 1000 });
      expect(events).toEqual(['session.closed']);
      expect(terminals).toEqual(['terminal']);
    });
  });

  test('sends typed and raw envelopes, closes once, and delivers all trailing events before finishing', async () => {
    await withServer(async (server, baseURL) => {
      const requests: unknown[] = [];
      let connections = 0;
      const trailing = [
        { type: 'session.output_audio.delta', delta: 'AA==', event_id: 'audio' },
        { type: 'session.input_transcript.delta', delta: 'hello', event_id: 'input' },
        {
          type: 'error',
          error: { type: 'invalid_request_error', message: 'synthetic nonterminal error' },
          event_id: 'error',
        },
        { type: 'future.translation.event', new_field: { retained: true } },
        { type: 'session.output_transcript.delta', delta: 'bonjour', event_id: 'output' },
        terminal,
      ];
      server.on('connection', (peer) => {
        connections += 1;
        peer.on('message', (data) => {
          const event = JSON.parse(data.toString());
          requests.push(event);
          if (event.type === 'session.close') {
            for (const frame of trailing) {
              peer.send(JSON.stringify(frame));
            }
          }
        });
      });
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const received: unknown[] = [];
      const order: string[] = [];
      connection.on('event', (event) => {
        received.push(event);
        order.push(event.type);
      });
      connection.on('error', (error) => order.push(error.error?.message ?? 'transport'));
      connection.on('session.output_transcript.delta', (event) => order.push(event.delta));
      connection.on('session.closed', () => {
        connection.session.close();
        order.push('typed terminal');
      });
      const update: RealtimeTranslationClientEvent = {
        type: 'session.update',
        session: { audio: { output: { language: 'fr' } } },
      };
      connection.send(update);
      connection.send('{"type":"session.input_audio_buffer.append","audio":"AA=="}');
      connection.session.close();
      connection.send({ type: 'session.close' });
      const finished = connection.finish({ timeoutMs: 2000 });
      expect(connection.finish({ timeoutMs: 2000 })).toBe(finished);
      expect(() => connection.send({ type: 'session.input_audio_buffer.append', audio: 'AA==' })).toThrow(
        'input is closed',
      );
      const expiredCaller = connection.finish({ timeoutMs: 0, signal: AbortSignal.abort() });
      await Promise.all([
        expect(finished).resolves.toBeUndefined(),
        expect(expiredCaller).resolves.toBeUndefined(),
      ]);
      expect(expiredCaller).toBe(finished);
      order.push('finished');
      expect(received).toEqual(trailing);
      expect(order.slice(-3)).toEqual(['session.closed', 'typed terminal', 'finished']);
      expect(order).toContain('bonjour');
      expect(order).toContain('synthetic nonterminal error');
      expect(requests).toEqual([
        update,
        { type: 'session.input_audio_buffer.append', audio: 'AA==' },
        { type: 'session.close' },
      ]);
      expect(connections).toBe(1);
    });
  });

  test('streams Translation output before input ends and finishes immediately after the last admitted chunk', async () => {
    await withServer(async (server, baseURL) => {
      const chunks = [
        { type: 'session.input_audio_buffer.append', audio: Buffer.alloc(16 * 1024, 0).toString('base64') },
        { type: 'session.input_audio_buffer.append', audio: Buffer.alloc(16 * 1024, 1).toString('base64') },
        { type: 'session.input_audio_buffer.append', audio: Buffer.from([2, 0]).toString('base64') },
      ] as const satisfies readonly RealtimeTranslationClientEvent[];
      const first = { type: 'session.input_transcript.delta', event_id: 'input-1', delta: 'hello' };
      const trailing = [
        { type: 'session.output_transcript.delta', event_id: 'text-1', delta: 'bon' },
        { type: 'future.translation.event', items: [null, { language: 'future-locale' }] },
        { type: 'session.output_audio.delta', event_id: 'audio-1', delta: 'AQI=', sample_rate: 24_000 },
        { type: 'session.output_transcript.delta', event_id: 'text-2', delta: 'jour' },
        terminal,
      ];
      const requests: unknown[] = [];
      let connections = 0;
      server.on('connection', (peer) => {
        connections += 1;
        peer.on('message', (data) => {
          const frame: unknown = JSON.parse(data.toString());
          requests.push(frame);
          if (requests.length === 1) {
            peer.send(JSON.stringify(first));
          }
          if (requests.length === chunks.length + 1) {
            for (const event of trailing) {
              peer.send(JSON.stringify(event));
            }
          }
        });
      });
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const raw: unknown[] = [];
      const typed: string[] = [];
      connection.on('event', (event) => raw.push(event));
      connection.on('session.input_transcript.delta', (event) => typed.push(event.delta));
      connection.on('session.output_transcript.delta', (event) => typed.push(event.delta));
      connection.on('session.output_audio.delta', (event) => typed.push(event.delta));
      connection.on('session.closed', () => typed.push('closed'));

      expect(connection.send(chunks[0])).toBeUndefined();
      await vi.waitFor(() => expect(typed).toEqual(['hello']));
      // Observe output while the remaining input has not even been sent.
      expect(requests).toEqual([chunks[0]]);
      expect(raw).toEqual([first]);
      connection.send(chunks[1]);
      expect(connection.send(chunks[2])).toBeUndefined();
      // No direct session.close, awaiting send, or event-loop turn before finish.
      const finished = connection.finish({ timeoutMs: 2000 });
      expect(connection.finish({ timeoutMs: 2000 })).toBe(finished);
      await expect(finished).resolves.toBeUndefined();
      typed.push('finished');

      expect(requests).toEqual([...chunks, { type: 'session.close' }]);
      expect(raw).toEqual([first, ...trailing]);
      expect(typed).toEqual(['hello', 'bon', 'AQI=', 'jour', 'closed', 'finished']);
      expect(connections).toBe(1);
      expect(connection.socket.platformSocket.listenerCount('message')).toBe(0);
    });
  });

  test('a terminal event before finish prevents later protocol close, including reentrant and throwing listeners', async () => {
    await withServer(async (server, baseURL) => {
      const requests: unknown[] = [];
      server.on('connection', (peer) => peer.on('message', (data) => requests.push(data.toString())));
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const delivered: string[] = [];
      let finishing: Promise<void> | undefined;
      connection.on('event', (event) => {
        event.type = 'listener-mutated-type';
        connection.session.close();
        finishing = connection.finish({ timeoutMs: 2000 });
        throw new Error('synthetic listener exception');
      });
      connection.on('session.closed', () => {
        delivered.push('terminal');
        connection.close();
      });
      expect(() =>
        connection.socket.platformSocket.emit('message', Buffer.from(JSON.stringify(terminal)), false),
      ).toThrow('synthetic listener exception');
      await finishing;
      await connection.finish({ timeoutMs: 2000 });
      expect(delivered).toEqual(['terminal']);
      expect(requests).toEqual([]);
      expect(connection.socket.readyState).toBe(3);
      expect(connection.socket.platformSocket.listenerCount('message')).toBe(0);
    });
  });

  test('delivers terminal output before rejecting a subsequent transport cleanup failure', async () => {
    await withServer(async (_server, baseURL) => {
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const order: string[] = [];
      connection.on('session.closed', () => order.push('terminal'));
      const finishing = connection.finish({ timeoutMs: 1000 });
      connection.socket.platformSocket.emit('message', Buffer.from(JSON.stringify(terminal)), false);
      connection.socket.platformSocket.emit('error', new Error('synthetic cleanup error'));
      await expect(finishing).rejects.toThrow('transport failed');
      order.push('rejected');
      expect(order).toEqual(['terminal', 'rejected']);
      expect(connection.socket.readyState).toBe(3);
      expect(connection.socket.platformSocket.listenerCount('message')).toBe(0);
    });
  });

  test('rejects an abrupt peer disconnect after delivering terminal output', async () => {
    await withServer(async (server, baseURL) => {
      server.on('connection', (peer) =>
        peer.on('message', () => {
          peer.send(JSON.stringify(terminal), () => peer.terminate());
        }),
      );
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const delivered: string[] = [];
      connection.on('session.closed', () => delivered.push('terminal'));
      await expect(connection.finish({ timeoutMs: 1000 })).rejects.toThrow('closed abnormally');
      expect(delivered).toEqual(['terminal']);
      expect(connection.socket.platformSocket.listenerCount('message')).toBe(0);
    });
  });

  test.each(['disconnect', 'timeout', 'abort'] as const)(
    'rejects finish on %s and releases listeners',
    async (failure) => {
      await withServer(async (server, baseURL) => {
        let connections = 0;
        const controller = new AbortController();
        const reason = { operation: 'translation', kind: 'user-requested-cancellation' };
        server.on('connection', (peer) => {
          connections += 1;
          peer.on('message', () => {
            if (failure === 'disconnect') {
              peer.close();
            }
            if (failure === 'abort') {
              controller.abort(reason);
            }
          });
        });
        const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
        const closed = once(connection.socket.platformSocket, 'close');
        const finish = connection.finish({
          timeoutMs: failure === 'timeout' ? 25 : 2000,
          signal: controller.signal,
        });
        await expect(finish).rejects.toThrow(
          { disconnect: 'before session.closed', timeout: 'Timed out', abort: 'aborted' }[failure],
        );
        if (failure === 'abort') {
          await expect(finish).rejects.toHaveProperty('cause', reason);
        }
        await closed;
        expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
        expect(connection.socket.platformSocket.listenerCount('message')).toBe(0);
        expect(connections).toBe(1);
      });
    },
  );

  test('an already aborted finish sends no protocol frame', async () => {
    await withServer(async (server, baseURL) => {
      const requests: string[] = [];
      server.on('connection', (peer) => peer.on('message', (data) => requests.push(data.toString())));
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const controller = new AbortController();
      const reason = new Error('Caller abandoned this synthetic operation.');
      controller.abort(reason);
      const finished = connection.finish({ timeoutMs: 1000, signal: controller.signal });
      await expect(finished).rejects.toThrow('aborted');
      await expect(finished).rejects.toHaveProperty('cause', reason);
      expect(requests).toEqual([]);
    });
  });

  test('a failed close write is never retried', async () => {
    await withServer(async (_server, baseURL) => {
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const send = vi.spyOn(connection.socket, 'send').mockImplementation(() => {
        throw new Error('write failed');
      });
      await expect(connection.finish({ timeoutMs: 1000 })).rejects.toThrow('Could not send');
      connection.session.close();
      await expect(connection.finish({ timeoutMs: 1000 })).rejects.toThrow('Could not send');
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  test('terminates a peer that stalls the close handshake after terminal output', async () => {
    await withServer(async (server, baseURL) => {
      server.on('connection', (peer) =>
        peer.on('message', () => {
          peer.send(JSON.stringify(terminal));
          peer.pause();
        }),
      );
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const closed = once(connection.socket.platformSocket, 'close');
      const delivered: string[] = [];
      connection.on('session.closed', () => delivered.push('terminal'));
      await expect(connection.finish({ timeoutMs: 25 })).rejects.toThrow('Timed out');
      expect(delivered).toEqual(['terminal']);
      const [code] = await closed;
      expect(code).toBe(1006);
    });
  });

  test('reports a stalled post-terminal close without finish and retains its failure', async () => {
    await withServer(async (server, baseURL) => {
      server.on('connection', (peer) =>
        peer.on('message', () => {
          peer.send(JSON.stringify(terminal));
          peer.pause();
        }),
      );
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const failures: Error[] = [];
      const delivered: string[] = [];
      connection.on('session.closed', (event) => delivered.push(event.event_id));
      connection.on('error', (error) => failures.push(error));
      const closed = once(connection.socket.platformSocket, 'close');
      connection.send({ type: 'session.update', session: {} });
      const [code] = await closed;
      expect(delivered).toEqual(['terminal']);
      expect(code).toBe(1006);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.message).toContain('Timed out closing');
      await expect(connection.finish({ timeoutMs: 1000 })).rejects.toBe(failures[0]);
      expect(failures).toHaveLength(1);
      expect(connection.socket.platformSocket.listenerCount('message')).toBe(0);
    });
  });

  test('validates serialized envelopes and sanitizes malformed server JSON', async () => {
    await withServer(async (server, baseURL) => {
      const requests: string[] = [];
      server.on('connection', (peer) => peer.on('message', (data) => requests.push(data.toString())));
      const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
      const messages: string[] = [];
      connection.on('error', (error) => messages.push(error.message));
      for (const invalid of ['[]', 'null', '{"type":1}', 'private malformed content']) {
        expect(() => connection.send(invalid)).toThrow();
        connection.socket.platformSocket.emit('message', Buffer.from(invalid), false);
      }
      expect(() => connection.send({ type: 'session.update', toJSON: () => ({ wrong: true }) })).toThrow(
        'string type',
      );
      expect(requests).toEqual([]);
      expect(messages).toHaveLength(4);
      expect(messages.join(' ')).not.toContain('private malformed content');
      connection.close();
    });
  });

  test.each([0, -1, Infinity, Number.NaN, 2_147_483_648])(
    'requires a usable finite deadline: %s',
    async (timeoutMs) => {
      await withServer(async (_server, baseURL) => {
        const connection = await open(new OpenAI({ apiKey: 'synthetic-key', baseURL }));
        await expect(connection.finish({ timeoutMs })).rejects.toThrow('positive finite');
        connection.close();
      });
    },
  );
});

async function inspectHandshake(
  makeClient: (baseURL: string) => OpenAI,
  options?: Parameters<typeof OpenAIRealtimeTranslationWS.create>[1]['options'],
): Promise<{ headers: IncomingHttpHeaders; path: string | undefined }> {
  let observed: { headers: IncomingHttpHeaders; path: string | undefined } | undefined;
  await withServer(async (server, baseURL) => {
    server.on('connection', (_peer, request) => {
      observed = { headers: request.headers, path: request.url };
    });
    const connection = await OpenAIRealtimeTranslationWS.create(makeClient(baseURL), {
      model: 'model with space',
      options: { ca: lab.certificateAuthority, ...options },
    });
    await once(connection.socket.platformSocket, 'open');
    connection.close();
  });
  if (!observed) {
    throw new Error('Expected handshake');
  }
  return observed;
}

describe('translation connection authentication', () => {
  test('rejects plaintext translation endpoints before resolving credentials or opening a socket', async () => {
    await withServer(async (server, baseURL) => {
      const credential = vi.fn(async () => 'synthetic-key');
      const connected = vi.fn();
      server.on('connection', connected);
      const creating = OpenAIRealtimeTranslationWS.create(
        new OpenAI({ apiKey: credential, baseURL: baseURL.replace('https:', 'http:') }),
        { model: 'translation-test' },
      );
      try {
        await expect(creating).rejects.toThrow('HTTPS');
        expect(credential).not.toHaveBeenCalled();
        expect(connected).not.toHaveBeenCalled();
      } finally {
        // Clean up even when regressing to a version that opens the unwanted socket.
        await creating.then(
          (connection) => connection.close(),
          () => {},
        );
      }
    });
  });

  test.each(['defaultQuery', 'baseURL'] as const)(
    'rejects forbidden translation intent from %s before credentials or a connection',
    async (source) => {
      await withServer(async (server, baseURL) => {
        const credential = vi.fn(async () => 'synthetic-key');
        let connections = 0;
        server.on('connection', () => {
          connections += 1;
        });
        const client = new OpenAI({
          apiKey: credential,
          baseURL: source === 'baseURL' ? `${baseURL}?intent=transcription` : baseURL,
          defaultQuery: source === 'defaultQuery' ? { intent: '' } : undefined,
        });
        await expect(
          OpenAIRealtimeTranslationWS.create(client, { model: 'gpt-realtime-translate' }),
        ).rejects.toThrow('intent');
        expect(credential).not.toHaveBeenCalled();
        expect(connections).toBe(0);
      });
    },
  );

  test('preserves the base path, query, organization/project, and case-insensitive header precedence', async () => {
    const observed = await inspectHandshake(
      (baseURL) =>
        new OpenAI({
          apiKey: 'synthetic-key',
          baseURL: `${baseURL}/custom?base=kept&model=base#configuration`,
          defaultQuery: { routing: 'value', model: 'default' },
          organization: 'synthetic-org',
          project: 'synthetic-project',
          defaultHeaders: { Authorization: 'Bearer default-key', 'X-Keep': 'default', 'X-Remove': 'remove' },
        }),
      {
        headers: {
          aUtHoRiZaTiOn: 'Bearer override',
          'x-keep': undefined,
          'x-remove': null,
        },
      },
    );
    expect(observed.path).toBe(
      '/v1/custom/realtime/translations?base=kept&model=model%20with%20space&routing=value',
    );
    expect(observed.headers.authorization).toBe('Bearer override');
    expect(observed.headers['x-keep']).toBe('default');
    expect(observed.headers['x-remove']).toBeUndefined();
    expect(observed.headers['openai-organization']).toBe('synthetic-org');
    expect(observed.headers['openai-project']).toBe('synthetic-project');
    expect(observed.headers['user-agent']).toContain('OpenAI/JS');
  });

  test('captures concurrent function credentials per connection', async () => {
    await withServer(async (server, baseURL) => {
      const headers: IncomingHttpHeaders[] = [];
      server.on('connection', (_peer, request) => headers.push(request.headers));
      let calls = 0;
      const client = new OpenAI({
        apiKey: async () => {
          calls += 1;
          return `synthetic-${calls}`;
        },
        baseURL,
      });
      const connections = await Promise.all([open(client), open(client)]);
      expect(headers.map((header) => header.authorization)).toEqual(
        expect.arrayContaining(['Bearer synthetic-1', 'Bearer synthetic-2']),
      );
      for (const connection of connections) {
        connection.close();
      }
    });
  });

  test('snapshots custom credential header values once', async () => {
    let reads = 0;
    const token = {
      toString: () => {
        reads += 1;
        return `synthetic-${reads}`;
      },
    };
    const observed = await inspectHandshake((baseURL) => new OpenAI({ apiKey: 'synthetic-key', baseURL }), {
      // SAFETY: Exercise Node's runtime string-coercion boundary with a deliberately mutable header value.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Deliberately supply a JavaScript header object to verify one-time coercion at the transport boundary.
      headers: { 'X-Auth-Token': token as unknown as string },
    });
    expect(observed.headers['x-auth-token']).toBe('synthetic-1');
    expect(reads).toBe(1);
  });

  test('rejects redirects even when the caller requests them', async () => {
    let redirected = false;
    const server = createServer(
      { cert: lab.server.certificate, key: lab.server.privateKey },
      (request, response) => {
        if (request.url === '/redirected') {
          redirected = true;
        }
        response.writeHead(302, { Location: '/redirected' });
        response.end();
      },
    );
    await once(server.listen(0, '127.0.0.1'), 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected local server');
      }
      const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: `https://127.0.0.1:${address.port}/v1` });
      const connection = await OpenAIRealtimeTranslationWS.create(client, {
        model: 'translation-test',
        options: { ca: lab.certificateAuthority, followRedirects: true },
      });
      const error = await connection.emitted('error');
      expect(error.message).toContain('transport failed');
      expect(redirected).toBe(false);
      await expect(connection.finish({ timeoutMs: 1000 })).rejects.toThrow('transport failed');
    } finally {
      server.closeAllConnections();
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  });

  test('rejects Azure and provider clients before credential resolution', async () => {
    const credential = vi.fn(async () => 'synthetic-key');
    const azure = new AzureOpenAI({
      azureADTokenProvider: credential,
      apiVersion: 'test',
      baseURL: 'https://example.invalid',
    });
    await expect(OpenAIRealtimeTranslationWS.create(azure, { model: 'test' })).rejects.toThrow(
      'ordinary OpenAI API-key',
    );
    const prepareRequest = vi.fn();
    const provider = new OpenAI({
      provider: createProvider({
        configure: () => ({ name: 'test', baseURL: 'https://example.invalid', prepareRequest }),
      }),
    });
    await expect(OpenAIRealtimeTranslationWS.create(provider, { model: 'test' })).rejects.toThrow(
      'ordinary OpenAI API-key',
    );
    const bedrock = new BedrockOpenAI({ bedrockTokenProvider: credential, awsRegion: 'us-east-1' });
    await expect(OpenAIRealtimeTranslationWS.create(bedrock, { model: 'test' })).rejects.toThrow(
      'ordinary OpenAI API-key',
    );
    const workload = new OpenAI({
      apiKey: null,
      workloadIdentity: {
        identityProviderId: 'synthetic-provider',
        serviceAccountId: 'synthetic-account',
        provider: { tokenType: 'jwt', getToken: credential },
      },
    });
    await expect(OpenAIRealtimeTranslationWS.create(workload, { model: 'test' })).rejects.toThrow(
      'ordinary OpenAI API-key',
    );
    expect(credential).not.toHaveBeenCalled();
    expect(prepareRequest).not.toHaveBeenCalled();
  });

  test('rejects browser use before resolving credentials even with browser consent', async () => {
    const credential = vi.fn(async () => 'synthetic-key');
    const client = new OpenAI({ apiKey: credential });
    vi.stubGlobal('window', { document: {} });
    vi.stubGlobal('navigator', {});
    try {
      await expect(OpenAIRealtimeTranslationWS.create(client, { model: 'test' })).rejects.toThrow(
        'require Node.js',
      );
      expect(credential).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

test('the root imports without optional ws and the explicit Node adapter requires it', () => {
  execFileSync(process.execPath, [
    '-e',
    `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function(name, ...args) {
      if (name === 'ws') throw new Error('optional ws unavailable');
      return Reflect.apply(load, this, [name, ...args]);
    };
    const OpenAI = require(process.argv[1]).default;
    const client = new OpenAI({ apiKey: 'synthetic-key' });
    assert.equal(client.apiKey, 'synthetic-key');
    assert.throws(() => require(process.argv[2]), /optional ws unavailable/);
  `,
    compiledFixture('src', 'index.ts'),
    compiledFixture('src', 'realtime', 'translations', 'ws.ts'),
  ]);
});
