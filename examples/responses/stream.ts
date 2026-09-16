#!/usr/bin/env -S npm run tsn -- -T

import OpenAI from 'openai';

const openai = new OpenAI();

async function main() {
  const runner = openai.responses
    .stream({
      model: 'gpt-4o-2024-08-06',
      input: 'solve 8x + 31 = 2',
    })
    .on('event', (event) => console.log(event))
    .on('response.output_text.delta', (diff) => process.stdout.write(diff.delta));

  for await (const event of runner) {
    console.log('event', event);
  }

  const result = await runner.finalResponse();
  console.log(result);
  if (result.status !== 'completed') {
    console.error(`Response ended with status ${result.status ?? 'unknown'}.`);
    process.exitCode = 1;
  }
}

main();
