import { EventEmitter } from '../../core/EventEmitter';
import { OpenAIError } from '../../core/error';
import type { ServerEvent } from '../../resources/live/live';
import { TranscriptGrouping } from './transcript-grouping';
import type { GroupingUpdate, TranscriptFragment } from './transcript-grouping';

/** Options for the speaker-based transcript grouping policy. */
export interface TranscriptGrouperOptions {
  /** Minimum source-time gap before promoting buffered assistant text. Default: 500 ms. */
  minTurnSeparationMs?: number;
  /** Assistant transcript inactivity before closing a segment. Default: 2000 ms; not an audio/VAD signal. */
  assistantSilenceMs?: number;
  /** Acknowledgments shorter than this may be suppressed as backchannels. Default: 1000 ms; zero disables suppression. */
  backchannelMaxDurationMs?: number;
  /** Isolation window used to distinguish backchannels from assistant replies. Default: 2000 ms. */
  backchannelIsolationMs?: number;
  /** Extra phrases eligible for backchannel suppression, in addition to the built-in acknowledgments.
   * Normalized like transcript text (case, hyphens, whitespace, and surrounding punctuation).
   * Copied when the grouper is created; the same timing thresholds apply.
   */
  additionalAcknowledgments?: readonly string[];
}

/** An immutable SDK projection of spoken text, not a server conversation item. */
export interface TranscriptSegment {
  /** Stable ID local to this SDK projection; not a server turn or item ID. */
  readonly id: string;
  /** ID of the preceding emitted segment, or null for the first segment. */
  readonly previousId: string | null;
  /** Speaker whose transcript text was grouped. */
  readonly speaker: 'user' | 'assistant';
  /** Complete append-only text; replace the displayed text on each update. */
  readonly text: string;
  /** Start of the first contributing public transcript interval, in session milliseconds. */
  readonly startMs: number;
  /** Latest end of the contributing public transcript intervals; never a playback completion time. */
  readonly endMs: number;
}

/** Why a display segment was finalized; none of these proves audible speech completed. */
export type TranscriptSegmentCloseReason =
  | 'speaker_change'
  | 'inactivity'
  | 'timestamp_reset'
  | 'session_closed'
  | 'manual';

/** A final segment snapshot and the reason it will receive no further updates. */
export interface TranscriptSegmentClosedEvent {
  /** The final immutable segment, including all previously emitted text. */
  readonly segment: TranscriptSegment;
  /** The local grouping decision that finalized the segment. */
  readonly reason: TranscriptSegmentCloseReason;
}

/** Events emitted by a TranscriptGrouper. */
// oxlint-disable-next-line typescript/consistent-type-definitions -- A closed event-map type satisfies the SDK emitter's Record constraint without permitting arbitrary event names.
export type TranscriptGrouperEvents = {
  /** First and subsequent complete snapshots of an emitted segment. */
  'segment.updated': (segment: TranscriptSegment) => void;
  /** Exactly one final snapshot per emitted segment; closed segments are never reopened. */
  'segment.closed': (event: TranscriptSegmentClosedEvent) => void;
};

type ReceivedFragment = TranscriptFragment & { receivedAt: number };
const SETTLE_MS = 50;
const MAX_TIMEOUT_MS = 2_147_483_647;
let nextGrouperId = 0;

function normalizeTranscript(
  event: Extract<ServerEvent, { type: 'session.input_transcript.delta' | 'session.output_transcript.delta' }>,
): ReceivedFragment & { id: string } {
  const { event_id: id, delta: text, start_ms: startMs, end_ms: endMs } = event;
  const speaker = event.type === 'session.input_transcript.delta' ? 'user' : 'assistant';
  if (
    typeof id !== 'string' ||
    !id ||
    typeof text !== 'string' ||
    !Number.isSafeInteger(startMs) ||
    startMs < 0 ||
    !Number.isSafeInteger(endMs) ||
    endMs < startMs
  ) {
    throw new OpenAIError(
      'Invalid Live transcript delta: expected an event ID, text, and a nonnegative timed interval',
    );
  }
  return { id, speaker, text, startMs, endMs, receivedAt: performance.now() };
}

function optionsWithDefaults(options: TranscriptGrouperOptions): Required<TranscriptGrouperOptions> {
  const resolved = {
    minTurnSeparationMs: options.minTurnSeparationMs ?? 500,
    assistantSilenceMs: options.assistantSilenceMs ?? 2000,
    backchannelMaxDurationMs: options.backchannelMaxDurationMs ?? 1000,
    backchannelIsolationMs: options.backchannelIsolationMs ?? 2000,
  };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isFinite(value) || value < 0 || value > MAX_TIMEOUT_MS) {
      throw new OpenAIError(`${name} must be a finite number between 0 and ${MAX_TIMEOUT_MS}`);
    }
  }
  return { ...resolved, additionalAcknowledgments: options.additionalAcknowledgments ?? [] };
}

/**
 * Groups public Live transcript events using speaker and
 * backchannel heuristics. Raw events remain available on your transport.
 *
 * Only session.input_transcript.delta, session.output_transcript.delta and session.closed are
 * consumed. No audio, engine frames, server turn events or internal end markers
 * are required. Ambiguous speaker changes settle for at most 50 ms. When source
 * time stops arriving, a monotonic local clock supplies a best-effort inactivity
 * fallback. Delayed delivery can therefore change grouping; this is not VAD,
 * playback tracking, or a lossless transcript (some backchannels are suppressed).
 *
 * Create one instance per session. Call close() on transport loss or teardown;
 * the grouper never owns or closes your transport and does not reconnect it.
 */
