import type { NextApiRequest, NextApiResponse } from 'next';
import { distance } from 'fastest-levenshtein';
import OpenAI from 'openai';
import { uploadWebApiTestCases } from '../../uploadWebApiTestCases';

type Test = { description: string; handler: () => Promise<void> };

const tests: Test[] = [];
function it(description: string, handler: () => Promise<void>) {
  tests.push({ description, handler });
}
function expectEqual(a: any, b: any) {
  if (!Object.is(a, b)) {
    throw new Error(`expected values to be equal: ${JSON.stringify({ a, b })}`);
  }
}
function expectSimilar(received: string, expected: string, maxDistance: number) {
  const receivedDistance = distance(received, expected);
  if (receivedDistance < maxDistance) {
    return;
  }

  const message = [
    `Received: ${JSON.stringify(received)}`,
    `Expected: ${JSON.stringify(expected)}`,
    `Max distance: ${maxDistance}`,
    `Received distance: ${receivedDistance}`,
  ].join('\n');

  throw new Error(message);
}

export default async (request: NextApiRequest, response: NextApiResponse) => {
  try {
    console.error('creating client');
    const client = new OpenAI();
    console.error('created client');

    uploadWebApiTestCases({
      client: client as any,
      it,
      expectEqual,
      expectSimilar,
    });

    let allPassed = true;
    const results = [];

    for (const { description, handler } of tests) {
      console.error('running', description);
      let result;
      try {
        result = await handler();
        console.error('passed ', description);
      } catch (error) {
        console.error('failed ', description, error);
        allPassed = false;
        result = error instanceof Error ? error.stack : String(error);
      }
      results.push(`${description}\n\n${String(result)}`);
    }

    response.status(200).end(allPassed ? 'Passed!' : results.join('\n\n'));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    response.status(500).end(error instanceof Error ? error.stack : String(error));
  }
};
