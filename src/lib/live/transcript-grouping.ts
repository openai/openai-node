import type {
  TranscriptGrouperOptions,
  TranscriptSegment,
  TranscriptSegmentCloseReason,
} from './transcript-grouper';

export interface TranscriptFragment {
  speaker: 'user' | 'assistant';
  text: string;
  startMs: number;
  endMs: number;
}

export type GroupingUpdate =
  | { type: 'updated'; segment: TranscriptSegment }
  | { type: 'closed'; segment: TranscriptSegment; reason: TranscriptSegmentCloseReason };

interface Acknowledgment {
  characters: number;
  text: string | undefined;
}

type Turn = TranscriptFragment & {
  id: string;
  previousId: string | null;
  emitted: boolean;
  canDropAsBackchannel: boolean;
  acknowledgment?: Acknowledgment | undefined;
};

const ACKNOWLEDGMENTS = [
  'aha',
  'alright',
  'gotcha',
  'hm',
  'hmm',
  'mhm',
  'mm',
  'mm hmm',
  'okay',
  'ok',
  'right',
  'sure',
  'uh huh',
  'yeah',
  'yep',
  'yes',
];

function normalizeAcknowledgment(text: string): string {
  const normalized = text
    .toLowerCase()
    .split('-')
    .join(' ')
    .replace(/^[\s.,!?;:"'()[\]{}]+/u, '');
  let end = normalized.length;
  while (end > 0 && /[\s.,!?;:"'()[\]{}]/u.test(normalized.charAt(end - 1))) {
    end -= 1;
  }
  return normalized.slice(0, end).split(/\s+/u).join(' ');
}

/** The v2 grouping policy, driven by timed public text rather than engine frames. */
export class TranscriptGrouping {
  private current: Turn | undefined;
  private buffered: Turn | undefined;
  private lastId: string | null = null;
  private nextId = 0;
  private lastAssistantEnd: number | undefined;

  private readonly options: Required<TranscriptGrouperOptions>;
  private readonly idPrefix: string;
  private readonly acknowledgments: readonly string[];
  private readonly maxAcknowledgmentLength: number;

  constructor(options: Required<TranscriptGrouperOptions>, idPrefix: string) {
    this.options = options;
    this.idPrefix = idPrefix;
    this.acknowledgments = [
      ...ACKNOWLEDGMENTS,
      ...options.additionalAcknowledgments.map(normalizeAcknowledgment).filter(Boolean),
    ];
    let maxLength = 0;
    for (const acknowledgment of this.acknowledgments) {
      maxLength = Math.max(maxLength, acknowledgment.length);
    }
    this.maxAcknowledgmentLength = maxLength;
  }

  get speaker(): TranscriptFragment['speaker'] | undefined {
    return this.current?.speaker;
  }

  process(fragments: readonly TranscriptFragment[]): GroupingUpdate[] {
    const events: GroupingUpdate[] = [];
    const preferred = this.current?.speaker ?? 'user';
    const ordered = [
      ...fragments.filter((fragment) => fragment.speaker === preferred),
      ...fragments.filter((fragment) => fragment.speaker !== preferred),
    ];
    const [first] = ordered;
    if (!first) {
      return events;
    }
    // A later public interval supplies elapsed source time even when no silence
    // events were sent. Resolve decisions strictly before the incoming interval.
    let deadline = this.deadline();
    while (deadline !== undefined && deadline < first.startMs) {
      events.push(...this.advance(deadline));
      deadline = this.deadline();
    }
    if (this.current && !ordered.some((fragment) => fragment.speaker === this.current?.speaker)) {
      events.push(
        ...this.advance(
          first.startMs,
          ordered.some((fragment) => fragment.speaker === 'user'),
        ),
      );
    }
    for (const fragment of ordered) {
      events.push(...this.ingest(fragment));
    }
    return events;
  }

  advance(timeMs: number, hasIncomingUser = false): GroupingUpdate[] {
    if (
      this.current &&
      this.buffered &&
      timeMs - this.current.endMs >= this.options.minTurnSeparationMs &&
      !this.keepBackchannel(timeMs)
    ) {
      this.buffered = this.maybeDropBackchannel(timeMs);
      if (this.buffered) {
        return this.promote();
      }
    }
    if (
      this.current?.speaker === 'assistant' &&
      !hasIncomingUser &&
      timeMs - this.current.endMs >= this.options.assistantSilenceMs
    ) {
      return this.finishCurrent('inactivity');
    }
    return [];
  }

  deadline(): number | undefined {
    if (!this.current) {
      return undefined;
    }
    if (this.buffered) {
      const separation = this.current.endMs + this.options.minTurnSeparationMs;
      if (
        this.mightBeBackchannel() &&
        this.buffered.canDropAsBackchannel &&
        !this.userContinued() &&
        !this.recentAssistant()
      ) {
        return Math.max(separation, this.buffered.endMs + this.options.backchannelIsolationMs);
      }
      return separation;
    }
    return this.current.speaker === 'assistant'
      ? this.current.endMs + this.options.assistantSilenceMs
      : undefined;
  }

  close(timeMs: number, reason: TranscriptSegmentCloseReason): GroupingUpdate[] {
    const buffered = this.maybeDropBackchannel(timeMs);
    const events = this.finishCurrent(reason);
    this.buffered = undefined;
    if (buffered?.text) {
      events.push(...this.emit(buffered), ...this.finish(buffered, reason));
    }
    if (reason === 'timestamp_reset') {
      this.lastAssistantEnd = undefined;
    }
    return events;
  }

  private ingest(fragment: TranscriptFragment): GroupingUpdate[] {
    if (!this.current) {
      this.current = this.newTurn(fragment);
      return this.emit(this.current);
    }
    if (fragment.speaker === this.current.speaker) {
      TranscriptGrouping.append(this.current, fragment, this.buffered !== undefined);
      return this.emit(this.current);
    }
    if (this.current.speaker === 'user' && this.userContinued()) {
      this.buffered = undefined;
    }

    const separation = fragment.startMs - this.current.endMs;
    if (this.current.speaker === 'assistant') {
      this.buffer(fragment);
      return this.promote();
    }
    const withinDuration =
      fragment.endMs - (this.buffered?.startMs ?? fragment.startMs) < this.options.backchannelMaxDurationMs;
    const acknowledgment = this.acknowledgment(fragment, withinDuration);
    const normalized = withinDuration ? acknowledgment.text : undefined;
    if (separation < this.options.minTurnSeparationMs) {
      this.buffer(
        fragment,
        normalized !== undefined &&
          normalized.length > 0 &&
          this.acknowledgments.some((phrase) => phrase.startsWith(normalized)),
        acknowledgment,
      );
      return [];
    }
    if (normalized !== undefined && this.acknowledgments.includes(normalized)) {
      this.buffer(fragment, this.buffered !== undefined, acknowledgment);
      return [];
    }
    this.buffered = this.maybeDropBackchannel(undefined, fragment);
    const events = this.finishCurrent('speaker_change');
    if (this.buffered) {
      this.current = this.buffered;
      this.buffered = undefined;
      TranscriptGrouping.append(this.current, fragment);
    } else {
      this.current = this.newTurn(fragment);
    }
    events.push(...this.emit(this.current));
    return events;
  }

  private newTurn(fragment: TranscriptFragment): Turn {
    const turn = {
      ...fragment,
      id: `${this.idPrefix}_${this.nextId}`,
      previousId: null,
      emitted: false,
      canDropAsBackchannel: true,
    };
    this.nextId += 1;
    return turn;
  }

  private static append(turn: Turn, fragment: TranscriptFragment, separate = false): void {
    const separator =
      separate && /[\p{L}\p{N}]$/u.test(turn.text) && /^[\p{L}\p{N}]/u.test(fragment.text) ? ' ' : '';
    turn.text += separator + fragment.text;
    turn.endMs = Math.max(turn.endMs, fragment.endMs);
  }

  private buffer(fragment: TranscriptFragment, canDrop?: boolean, acknowledgment?: Acknowledgment): void {
    if (this.buffered) {
      TranscriptGrouping.append(this.buffered, fragment);
    } else {
      this.buffered = this.newTurn(fragment);
    }
    if (canDrop !== undefined) {
      this.buffered.canDropAsBackchannel = canDrop;
    }
    this.buffered.acknowledgment = acknowledgment;
  }

  private promote(): GroupingUpdate[] {
    if (!this.buffered) {
      return [];
    }
    const events = this.finishCurrent('speaker_change');
    this.current = this.buffered;
    this.buffered = undefined;
    events.push(...this.emit(this.current));
    return events;
  }

  private finishCurrent(reason: TranscriptSegmentCloseReason): GroupingUpdate[] {
    const { current } = this;
    this.current = undefined;
    return current ? this.finish(current, reason) : [];
  }

  private finish(turn: Turn, reason: TranscriptSegmentCloseReason): GroupingUpdate[] {
    if (turn.speaker === 'assistant') {
      this.lastAssistantEnd = turn.endMs;
    }
    return turn.emitted ? [{ type: 'closed', segment: TranscriptGrouping.snapshot(turn), reason }] : [];
  }

  private emit(turn: Turn): GroupingUpdate[] {
    if (!turn.text) {
      return [];
    }
    if (!turn.emitted) {
      turn.previousId = this.lastId;
      this.lastId = turn.id;
      turn.emitted = true;
    }
    return [{ type: 'updated', segment: TranscriptGrouping.snapshot(turn) }];
  }

  private static snapshot(turn: Turn): TranscriptSegment {
    return Object.freeze({
      id: turn.id,
      previousId: turn.previousId,
      speaker: turn.speaker,
      text: turn.text,
      startMs: turn.startMs,
      endMs: turn.endMs,
    });
  }

  private mightBeBackchannel(): boolean {
    return (
      this.current?.speaker === 'user' &&
      this.buffered?.speaker === 'assistant' &&
      this.buffered.endMs - this.buffered.startMs < this.options.backchannelMaxDurationMs
    );
  }

  private userContinued(): boolean {
    return (
      this.mightBeBackchannel() &&
      this.buffered?.canDropAsBackchannel === true &&
      this.current !== undefined &&
      this.current.endMs > this.buffered.endMs
    );
  }

  private recentAssistant(): boolean {
    return (
      this.current !== undefined &&
      this.buffered !== undefined &&
      this.lastAssistantEnd !== undefined &&
      this.buffered.startMs - this.lastAssistantEnd < this.options.backchannelIsolationMs &&
      this.buffered.startMs <= this.current.startMs
    );
  }

  private keepBackchannel(timeMs: number): boolean {
    return (
      this.mightBeBackchannel() &&
      this.buffered?.canDropAsBackchannel === true &&
      !this.userContinued() &&
      !this.recentAssistant() &&
      timeMs - this.buffered.endMs < this.options.backchannelIsolationMs
    );
  }

  private maybeDropBackchannel(timeMs?: number, next?: TranscriptFragment): Turn | undefined {
    if (!this.mightBeBackchannel() || !this.buffered) {
      return this.buffered;
    }
    if (this.userContinued()) {
      return undefined;
    }
    if (this.recentAssistant()) {
      return this.buffered;
    }
    if (next && next.startMs - this.buffered.endMs < this.options.backchannelIsolationMs) {
      return this.buffered;
    }
    if (
      !next &&
      (timeMs === undefined || timeMs - this.buffered.endMs < this.options.backchannelIsolationMs)
    ) {
      return this.buffered;
    }
    return this.buffered.canDropAsBackchannel ? undefined : this.buffered;
  }

  private acknowledgment(fragment: TranscriptFragment, withinDuration: boolean): Acknowledgment {
    const previous = this.buffered?.acknowledgment;
    const previousCharacters = previous?.characters ?? 0;
    let characters = previousCharacters;
    const separator = /[\s.,!?;:"'()[\]{}-]/u;
    for (
      let index = 0;
      index < fragment.text.length && characters <= this.maxAcknowledgmentLength;
      index += 1
    ) {
      if (!separator.test(fragment.text.charAt(index))) {
        characters += 1;
      }
    }
    // Significant characters cannot disappear during normalization. Once they
    // outgrow the configured phrases, stop counting without allocating tokens.
    let text: string | undefined;
    if (characters === previousCharacters && previous?.text !== undefined) {
      // Keep the raw suffix in the turn: later text can make punctuation internal.
      ({ text } = previous);
    } else if (withinDuration && characters <= this.maxAcknowledgmentLength) {
      // Retain whole-string Unicode casing (including context-sensitive sigma).
      text = normalizeAcknowledgment((this.buffered?.text ?? '') + fragment.text);
    }
    return { characters, text };
  }
}
