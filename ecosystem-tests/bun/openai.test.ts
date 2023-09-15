import OpenAI, { toFile } from 'openai';
import fs from 'fs';
import { distance } from 'fastest-levenshtein';
import { test, expect } from 'bun:test';

const url = 'https://audio-samples.github.io/samples/mp3/blizzard_biased/sample-1.mp3';
const filename = 'sample-1.mp3';

const correctAnswer =
  'It was anxious to find him no one that expectation of a man who were giving his father enjoyment. But he was avoided in sight in the minister to which indeed,';
const model = 'whisper-1';

const client = new OpenAI();

async function typeTests() {
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await client.audio.transcriptions.create({ file: { foo: true }, model: 'whisper-1' });
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await client.audio.transcriptions.create({ file: null, model: 'whisper-1' });
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await client.audio.transcriptions.create({ file: 'test', model: 'whisper-1' });
}

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

// @ts-ignore avoid DOM lib for testing purposes
if (typeof File !== 'undefined') {
  test('handles builtinFile', async function () {
    const file = await fetch(url)
      .then((x) => x.arrayBuffer())
      // @ts-ignore avoid DOM lib for testing purposes
      .then((x) => new File([x], filename));

    const result = await client.audio.transcriptions.create({ file, model });
    expectSimilar(result.text, correctAnswer, 12);
  });
}

test('handles Response', async function () {
  const file = await fetch(url);

  const result = await client.audio.transcriptions.create({ file, model });
  expectSimilar(result.text, correctAnswer, 12);
});

test('handles fs.ReadStream', async function () {
  const result = await client.audio.transcriptions.create({
    file: fs.createReadStream('sample1.mp3'),
    model,
  });
  expectSimilar(result.text, correctAnswer, 12);
});

const fineTune = `{"prompt": "<prompt text>", "completion": "<ideal generated text>"}`;

// @ts-ignore avoid DOM lib for testing purposes
if (typeof Blob !== 'undefined') {
  test('toFile handles builtin Blob', async function () {
    const result = await client.files.create({
      file: await toFile(
        // @ts-ignore avoid DOM lib for testing purposes
        new Blob([new TextEncoder().encode(fineTune)]),
        'finetune.jsonl',
      ),
      purpose: 'fine-tune',
    });
    expect(result.status).toEqual('uploaded');
  });
}
test('toFile handles Uint8Array', async function () {
  const result = await client.files.create({
    file: await toFile(
      // @ts-ignore avoid DOM lib for testing purposes
      new TextEncoder().encode(fineTune),
      'finetune.jsonl',
    ),
    purpose: 'fine-tune',
  });
  expect(result.status).toEqual('uploaded');
});
test('toFile handles ArrayBuffer', async function () {
  const result = await client.files.create({
    file: await toFile(
      // @ts-ignore avoid DOM lib for testing purposes
      new TextEncoder().encode(fineTune).buffer,
      'finetune.jsonl',
    ),
    purpose: 'fine-tune',
  });
  expect(result.status).toEqual('uploaded');
});
test('toFile handles DataView', async function () {
  const result = await client.files.create({
    file: await toFile(
      // @ts-ignore avoid DOM lib for testing purposes
      new DataView(new TextEncoder().encode(fineTune).buffer),
      'finetune.jsonl',
    ),
    purpose: 'fine-tune',
  });
  expect(result.status).toEqual('uploaded');
});
