import OpenAI, { toFile } from 'openai';
import { distance } from 'fastest-levenshtein';
import { test, expect } from 'bun:test';

const client = new OpenAI();

function expectSimilar(received: any, comparedTo: string, expectedDistance: number) {
  const message = () =>
    [
      `Received: ${JSON.stringify(received)}`,
      `Expected: ${JSON.stringify(comparedTo)}`,
      `Expected distance: ${expectedDistance}`,
      `Received distance: ${actualDistance}`,
    ].join('\n');

  const actualDistance = distance(received, comparedTo);
  expect(actualDistance).toBeLessThan(expectedDistance);
}

test(`basic request works`, async function () {
  const completion = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Say this is a test' }],
  });
  expectSimilar(completion.choices[0]?.message?.content, 'This is a test', 10);
});

test(`streaming works`, async function () {
  const stream = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Say this is a test' }],
    stream: true,
  });
  const chunks = [];
  for await (const part of stream) {
    chunks.push(part);
  }
  expectSimilar(chunks.map((c) => c.choices[0]?.delta.content || '').join(''), 'This is a test', 10);
});

test(`toFile rejects`, async function () {
  try {
    await toFile(new TextEncoder().encode('foo'), 'foo.txt');
    throw new Error(`expected toFile to reject`);
  } catch (error) {
    expect((error as any).message).toEqual(`file uploads aren't supported in this environment yet`);
  }
});
