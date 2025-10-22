#!/usr/bin/env -S npm run tsn -T

import { AzureOpenAI } from 'openai';
import { getBearerTokenProvider, DefaultAzureCredential } from '@azure/identity';
import 'dotenv/config';

// Corresponds to your Model deployment within your OpenAI resource, e.g. gpt-4-1106-preview
// Navigate to the Azure OpenAI Studio to deploy a model.
const deployment = 'gpt-4-1106-preview';

const credential = new DefaultAzureCredential();
const scope = 'https://cognitiveservices.azure.com/.default';
const azureADTokenProvider = getBearerTokenProvider(credential, scope);

// Make sure to set AZURE_OPENAI_ENDPOINT with the endpoint of your Azure resource.
// You can find it in the Azure Portal.
const openai = new AzureOpenAI({ azureADTokenProvider, apiVersion: '2024-10-01-preview' });

async function main() {
  const assistant = await openai.beta.assistants.create({
    model: deployment,
    name: 'Math Tutor',
    instructions: 'You are a personal math tutor. Write and run code to answer math questions.',
    // tools = [],
  });

  let assistantId = assistant.id;
  console.log('Created Assistant with Id: ' + assistantId);

  const thread = await openai.beta.threads.create({
    messages: [
      {
        role: 'user',
        content: '"I need to solve the equation `3x + 11 = 14`. Can you help me?"',
      },
    ],
  });

  let threadId = thread.id;
  console.log('Created thread with Id: ' + threadId);

  const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
    assistant_id: assistantId,
    additional_instructions: 'Please address the user as Jane Doe. The user has a premium account.',
  });

  console.log('Run finished with status: ' + run.status);

  if (run.status == 'completed') {
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
