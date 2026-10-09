import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import OpenAI from 'openai';
import { TranscriptGrouper } from 'openai/helpers/live';
import type { TranscriptSegmentClosedEvent } from 'openai/helpers/live';
import type { ServerEvent } from 'openai/resources/live/live';
import { LiveWS } from 'openai/resources/live/ws';

test('disposing a Live grouper preserves typed and raw observers and leaves the socket usable', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing local server address');
  }
  const incoming = once(server, 'connection');
  const client = new OpenAI({ apiKey: 'ek_fake_live', baseURL: `http://127.0.0.1:${address.port}/v1` });
  const live = new LiveWS(client);
  const { socket } = live;
  const opened = once(socket.platformSocket, 'open');
  const first = new TranscriptGrouper();
  const second = new TranscriptGrouper();
  const firstFinals: TranscriptSegmentClosedEvent[] = [];
  const secondFinals: TranscriptSegmentClosedEvent[] = [];
  const observed: ServerEvent[] = [];
  const typed: ServerEvent[] = [];
  const raw: unknown[] = [];
  const frames: { data: string | RawData; binary: boolean }[] = [];
  const commands: string[] = [];
  const feedFirst = (event: ServerEvent) => first.push(event);
  const feedSecond = (event: ServerEvent) => second.push(event);
  first.on('segment.closed', (event) => firstFinals.push(event));
  second.on('segment.closed', (event) => secondFinals.push(event));
  live.on('event', feedFirst);
  live.on('event', feedSecond);
  live.on('event', (event) => observed.push(event));
  live.on('session.input_transcript.delta', (event) => typed.push(event));
  live.on('raw', (data) => raw.push(data));
  socket.platformSocket.on('message', (data, binary) => {
    frames.push({ data: binary ? data : data.toString(), binary });
  });
  const transcripts = ['One', ' two', ' three', ' four'].map((delta, index) => ({
    type: 'session.input_transcript.delta',
    event_id: `part-${index}`,
    delta,
    start_ms: index * 200,
    end_ms: (index + 1) * 200,
  }));
  try {
    const [peer] = await incoming;
    peer.on('message', (data: Buffer) => commands.push(data.toString()));
    await opened;
    for (const transcript of transcripts.slice(0, 2)) {
      const next = live.emitted('event');
      peer.send(JSON.stringify(transcript));
      // oxlint-disable-next-line eslint/no-await-in-loop -- Register each once-only observer after the preceding event has been delivered.
      await next;
    }
    live.off('event', feedFirst);
    first.close();
    first.close();
    expect(firstFinals.map(({ segment, reason }) => [segment.text, reason])).toEqual([['One two', 'manual']]);

    const sentinel = Buffer.from([0, 255, 128, 2]);
    const nextRaw = live.emitted('raw');
    peer.send(sentinel, { binary: true });
    await nextRaw;
    for (const transcript of transcripts.slice(2)) {
      const next = live.emitted('event');
      peer.send(JSON.stringify(transcript));
      // oxlint-disable-next-line eslint/no-await-in-loop -- Register each once-only observer after the preceding event has been delivered.
      await next;
    }
    const update = { type: 'session.update' as const, event_id: 'after-dispose', session: {} };
    const received = once(peer, 'message');
    expect(live.send(update)).toBeUndefined();
    await received;
    const acknowledgment = {
      type: 'session.updated',
      event_id: 'updated',
      client_event_id: 'after-dispose',
      session: { id: 'live_fixture', model: 'gpt-live-1', status: 'active', expires_at: 123 },
      future_metadata: { explicit_null: null, nested: [1, 'retained'] },
    };
    const next = live.emitted('event');
    peer.send(JSON.stringify(acknowledgment));
    await next;
    second.close();

    expect(observed).toEqual([...transcripts, acknowledgment]);
    expect(typed).toEqual(transcripts);
    expect(raw).toEqual([sentinel]);
    expect(frames).toEqual([
      ...transcripts.slice(0, 2).map((data) => ({ data: JSON.stringify(data), binary: false })),
      { data: sentinel, binary: true },
      ...transcripts.slice(2).map((data) => ({ data: JSON.stringify(data), binary: false })),
      { data: JSON.stringify(acknowledgment), binary: false },
    ]);
    expect(firstFinals.map(({ segment, reason }) => [segment.text, reason])).toEqual([['One two', 'manual']]);
    expect(secondFinals.map(({ segment, reason }) => [segment.text, reason])).toEqual([
      ['One two three four', 'manual'],
    ]);
    expect(commands).toEqual([JSON.stringify(update)]);
    expect(live.socket).toBe(socket);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    const peerClosed = once(peer, 'close');
    live.close();
    await peerClosed;
    expect(commands).toEqual([JSON.stringify(update)]);
  } finally {
    first.close();
    second.close();
    live.close();
    for (const peer of server.clients) {
      peer.terminate();
    }
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});
