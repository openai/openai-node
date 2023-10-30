#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';

const openai = new OpenAI();

async function main() {
  const runner = await openai.beta.chat.completions
    .stream({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Say this is a test' }],
    })
    .on('message', (msg) => console.log(msg))
    .on('content', (diff) => process.stdout.write(diff));

  for await (const chunk of runner) {
    console.log('chunk', chunk);
  }

  const result = await runner.finalChatCompletion();
  console.log(result);
}

main();
