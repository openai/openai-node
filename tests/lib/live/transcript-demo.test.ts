import { once } from 'node:events';
import { expect, it } from 'vitest';
import { WebSocketServer } from 'ws';

import OpenAI from 'openai';
import { runTranscriptDemo } from '../../../examples/live/transcript-demo';

const firstUser = 'Plan our picnic.';
const secondUser = 'Make it breakfast.';
const firstAnswer = 'There are sandwiches, fruit and a vegetarian salad.';
const finalAnswer = 'Bring breakfast rolls and coffee.';

it.concurrent.each([
  { timing: 'early', interrupt: false },
  { timing: 'early', interrupt: true },
  { timing: 'delayed', interrupt: false },
  { timing: 'delayed', interrupt: true },
  { timing: 'overlap', interrupt: false },
  { timing: 'overlap', interrupt: true },
  { timing: 'stale', interrupt: true },
  { timing: 'no-answer', interrupt: true },
  { timing: 'straddling-stale-only', interrupt: true },
  { timing: 'reused-user', interrupt: true },
  { timing: 'audio-tail', interrupt: false },
  { timing: 'error', interrupt: false },
  { timing: 'eof', interrupt: true },
])('handles a $timing answer (interrupt=$interrupt)', async ({ timing, interrupt }) => {
  const expectsAnswer = !['no-answer', 'straddling-stale-only', 'error', 'eof'].includes(timing);
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected an ephemeral TCP address');
  }
  const baseURL = `http://127.0.0.1:${address.port}/v1`;
  const client = new OpenAI({ apiKey: 'local-test-key', baseURL });
  const timers: ReturnType<typeof setTimeout>[] = [];
  let secondChunks = 0;
  let answerAtChunk = 0;
  let sentSessionClose = false;
  let audioFrames = 0;

  server.on('connection', (socket) => {
    const startedAt = performance.now();
    const now = () => Math.round(performance.now() - startedAt);
    const sendText = (speaker: 'input' | 'output', text: string, start: number, end: number) =>
      socket.send(
        JSON.stringify({
          type: `session.${speaker}_transcript.delta`,
          event_id: `${speaker}-${now()}`,
          delta: text,
          start_ms: start,
          end_ms: end,
        }),
      );
    const sendAudio = () => {
      audioFrames += 1;
      socket.send(
        JSON.stringify({
          type: 'session.output_audio.delta',
          event_id: `audio-${now()}`,
          delta: Buffer.alloc(1920).toString('base64'),
        }),
      );
    };
    let heardFirst = false;
    let firstEnd = 0;
    socket.on('message', (raw) => {
      const event: { type: string; audio: string } = JSON.parse(raw.toString());
      if (event.type === 'session.start') {
        socket.send(
          JSON.stringify({ type: 'session.started', session: { id: 'fixture', status: 'active' } }),
        );
      }
      if (event.type === 'session.input_audio.append') {
        const [marker] = Buffer.from(event.audio, 'base64');
        if (marker === 1 && !heardFirst) {
          heardFirst = true;
          const mark = now();
          sendText('input', timing === 'reused-user' ? 'Plan our ' : firstUser, Math.max(0, mark - 20), mark);
          timers.push(
            setTimeout(() => {
              firstEnd = now();
              sendText('output', firstAnswer, firstEnd - 50, firstEnd);
              sendAudio();
              if (timing === 'reused-user') {
                // A delayed user fragment leaves the same user bubble active
                // across the start of the second clip.
                sendText('input', 'picnic.', firstEnd + 1, firstEnd + 2);
              }
            }, 720),
          );
        }
        if (marker === 2) {
          secondChunks += 1;
          if (secondChunks === 1) {
            const mark = now();
            if (timing !== 'overlap') {
              sendText('input', secondUser, Math.max(0, mark - 20), mark);
            }
            if (timing === 'stale' || timing === 'no-answer' || timing === 'straddling-stale-only') {
              timers.push(
                setTimeout(() => {
                  // This older fragment is delivered after the new user input.
                  sendText(
                    'output',
                    ' Plus lemonade.',
                    firstEnd - 50,
                    timing === 'straddling-stale-only' ? mark + 500 : firstEnd,
                  );
                  sendAudio();
                }, 140),
              );
            }
            const answerDelay = timing === 'delayed' || timing === 'overlap' ? 2050 : 720;
            if (expectsAnswer) {
              timers.push(
                setTimeout(() => {
                  answerAtChunk = secondChunks;
                  const answerEnd = now();
                  if (timing === 'overlap') {
                    // The answer occurred during the user's long second interval,
                    // even though the peer delivers both transcripts afterwards.
                    sendText('input', secondUser, Math.max(0, mark - 20), answerEnd);
                    sendText('output', finalAnswer, mark + 650, mark + 1000);
                  } else {
                    sendText('output', finalAnswer, answerEnd - 50, answerEnd);
                  }
                  sendAudio();
                }, answerDelay),
              );
            }
            if (timing === 'audio-tail') {
              for (const delay of [1800, 2400, 3200, 4000, 4800]) {
                timers.push(setTimeout(sendAudio, delay));
              }
            }
            // Allow a real settled answer, then close the peer to bound a failed
            // demo without waiting for its 45-second production timeout.
            timers.push(
              setTimeout(
                () => {
                  if (timing === 'error') {
                    socket.send(
                      JSON.stringify({
                        type: 'error',
                        error: { type: 'invalid_request_error', code: 'fixture', message: 'Synthetic error' },
                      }),
                    );
                  } else {
                    socket.close();
                  }
                },
                timing === 'audio-tail' ? 9000 : answerDelay + 3700,
              ),
            );
          }
        }
      }
      if (event.type === 'session.close') {
        sentSessionClose = true;
        socket.send(
          JSON.stringify({ type: 'session.closed', reason: 'close_requested', session: { id: 'fixture' } }),
        );
        socket.close();
      }
    });
  });

  try {
    const result = runTranscriptDemo(client, [Buffer.alloc(1920, 1), Buffer.alloc(1920 * 40, 2)], {
      interrupt,
    });
    if (expectsAnswer) {
      const demo = await result;
      expect(sentSessionClose).toBe(true);
      expect(secondChunks).toBe(40);
      if (timing === 'delayed' || timing === 'overlap') {
        expect(answerAtChunk).toBe(secondChunks);
      } else {
        expect(answerAtChunk).toBeLessThan(secondChunks);
      }
      expect(demo.rawUserText).toBe(firstUser + secondUser);
      expect(demo.interruptionSentDuringOutput).toBe(interrupt);
      if (timing === 'audio-tail') {
        expect(audioFrames).toBe(7);
      }
      expect(demo.segments.map(({ segment }) => [segment.speaker, segment.text])).toEqual([
        ['user', timing === 'reused-user' ? 'Plan our ' : firstUser],
        ['assistant', firstAnswer],
        ['user', (timing === 'reused-user' ? 'picnic.' : '') + secondUser],
        ['assistant', (timing === 'stale' ? ' Plus lemonade.' : '') + finalAnswer],
      ]);
      for (const [index, { segment }] of demo.segments.entries()) {
        expect(segment.previousId).toBe(demo.segments[index - 1]?.segment.id ?? null);
      }
    } else {
      await expect(result).rejects.toBeInstanceOf(Error);
      expect(sentSessionClose).toBe(false);
    }
  } finally {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    const closed = once(server, 'close');
    for (const peer of server.clients) {
      peer.terminate();
    }
    server.close();
    await closed;
  }
});
