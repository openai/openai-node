import { bench, beforeAll, describe } from 'vitest';

import OpenAI from '../../src';
import { buildHeaders } from '../../src/internal/headers';
import type { HeadersLike } from '../../src/internal/headers';
import { stringifyQuery } from '../../src/internal/utils/query';

const BENCHMARK_OPTIONS = {
  iterations: 10,
  time: 100,
  warmupIterations: 3,
  warmupTime: 30,
} as const;

const BASIC_HEADER_LAYERS: HeadersLike[] = [
  {
    Accept: 'application/json',
    'User-Agent': 'OpenAI/JS benchmark',
    'X-Stainless-Retry-Count': '0',
  },
  { Authorization: 'Bearer benchmark-api-key' },
];

const LAYERED_REQUEST_HEADERS: HeadersLike[] = [
  ...BASIC_HEADER_LAYERS,
  {
    'OpenAI-Organization': 'org_benchmark',
    'OpenAI-Project': 'proj_benchmark',
  },
  {
    'OpenAI-Beta': 'assistants=v2',
    'X-Request-Origin': 'client-default',
    'X-Trace-ID': 'trace-default',
  },
  {
    'openai-beta': null,
    'x-request-origin': 'per-request',
    'X-Trace-ID': 'trace-request',
    Cookie: ['session=benchmark', 'route=primary'],
  },
];

const FLAT_QUERY = {
  limit: 50,
  after: 'file_0009',
  order: 'desc',
  purpose: 'fine-tune',
};

const NESTED_QUERY = {
  ...FLAT_QUERY,
  locale: 'en-GB',
  filters: {
    status: ['uploaded', 'processed', 'error'],
    created_at: { gte: 1_700_000_000, lte: 1_700_086_400 },
    owner: { organization: 'org_benchmark', project: 'proj_benchmark' },
  },
  metadata: { source: 'fixture/import', trace: 'batch 001' },
};

const CHAT_REQUEST = {
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system' as const, content: 'Return a short deterministic benchmark response.' },
    ...Array.from({ length: 8 }, (_, index) => ({
      role: 'user' as const,
      content: `Benchmark message ${index}: ${'representative SDK request payload. '.repeat(4)}`,
    })),
  ],
  temperature: 0,
  metadata: { benchmark: 'request-preparation', workload: 'deterministic' },
};

const CHAT_RESPONSE = JSON.stringify({
  id: 'chatcmpl-request-benchmark',
  object: 'chat.completion',
  created: 1,
  model: CHAT_REQUEST.model,
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Benchmark complete.', refusal: null },
      finish_reason: 'stop',
      logprobs: null,
    },
  ],
  usage: { prompt_tokens: 128, completion_tokens: 4, total_tokens: 132 },
});

