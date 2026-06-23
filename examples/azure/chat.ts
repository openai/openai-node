#!/usr/bin/env -S npm run tsn -- -T

import OpenAI from 'openai';
import { getBearerTokenProvider, DefaultAzureCredential } from '@azure/identity';
import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

// For example: https://your-resource-name.openai.azure.com
const endpoint = requireEnv('AZURE_OPENAI_ENDPOINT');
// This is the name of your Azure model deployment, not the underlying model name.
const deployment = requireEnv('AZURE_OPENAI_DEPLOYMENT');

// Azure's v1 endpoint uses the standard OpenAI client.
const tokenProvider = getBearerTokenProvider(new DefaultAzureCredential(), 'https://ai.azure.com/.default');

const openai = new OpenAI({
  baseURL: `${endpoint.replace(/\/+$/, '')}/openai/v1/`,
  apiKey: tokenProvider,
});

async function main() {
  console.log('Non-streaming:');
  const result = await openai.chat.completions.create({
    model: deployment,
    messages: [{ role: 'user', content: 'Say hello!' }],
  });
  console.log(result.choices[0]!.message?.content);

  console.log();
  console.log('Streaming:');
  const stream = await openai.chat.completions.create({
    model: deployment,
    messages: [{ role: 'user', content: 'Say hello!' }],
    stream: true,
  });

  for await (const part of stream) {
    process.stdout.write(part.choices[0]?.delta?.content ?? '');
  }
  process.stdout.write('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
