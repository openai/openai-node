#!/usr/bin/env -S npm run tsn -T

import { AzureOpenAI } from 'openai';

// Corresponds to your Model deployment within your OpenAI resource, e.g. gpt-4-1106-preview
// Navigate to the Azure OpenAI Studio to deploy a model.
const deployment = 'gpt-4-1106-preview';

// Make sure to set both AZURE_OPENAI_ENDPOINT with the endpoint of your Azure resource and AZURE_OPENAI_API_KEY with the API key.
// You can find both information in the Azure Portal.
const openai = new AzureOpenAI();

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
