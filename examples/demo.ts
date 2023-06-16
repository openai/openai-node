#!/usr/bin/env yarn tsn -T

import OpenAI from 'openai';

// gets API Key from environment variable OPENAI_API_KEY
const client = new OpenAI();

async function main() {
  // Non-streaming:
  const result = await client.completions.create({
    prompt: 'Say this is a test',
    model: 'text-davinci-003',
  });
  console.log(result.choices[0]!.text);

  // Streaming:
  const stream = await client.completions.create({
    prompt: 'Say this is a test',
    model: 'text-davinci-003',
    stream: true,
  });
  for await (const part of stream) {
    process.stdout.write(part.choices[0]?.text || '');
  }
  process.stdout.write('\n');
}

main().catch(console.error);
