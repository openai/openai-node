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
  const instructions = 'You are a personal math tutor. Explain each step clearly.';
  const response = await openai.responses.create({
    model: deployment,
    instructions,
    input: 'I need to solve the equation `3x + 11 = 14`. Can you help me?',
  });
  console.log(response.output_text);

  // Instructions are not inherited through `previous_response_id`.
  const followUp = await openai.responses.create({
    model: deployment,
    instructions,
    previous_response_id: response.id,
    input: 'Now verify the result by substituting it back into the equation.',
  });
  console.log(followUp.output_text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
