import { NextRequest, NextResponse } from 'next/server';
import { distance } from 'fastest-levenshtein';
import OpenAI from 'openai';
import { uploadWebApiTestCases } from '../../uploadWebApiTestCases';

export const config = {
  runtime: 'edge',
  unstable_allowDynamic: [
    // This is currently required because `qs` uses `side-channel` which depends on this.
    //
    // Warning: Some features may be broken at runtime because of this.
    '/node_modules/function-bind/**',
  ],
};

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

export default async (request: NextRequest) => {
  try {
    console.error('creating client');
    const client = new OpenAI();
    console.error('created client');

    uploadWebApiTestCases({
      client: client as any,
      it,
      expectEqual,
      expectSimilar,
      runtime: 'edge',
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

    return new NextResponse(allPassed ? 'Passed!' : results.join('\n\n'));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    return new NextResponse(error instanceof Error ? error.stack : String(error), { status: 500 });
  }
};
