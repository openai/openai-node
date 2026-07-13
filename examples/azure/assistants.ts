#!/usr/bin/env -S npm run tsn -- -T

import { AzureOpenAI } from 'openai';
import 'dotenv/config';

/**
 * This legacy example uses the deprecated Azure OpenAI Assistants API.
 * The API will be retired on August 26, 2026.
 * For new integrations, use Microsoft Foundry Agents:
 * https://learn.microsoft.com/azure/foundry/agents/overview
 *
 * Unlike deployment-scoped APIs such as Chat Completions, Assistants use
 * resource-scoped URLs. Pass the deployment as the request's `model`
 * instead of setting the client's `deployment` option.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const openai = new AzureOpenAI({
  endpoint: requireEnv('AZURE_OPENAI_ENDPOINT'),
  apiKey: requireEnv('AZURE_OPENAI_API_KEY'),
  apiVersion: requireEnv('OPENAI_API_VERSION'),
});
const deployment = requireEnv('AZURE_OPENAI_DEPLOYMENT');

async function main() {
  const assistant = await openai.beta.assistants.create({
    model: deployment,
    name: 'Math Tutor',
    instructions: 'You are a personal math tutor. Write and run code to answer math questions.',
  });
  console.log('Created Assistant with Id: ' + assistant.id);

  const thread = await openai.beta.threads.create({
    messages: [
      {
        role: 'user',
        content: 'I need to solve the equation 3x + 11 = 14. Can you help me?',
      },
    ],
  });
  console.log('Created Thread with Id: ' + thread.id);

  const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
    assistant_id: assistant.id,
  });
  console.log('Run finished with status: ' + run.status);

  if (run.status === 'completed') {
    const messages = await openai.beta.threads.messages.list(thread.id);
    for (const message of messages.getPaginatedItems()) {
      console.log(message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
