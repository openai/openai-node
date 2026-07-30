import { bench, describe } from 'vitest';
import { z as zodV3 } from 'zod/v3';
import { z as zodV4 } from 'zod/v4';

import OpenAI from '../../src';
import { partialParse } from '../../src/_vendor/partial-json-parser/parser';
import { zodResponseFormat, zodTextFormat } from '../../src/helpers/zod';
import { toFloat32Array } from '../../src/internal/utils/base64';
import base64EmbeddingFixture from '../api-resources/embeddings-base64-response.json';
import floatEmbeddingFixture from '../api-resources/embeddings-float-response.json';

const BENCHMARK_OPTIONS = {
  iterations: 10,
  time: 150,
  warmupIterations: 3,
  warmupTime: 50,
} as const;

const STEP_COUNT = 32;
const STREAM_CHUNK_SIZE = 128;

const stepSchemaV3 = zodV3.object({
  index: zodV3.number().int(),
  explanation: zodV3.string(),
  evidence: zodV3.object({ source: zodV3.string(), score: zodV3.number() }),
  tags: zodV3.array(zodV3.string()),
});

const structuredOutputSchemaV3 = zodV3.object({
  request_id: zodV3.string(),
  final_answer: zodV3.string(),
  steps: zodV3.array(stepSchemaV3),
  metadata: zodV3.object({ version: zodV3.number().int(), category: zodV3.enum(['analysis', 'summary']) }),
});

const stepSchemaV4 = zodV4.object({
  index: zodV4.number().int(),
  explanation: zodV4.string(),
  evidence: zodV4.object({ source: zodV4.string(), score: zodV4.number() }),
  tags: zodV4.array(zodV4.string()),
});

const structuredOutputSchemaV4 = zodV4.object({
  request_id: zodV4.string(),
  final_answer: zodV4.string(),
  steps: zodV4.array(stepSchemaV4),
  metadata: zodV4.object({ version: zodV4.number().int(), category: zodV4.enum(['analysis', 'summary']) }),
});

const structuredOutputFixture = {
  request_id: 'request-benchmark-001',
  final_answer: 'Deterministic structured output benchmark result.',
  steps: Array.from({ length: STEP_COUNT }, (_, index) => ({
    index,
    explanation: `Step ${index}: verify the bounded deterministic structured-output workload.`,
    evidence: { source: `fixture-${index % 4}`, score: index / STEP_COUNT },
    tags: [`group-${index % 4}`, `step-${index}`],
  })),
  metadata: { version: 1, category: 'analysis' as const },
};

const structuredOutputJSON = JSON.stringify(structuredOutputFixture);
const partialStructuredOutputJSON = structuredOutputJSON.slice(0, -1);
const progressiveStructuredOutputJSON: string[] = [];

for (let offset = STREAM_CHUNK_SIZE; offset < structuredOutputJSON.length; offset += STREAM_CHUNK_SIZE) {
  progressiveStructuredOutputJSON.push(structuredOutputJSON.slice(0, offset));
}
progressiveStructuredOutputJSON.push(structuredOutputJSON);

const responseFormat = zodResponseFormat(structuredOutputSchemaV4, 'benchmark_structured_output', {
  schemaDefinitions: { Step: stepSchemaV4 },
});
const textFormat = zodTextFormat(structuredOutputSchemaV4, 'benchmark_structured_output');

const chatCompletionResponse = JSON.stringify({
  id: 'chatcmpl-benchmark-001',
  object: 'chat.completion',
  created: 1,
  model: 'gpt-4o-mini',
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      logprobs: null,
      message: { role: 'assistant', content: structuredOutputJSON, refusal: null },
    },
  ],
  usage: { prompt_tokens: 12, completion_tokens: 128, total_tokens: 140 },
});

const structuredOutputClient = createFixtureClient(chatCompletionResponse);
const structuredOutputRequest = {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user' as const, content: 'Return the deterministic benchmark fixture.' }],
  response_format: responseFormat,
};

