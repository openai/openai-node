#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';
import { z } from 'zod';
import assert from 'node:assert/strict';

// gets API Key from environment variable OPENAI_API_KEY
const openai = new OpenAI();

async function main() {
  // Non-streaming:
  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'What is the current weather in Boston?' }],
    tools: [
      openai.zodFunction({
        name: 'get_current_weather',
        parameters: z.object({
          location: z.string(),
        }),
      }),
    ],
  });

  // This should return a parsed function.arguments
  const func = completion.choices[0]?.message.tool_calls?.[0]?.function;
  assert.deepStrictEqual(func, {
    name: 'get_current_weather',
    arguments: {
      location: 'Boston',
    },
  });
  console.log(func);

  // Streaming:
  // const stream = await openai.chat.completions.create({
  //   model: 'gpt-4',
  //   messages: [{ role: 'user', content: 'Say this is a test' }],
  //   stream: true,
  // });
  // for await (const part of stream) {
  //   process.stdout.write(part.choices[0]?.delta?.content || '');
  // }
  // process.stdout.write('\n');
}

main();
