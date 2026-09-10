/* oxlint-disable unicorn/prefer-single-call -- TranscriptGrouper.push consumes one event at a time; it is not Array.push. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptGrouper } from 'openai/helpers/live';
import type {
  TranscriptGrouperOptions,
  TranscriptSegment,
  TranscriptSegmentClosedEvent,
} from 'openai/helpers/live';
import type { ServerEvent } from 'openai/resources/live/live';

let itemId = 0;
function text(
  speaker: 'user' | 'assistant',
  value: string,
  startMs: number,
  endMs = startMs + 200,
): ServerEvent {
  const id = `item_${itemId}`;
  itemId += 1;
  return speaker === 'user'
    ? {
        type: 'session.input_transcript.delta',
        start_ms: startMs,
        end_ms: endMs,
        event_id: id,
        delta: value,
      }
    : {
        type: 'session.output_transcript.delta',
        start_ms: startMs,
        end_ms: endMs,
        event_id: id,
        delta: value,
      };
}

function recording(options?: TranscriptGrouperOptions) {
  const grouper = new TranscriptGrouper(options);
  const updates: TranscriptSegment[] = [];
  const closed: TranscriptSegmentClosedEvent[] = [];
  const latest = new Map<string, TranscriptSegment>();
  const finished = new Set<string>();
  grouper.on('segment.updated', (segment) => {
    expect(finished.has(segment.id)).toBe(false);
    expect(segment.text.startsWith(latest.get(segment.id)?.text ?? '')).toBe(true);
    expect(Object.isFrozen(segment)).toBe(true);
    latest.set(segment.id, segment);
    updates.push(segment);
  });
  grouper.on('segment.closed', (event) => {
    expect(finished.has(event.segment.id)).toBe(false);
    expect(event.segment).toEqual(latest.get(event.segment.id));
    finished.add(event.segment.id);
    closed.push(event);
  });
  return {
    grouper,
    updates,
    closed,
    latest,
    finished,
    contents: () => closed.map(({ segment }) => [segment.speaker, segment.text]),
  };
}

beforeEach(() => {
  itemId = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
});
afterEach(() => vi.useRealTimers());

describe('public Live transcript grouping', () => {
  it('emits append-only snapshots, stable IDs, predecessors and one final event', () => {
    const { grouper, updates, closed } = recording();
    grouper.push(text('user', 'Can you ', 0));
    grouper.push(text('user', 'run ls?', 200));
    grouper.push(text('assistant', 'Sure.', 1000));
    grouper.close();
    expect(closed.map(({ segment }) => segment.text)).toEqual(['Can you run ls?', 'Sure.']);
    expect(updates[0]?.text).toBe('Can you ');
    expect(closed[0]?.segment.previousId).toBeNull();
    expect(closed[1]?.segment.previousId).toBe(closed[0]?.segment.id);
    expect(closed[0]?.segment).toMatchObject({ startMs: 0, endMs: 400 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([['mhm'], ['Mm-hmm.'], ['Mm-', 'hmm.'], ['ye', 'ah'], ['uh-', 'huh!']])(
    'suppresses an overlapping acknowledgment %j when the user continues',
    (...parts) => {
      const { grouper, contents } = recording();
      grouper.push(text('user', 'Tell me', 0));
      for (const [index, part] of parts.entries()) {
        grouper.push(text('assistant', part, 200 + index * 200));
      }
      grouper.push(text('user', 'more', 800));
      grouper.push(text('assistant', 'Here is the answer.', 2000));
      grouper.close();
      expect(contents()).toEqual([
        ['user', 'Tell me more'],
        ['assistant', 'Here is the answer.'],
      ]);
    },
  );

  it.each([['xy-', 'z!'], ['mhm'], ['Mm-hmm.']])(
    'extends defaults with normalized, copied additional acknowledgments %j',
    (...parts) => {
      const phrases = [' XY-Z! ', '...'];
      const { grouper, contents } = recording({ additionalAcknowledgments: phrases });
      phrases.length = 0;
      grouper.push(text('user', 'Tell me', 0));
      for (const [index, part] of parts.entries()) {
        grouper.push(text('assistant', part, 200 + index * 200));
      }
      grouper.push(text('user', 'more', 800));
      grouper.close();
      expect(contents()).toEqual([['user', 'Tell me more']]);
    },
  );

  it('keeps additional acknowledgments local to each instance', () => {
    const custom = recording({ additionalAcknowledgments: ['xyz'] });
    const { grouper, contents } = recording();
    grouper.push(text('user', 'Tell me', 0));
    grouper.push(text('assistant', 'xyz', 200));
    grouper.push(text('user', 'more', 800));
    grouper.close();
    custom.grouper.close();
    expect(contents()).toEqual([
      ['user', 'Tell me'],
      ['assistant', 'xyz'],
      ['user', 'more'],
    ]);
  });

  it('respects disabled suppression for additional acknowledgments', () => {
    const { grouper, contents } = recording({
      additionalAcknowledgments: ['xyz'],
      backchannelMaxDurationMs: 0,
    });
    grouper.push(text('user', 'Tell me', 0));
    grouper.push(text('assistant', 'xyz', 200));
    grouper.push(text('user', 'more', 800));
    grouper.close();
    expect(contents()).toEqual([
      ['user', 'Tell me'],
      ['assistant', 'xyz'],
      ['user', 'more'],
    ]);
  });

  it('does not prepend a discarded backchannel to the following semantic reply', () => {
    const { grouper, contents } = recording();
    grouper.push(text('user', 'Tell me', 0));
    grouper.push(text('assistant', 'mhm', 200));
    grouper.push(text('user', 'more', 400));
    grouper.push(text('assistant', 'Here is the answer.', 600));
    grouper.close();
    expect(contents()).toEqual([
      ['user', 'Tell me more'],
      ['assistant', 'Here is the answer.'],
    ]);
  });

  it('keeps a short substantive answer and trailing user ASR', () => {
    const { grouper, contents } = recording();
    grouper.push(text('user', 'Stop counting', 0));
    grouper.push(text('assistant', 'thirteen', 200));
    grouper.push(text('user', '.', 400));
    grouper.close();
    expect(contents()).toEqual([
      ['user', 'Stop counting.'],
      ['assistant', 'thirteen'],
    ]);
  });

  it('preserves a standalone acknowledgment following a clear speaker gap', () => {
    const { grouper, contents } = recording();
    grouper.push(text('user', 'Are you there?', 0));
    grouper.push(text('assistant', 'yes', 800));
    vi.advanceTimersByTime(5000);
    grouper.close();
    expect(contents()).toEqual([
      ['user', 'Are you there?'],
      ['assistant', 'yes'],
    ]);
  });

  it.each([true, false])('handles a same-interval user barge-in (input first: %s)', (inputFirst) => {
    const { grouper, contents } = recording();
    grouper.push(text('assistant', 'The answer is', 0));
    vi.advanceTimersByTime(50);
    const pair = [text('user', 'Wait', 200), text('assistant', ' forty-two.', 200)];
    if (!inputFirst) {
      pair.reverse();
    }
    for (const event of pair) {
      grouper.push(event);
    }
    grouper.push(text('user', ', stop.', 400));
    grouper.close();
    expect(contents()).toEqual([
      ['assistant', 'The answer is forty-two.'],
      ['user', 'Wait, stop.'],
    ]);
  });

  it.each([true, false])(
    'settles the first interval in either arrival order (input first: %s)',
    (inputFirst) => {
      const { grouper, contents } = recording();
      const pair = [text('user', 'hello', 0), text('assistant', 'hello there', 0)];
      if (!inputFirst) {
        pair.reverse();
      }
      for (const event of pair) {
        grouper.push(event);
      }
      grouper.close();
      expect(contents()).toEqual([
        ['user', 'hello'],
        ['assistant', 'hello there'],
      ]);
    },
  );

  it('closes assistant text using a local timeout without any subsequent API event', () => {
    const { grouper, closed } = recording();
    grouper.push(text('assistant', 'The answer is ready.', 0));
    vi.advanceTimersByTime(1999);
    expect(closed).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ reason: 'inactivity', segment: { endMs: 200 } });
    expect(vi.getTimerCount()).toBe(0);
    grouper.close();
  });

  it('does not close user text solely because of inactivity', () => {
    const { grouper, closed, contents } = recording();
    grouper.push(text('user', 'Hello', 0));
    vi.advanceTimersByTime(60_000);
    expect(closed).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    grouper.push(text('user', ' again.', 60_000));
    grouper.close();
    expect(contents()).toEqual([['user', 'Hello again.']]);
  });

  it('restarts inactivity from the source high-water mark for overlapping intervals', () => {
    const { grouper, closed, contents } = recording({ assistantSilenceMs: 200 });
    grouper.push(text('assistant', 'First', 0, 500));
    vi.advanceTimersByTime(100);
    grouper.push(text('assistant', ' overlapping.', 100, 120));
    vi.advanceTimersByTime(199);
    expect(closed).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ reason: 'inactivity', segment: { endMs: 500 } });
    grouper.push(text('assistant', 'Later.', 150, 200));
    grouper.close();
    expect(contents()).toEqual([
      ['assistant', 'First overlapping.'],
      ['assistant', 'Later.'],
    ]);
    expect(closed[1]?.segment.id).not.toBe(closed[0]?.segment.id);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the source high-water mark when the session timeline resets', () => {
    const { grouper, closed } = recording({ assistantSilenceMs: 200 });
    grouper.push(text('assistant', 'Old timeline.', 1000, 1500));
    vi.advanceTimersByTime(100);
    grouper.push(text('assistant', 'New timeline.', 0, 100));
    expect(closed).toHaveLength(1);
    expect(closed[0]?.reason).toBe('timestamp_reset');
    vi.advanceTimersByTime(199);
    expect(closed).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(closed).toHaveLength(2);
    expect(closed[1]).toMatchObject({ reason: 'inactivity', segment: { endMs: 100 } });
    grouper.close();
  });

  it('uses source-time gaps when several events arrive together', () => {
    const { grouper, contents } = recording();
    grouper.push(text('user', 'One?', 0));
    grouper.push(text('assistant', 'First answer.', 1000));
    grouper.push(text('assistant', 'Second answer.', 4000));
    grouper.close();
    expect(contents()).toEqual([
      ['user', 'One?'],
      ['assistant', 'First answer.'],
      ['assistant', 'Second answer.'],
    ]);
  });

  it('buffers only speaker changes, not every current-speaker update', () => {
    const { grouper, updates } = recording();
    grouper.push(text('assistant', 'First', 0));
    expect(updates).toHaveLength(0);
    vi.advanceTimersByTime(49);
    expect(updates).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(updates).toHaveLength(1);
    grouper.push(text('assistant', ' next', 200));
    expect(updates.map((segment) => segment.text)).toEqual(['First', 'First next']);
    grouper.close();
  });

  it('keeps public literal marker text and never relies on internal end markers', () => {
    const { grouper, contents } = recording();
    grouper.push(text('assistant', 'Say [end] literally.', 0));
    grouper.close();
    expect(contents()).toEqual([['assistant', 'Say [end] literally.']]);
  });

  it('ignores server turn, response, delegation and audio events', () => {
    const { grouper, updates, closed } = recording();
    grouper.push(text('assistant', 'Actual spoken text.', 0));
    vi.advanceTimersByTime(50);
    for (const type of [
      'turn.created',
      'turn.delta',
      'turn.done',
      'response.completed',
      'session.delegation.created',
      'session.output_audio.delta',
    ]) {
      grouper.push({ type } as ServerEvent);
    }
    expect(updates).toHaveLength(1);
    expect(closed).toHaveLength(0);
    grouper.close();
  });

  it('deduplicates public event IDs without resetting inactivity timers', () => {
    const { grouper, closed, updates } = recording();
    const event = text('assistant', 'Once.', 0);
    grouper.push(event);
    vi.advanceTimersByTime(1900);
    grouper.push(event);
    vi.advanceTimersByTime(100);
    expect(updates).toHaveLength(1);
    expect(closed).toHaveLength(1);
    grouper.close();
  });

  it('does not drop a received fragment when its caller mutates the original object', () => {
    const { grouper, contents } = recording();
    const event = text('user', 'Original.', 0);
    grouper.push(event);
    if (event.type === 'session.input_transcript.delta') {
      event.delta = 'Changed.';
    }
    grouper.close();
    expect(contents()).toEqual([['user', 'Original.']]);
  });

  it('preserves whitespace, Unicode and large fragments without display limits', () => {
    const { grouper, contents } = recording();
    const value = '你好 😀'.repeat(100_000);
    grouper.push(text('assistant', value, 0));
    grouper.push(text('assistant', ' \n', 200));
    grouper.close();
    expect(contents()).toEqual([['assistant', `${value} \n`]]);
  });

  it('starts a fresh segment for text arriving after an inactivity closure', () => {
    const { grouper, contents, closed } = recording();
    grouper.push(text('assistant', 'First', 0));
    vi.advanceTimersByTime(3000);
    grouper.push(text('assistant', ' late.', 200));
    grouper.close();
    expect(contents()).toEqual([
      ['assistant', 'First'],
      ['assistant', ' late.'],
    ]);
    expect(closed[0]?.segment.id).not.toBe(closed[1]?.segment.id);
  });

  it('preserves text with regressing timestamps without reusing IDs', () => {
    const { grouper, contents, closed } = recording();
    grouper.push(text('assistant', 'Later', 1000));
    grouper.push(text('assistant', 'Earlier', 0));
    grouper.close();
    expect(contents()).toEqual([
      ['assistant', 'Later'],
      ['assistant', 'Earlier'],
    ]);
    expect(closed[0]?.reason).toBe('timestamp_reset');
    expect(closed[0]?.segment.id).not.toBe(closed[1]?.segment.id);
  });

  it('treats an empty transcript as no text rather than a silence heartbeat', () => {
    const { grouper, closed } = recording();
    grouper.push(text('assistant', 'Answer', 0));
    vi.advanceTimersByTime(1900);
    grouper.push(text('assistant', '', 100_000));
    vi.advanceTimersByTime(100);
    expect(closed[0]?.reason).toBe('inactivity');
    grouper.close();
  });

  it('flushes and closes once on the public session.closed event', () => {
    const { grouper, contents, closed } = recording();
    grouper.push(text('user', 'Question', 0));
    grouper.push(text('assistant', 'Answer', 200));
    grouper.push({ type: 'session.closed' } as ServerEvent);
    grouper.close();
    expect(contents()).toEqual([
      ['user', 'Question'],
      ['assistant', 'Answer'],
    ]);
    expect(closed.every((event) => event.reason === 'session_closed')).toBe(true);
    expect(() => grouper.push(text('user', 'After', 1000))).toThrow('after closing');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows closing from an update listener without stale timers or duplicate closures', () => {
    const { grouper, closed } = recording();
    grouper.on('segment.updated', () => grouper.close());
    grouper.push(text('assistant', 'Answer', 0));
    vi.advanceTimersByTime(50);
    expect(closed).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows a zero backchannel duration to preserve overlapping acknowledgments', () => {
    const { grouper, contents } = recording({ backchannelMaxDurationMs: 0 });
    grouper.push(text('user', 'Tell me ', 0));
    grouper.push(text('assistant', 'mhm', 200));
    grouper.push(text('user', 'more', 400));
    grouper.close();
    expect(contents()).toEqual([
      ['user', 'Tell me more'],
      ['assistant', 'mhm'],
    ]);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'rejects invalid options %s',
    (value) => {
      for (const key of [
        'minTurnSeparationMs',
        'assistantSilenceMs',
        'backchannelMaxDurationMs',
        'backchannelIsolationMs',
      ]) {
        expect(() => new TranscriptGrouper({ [key]: value })).toThrow('finite number');
      }
    },
  );

  it.each([-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid public intervals %s before changing state',
    (value) => {
      const { grouper, contents } = recording();
      expect(() => grouper.push(text('user', 'Invalid', value))).toThrow('Invalid Live transcript delta');
      grouper.push(text('user', 'Valid', 0));
      grouper.close();
      expect(contents()).toEqual([['user', 'Valid']]);
    },
  );
});
