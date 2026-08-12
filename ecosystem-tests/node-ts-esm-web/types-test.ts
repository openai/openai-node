import type OpenAI from 'openai';

async function typeTests(client: OpenAI) {
  const response = await client.chat.completions.create({ model: 'gpt-4o', messages: [] }).asResponse();
  const url: string = response.url;
}

// oxlint-disable-next-line unicorn/require-module-specifiers -- keep this type-test file a module
export {};
