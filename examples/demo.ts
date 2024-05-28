#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:7331',
  apiKey: 'cortex',
});

const model = 'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF';

async function main() {
  await openai.models.start(model);

  // Non-streaming:
  const completion = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: 'Say this is a test' }],
  });
  console.log(completion.choices[0]?.message?.content);

  // Streaming:
  const stream = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: 'Say this is a test' }],
    stream: true,
  });
  for await (const part of stream) {
    process.stdout.write(part.choices[0]?.delta?.content || '');
  }
  process.stdout.write('\n');
}

main();