describe('structured output', () => {
  bench(
    'generate a strict response schema with reusable definitions (Zod v3)',
    () => {
      zodResponseFormat(structuredOutputSchemaV3, 'benchmark_structured_output', {
        schemaDefinitions: { Step: stepSchemaV3 },
      });
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'generate a strict response schema with reusable definitions (Zod v4)',
    () => {
      zodResponseFormat(structuredOutputSchemaV4, 'benchmark_structured_output', {
        schemaDefinitions: { Step: stepSchemaV4 },
      });
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'parse and validate a structured response format',
    () => {
      assertStepCount(responseFormat.$parseRaw(structuredOutputJSON));
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'parse and validate a structured text format',
    () => {
      assertStepCount(textFormat.$parseRaw(structuredOutputJSON));
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'parse structured output through the public chat completions API',
    async () => {
      const completion = await structuredOutputClient.chat.completions.parse(structuredOutputRequest);
      assertStepCount(completion.choices[0]?.message.parsed);
    },
    BENCHMARK_OPTIONS,
  );
});

describe('partial JSON parsing', () => {
  bench(
    'JSON.parse complete structured output',
    () => {
      assertStepCount(JSON.parse(structuredOutputJSON));
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'partialParse complete structured output',
    () => {
      assertStepCount(partialParse(structuredOutputJSON));
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'partialParse incomplete structured output',
    () => {
      assertStepCount(partialParse(partialStructuredOutputJSON));
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'partialParse progressive 128-byte streaming chunks',
    () => {
      let parsed: unknown;
      for (const chunk of progressiveStructuredOutputJSON) {
        parsed = partialParse(chunk);
      }
      assertStepCount(parsed);
    },
    BENCHMARK_OPTIONS,
  );
});

const base64EmbeddingResponse = JSON.stringify(base64EmbeddingFixture);
const floatEmbeddingResponse = JSON.stringify(floatEmbeddingFixture);
const base64Embedding = base64EmbeddingFixture.data[0]!.embedding;
const embeddingDimensions = floatEmbeddingFixture.data[0]!.embedding.length;

const base64EmbeddingClient = createFixtureClient(base64EmbeddingResponse);
const floatEmbeddingClient = createFixtureClient(floatEmbeddingResponse);
const embeddingRequest = { model: 'text-embedding-3-large', input: 'deterministic embedding benchmark' };

describe(`embeddings (${embeddingDimensions} dimensions)`, () => {
  bench(
    'decode a base64 Float32 embedding',
    () => {
      assertEmbeddingDimensions(toFloat32Array(base64Embedding));
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'parse a float-encoded embedding response',
    () => {
      const response = JSON.parse(floatEmbeddingResponse) as typeof floatEmbeddingFixture;
      assertEmbeddingDimensions(response.data[0]?.embedding);
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'parse and decode a base64-encoded embedding response',
    () => {
      const response = JSON.parse(base64EmbeddingResponse) as typeof base64EmbeddingFixture;
      assertEmbeddingDimensions(toFloat32Array(response.data[0]!.embedding));
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'embeddings.create default base64 response and Float32 conversion',
    async () => {
      const response = await base64EmbeddingClient.embeddings.create(embeddingRequest);
      assertEmbeddingDimensions(response.data[0]?.embedding);
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'embeddings.create explicit float response',
    async () => {
      const response = await floatEmbeddingClient.embeddings.create({
        ...embeddingRequest,
        encoding_format: 'float',
      });
      assertEmbeddingDimensions(response.data[0]?.embedding);
    },
    BENCHMARK_OPTIONS,
  );
});

function createFixtureClient(responseBody: string): OpenAI {
  return new OpenAI({
    apiKey: 'benchmark-api-key',
    baseURL: 'https://sdk-benchmark.invalid/v1',
    maxRetries: 0,
    fetch: async () =>
      new Response(responseBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });
}

function assertStepCount(value: unknown): void {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('steps' in value) ||
    !Array.isArray(value.steps) ||
    value.steps.length !== STEP_COUNT
  ) {
    throw new Error(`Expected a deterministic structured response with ${STEP_COUNT} steps.`);
  }
}

function assertEmbeddingDimensions(value: number[] | undefined): void {
  if (value?.length !== embeddingDimensions) {
    throw new Error(`Expected a deterministic ${embeddingDimensions}-dimension embedding.`);
  }
}
