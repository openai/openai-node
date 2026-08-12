import { bench, beforeAll, describe } from 'vitest';

import { Stream, _iterSSEMessages } from '../../src/core/streaming';
import { ReadableStreamFrom } from '../../src/internal/shims';

type LineEnding = '\n' | '\r\n' | '\r';

type FixtureSpec = {
  label: string;
  payloadBytes: number;
  chunkBytes: number;
  eventCount?: number;
  lineEnding?: LineEnding;
};

type BenchmarkPayload = {
  index: number;
  text: string;
};

type BenchmarkFixture = {
  label: string;
  chunks: Uint8Array[];
  expected: { data: string; payload: BenchmarkPayload }[];
};

const BENCHMARK_OPTIONS = {
  time: 100,
  iterations: 10,
  warmupTime: 0,
  warmupIterations: 2,
} as const;

const FIXTURE_SPECS: readonly FixtureSpec[] = [
  { label: '1 KiB event / 1-byte chunks', payloadBytes: 1024, chunkBytes: 1 },
  { label: '1 KiB event / 64-byte chunks', payloadBytes: 1024, chunkBytes: 64 },
  { label: '1 KiB event / 1 KiB chunks', payloadBytes: 1024, chunkBytes: 1024 },
  { label: '8 KiB event / 1-byte chunks', payloadBytes: 8192, chunkBytes: 1 },
  { label: '8 KiB event / 64-byte chunks', payloadBytes: 8192, chunkBytes: 64 },
  { label: '8 KiB event / 1 KiB chunks', payloadBytes: 8192, chunkBytes: 1024 },
  { label: '16 KiB event / 1-byte chunks', payloadBytes: 16_384, chunkBytes: 1 },
  { label: '16 KiB event / 1 KiB chunks', payloadBytes: 16_384, chunkBytes: 1024 },
  { label: '64 short events / 64-byte chunks', payloadBytes: 128, chunkBytes: 64, eventCount: 64 },
  { label: '64 short events / 1 KiB chunks', payloadBytes: 128, chunkBytes: 1024, eventCount: 64 },
  { label: 'CRLF delimiter / 1-byte chunks', payloadBytes: 1024, chunkBytes: 1, lineEnding: '\r\n' },
  { label: 'CR delimiter / 1-byte chunks', payloadBytes: 1024, chunkBytes: 1, lineEnding: '\r' },
];

const FIXTURES = FIXTURE_SPECS.map(createFixture);
let benchmarkSink = 0;

function createFixture(spec: FixtureSpec): BenchmarkFixture {
  const lineEnding = spec.lineEnding ?? '\n';
  const eventCount = spec.eventCount ?? 1;
  const expected: BenchmarkFixture['expected'] = [];
  const frames: string[] = [];

  for (let index = 0; index < eventCount; index++) {
    // Single-byte chunks deliberately split both the emoji and accented UTF-8 bytes.
    const payload = { index, text: `${'x'.repeat(spec.payloadBytes)}🚀 café` };
    const data = JSON.stringify(payload);
    expected.push({ data, payload });
    frames.push(`event: completion${lineEnding}data: ${data}${lineEnding}${lineEnding}`);
  }

  const encoded = new TextEncoder().encode(frames.join(''));
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < encoded.length; offset += spec.chunkBytes) {
    chunks.push(encoded.subarray(offset, offset + spec.chunkBytes));
  }

  return { label: spec.label, chunks, expected };
}

function createResponse(fixture: BenchmarkFixture): Response {
  return new Response(ReadableStreamFrom(fixture.chunks), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function verifyFixture(fixture: BenchmarkFixture): Promise<void> {
  let decodedCount = 0;
  for await (const event of _iterSSEMessages(createResponse(fixture), new AbortController())) {
    const expected = fixture.expected[decodedCount];
    if (!expected || event.event !== 'completion' || event.data !== expected.data) {
      throw new Error(`SSE decoder produced unexpected event ${decodedCount} for ${fixture.label}`);
    }
    decodedCount++;
  }
  if (decodedCount !== fixture.expected.length) {
    throw new Error(`SSE decoder produced ${decodedCount} events for ${fixture.label}`);
  }

  let parsedCount = 0;
  const stream = Stream.fromSSEResponse<BenchmarkPayload>(createResponse(fixture), new AbortController());
  for await (const event of stream) {
    const expected = fixture.expected[parsedCount]?.payload;
    if (!expected || event.index !== expected.index || event.text !== expected.text) {
      throw new Error(`SSE JSON stream produced unexpected event ${parsedCount} for ${fixture.label}`);
    }
    parsedCount++;
  }
  if (parsedCount !== fixture.expected.length) {
    throw new Error(`SSE JSON stream produced ${parsedCount} events for ${fixture.label}`);
  }
}

describe.each(FIXTURES)('SSE streaming: $label', (fixture) => {
  beforeAll(async () => {
    await verifyFixture(fixture);
  });

  bench(
    'decode SSE frames',
    async () => {
      let consumed = 0;
      for await (const event of _iterSSEMessages(createResponse(fixture), new AbortController())) {
        consumed += event.data.length;
      }
      benchmarkSink ^= consumed;
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'decode and parse SSE JSON',
    async () => {
      let consumed = 0;
      const stream = Stream.fromSSEResponse<BenchmarkPayload>(createResponse(fixture), new AbortController());
      for await (const event of stream) {
        consumed += event.text.length + event.index;
      }
      benchmarkSink ^= consumed;
    },
    BENCHMARK_OPTIONS,
  );
});
