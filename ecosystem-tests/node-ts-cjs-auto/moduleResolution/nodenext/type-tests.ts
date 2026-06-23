import OpenAI from 'openai';

async function typeTests(client: OpenAI) {
  const response = await client.chat.completions.create({ model: 'gpt-4o', messages: [] }).asResponse();
  const url: string = response.url;
}
