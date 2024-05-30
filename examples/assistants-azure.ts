#!/usr/bin/env -S npm run tsn -T

import { AzureOpenAI } from 'openai';
import { getBearerTokenProvider, DefaultAzureCredential } from '@azure/identity';

const credential = new DefaultAzureCredential();
const scope = 'https://cognitiveservices.azure.com/.default';
const azureADTokenProvider = getBearerTokenProvider(credential, scope);

const apiVersion = '2024-05-01-preview';
// Make sure to set AZURE_OPENAI_ENDPOINT with the endpoint of your Azure resource.
// You can find it in the Azure Portal.
const openai = new AzureOpenAI({ azureADTokenProvider, apiVersion });

/**
 * Example of polling for a complete response from an assistant
 */
async function main() {
  const assistant = await openai.beta.assistants.create({
    model: 'gpt-4',
    name: 'Math Tutor',
    instructions: 'You are a personal math tutor. Write and run code to answer math questions.',
  });

  console.log('Created Assistant with Id: ' + assistant.id);

  const thread = await openai.beta.threads.create({
    messages: [
      {
        role: 'user',
        content: '"I need to solve the equation `3x + 11 = 14`. Can you help me?"',
      },
    ],
  });

  console.log('Created thread with Id: ' + thread.id);

  const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
    assistant_id: assistant.id,
    additional_instructions: 'Please address the user as Jane Doe. The user has a premium account.',
  });

  console.log('Run finished with status: ' + run.status);

  if (run.status == 'completed') {
    const messages = await openai.beta.threads.messages.list(thread.id);
    for await (const message of messages) {
      console.log(message);
    }
  }
}

main();
