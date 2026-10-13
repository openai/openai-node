import OpenAI from 'openai';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';
import type { ResponsesRunnerCheckpoint } from 'openai/helpers/responses-tool-runner';
import { expect, test } from 'vitest';

const message = {
  id: 'msg_fixture',
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text: 'done', annotations: [] }],
};

const fileCases = [
  { fields: { file_data: 42 }, accepted: false },
  { fields: { file_id: 42 }, accepted: false },
  { fields: { file_url: 42 }, accepted: false },
  { fields: { filename: 42 }, accepted: false },
  { fields: { detail: 'original' }, accepted: false },
  { fields: { detail: null }, accepted: false },
  { fields: { file_data: null }, accepted: false },
  { fields: { file_url: null }, accepted: false },
  { fields: { filename: null }, accepted: false },
  { fields: { prompt_cache_breakpoint: null }, accepted: false },
  { fields: { prompt_cache_breakpoint: {} }, accepted: false },
  { fields: { prompt_cache_breakpoint: { mode: 'automatic' } }, accepted: false },
  { fields: {}, accepted: true },
  { fields: { file_id: null }, accepted: true },
  {
    fields: {
      file_data: '',
      file_id: null,
      file_url: '',
      filename: '',
      detail: 'auto',
      prompt_cache_breakpoint: { mode: 'explicit' },
      extension: 'retained',
    },
    accepted: true,
  },
].map(({ fields, accepted }) => ({
  replay: { role: 'user', content: [{ type: 'input_file', ...fields }] },
  accepted,
}));

const replayCases = [
  ...fileCases,
  { replay: { role: 'user', content: 'plain text' }, accepted: true },
  { replay: message, accepted: true },
  { replay: { role: 'assistant', content: [{ type: 'input_text', text: '' }] }, accepted: true },
  { replay: { role: 'assistant', content: 'old output', phase: 'unsupported' }, accepted: false },
  {
    replay: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'input_text', text: 'old output' }],
      phase: 'unsupported',
    },
    accepted: false,
  },
  { replay: { type: 'message', role: 'user', content: 'plain text', phase: 42 }, accepted: false },
  { replay: { role: 'assistant', content: 'old output', phase: null }, accepted: true },
  {
    replay: { type: 'message', role: 'assistant', content: 'old output', phase: 'commentary' },
    accepted: true,
  },
  {
    replay: { role: 'assistant', content: [{ type: 'input_text', text: '' }], phase: 'final_answer' },
    accepted: true,
  },
  { replay: { role: 'user', content: 'plain text', phase: null }, accepted: true },
  {
    replay: { role: 'system', content: [{ type: 'input_text', text: 'instruction' }], phase: 'extension' },
    accepted: true,
  },
  {
    replay: {
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: 'instruction' }],
      phase: { opaque: true },
    },
    accepted: true,
  },
  { replay: { role: 'user', content: [{ type: 'input_text', text: 42 }] }, accepted: false },
  {
    replay: { role: 'user', content: [{ type: 'input_text', text: '', prompt_cache_breakpoint: null }] },
    accepted: false,
  },
  {
    replay: { role: 'user', content: [{ type: 'input_text', text: '', prompt_cache_breakpoint: {} }] },
    accepted: false,
  },
  {
    replay: {
      role: 'system',
      content: [
        {
          type: 'input_text',
          text: '',
          prompt_cache_breakpoint: { mode: 'explicit', extension: 'nested' },
          extension: 'retained',
        },
      ],
    },
    accepted: true,
  },
  {
    replay: { role: 'user', content: [{ type: 'input_image', detail: 'low', image_url: 42 }] },
    accepted: false,
  },
  {
    replay: { role: 'user', content: [{ type: 'input_image', detail: 'high', file_id: 42 }] },
    accepted: false,
  },
  { replay: { role: 'user', content: [{ type: 'input_image' }] }, accepted: false },
  { replay: { role: 'user', content: [{ type: 'input_image', detail: null }] }, accepted: false },
  { replay: { role: 'user', content: [{ type: 'input_image', detail: 'auto' }] }, accepted: true },
  {
    replay: {
      role: 'user',
      content: [{ type: 'input_image', detail: 'low', prompt_cache_breakpoint: null }],
    },
    accepted: false,
  },
  {
    replay: {
      role: 'user',
      content: [{ type: 'input_image', detail: 'high', prompt_cache_breakpoint: { mode: 'automatic' } }],
    },
    accepted: false,
  },
  {
    replay: {
      role: 'user',
      content: [{ type: 'input_image', detail: 'low', image_url: null, file_id: null }],
    },
    accepted: true,
  },
  {
    replay: {
      role: 'developer',
      content: [
        {
          type: 'input_image',
          detail: 'original',
          image_url: '',
          file_id: '',
          prompt_cache_breakpoint: { mode: 'explicit' },
          extension: 'retained',
        },
      ],
    },
    accepted: true,
  },
];

test.each(replayCases.flatMap((entry) => ['fresh', 'resume'].map((mode) => ({ ...entry, mode }))))(
  'native $mode message inputs preserve their generated semantics: $replay',
  async ({ replay, accepted, mode }) => {
    const saved: ResponsesRunnerCheckpoint = {
      version: 1,
      run_id: 'input-run',
      revision: 1,
      phase: 'boundary',
      max_steps: 3,
      consumed_requests: 1,
      tools: [],
      output_override_names: [],
      history: [],
      attempted_call_ids: [],
      returned_call_ids: [],
      pending_items: [],
      returned_outputs: [],
      final_response: null,
    };
    Reflect.set(saved, 'history', [replay]);
    const requests: unknown[] = [];
    let saves = 0;
    const client = new OpenAI({
      apiKey: 'synthetic-test-key',
      maxRetries: 0,
      fetch: async (url, options) => {
        requests.push(await new Request(url, options).json());
        return Response.json({
          id: 'resp_fixture',
          object: 'response',
          status: 'completed',
          output: [{ ...message, id: 'msg_next_response' }],
        });
      },
    });
    const params = { model: '', input: 'current observation' };
    if (mode === 'fresh') {
      Reflect.set(params, 'input', [replay]);
    }
    const run = new ResponsesToolRunner({}).run(client, params, {
      ledger: {
        runId: 'input-run',
        save() {
          saves += 1;
        },
        ...(mode === 'resume' && { resumeFrom: saved }),
      },
    });
    if (accepted) {
      await expect(run).resolves.toMatchObject({ status: 'completed' });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ input: expect.arrayContaining([replay]) });
      expect(saves).toBeGreaterThan(0);
    } else {
      await expect(run).rejects.toThrow();
      expect(requests).toHaveLength(0);
      expect(saves).toBe(0);
    }
  },
);
