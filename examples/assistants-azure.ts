#!/usr/bin/env -S npm run tsn -T

import { AzureOpenAI } from 'openai';

/**
 * Example of polling for a complete response from an assistant
 */
const apiVersion = '2024-02-15-preview';
const openai = new AzureOpenAI({
  endpoint:'https://YOUR_AZURE_OPENAI_RESOURCE_NAME.openai.azure.com/',
  apiKey: 'YOUR_AZURE_API_KEY',
  apiVersion
});


async function main() {
  const assistant = await openai.beta.assistants.create({
    model: 'gpt-4',
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

main();
