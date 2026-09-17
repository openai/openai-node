import { once } from 'node:events';
import { Agent } from 'node:https';
import { test } from 'vitest';
import OpenAI from 'openai';
import { ResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWebSocketSession } from 'openai/lib/responses/responses-websocket-session';

const enabled = process.env['OPENAI_WEBSOCKET_LIVE_TEST'] === '1' && Boolean(process.env['OPENAI_API_KEY']);

test.skipIf(!enabled)(
  'live Responses continuation with custom headers',
  async () => {
    const agent = new Agent({ proxyEnv: process.env });
    const connection = new ResponsesWS(new OpenAI(), {
      agent,
      headers: { 'X-SDK-WebSocket-Test': 'synthetic' },
    });
    const session = new ResponsesWebSocketSession(connection, {
      maxLanes: 4,
      maxBufferedEvents: 256,
      maxBufferedBytes: 32 * 1024 * 1024,
    });
    const signal = AbortSignal.timeout(60_000);
    try {
      await once(connection.socket.platformSocket, 'open', { signal });
      const lane = session.lane('sdk-live');
      const model = process.env['OPENAI_WEBSOCKET_TEST_MODEL'] ?? 'gpt-4o-mini';
      lane.create({ model, input: 'Reply with exactly OK.', store: false });
      const first = await lane.finalResponse({ signal });
      expect(first.status).toBe('completed');
      expect(first.output.length).toBeGreaterThan(0);
      lane.create({
        model,
        input: 'Reply with exactly OK again.',
        previous_response_id: first.id,
        store: false,
      });
      const second = await lane.finalResponse({ signal });
      expect(second.status).toBe('completed');
      expect(second.id).not.toBe(first.id);
      expect(second.output.length).toBeGreaterThan(0);
    } finally {
      session.close();
      connection.close();
      agent.destroy();
    }
  },
  65_000,
);
