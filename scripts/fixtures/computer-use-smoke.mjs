// Copied into an installed-package consumer by test-packed-package.ts.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
function unexpected() {
  throw new Error('Unexpected computer action');
}

async function main() {
  const [mode] = process.argv.slice(2);
  assert.ok(mode === 'cjs' || mode === 'esm');
  const load = mode === 'cjs' ? require : (name) => import(name);
  const root = await load('openai');
  const OpenAI = root.default || root;
  const { ComputerToolset } = await load('openai/helpers/computer');
  const { BrowserToolset } = await load('openai/helpers/browser');
  const { ResponsesToolRunner, ResponsesToolRunnerError } = await load(
    'openai/helpers/responses-tool-runner',
  );
  assert.equal(root.ComputerToolset, ComputerToolset);

  const effects = [];
  const image = { type: 'computer_screenshot', image_url: 'data:image/png;base64,cG5n' };
  const computer = new ComputerToolset({
    click: unexpected,
    double_click: unexpected,
    drag: unexpected,
    keypress: unexpected,
    move: unexpected,
    scroll: unexpected,
    type: unexpected,
    wait() {
      effects.push('wait');
    },
    screenshot() {
      effects.push('screenshot');
      return image;
    },
  });
  const browser = new BrowserToolset(
    {
      state: () => ({
        tabs: [{ id: 'one', title: 'Receipt', url: 'https://fixture.invalid/', active: true }],
      }),
      read_page() {
        effects.push('read');
        return 'receipt ready';
      },
    },
    { members: ['read_page'] },
  );
  const runner = new ResponsesToolRunner({ browser, computer });
  const bodies = [];
  let checkpoint;
  let resume = false;
  const client = new OpenAI({
    apiKey: 'synthetic-unused',
    maxRetries: 0,
    baseURL: 'http://fixture.invalid/v1',
    fetch: (_url, init) => {
      bodies.push(JSON.parse(init.body));
      const output = resume
        ? [
            {
              type: 'message',
              id: 'msg_one',
              status: 'completed',
              role: 'assistant',
              phase: 'final_answer',
              content: [{ type: 'output_text', text: 'complete', annotations: [] }],
            },
          ]
        : [
            {
              type: 'function_call',
              id: 'fc_read',
              call_id: 'read',
              name: 'browser_read_page',
              status: 'completed',
              arguments: '{"tab_id":null,"filter":"all"}',
            },
            {
              type: 'computer_call',
              id: 'cu_one',
              call_id: 'native_one',
              status: 'completed',
              actions: [{ type: 'wait' }],
            },
          ];
      return Promise.resolve(
        Response.json({
          id: `resp_${bodies.length}`,
          object: 'response',
          created_at: 0,
          model: '',
          status: 'completed',
          output,
        }),
      );
    },
  });
  const save = (value) => {
    checkpoint = value;
    // The recorder has committed a resumable boundary before losing its acknowledgement.
    if (!resume && value.phase === 'boundary' && value.returned_call_ids.length) {
      throw new Error('Synthetic lost acknowledgement');
    }
  };
  const params = { model: '', input: 'Process the receipt', store: false };
  await assert.rejects(
    runner.run(client, params, { maxSteps: 3, ledger: { runId: 'package-smoke', save } }),
    ResponsesToolRunnerError,
  );
  assert.equal(bodies.length, 1);
  assert.equal(checkpoint.phase, 'boundary');
  assert.deepEqual(checkpoint.returned_call_ids, ['read', 'native_one']);
  assert.deepEqual(effects, ['read', 'wait', 'screenshot']);
  const previous = checkpoint;
  resume = true;
  const fresh = [{ role: 'user', content: [{ type: 'input_text', text: 'Continue' }] }];
  const final = await runner.run(
    client,
    { ...params, input: fresh },
    {
      ledger: { runId: 'package-smoke', save, resumeFrom: previous },
    },
  );
  assert.equal(final.output_text, 'complete');
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1].input, [...previous.history, ...fresh]);
  const returned = bodies[1].input.filter((item) => item.type?.endsWith('_call_output'));
  assert.deepEqual(
    returned.map((item) => item.call_id),
    ['read', 'native_one'],
  );
  assert.equal(JSON.parse(returned[0].output[0].text).result, 'receipt ready');
  assert.deepEqual(returned[1].output, image);
  assert.deepEqual(effects, ['read', 'wait', 'screenshot']);
  console.log(`Installed computer-use smoke ${mode}: PASS`);
}

await main();
