/* oxlint-disable no-await-in-loop -- PCM and silence must be sent sequentially at real-time cadence, not in parallel. */
import { setTimeout as sleep } from 'node:timers/promises';
import type OpenAI from 'openai';
import { TranscriptGrouper } from 'openai/helpers/live';
import type { TranscriptSegment, TranscriptSegmentClosedEvent } from 'openai/helpers/live';
import { LiveWS } from 'openai/resources/live/ws';
import type { LiveWSClientOptions } from 'openai/resources/live/ws';
import type { ServerEvent } from 'openai/resources/live/live';

const SAMPLE_RATE = 24_000;
const CHUNK_MS = 40;
const CHUNK_BYTES = (SAMPLE_RATE * 2 * CHUNK_MS) / 1000;
const PROMPTS = [
  "I'd like help planning a picnic. Let me think for a moment. There will be four people, and one person is vegetarian. Please suggest a detailed menu.",
  'Actually, make it a breakfast picnic instead. Please give me just one short sentence.',
];

/** Public-event observations from one synthetic conversation; contains its transcript text. */
export interface TranscriptDemoResult {
  /** Number of raw public text fragments received. */
  rawTranscriptEvents: number;
  /** Number of immutable segment updates supplied to a UI. */
  updateCount: number;
  /** Final grouped bubbles, in their emitted order. */
  segments: TranscriptSegmentClosedEvent[];
  /** Exact user transcript from public events, used to verify that no user text was lost. */
  rawUserText: string;
  /** Whether the second utterance was sent while output audio was arriving. */
  interruptionSentDuringOutput: boolean;
}

/** Prepare every AI-generated input clip before creating any Live connection. */
export async function prepareTranscriptDemo(client: OpenAI): Promise<Buffer[]> {
  return Promise.all(
    PROMPTS.map(async (input) => {
      const response = await client.audio.speech.create({
        model: 'gpt-4o-mini-tts',
        voice: 'coral',
        input,
        instructions: 'Speak naturally and clearly. Pause briefly between sentences.',
        response_format: 'pcm',
      });
      return Buffer.from(await response.arrayBuffer());
    }),
  );
}

/**
 * Send pre-generated PCM through the public Live WebSocket and group only its
 * public transcript events. This makes paid API requests; requires Live access.
 * No microphone, local TTS latency, internal API, or server turn events are used.
 */
