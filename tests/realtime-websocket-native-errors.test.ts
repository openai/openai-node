import { once } from 'node:events';
import { createServer } from 'node:net';

import OpenAI from 'openai';
import { OpenAIRealtimeWebSocket as StableRealtime } from 'openai/realtime/websocket';
import { OpenAIRealtimeWebSocket as BetaRealtime } from 'openai/beta/realtime/websocket';

describe.each([
  { name: 'stable', Realtime: StableRealtime },
  { name: 'beta', Realtime: BetaRealtime },
])('$name native realtime WebSocket errors', ({ Realtime }) => {
  test('preserves the message and original cause when the local peer closes the connection', async () => {
    let connections = 0;
    const server = createServer((connection) => {
      // Fail the native WebSocket's TLS handshake without an external endpoint or port-allocation race.
      connections += 1;
      connection.destroy();
    });
    await once(server.listen(0, '127.0.0.1'), 'listening');
    let socket: WebSocket | undefined;

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected a local TCP server');
      }

      const realtime = new Realtime(
        { model: 'gpt-realtime' },
        new OpenAI({ apiKey: 'test-key', baseURL: `https://127.0.0.1:${address.port}/v1` }),
      );
      ({ socket } = realtime);
      expect(socket).toBeInstanceOf(globalThis.WebSocket);

      const errors: (Error & { cause?: unknown })[] = [];
      // oxlint-disable-next-line anti-slop/no-known-value-widening -- The common error-event view permits the same native-error test across stable and beta transports.
      const errorEmitter: { on: (event: 'error', listener: (error: Error) => void) => void } = realtime;
      errorEmitter.on('error', (error) => errors.push(error));

      const [nativeEvent] = await once(socket, 'error', { signal: AbortSignal.timeout(5000) });

      expect(connections).toBe(1);
      expect(nativeEvent.error).toBeInstanceOf(Error);
      expect(errors).toHaveLength(1);
      // Node 22 provides a description; newer native implementations may emit an empty TypeError.
      expect(errors[0]?.message).toBe(nativeEvent.message || nativeEvent.error.message || 'unknown error');
      expect(errors[0]?.cause).toBe(nativeEvent.error);
    } finally {
      socket?.close();
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  });
});
