#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';

const openai = new OpenAI();

async function main() {
  const runner = openai.responses.stream({
    model: 'gpt-4o-2024-08-06',
    input: 'solve 8x + 31 = 2',
    background: true,
  });

  let id: string | null = null;

  for await (const event of runner) {
    if (event.type == 'response.created') {
      id = event.response.id;
    }

    console.log('event', event);
    if (event.sequence_number == 10) {
      break;
    }
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
  console.log(result);
}

main();
