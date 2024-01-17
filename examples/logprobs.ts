#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';

// gets API Key from environment variable OPENAI_API_KEY
const openai = new OpenAI();

async function main() {
  const stream = await openai.beta.chat.completions
    .stream({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Say this is a test' }],
      stream: true,
      logprobs: true,
    })
    .on('logprob', (logprob) => {
      console.log(logprob);
    });

  console.dir(await stream.finalChatCompletion(), { depth: null });
}

main();
