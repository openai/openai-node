import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import OpenAI from 'openai';
import { Desktop } from '../../computer-desktop/desktop.mjs';
import { cleanupMixedSetup, createMixedFixture, runMixed } from './mixed-session.mjs';

const { values } = parseArgs({ options: { live: { type: 'boolean' }, 'runtime-dir': { type: 'string' } } });
if (
  !values.live ||
  !values['runtime-dir'] ||
  !process.env['OPENAI_API_KEY'] ||
  !process.env['OPENAI_MODEL']
) {
  throw new Error(
    'Set OPENAI_API_KEY and OPENAI_MODEL, pass --live and --runtime-dir. Use exercise-mixed.mjs for the no-key exercise.',
  );
}
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const stop = new AbortController();
const interrupted = () => stop.abort();
process.on('SIGINT', interrupted);
const approve = async (label, signal) => {
  try {
    const answer = await terminal.question(`${label} Type yes: `, { signal });
    return answer.trim().toLowerCase() === 'yes' && !signal.aborted;
  } catch {
    return false;
  }
};
let desktop;
let fixture;
let delegated = false;
try {
  console.log(
    'Two private workspaces: Host browser for Dispatch receipts; isolated desktop editor for Save.',
  );
  console.log('Ctrl-C stops this run. Earlier work is not rolled back. Human handoff is not available here.');
  if (!(await approve('Create both disposable workspaces for this fixed task?', stop.signal))) {
    throw new Error('Task declined.');
  }
  fixture = await createMixedFixture();
  desktop = await Desktop.create({ runtimeDir: values['runtime-dir'], signal: stop.signal });
  stop.signal.throwIfAborted();
  const client = new OpenAI({ maxRetries: 0 });
  delegated = true;
  const proof = await runMixed({
    client,
    model: process.env['OPENAI_MODEL'],
    desktop,
    fixture,
    signal: stop.signal,
    approve,
    progress: (message) => console.log(message),
  });
  console.log(JSON.stringify(proof));
  if (proof.status !== 'verified' || !proof.verified) {
    process.exitCode = 1;
  }
} finally {
  try {
    if (!delegated) {
      await cleanupMixedSetup(desktop, fixture);
    }
  } finally {
    process.removeListener('SIGINT', interrupted);
    terminal.close();
  }
}
