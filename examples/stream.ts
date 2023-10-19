#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';

const openai = new OpenAI();

async function main() {
  const runner = await openai.chat.completions
    .stream({
      model: 'gpt-3.5-turbo',
      functions: [
        { name: 'result', parameters: { type: 'object', properties: { text: { type: 'string' } } } },
      ],
      function_call: { name: 'result' },
      messages: [
        {
          role: 'system',
          content:
            'Please use our book database, which you can access using functions to answer the following questions.',
        },
        {
          role: 'user',
          content:
            'I really enjoyed reading To Kill a Mockingbird, could you recommend me a book that is similar and tell me why?',
        },
      ],
    })
    .on('message', (msg) => console.log(msg))
    .on('content', (diff) => process.stdout.write(diff));

  rsp.send(runner.toReadableStream());

  for await (const chunk of runner) {
    console.log('chunk', chunk);
  }

  const result = await runner.finalChatCompletion();
  console.log(result);
}

main();
