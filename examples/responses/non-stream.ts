#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';

const openai = new OpenAI();

async function main() {
  const result = await openai.responses
    .create({
      model: 'gpt-4o-2024-08-06',
      input: 'solve 8x + 31 = 2',
      include: ['message.output_text.logprobs'],
      top_logprobs: 20,
    });

    console.log(result.output_text);
}
main();
