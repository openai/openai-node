import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import OpenAI from 'openai';
import { Desktop } from './desktop.mjs';

const { values } = parseArgs({ options: { live: { type: 'boolean' }, 'runtime-dir': { type: 'string' } } });
if (
  !values.live ||
  !values['runtime-dir'] ||
  !process.env['OPENAI_API_KEY'] ||
  !process.env['OPENAI_MODEL']
) {
  throw new Error(
    'Optional API run: set OPENAI_API_KEY and OPENAI_MODEL, then pass --live --runtime-dir /absolute/private/runtime. For no API calls, use exercise.mjs.',
  );
}

const input = createInterface({ input: process.stdin, output: process.stdout });
let desktop;
const interruption = new AbortController();
async function approve(prompt, signal = interruption.signal) {
  const answer = await input.question(prompt, { signal: AbortSignal.any([interruption.signal, signal]) });
  return answer.trim().toLowerCase() === 'yes';
}
const onInterrupt = () => {
  interruption.abort(new Error('Desktop startup interrupted.'));
};
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onInterrupt);
try {
  if (
    !(await approve(
      'Use only this disposable browser/editor and the fixed local receipt? Type yes to start: ',
    ))
  ) {
    throw new Error('Desktop task declined.');
  }
  desktop = await Desktop.create({ runtimeDir: values['runtime-dir'], signal: interruption.signal });
  const client = new OpenAI({ maxRetries: 0 });
  await desktop.withComputer(
    (computer, signal) =>
      computer.run(
        client,
        {
          model: process.env['OPENAI_MODEL'],
          store: false,
          input:
            'This is an isolated Linux desktop with a local synthetic task. In the browser on the left, route D-2201. In the editor on the right, write exactly Desktop receipt D-2201 and save the open result.txt. Stop once done.',
        },
        {
          signal,
          maxSteps: 20,
          beforeAction: () => true,
          approveSafetyChecks: (_call, { signal: currentSignal }) =>
            approve(
              'The API requests a safety decision for this local task. Approve the pending action? Type yes: ',
              currentSignal,
            ),
        },
      ),
    { signal: interruption.signal },
  );
  const proof = await desktop.seal({ signal: interruption.signal });
  console.log(
    JSON.stringify({
      verified: proof.file_matches && proof.browser_matches,
      uncertainEffects: desktop.uncertainEffects,
    }),
  );
  if (!proof.file_matches || !proof.browser_matches) {
    process.exitCode = 1;
  }
} finally {
  try {
    await desktop?.stop();
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onInterrupt);
    input.close();
  }
}
