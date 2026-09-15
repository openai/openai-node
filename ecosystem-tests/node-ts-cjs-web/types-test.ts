import type OpenAI from 'openai';

async function typeTests(client: OpenAI) {
  const response = await client.chat.completions.create({ model: 'gpt-4o', messages: [] }).asResponse();
  const url: string = response.url;
}

// oxlint-disable-next-line unicorn/require-module-specifiers, typescript/no-useless-empty-export -- preserve the intentional module marker in this type-only fixture
export {};
