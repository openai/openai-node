#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';
import { betaZodTool } from 'openai/helpers/beta/zod';
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
        parameters: z.object({
          location: z.string().describe('The city and state, e.g. San Francisco, CA'),
        }),
        run: ({ location }) => {
          return `The weather is sunny with a temperature of 20°C in ${location}.`;
        },
      }),
      betaZodTool({
        name: 'getTime',
        description: 'Get the current time in a specific timezone',
        parameters: z.object({
          timezone: z.string().describe('The timezone, e.g. America/Los_Angeles'),
        }),
        run: ({ timezone }) => {
          return `The current time in ${timezone} is 3:00 PM.`;
        },
      }),
      betaZodTool({
        name: 'getCurrencyExchangeRate',
        description: 'Get the exchange rate between two currencies',
        parameters: z.object({
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
    stream: true,
  });

  console.log(`\n🚀 Running tools...\n`);

  let prevMessageStarted = '';
  let prevToolStarted = '';
  let prevWasToolCall = false;

  for await (const messageStream of runner) {
    for await (const event of messageStream) {
      const hadToolCalls = !!event.choices?.[0]?.delta?.tool_calls;

      if (hadToolCalls) {
        if (!prevMessageStarted) {
          console.log(`┌─ Message ${event.id} `.padEnd(process.stdout.columns, '─'));
          prevMessageStarted = event.id;
        }

        prevWasToolCall = true;
        const toolCalls = event.choices[0]!.delta.tool_calls!;

        for (const toolCall of toolCalls) {
          if (toolCall.function?.name && prevToolStarted !== toolCall.function.name) {
            process.stdout.write(`\n${toolCall.function.name}: `);
            prevToolStarted = toolCall.function.name;
          } else if (toolCall.function?.arguments) {
            process.stdout.write(toolCall.function.arguments);
          }
        }
      } else if (event.choices?.[0]?.delta?.content) {
        if (prevWasToolCall) {
          console.log();
          console.log();
          console.log(`└─`.padEnd(process.stdout.columns, '─'));
          console.log();
          prevWasToolCall = false;
        }

        if (prevMessageStarted !== event.id) {
          console.log(`┌─ Message ${event.id} `.padEnd(process.stdout.columns, '─'));
          console.log();
          prevMessageStarted = event.id;
        }

        process.stdout.write(event.choices[0].delta.content);
      }
    }
  }

  console.log();
  console.log();
  console.log(`└─`.padEnd(process.stdout.columns, '─'));
}

main();
