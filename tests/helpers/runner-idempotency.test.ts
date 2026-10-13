import OpenAI from 'openai';
import { DecisionsToolRunner } from 'openai/helpers/decisions-tool-runner';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';
import type { ResponsesRunnerCheckpoint } from 'openai/helpers/responses-tool-runner';
import { expect, test } from 'vitest';

test.each(
  (['responses', 'decisions'] as const).flatMap((api) =>
    (['default', 'request', 'remove', 'none'] as const).map((source) => ({ api, source })),
  ),
)('$api rotates $source idempotency keys between turns, not retries', async ({ api, source }) => {
  const sent: Headers[] = [];
  const actions: string[] = [];
  const client = new OpenAI({
    apiKey: 'synthetic-test-key',
    maxRetries: 1,
    defaultHeaders: { 'x-kept': 'yes', ...(source === 'none' ? {} : { 'Idempotency-Key': 'client-first' }) },
    fetch: async (url, init) => {
      sent.push(new Request(url, init).headers);
      if (sent.length === 1 || sent.length === 3) {
        return Response.json(
          { error: { message: 'retry this request' } },
          { status: 500, headers: { 'retry-after-ms': '0' } },
        );
      }
      if (api === 'decisions') {
        return Response.json({
          model: '',
          answers: [
            {
              type: 'choice',
              name: 'next_action',
              choice: actions.length ? 'done' : 'act',
              confidence: 1,
              probabilities: [],
            },
          ],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
            input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        });
      }
      return Response.json({
        id: `resp_${actions.length}`,
        object: 'response',
        status: 'completed',
        output: actions.length
          ? [
              {
                id: 'message',
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'done', annotations: [] }],
              },
            ]
          : [
              {
                id: 'item',
                type: 'function_call',
                call_id: 'call',
                name: 'act',
                arguments: '{}',
                status: 'completed',
              },
            ],
      });
    },
  });
  const requestOptions = {
    headers: {
      default: {},
      none: {},
      request: { 'idempotency-key': 'request-first' },
      remove: { 'idempotency-key': null },
    }[source],
  };
  const execute = () => {
    actions.push('act');
    return 'done';
  };
  await (api === 'responses'
    ? new ResponsesToolRunner({
        functions: [{ tool: { type: 'function', name: 'act', parameters: {}, strict: false }, execute }],
      }).run(client, { input: 'fixture' }, { requestOptions })
    : new DecisionsToolRunner({
        observe: () => actions.join(','),
        candidates: () => [
          {
            id: 'act',
            description: 'Act',
            execute: () => {
              execute();
            },
          },
          { id: 'done', description: 'Done', done: true },
        ],
      }).run(client, { model: '', input: 'fixture' }, { requestOptions }));
  expect(actions).toEqual(['act']);
  expect(sent).toHaveLength(4);
  const keys = sent.map((headers) => headers.get('idempotency-key'));
  if (source === 'none' || source === 'remove') {
    expect(keys).toEqual([null, null, null, null]);
  } else {
    const first = source === 'request' ? 'request-first' : 'client-first';
    expect(keys.slice(0, 2)).toEqual([first, first]);
    expect(keys[2]).toBeTruthy();
    expect(keys[2]).not.toBe(first);
    expect(keys[3]).toBe(keys[2]);
  }
  expect(sent.map((headers) => headers.get('x-kept'))).toEqual(['yes', 'yes', 'yes', 'yes']);
});

test('Responses ledger resume uses a fresh key without changing its source checkpoint or headers', async () => {
  const sent: Headers[] = [];
  const checkpoints: ResponsesRunnerCheckpoint[] = [];
  const actions: string[] = [];
  const defaults = { 'Idempotency-Key': 'initial-request', 'x-kept': 'default' };
  const headers = { 'x-run': 'run' };
  const client = new OpenAI({
    apiKey: 'synthetic-test-key',
    defaultHeaders: defaults,
    fetch: async (url, init) => {
      sent.push(new Request(url, init).headers);
      return Response.json({
        id: `resp_${sent.length}`,
        object: 'response',
        status: 'completed',
        output:
          sent.length === 1
            ? [
                {
                  id: 'item',
                  type: 'function_call',
                  call_id: 'call',
                  name: 'act',
                  arguments: '{}',
                  status: 'completed',
                },
              ]
            : [
                {
                  id: 'message',
                  type: 'message',
                  role: 'assistant',
                  status: 'completed',
                  content: [{ type: 'output_text', text: 'done', annotations: [] }],
                },
              ],
      });
    },
  });
  const runner = new ResponsesToolRunner({
    functions: [
      {
        tool: { type: 'function', name: 'act', parameters: {}, strict: false },
        execute() {
          actions.push('act');
          return 'done';
        },
      },
    ],
  });
  const ledger = {
    runId: 'resume-key',
    save(checkpoint: ResponsesRunnerCheckpoint) {
      checkpoints.push(structuredClone(checkpoint));
    },
  };
  const params = { input: 'fixture' };
  await runner.run(client, params, { ledger, requestOptions: { headers } });
  const boundary = checkpoints.find(
    (checkpoint) =>
      checkpoint.phase === 'boundary' &&
      checkpoint.consumed_requests > 0 &&
      checkpoint.returned_call_ids.includes('call'),
  );
  if (!boundary) {
    throw new Error('Missing saved boundary after the local effect');
  }
  const before = structuredClone({ boundary, defaults, headers });
  const resumed: ResponsesRunnerCheckpoint[] = [];
  await runner.run(client, params, {
    ledger: {
      runId: ledger.runId,
      resumeFrom: boundary,
      save(checkpoint) {
        resumed.push(checkpoint);
      },
    },
    requestOptions: { headers },
  });
  expect(sent).toHaveLength(3);
  expect(sent[0]?.get('idempotency-key')).toBe('initial-request');
  expect(sent[2]?.get('idempotency-key')).toBeTruthy();
  expect(sent[2]?.get('idempotency-key')).not.toBe('initial-request');
  expect(sent[2]?.get('x-kept')).toBe('default');
  expect(sent[2]?.get('x-run')).toBe('run');
  expect(actions).toEqual(['act']);
  expect(resumed.some((checkpoint) => checkpoint.phase === 'final')).toBe(true);
  expect({ boundary, defaults, headers }).toEqual(before);
});
