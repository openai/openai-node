#!/usr/bin/env -S npm run tsn -T

import { OpenAI } from 'openai';
import { getBearerTokenProvider, DefaultAzureCredential } from '@azure/identity';
import 'dotenv/config';

// Corresponds to your Model deployment within your OpenAI resource, e.g. gpt-4-1106-preview
// Navigate to the Azure OpenAI Studio to deploy a model.
const deployment = 'gpt-5';
const baseURL = process.env?.['AZURE_OPENAI_ENDPOINT'];
const credential = new DefaultAzureCredential();
const scope = 'https://cognitiveservices.azure.com/.default';
const apiKey = getBearerTokenProvider(credential, scope);

const openai = new OpenAI({ baseURL: baseURL + '/openai/v1', apiKey });

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
