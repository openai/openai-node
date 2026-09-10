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

type Turn = TranscriptFragment & {
  id: string;
  previousId: string | null;
  emitted: boolean;
  canDropAsBackchannel: boolean;
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
  return text
    .toLowerCase()
    .split('-')
    .join(' ')
    .replace(/^[\s.,!?;:"'()[\]{}]+/u, '')
    .replace(/[\s.,!?;:"'()[\]{}]+$/u, '')
    .split(/\s+/u)
    .join(' ');
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

  constructor(options: Required<TranscriptGrouperOptions>, idPrefix: string) {
    this.options = options;
    this.idPrefix = idPrefix;
    this.acknowledgments = [
      ...ACKNOWLEDGMENTS,
      ...options.additionalAcknowledgments.map(normalizeAcknowledgment).filter(Boolean),
    ];
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
    if (separation < this.options.minTurnSeparationMs) {
      this.buffer(fragment, this.possibleAcknowledgment(fragment));
      return [];
    }
    if (this.buffered && this.standaloneAcknowledgment(fragment, this.buffered)) {
      this.buffer(fragment, true);
      return [];
    }
    if (!this.buffered && this.standaloneAcknowledgment(fragment)) {
      this.buffer(fragment, false);
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

  private buffer(fragment: TranscriptFragment, canDrop?: boolean): void {
    if (this.buffered) {
      TranscriptGrouping.append(this.buffered, fragment);
    } else {
      this.buffered = this.newTurn(fragment);
    }
    if (canDrop !== undefined) {
      this.buffered.canDropAsBackchannel = canDrop;
    }
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

  private standaloneAcknowledgment(fragment: TranscriptFragment, previous?: Turn): boolean {
    return (
      fragment.endMs - (previous?.startMs ?? fragment.startMs) < this.options.backchannelMaxDurationMs &&
      this.acknowledgments.includes(normalizeAcknowledgment((previous?.text ?? '') + fragment.text))
    );
  }

  private possibleAcknowledgment(fragment: TranscriptFragment): boolean {
    const text = normalizeAcknowledgment((this.buffered?.text ?? '') + fragment.text);
    return (
      fragment.endMs - (this.buffered?.startMs ?? fragment.startMs) < this.options.backchannelMaxDurationMs &&
      text.length > 0 &&
      this.acknowledgments.some((acknowledgment) => acknowledgment.startsWith(text))
    );
  }
}
