#!/usr/bin/env -S npm run tsn -- -T

import { once } from 'node:events';
import OpenAI from 'openai';
import { ResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWebSocketSession } from 'openai/lib/responses/responses-websocket-session';

async function run() {
  const connection = new ResponsesWS(new OpenAI(), {
    headers: { 'X-Application-Name': 'responses-example' },
  });
  const session = new ResponsesWebSocketSession(connection, {
    maxLanes: 4,
    maxBufferedEvents: 256,
    maxBufferedBytes: 32 * 1024 * 1024,
  });
  const signal = AbortSignal.timeout(60_000);
  try {
    await once(connection.socket.platformSocket, 'open', { signal });
    const lane = session.lane('conversation');
    const model = process.env['OPENAI_WEBSOCKET_TEST_MODEL'] ?? 'gpt-4o-mini';
    lane.create({ model, input: 'Remember the example delivery day: Tuesday.', store: false });
    const first = await lane.finalResponse({ signal });
    if (first.status !== 'completed') {
      throw new Error('First response did not complete');
    }
    lane.create({ model, input: 'What is the delivery day?', previous_response_id: first.id, store: false });
    const second = await lane.finalResponse({ signal });
    if (second.status !== 'completed') {
      throw new Error('Second response did not complete');
    }
    console.log('Completed two Responses turns over the same WebSocket.');
  } finally {
    session.close();
    connection.close();
  }
}

async function main() {
  try {
    await run();
  } catch {
    console.error('Responses WebSocket example failed.');
    process.exitCode = 1;
  }
}

main();
