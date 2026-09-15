import { vi } from 'vitest';
import type OpenAI from 'openai';
import type { ResponseTextDeltaEvent } from 'openai/resources/responses/responses';
import type { OutputTranscriptDeltaEvent } from 'openai/resources/live/live';
import { ResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import { LiveWS } from 'openai/resources/live/ws';
import { ForksWS } from 'openai/resources/live/forks/ws';
import { SidebandWS } from 'openai/resources/live/sideband/ws';

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    // oxlint-disable-next-line unicorn/prefer-event-target -- The public ws adapter requires Node EventEmitter semantics.
    WebSocket: class extends EventEmitter {
      readyState = 1;
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

export const websocketVariants = [
  {
    name: 'stable Responses',
    create: (client: OpenAI) => new ResponsesWS(client),
    event: responseEvent,
  },
  {
    name: 'beta Responses',
    create: (client: OpenAI) => new BetaResponsesWS(client),
    event: responseEvent,
  },
  {
    name: 'Live',
    create: (client: OpenAI) => new LiveWS(client),
    event: liveEvent,
  },
  {
    name: 'Live forks',
    create: (client: OpenAI) => new ForksWS(client, { session_id: 'synthetic-session' }),
    event: liveEvent,
  },
  {
    name: 'Live sideband',
    create: (client: OpenAI) => new SidebandWS(client, { session_id: 'synthetic-session' }),
    event: liveEvent,
  },
] as const;

export type PublicWebSocket = ReturnType<(typeof websocketVariants)[number]['create']>;

type CommonWebSocketEvent = 'event' | 'raw' | 'error' | 'close' | 'reconnecting' | 'reconnected';

export function onWebSocketEvent(
  connection: {
    on: (event: CommonWebSocketEvent, listener: (...args: unknown[]) => void) => unknown;
  },
  event: CommonWebSocketEvent,
  listener: (...args: unknown[]) => void,
): void {
  connection.on(event, listener);
}

export function dispatchFrame(connection: PublicWebSocket, data: string | Buffer, isBinary = false): void {
  connection.socket.platformSocket.emit('message', Buffer.from(data), isBinary);
}
