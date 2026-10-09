import { vi } from 'vitest';
import type OpenAI from 'openai';
import type { ResponseTextDeltaEvent } from 'openai/resources/responses/responses';
import type { OutputTranscriptDeltaEvent } from 'openai/resources/live/live';
import { ResponsesWS } from 'openai/resources/responses/ws';
import type { ResponsesWSClientOptions } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import { LiveWS } from 'openai/resources/live/ws';
import type { ForksWSClientOptions } from 'openai/resources/live/forks/ws';
import type { SidebandWSClientOptions } from 'openai/resources/live/sideband/ws';
import { ForksWS } from 'openai/resources/live/forks/ws';
import { SidebandWS } from 'openai/resources/live/sideband/ws';

const mockSocketState = vi.hoisted(() => ({ readyState: 1 }));

export function setMockSocketReadyState(readyState: number): void {
  mockSocketState.readyState = readyState;
}

// oxlint-disable-next-line anti-slop/no-module-mocking -- The public adapters do not inject socket constructors; this event-emitting transport controls close, reconnect, and frame ordering.
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    // oxlint-disable-next-line unicorn/prefer-event-target -- The public ws adapter requires Node EventEmitter semantics.
    WebSocket: class extends EventEmitter {
      readyState = mockSocketState.readyState;
      send = vi.fn();
      close(code = 1000, reason = 'OK') {
        this.readyState = 3;
        this.emit('close', code, Buffer.from(reason));
      }
    },
  };
});

const responseEvent = (index: number): ResponseTextDeltaEvent => ({
  type: 'response.output_text.delta',
  delta: `synthetic delta ${index}`,
  content_index: 0,
  item_id: 'synthetic-item',
  logprobs: [],
  output_index: 0,
  sequence_number: index,
});

const liveEvent = (index: number): OutputTranscriptDeltaEvent => ({
  type: 'session.output_transcript.delta',
  delta: `synthetic delta ${index}`,
  event_id: `synthetic-event-${index}`,
  start_ms: index,
  end_ms: index + 1,
});

type TestWebSocketOptions = ResponsesWSClientOptions & ForksWSClientOptions & SidebandWSClientOptions;

export const websocketVariants = [
  {
    name: 'stable Responses',
    create: (client: OpenAI, options?: TestWebSocketOptions) => new ResponsesWS(client, options),
    event: responseEvent,
  },
  {
    name: 'beta Responses',
    create: (client: OpenAI, options?: TestWebSocketOptions) => new BetaResponsesWS(client, options),
    event: responseEvent,
  },
  {
    name: 'Live',
    create: (client: OpenAI, options?: TestWebSocketOptions) => new LiveWS(client, options),
    event: liveEvent,
  },
  {
    name: 'Live forks',
    create: (client: OpenAI, options?: TestWebSocketOptions) =>
      new ForksWS(client, { session_id: 'synthetic-session' }, options),
    event: liveEvent,
  },
  {
    name: 'Live sideband',
    create: (client: OpenAI, options?: TestWebSocketOptions) =>
      new SidebandWS(client, { session_id: 'synthetic-session' }, options),
    event: liveEvent,
  },
] as const;

export type PublicWebSocket = ReturnType<(typeof websocketVariants)[number]['create']>;

type CommonWebSocketEvent = 'event' | 'raw' | 'error' | 'close' | 'reconnecting' | 'reconnected';

export function onWebSocketEvent(
  connection: {
    on: (event: CommonWebSocketEvent, listener: (...args: unknown[]) => void) => void;
  },
  event: CommonWebSocketEvent,
  listener: (...args: unknown[]) => void,
): void {
  connection.on(event, listener);
}

export function dispatchFrame(connection: PublicWebSocket, data: string | Buffer, isBinary = false): void {
  connection.socket.platformSocket.emit('message', Buffer.from(data), isBinary);
}