// oxlint-disable-next-line unicorn/prefer-event-target -- This is the SDK's browser-compatible typed emitter, not node:events.
export class TranscriptGrouper extends EventEmitter<TranscriptGrouperEvents> {
  private readonly grouping: TranscriptGrouping;
  private readonly seenIds = new Set<string>();
  private pending: ReceivedFragment[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private anchor: { sourceMs: number; receivedAt: number } | undefined;
  private lastStartMs: number | undefined;
  private closed = false;
  private dispatching = false;
  private readonly updates: GroupingUpdate[] = [];

  /** Create a grouper with speaker-based defaults. Invalid timing options throw OpenAIError. */
  constructor(options: TranscriptGrouperOptions = {}) {
    super();
    this.grouping = new TranscriptGrouping(optionsWithDefaults(options), `segment_${nextGrouperId}`);
    nextGrouperId += 1;
  }

  /**
   * Consume one public Live event. Duplicate transcript event IDs and unrelated
   * event types are ignored. Empty text does not count as speech activity.
   * Malformed transcript fields or use after close() throw OpenAIError.
   */
  push(event: ServerEvent): void {
    if (this.closed) {
      throw new OpenAIError('Cannot push events after closing the transcript grouper');
    }
    if (event.type === 'session.closed') {
      this.finish('session_closed');
      return;
    }
    if (event.type !== 'session.input_transcript.delta' && event.type !== 'session.output_transcript.delta') {
      return;
    }
    const fragment = normalizeTranscript(event);
    const { id, startMs, endMs, speaker } = fragment;
    if (this.seenIds.has(id)) {
      return;
    }
    this.seenIds.add(id);
    if (!fragment.text) {
      return;
    }
    const updates: GroupingUpdate[] = [];
    const [pending] = this.pending;
    if (pending && pending.startMs === startMs && pending.endMs === endMs) {
      this.pending.push(fragment);
      if (this.pending.some((part) => part.speaker !== speaker)) {
        updates.push(...this.flushPending());
      }
    } else {
      updates.push(...this.flushPending());
      if (this.grouping.speaker === speaker) {
        updates.push(...this.commit([fragment]));
      } else {
        this.pending.push(fragment);
      }
    }
    this.schedule();
    this.dispatch(updates);
  }

  /**
   * Flush buffered text according to the grouping policy, finalize all emitted
   * segments, and cancel timers. Idempotent; further push() calls fail. Does not
   * close the transport. Invoke before discarding the grouper at session teardown.
   */
  close(): void {
    this.finish('manual');
  }

  private finish(reason: 'manual' | 'session_closed'): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.clearTimer();
    const updates = this.flushPending();
    updates.push(...this.grouping.close(this.sourceNow(), reason));
    this.seenIds.clear();
    this.dispatch(updates);
  }

  private commit(fragments: readonly ReceivedFragment[]): GroupingUpdate[] {
    const [first] = fragments;
    if (!first) {
      return [];
    }
    const updates: GroupingUpdate[] = [];
    if (this.lastStartMs !== undefined && first.startMs < this.lastStartMs) {
      updates.push(...this.grouping.close(this.sourceNow(), 'timestamp_reset'));
      this.anchor = undefined;
    }
    this.lastStartMs = first.startMs;
    // Overlapping intervals can end before earlier ones. Preserve the source
    // high-water mark while restarting local inactivity on newly received text.
    this.anchor = {
      sourceMs: Math.max(this.anchor?.sourceMs ?? 0, first.endMs),
      receivedAt: first.receivedAt,
    };
    for (const part of fragments) {
      this.anchor.sourceMs = Math.max(this.anchor.sourceMs, part.endMs);
      this.anchor.receivedAt = Math.max(this.anchor.receivedAt, part.receivedAt);
    }
    updates.push(...this.grouping.process(fragments));
    return updates;
  }

  private flushPending(): GroupingUpdate[] {
    const { pending } = this;
    this.pending = [];
    return this.commit(pending);
  }

  private sourceNow(): number {
    return this.anchor ? this.anchor.sourceMs + Math.max(0, performance.now() - this.anchor.receivedAt) : 0;
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    this.timer = undefined;
  }

  private schedule(): void {
    this.clearTimer();
    if (this.closed) {
      return;
    }
    const [pending] = this.pending;
    const deadline = this.grouping.deadline();
    // Settle newly arrived text before applying an older inactivity deadline.
    let delay: number | undefined;
    if (pending) {
      delay = pending.receivedAt + SETTLE_MS - performance.now();
    } else if (deadline !== undefined) {
      delay = deadline - this.sourceNow();
    }
    if (delay === undefined) {
      return;
    }
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        const updates = this.flushPending();
        updates.push(...this.grouping.advance(this.sourceNow()));
        this.schedule();
        this.dispatch(updates);
      },
      Math.min(MAX_TIMEOUT_MS, Math.max(0, Math.ceil(delay))),
    );
    const timer: unknown = this.timer;
    if (
      typeof timer === 'object' &&
      timer !== null &&
      'unref' in timer &&
      typeof timer.unref === 'function'
    ) {
      timer.unref();
    }
  }

  private dispatch(updates: GroupingUpdate[]): void {
    this.updates.push(...updates);
    if (this.dispatching) {
      return;
    }
    this.dispatching = true;
    try {
      while (this.updates.length) {
        const update = this.updates.shift();
        if (update?.type === 'updated') {
          this._emit('segment.updated', update.segment);
        } else if (update) {
          this._emit('segment.closed', { segment: update.segment, reason: update.reason });
        }
      }
    } finally {
      this.dispatching = false;
    }
  }
}
