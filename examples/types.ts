#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';

// gets API Key from environment variable OPENAI_API_KEY
const openai = new OpenAI();

async function main() {
  // Explicit non streaming params type:
  const params: OpenAI.Chat.CompletionCreateParams = {
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Say this is a test!' }],
  };
  const completion = await openai.chat.completions.create(params);
  console.log(completion.choices[0]?.message?.content);

  // Explicit streaming params type:
  const streaming_params: OpenAI.Chat.CompletionCreateParams = {
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Say this is a test!' }],
    stream: true,
  };

  const stream = await openai.chat.completions.create(streaming_params);
  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }
  process.stdout.write('\n');
}

main();
