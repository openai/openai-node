import 'openai/shims/node.mjs';
import OpenAI from 'openai';
import { distance } from 'fastest-levenshtein';
import { ChatCompletion } from 'openai/resources/chat/completions';
import * as shims from 'openai/_shims/index';

// The tests in this file don't typecheck with "moduleResolution": "node"

function typeTests(x: shims.Request) {
  const url: string = x.url;
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
  const { body } = response;
  if (!body) throw new Error(`expected response.body to be defined`);
  body.on('data', (chunk) => chunks.push(chunk));
  await new Promise<void>((resolve, reject) => {
    body.once('end', resolve);
    body.once('error', reject);
  });
  const json: ChatCompletion = JSON.parse(chunks.join(''));
  expect(json.choices[0]?.message.content || '').toBeSimilarTo('This is a test', 10);
});
