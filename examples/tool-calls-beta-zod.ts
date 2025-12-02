#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';
import { betaZodTool } from 'openai/helpers/beta/zod';
// import { BetaToolUseBlock } from 'openai/helpers/beta';
import { z } from 'zod';

const client = new OpenAI();

async function main() {
  const runner = client.beta.chat.completions.toolRunner({
    messages: [
      {
        role: 'user',
        content: `I'm planning a trip to San Francisco and I need some information. Can you help me with the weather, current time, and currency exchange rates (from EUR)? Please use parallel tool use`,
      },
    ],
    tools: [
      betaZodTool({
        name: 'getWeather',
        description: 'Get the weather at a specific location',
        inputSchema: z.object({
          location: z.string().describe('The city and state, e.g. San Francisco, CA'),
        }),
        run: ({ location }) => {
          return `The weather is sunny with a temperature of 20°C in ${location}.`;
        },
      }),
      betaZodTool({
        name: 'getTime',
        description: 'Get the current time in a specific timezone',
        inputSchema: z.object({
          timezone: z.string().describe('The timezone, e.g. America/Los_Angeles'),
        }),
        run: ({ timezone }) => {
          return `The current time in ${timezone} is 3:00 PM.`;
        },
      }),
      betaZodTool({
        name: 'getCurrencyExchangeRate',
        description: 'Get the exchange rate between two currencies',
        inputSchema: z.object({
          from_currency: z.string().describe('The currency to convert from, e.g. USD'),
          to_currency: z.string().describe('The currency to convert to, e.g. EUR'),
        }),
        run: ({ from_currency, to_currency }) => {
          return `The exchange rate from ${from_currency} to ${to_currency} is 0.85.`;
        },
      }),
    ],
    model: 'gpt-4o',
    max_tokens: 1024,
    // This limits the conversation to at most 10 back and forth between the API.
    max_iterations: 10,
  });

  console.log(`\n🚀 Running tools...\n`);

  for await (const message of runner) {
    console.log(`┌─ Message ${message.id} `.padEnd(process.stdout.columns, '─'));
    console.log();

    const { choices } = message;
    const firstChoice = choices.at(0)!;

    // When we get a tool call request it's null
    if (firstChoice.message.content !== null) {
      console.log(`${firstChoice.message.content}\n`);
    } else {
      // each tool call (could be many)
      for (const toolCall of firstChoice.message.tool_calls ?? []) {
        if (toolCall.type === 'function') {
          console.log(`${toolCall.function.name}(${JSON.stringify(toolCall.function.arguments, null, 2)})\n`);
        }
      }
    }

    console.log(`└─`.padEnd(process.stdout.columns, '─'));
    console.log();
    console.log();

    const defaultResponse = await runner.generateToolResponse();
    if (defaultResponse && Array.isArray(defaultResponse)) {
      console.log(`┌─ Response `.padEnd(process.stdout.columns, '─'));
      console.log();

      for (const toolResponse of defaultResponse) {
        if (toolResponse.role === 'tool') {
          const toolCall = firstChoice.message.tool_calls?.find((tc) => tc.id === toolResponse.tool_call_id);
          if (toolCall && toolCall.type === 'function') {
            console.log(`${toolCall.function.name}(): ${toolResponse.content}`);
          }
        }
      }

      console.log();
      console.log(`└─`.padEnd(process.stdout.columns, '─'));
      console.log();
      console.log();
    }
  }

  console.log(JSON.stringify(runner.params, null, 2));
}

main();