const requestClient = new OpenAI({
  apiKey: 'benchmark-api-key',
  organization: 'org_benchmark',
  project: 'proj_benchmark',
  baseURL: 'https://sdk-benchmark.invalid/v1',
  maxRetries: 0,
  defaultQuery: { locale: 'en-US', api_version: '2026-01-01' },
  defaultHeaders: {
    'OpenAI-Beta': 'assistants=v2',
    'X-Request-Origin': 'client-default',
    'X-Trace-ID': 'trace-default',
  },
  fetch: async () =>
    new Response(CHAT_RESPONSE, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
});

const LIST_REQUEST_OPTIONS = {
  method: 'get' as const,
  path: '/files?view=active',
  query: NESTED_QUERY,
  headers: { 'OpenAI-Beta': null, 'X-Request-Origin': 'per-request' },
};

const CHAT_REQUEST_OPTIONS = {
  method: 'post' as const,
  path: '/chat/completions',
  body: CHAT_REQUEST,
  headers: { 'X-Request-Origin': 'per-request' },
};

let benchmarkSink = 0;

beforeAll(async () => {
  const mergedHeaders = buildHeaders(LAYERED_REQUEST_HEADERS);
  if (
    mergedHeaders.values.get('authorization') !== 'Bearer benchmark-api-key' ||
    mergedHeaders.values.get('x-request-origin') !== 'per-request' ||
    mergedHeaders.values.get('cookie') !== 'session=benchmark; route=primary' ||
    !mergedHeaders.nulls.has('openai-beta')
  ) {
    throw new Error('Request header benchmark fixture did not merge correctly.');
  }

  const nestedQuery = new URLSearchParams(stringifyQuery(NESTED_QUERY));
  if (
    nestedQuery.getAll('filters[status][]').join(',') !== 'uploaded,processed,error' ||
    nestedQuery.get('filters[owner][organization]') !== 'org_benchmark' ||
    nestedQuery.get('metadata[source]') !== 'fixture/import'
  ) {
    throw new Error('Nested query benchmark fixture did not serialize correctly.');
  }

  const listRequest = await requestClient.buildRequest(LIST_REQUEST_OPTIONS);
  const listURL = new URL(listRequest.url);
  if (
    listURL.searchParams.get('view') !== 'active' ||
    listURL.searchParams.get('locale') !== 'en-GB' ||
    listURL.searchParams.get('api_version') !== '2026-01-01' ||
    listRequest.req.headers.get('x-request-origin') !== 'per-request' ||
    listRequest.req.headers.has('openai-beta')
  ) {
    throw new Error('GET request benchmark fixture did not preserve request options.');
  }

  const chatRequest = await requestClient.buildRequest(CHAT_REQUEST_OPTIONS);
  if (
    chatRequest.req.headers.get('content-type') !== 'application/json' ||
    typeof chatRequest.req.body !== 'string' ||
    JSON.parse(chatRequest.req.body).messages.length !== CHAT_REQUEST.messages.length
  ) {
    throw new Error('JSON request benchmark fixture did not encode correctly.');
  }

  const completion = await requestClient.chat.completions.create(CHAT_REQUEST);
  if (completion.choices[0]?.message.content !== 'Benchmark complete.') {
    throw new Error('In-memory request benchmark fixture returned an unexpected completion.');
  }
});

describe('request header preparation', () => {
  bench(
    'build standard authentication and SDK headers',
    () => {
      const headers = buildHeaders(BASIC_HEADER_LAYERS);
      benchmarkSink += headers.values.get('authorization')?.length ?? 0;
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'merge layered defaults, overrides, removals, and cookie values',
    () => {
      const headers = buildHeaders(LAYERED_REQUEST_HEADERS);
      benchmarkSink += headers.values.get('cookie')?.length ?? 0;
    },
    BENCHMARK_OPTIONS,
  );
});

describe('request query serialization', () => {
  bench(
    'serialize flat pagination parameters',
    () => {
      benchmarkSink += stringifyQuery(FLAT_QUERY).length;
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'serialize nested filters and bracket-array parameters',
    () => {
      benchmarkSink += stringifyQuery(NESTED_QUERY).length;
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'build a URL with default and flat query parameters',
    () => {
      benchmarkSink += requestClient.buildURL('/files', FLAT_QUERY).length;
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'build a URL with existing, default, and nested query parameters',
    () => {
      benchmarkSink += requestClient.buildURL('/files?view=active&locale=path-default', NESTED_QUERY).length;
    },
    BENCHMARK_OPTIONS,
  );
});

describe('complete request preparation', () => {
  bench(
    'build an authenticated GET request with nested query parameters',
    async () => {
      const request = await requestClient.buildRequest(LIST_REQUEST_OPTIONS);
      benchmarkSink += request.url.length;
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'build an authenticated JSON POST request',
    async () => {
      const request = await requestClient.buildRequest(CHAT_REQUEST_OPTIONS);
      benchmarkSink += request.req.headers.get('content-length')?.length ?? request.url.length;
    },
    BENCHMARK_OPTIONS,
  );

  bench(
    'send a public chat completions request through in-memory fetch',
    async () => {
      const completion = await requestClient.chat.completions.create(CHAT_REQUEST);
      benchmarkSink += completion.choices[0]?.message.content?.length ?? 0;
    },
    BENCHMARK_OPTIONS,
  );
});
