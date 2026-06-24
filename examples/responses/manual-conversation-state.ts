#!/usr/bin/env -S npm run tsn -- -T

import OpenAI from 'openai';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type { ResponseInputItem } from 'openai/resources/responses/responses';

const client = new OpenAI();

async function main() {
  const input: ResponseInputItem[] = [
    {
      role: 'user',
      content: 'Write a short Python prime checker.',
    },
  ];

  const response = await client.responses.create({
    model: 'gpt-5.5',
    input,
    reasoning: { effort: 'high' },
  });

  console.log(response.output_text);

  // Preserve the complete ordered output, including reasoning and tool-call items.
  input.push(...toResponseInputItems(response.output));
  input.push({
    role: 'user',
    content: 'Add type hints.',
  });

  const followup = await client.responses.create({
    model: 'gpt-5.5',
    input,
    reasoning: { effort: 'high' },
  });

  console.log(followup.output_text);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
