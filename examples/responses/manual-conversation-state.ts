#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';

const client = new OpenAI();

async function main() {
  const input: ResponseInputItem[] = [
    {
      type: 'message',
      role: 'user',
      content: 'Write a short Python prime checker.',
    },
  ];

  const response = await client.responses.create({
    model: 'gpt-5-mini',
    input,
    reasoning: { effort: 'low' },
  });

  console.log(response.output_text);

  // If you manage conversation state manually, keep all output items together.
  // Reasoning-capable models can return reasoning items that must stay paired
  // with the following message item on future turns.
  input.push(...response.output);
  input.push({
    type: 'message',
    role: 'user',
    content: 'Add type hints.',
  });

  const followup = await client.responses.create({
    model: 'gpt-5-mini',
    input,
    reasoning: { effort: 'low' },
  });

  console.log(followup.output_text);
}

main();
