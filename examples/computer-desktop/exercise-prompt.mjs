import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const [mode = 'prompt'] = process.argv.slice(2);
assert.ok(mode === 'prompt' || mode === 'active' || mode === 'verify');
const cases = {
  prompt: [
    'Approve the pending action?',
    'PASS Stop aborts the in-run prompt, drains policy, then cleans up its guest',
  ],
  active: ['REQUEST_ACTIVE', 'PASS Stop aborts the active operation, drains work, then cleans up its guest'],
  verify: ['SEAL_ACTIVE', 'PASS Stop prevents publishing a cancelled final verification'],
};
const preload = `
import { once } from 'node:events';
import { Desktop } from ${JSON.stringify(new URL('desktop.mjs', import.meta.url).href)};
let finish;
const drained = new Promise((resolve) => { finish = resolve; });
Desktop.create = async () => ({
  async withComputer(work, options = {}) {
    try {
      const signal = options.signal ?? new AbortController().signal;
      return await work({
        run: async (_client, _params, options) => {
          if (${JSON.stringify(mode)} === 'active') {
            const interrupted = once(options.signal, 'abort', { signal: AbortSignal.timeout(2500) });
            process.stdout.write('REQUEST_ACTIVE\\n');
            await interrupted;
            process.stdout.write('REQUEST_CANCELLED\\n');
            options.signal.throwIfAborted();
          } else if (${JSON.stringify(mode)} === 'prompt') {
            await options.approveSafetyChecks({}, { signal });
          }
        },
      }, signal);
    } finally { finish(); process.stdout.write('POLICY_DRAINED\\n'); }
  },
  async stop() { await drained; process.stdout.write('DESKTOP_STOPPED\\n'); },
  async seal({ signal } = {}) {
    process.stdout.write('SEAL_ACTIVE\\n');
    if (signal) {
      await once(signal, 'abort', { signal: AbortSignal.timeout(2500) });
      process.stdout.write('SEAL_CANCELLED\\n');
      signal.throwIfAborted();
    }
    return { file_matches: true, browser_matches: true };
  },
});
`;
const cli = spawn(
  process.execPath,
  [
    '--import',
    `data:text/javascript,${encodeURIComponent(preload)}`,
    fileURLToPath(new URL('run.mjs', import.meta.url)),
    '--live',
    '--runtime-dir',
    '/private/tmp/unused-local-prompt-fixture',
  ],
  {
    env: { ...process.env, OPENAI_API_KEY: 'local-no-request', OPENAI_MODEL: 'local-no-request' },
    stdio: ['pipe', 'pipe', 'pipe'],
  },
);
const exited = once(cli, 'exit');
let output = '';
let errors = '';
let admitted = false;
let stopped = false;
cli.stdout.on('data', (chunk) => {
  output += chunk.toString();
  if (!admitted && output.includes('Type yes to start')) {
    admitted = true;
    cli.stdin.write('yes\n');
  }
  const [expected] = cases[mode];
  if (!stopped && output.includes(expected)) {
    stopped = true;
    cli.kill('SIGINT');
  }
});
cli.stderr.on('data', (chunk) => {
  errors += chunk.toString();
});
try {
  const result = await Promise.race([exited, delay(5000, undefined, { ref: false })]);
  assert.ok(result, `Approval did not settle before Stop: ${errors}`);
  assert.ok(admitted && stopped, `CLI did not reach its in-run prompt: ${errors}`);
  assert.notEqual(result[0], 0);
  assert.doesNotMatch(output, /"verified":true/u);
  if (mode === 'active') {
    assert.match(output, /REQUEST_CANCELLED[\s\S]*POLICY_DRAINED/u);
  }
  if (mode === 'verify') {
    assert.match(output, /SEAL_CANCELLED[\s\S]*DESKTOP_STOPPED/u);
  }
  assert.match(output, /POLICY_DRAINED[\s\S]*DESKTOP_STOPPED/u);
  console.log(cases[mode][1]);
} finally {
  if (cli.exitCode === null && cli.signalCode === null) {
    cli.kill('SIGKILL');
    await exited;
  }
}
