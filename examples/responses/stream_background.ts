#!/usr/bin/env -S npm run tsn -- -T

import OpenAI from 'openai';

const openai = new OpenAI();

async function main() {
  const runner = openai.responses.stream({
    model: 'gpt-4o-2024-08-06',
    input: 'solve 8x + 31 = 2',
    background: true,
  });

  let id: string | null = null;
  let completed = false;

  for await (const event of runner) {
    if (event.type === 'response.created') {
      id = event.response.id;
    }

    console.log('event', event);
    if (event.type === 'response.failed' || event.type === 'response.incomplete') {
      throw new Error(`Response ended with ${event.type}.`);
    }
    if (event.type === 'response.completed') {
      completed = true;
    }
    if (event.sequence_number === 10 && !completed) {
      break;
    }
  }

  // A clean EOF alone does not mean the background response has completed.
  if (completed) {
    console.log(await runner.finalResponse());
    return;
  }

  console.log('Interrupted. Continuing...');

  const runner2 = openai.responses.stream({
    response_id: id!,
    starting_after: 10,
  });

  for await (const event of runner2) {
    console.log('event', event);
  }

  const result = await runner2.finalResponse();
  if (result.status !== 'completed') {
    throw new Error(`Response ended with status ${result.status}.`);
  }
  console.log(result);
}

main();