export async function runTranscriptDemo(
  client: OpenAI,
  audio: readonly Buffer[],
  options: {
    /** Optional transport options, for example a local opt-in compatibility header. */
    websocketOptions?: LiveWSClientOptions | undefined;
    /** Interrupt the first answer instead of waiting for its projected completion. */
    interrupt?: boolean;
    /** Optional render callback; replace the bubble identified by segment.id. */
    onUpdate?: (segment: TranscriptSegment) => void;
    /** Optional final-bubble callback. */
    onClosed?: (event: TranscriptSegmentClosedEvent) => void;
    /** Observe outgoing mono 24 kHz PCM, including silence, for local playback. */
    onInputAudio?: (pcm: Buffer) => void;
    /** Observe incoming mono 24 kHz PCM independently of transcript grouping. */
    onOutputAudio?: (pcm: Buffer) => void;
  } = {},
): Promise<TranscriptDemoResult> {
  const [firstAudio, secondAudio] = audio;
  if (!firstAudio?.length || !secondAudio?.length) {
    throw new Error('Generate both TTS clips before opening Live.');
  }
  const live = new LiveWS(client, options.websocketOptions);

  const abort = new AbortController();
  const timeout = setTimeout(
    () => abort.abort(new Error('Live transcript demo exceeded 120 seconds')),
    120_000,
  );
  const transcript = new TranscriptGrouper();
  const result: TranscriptDemoResult = {
    rawTranscriptEvents: 0,
    updateCount: 0,
    segments: [],
    rawUserText: '',
    interruptionSentDuringOutput: false,
  };
  let ready = false;
  let finishing = false;
  let lastAudioAt = Number.NEGATIVE_INFINITY;
  let lastTextAt = Number.NEGATIVE_INFINITY;
  let assistantCharacters = 0;
  let closedAssistant = 0;
  const latest = new Map<string, string>();
  const closedIds = new Set<string>();
  transcript.on('segment.updated', (segment) => {
    if (closedIds.has(segment.id) || !segment.text.startsWith(latest.get(segment.id) ?? '')) {
      abort.abort(new Error('A closed segment changed or emitted text was rewritten'));
    }
    latest.set(segment.id, segment.text);
    result.updateCount += 1;
    options.onUpdate?.(segment);
  });
  transcript.on('segment.closed', (event) => {
    if (closedIds.has(event.segment.id) || latest.get(event.segment.id) !== event.segment.text) {
      abort.abort(new Error('A segment closed twice or final text differed from its updates'));
    }
    closedIds.add(event.segment.id);
    result.segments.push(event);
    if (event.segment.speaker === 'assistant') {
      closedAssistant += 1;
    }
    options.onClosed?.(event);
  });

  live.on('error', (error) => abort.abort(error));
  live.on('close', () => {
    if (!finishing) {
      abort.abort(new Error('Live transport closed before the demo completed'));
    }
  });
  const onEvent = (event: ServerEvent) => {
    if (event.type === 'session.started') {
      ready = true;
    }
    if (event.type === 'session.input_transcript.delta') {
      result.rawTranscriptEvents += 1;
      result.rawUserText += event.delta;
    }
    if (event.type === 'session.output_transcript.delta') {
      result.rawTranscriptEvents += 1;
      assistantCharacters += event.delta.length;
      lastTextAt = performance.now();
    }
    if (event.type === 'session.output_audio.delta') {
      lastAudioAt = performance.now();
    }
    try {
      if (event.type === 'session.output_audio.delta') {
        options.onOutputAudio?.(Buffer.from(event.delta, 'base64'));
      }
      transcript.push(event);
      if (event.type === 'session.closed') {
        live.off('event', onEvent);
      }
    } catch (error) {
      abort.abort(error);
    }
  };
  live.on('event', onEvent);
  const session: OpenAI.Live.SessionConfig = {
    model: process.env['OPENAI_LIVE_MODEL'] ?? 'gpt-live-1',
    instructions:
      'You are a helpful picnic planner. Listen to the user and use the backend for answers. Brief acknowledgments are fine. When the user interrupts, listen and then answer their updated request.',
    audio: { format: { type: 'audio/pcm', rate: SAMPLE_RATE }, output: { voice: 'marin' } },
    delegation: {
      type: 'responses',
      responses: {
        model: process.env['OPENAI_LIVE_BACKEND_MODEL'] ?? 'gpt-5.6-sol',
        instructions:
          'For the first picnic request give a detailed five-sentence menu. If the user changes to breakfast, give one short sentence. No tools are needed.',
        max_output_tokens: 500,
      },
    },
  };

  async function sendPCM(pcm: Buffer): Promise<void> {
    const startedAt = performance.now();
    for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
      abort.signal.throwIfAborted();
      const chunk = pcm.subarray(offset, offset + CHUNK_BYTES);
      live.send({
        type: 'session.input_audio.append',
        audio: chunk.toString('base64'),
      });
      options.onInputAudio?.(chunk);
      const sentMs = (Math.min(offset + CHUNK_BYTES, pcm.length) / (SAMPLE_RATE * 2)) * 1000;
      await sleep(Math.max(0, startedAt + sentMs - performance.now()), undefined, { signal: abort.signal });
    }
  }

  // Keep sending silence while waiting: the duplex model still needs live audio input.
  const silence = Buffer.alloc(CHUNK_BYTES * 5);
  async function waitWithAudio(predicate: () => boolean, description: string): Promise<void> {
    const deadline = performance.now() + 45_000;
    while (!predicate()) {
      if (performance.now() >= deadline) {
        throw new Error(
          `Timed out waiting for ${description} (${assistantCharacters} assistant characters, ${closedAssistant} closed assistant segments, ${Math.round(performance.now() - lastTextAt)} ms since the last output transcript)`,
        );
      }
      await sendPCM(silence);
    }
  }

  try {
    // The generated transport queues this until the socket opens.
    live.send({ type: 'session.start', session });
    // oxlint-disable-next-line no-unmodified-loop-condition -- The session.started event listener sets ready.
    while (!ready) {
      await sleep(20, undefined, { signal: abort.signal });
    }
    await sendPCM(firstAudio);
    if (options.interrupt) {
      await waitWithAudio(
        () =>
          assistantCharacters > 30 &&
          performance.now() - lastAudioAt < 400 &&
          performance.now() - lastTextAt < 1000,
        'the assistant to speak before interrupting',
      );
      result.interruptionSentDuringOutput = true;
    } else {
      await waitWithAudio(
        () => closedAssistant > 0 && performance.now() - lastTextAt >= 2500,
        'the first answer to settle',
      );
    }
    await sendPCM(secondAudio);
    const beforeAnswer = assistantCharacters;
    const beforeClose = closedAssistant;
    await waitWithAudio(
      () =>
        assistantCharacters > beforeAnswer &&
        closedAssistant > beforeClose &&
        performance.now() - lastTextAt >= 2500,
      'the final answer to settle',
    );
    finishing = true;
    live.send({ type: 'session.close' });
    // Give the public session.closed event a chance to finalize remaining text.
    await sleep(300, undefined, { signal: abort.signal });
  } finally {
    finishing = true;
    clearTimeout(timeout);
    live.off('event', onEvent);
    try {
      transcript.close();
    } finally {
      live.close();
    }
  }
  abort.signal.throwIfAborted();
  return result;
}
