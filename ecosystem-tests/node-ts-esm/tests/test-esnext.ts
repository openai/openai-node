import OpenAI from 'openai';
import { distance } from 'fastest-levenshtein';
import { ChatCompletion } from 'openai/resources/chat/completions';

// The tests in this file don't typecheck with "moduleResolution": "node"

async function typeTests(client: OpenAI) {
  const response = await client.chat.completions.create({ model: 'gpt-4o', messages: [] }).asResponse();
  const url: string = response.url;
}

const client = new OpenAI();

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeSimilarTo(comparedTo: string, expectedDistance: number): R;
    }
  }
}
expect.extend({
  toBeSimilarTo(received, comparedTo: string, expectedDistance: number) {
    const message = () =>
      [
        `Received: ${JSON.stringify(received)}`,
        `Expected: ${JSON.stringify(comparedTo)}`,
        `Expected distance: ${expectedDistance}`,
        `Received distance: ${actualDistance}`,
      ].join('\n');

    const actualDistance = distance(received, comparedTo);
    if (actualDistance < expectedDistance) {
      return {
        message,
        pass: true,
      };
    }

    return {
      message,
      pass: false,
    };
  },
});

it(`raw response`, async function () {
  const response = await client.chat.completions
    .create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Say this is a test' }],
    })
    .asResponse();

  // test that we can use node-fetch Response API
  const chunks: string[] = [];
  if (!response.body) throw new Error(`expected response.body to be defined`);

  const decoder = new TextDecoder();

  for await (const chunk of response.body) {
    chunks.push(decoder.decode(chunk));
  }

  const json: ChatCompletion = JSON.parse(chunks.join(''));
  expect(json.choices[0]?.message.content || '').toBeSimilarTo('This is a test', 10);
});
