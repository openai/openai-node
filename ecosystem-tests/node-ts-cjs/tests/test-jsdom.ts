/**
 * @jest-environment jest-fixed-jsdom
 */
import OpenAI, { toFile } from 'openai';
import { distance } from 'fastest-levenshtein';

const url = 'https://audio-samples.github.io/samples/mp3/blizzard_biased/sample-1.mp3';
const filename = 'sample-1.mp3';

const correctAnswer =
  'It was anxious to find him no one that expectation of a man who were giving his father enjoyment. But he was avoided in sight in the minister to which indeed,';
const model = 'whisper-1';

const client = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'],
  dangerouslyAllowBrowser: true,
});

async function typeTests() {
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await client.audio.transcriptions.create({ file: { foo: true }, model: 'whisper-1' });
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await client.audio.transcriptions.create({ file: null, model: 'whisper-1' });
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await client.audio.transcriptions.create({ file: 'test', model: 'whisper-1' });
}

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

test(`basic request works`, async function () {
  const completion = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Say this is a test' }],
  });
  expect(completion.choices[0]?.message?.content).toBeSimilarTo('This is a test', 10);
});

it(`streaming works`, async function () {
  const stream = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Say this is a test' }],
    stream: true,
  });
  const chunks = [];
  for await (const part of stream) {
    chunks.push(part);
  }
  expect(chunks.map((c) => c.choices[0]?.delta.content || '').join('')).toBeSimilarTo('This is a test', 10);
});

it.skip('handles builtinFile', async function () {
  const file = await fetch(url)
    .then((x) => x.arrayBuffer())
    .then((x) => new File([x], filename));

  const result = await client.audio.transcriptions.create({ file, model });
  expect(result.text).toBeSimilarTo(correctAnswer, 12);
});

it.skip('handles Response', async function () {
  const file = await fetch(url);

  const result = await client.audio.transcriptions.create({ file, model });
  expect(result.text).toBeSimilarTo(correctAnswer, 12);
});

const fineTune = `{"prompt": "<prompt text>", "completion": "<ideal generated text>"}`;

describe.skip('toFile', () => {
  it('handles builtin Blob', async function () {
    const result = await client.files.create({
      file: await toFile(new Blob([new TextEncoder().encode(fineTune)]), 'finetune.jsonl'),
      purpose: 'fine-tune',
    });
    expect(result.filename).toEqual('finetune.jsonl');
  });
  it('handles Uint8Array', async function () {
    const result = await client.files.create({
      file: await toFile(new TextEncoder().encode(fineTune), 'finetune.jsonl'),
      purpose: 'fine-tune',
    });
    expect(result.filename).toEqual('finetune.jsonl');
  });
  it('handles ArrayBuffer', async function () {
    const result = await client.files.create({
      file: await toFile(new TextEncoder().encode(fineTune).buffer, 'finetune.jsonl'),
      purpose: 'fine-tune',
    });
    expect(result.filename).toEqual('finetune.jsonl');
  });
  it('handles DataView', async function () {
    const result = await client.files.create({
      file: await toFile(new DataView(new TextEncoder().encode(fineTune).buffer), 'finetune.jsonl'),
      purpose: 'fine-tune',
    });
    expect(result.filename).toEqual('finetune.jsonl');
  });
});
