/* oxlint-disable no-await-in-loop -- Complete and dispose one browser workflow before starting the next fixture/API. */
import { strict as assert } from 'node:assert';
import OpenAI from 'openai';
import { serve, openWorkflow } from './workflow.mjs';

const server = await serve();
try {
  for (const api of ['responses', 'decisions']) {
    for (const [variant, labels] of [
      ['A', ['Open REQ-401', 'Reserve R2 Garden', 'Outgoing', 'Send REQ-401 to cedar@example.test']],
      ['B', ['Open REQ-718', 'Reserve T2 Garden', 'Outgoing', 'Send REQ-718 to aster@example.test']],
    ]) {
      const w = await openWorkflow(server, variant, { confirm: async () => true });
      let requests = 0;
      let phase = 0;
      try {
        const client = new OpenAI({
          apiKey: 'synthetic-not-a-key',
          baseURL: 'http://workflow.invalid/v1',
          maxRetries: 0,
          fetch: async (url, options) => {
            assert.match(String(url), /workflow\.invalid\/v1\/(?:responses|decisions)$/u);
            const body = JSON.parse(options.body);
            const step = requests;
            requests += 1;
            if (api === 'decisions') {
              const observation = JSON.parse(body.input[1].content);
              assert.equal(observation.priorActions.length, Math.min(step, labels.length));
              const [question] = body.questions;
              const { choices } = question;
              const choice =
                step === labels.length
                  ? 'done'
                  : choices.find((c) => c.description === `Click ${labels[step]}`).value;
              return Response.json({
                object: 'decision',
                id: `d_${step}`,
                model: '',
                answers: [
                  {
                    name: 'next_action',
                    type: 'choice',
                    choice,
                    confidence: 1,
                    probabilities: [{ value: choice, probability: 1 }],
                  },
                ],
                usage: {
                  input_tokens: 0,
                  output_tokens: 0,
                  total_tokens: 0,
                  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
                  output_tokens_details: { reasoning_tokens: 0 },
                },
              });
            }
            const response = {
              id: `resp_${step}`,
              object: 'response',
              created_at: 0,
              status: 'completed',
              model: '',
            };
            if (phase === labels.length * 2) {
              return Response.json({
                ...response,
                output: [
                  {
                    id: `msg_${step}`,
                    type: 'message',
                    role: 'assistant',
                    status: 'completed',
                    phase: 'final_answer',
                    content: [{ type: 'output_text', text: 'Booking sent.', annotations: [] }],
                  },
                ],
              });
            }
            let member = phase % 2 ? 'click' : 'read_page';
            let args = { tab_id: null, filter: 'all' };
            if (member === 'click') {
              const last = body.input.at(-1);
              assert.equal(last.type, 'function_call_output');
              const observation = JSON.parse(last.output[0].text);
              if (observation.ok) {
                const target = observation.result.elements.find(
                  (e) => e.label === labels[Math.floor(phase / 2)],
                ).ref;
                args = { tab_id: null, target };
                phase += 1;
              } else {
                assert.match(observation.error, /changed during|Read again/iu);
                member = 'read_page';
              }
            } else {
              phase += 1;
            }
            return Response.json({
              ...response,
              output: [
                {
                  type: 'function_call',
                  id: `fc_${step}`,
                  call_id: `call_${step}`,
                  name: `browser_${member}`,
                  arguments: JSON.stringify(args),
                  status: 'completed',
                },
              ],
            });
          },
        });
        const result = await w.run(client, '', api);
        assert.equal(result.status, 'verified', `${api} ${variant}`);
        assert.equal(w.metrics.requests, requests, 'receipt counts actual SDK requests');
        assert.ok(w.metrics.calls.length >= labels.length, 'receipt records observed SDK effects/selections');
        assert.ok(api === 'decisions' ? requests === 5 : requests >= 9 && requests <= 16);
      } finally {
        await w.close();
      }
      console.log(`PASS ${api} ${variant} real browser via mocked SDK transport`);
    }
  }
} finally {
  await server.close();
}
