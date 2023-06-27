/// <reference lib="dom" />;

import OpenAI, { toFile } from 'openai';
import fetch from 'node-fetch';
import { File as FormDataFile, Blob as FormDataBlob } from 'formdata-node';
import * as fs from 'fs';

async function typeTests() {
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await openai.audio.transcriptions.create({ file: { foo: true }, model: 'whisper-1' });
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await openai.audio.transcriptions.create({ file: null, model: 'whisper-1' });
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await openai.audio.transcriptions.create({ file: 'test', model: 'whisper-1' });
}

const url = 'https://audio-samples.github.io/samples/mp3/blizzard_biased/sample-1.mp3';
const filename = 'sample-1.mp3';

const correctAnswer =
  'It was anxious to find him no one that expectation of a man who were giving his father enjoyment. But he was avoided in sight in the minister to which indeed,';
const model = 'whisper-1';

const client = new OpenAI();

it('handles formdata-node File', async function () {
  const file = await fetch(url)
    .then((x) => x.arrayBuffer())
    .then((x) => new FormDataFile([x], filename));

  const result = await client.audio.transcriptions.create({ file, model });
  expect(result.text).toEqual(correctAnswer);
});

if (typeof File !== 'undefined') {
  it('handles builtinFile', async function () {
    const file = await fetch(url)
      .then((x) => x.arrayBuffer())
      .then((x) => new File([x], filename));

    const result = await client.audio.transcriptions.create({ file, model });
    expect(result.text).toEqual(correctAnswer);
  });
}

it('handles Response', async function () {
  const file = await fetch(url);

  const result = await client.audio.transcriptions.create({ file, model });
  expect(result.text).toEqual(correctAnswer);
});

it('handles fs.ReadStream', async function () {
  const result = await client.audio.transcriptions.create({
    file: fs.createReadStream('sample1.mp3'),
    model,
  });
  expect(result.text).toEqual(correctAnswer);
});

const fineTune = `{"prompt": "<prompt text>", "completion": "<ideal generated text>"}`;

describe('toFile', () => {
  it('handles form-data Blob', async function () {
    const result = await client.files.create({
      file: await toFile(new FormDataBlob([new TextEncoder().encode(fineTune)]), 'finetune.jsonl'),
      purpose: 'fine-tune',
    });
    expect(result.status).toEqual('uploaded');
  });
  if (typeof Blob !== 'undefined') {
    it('handles builtin Blob', async function () {
      const result = await client.files.create({
        file: await toFile(new Blob([new TextEncoder().encode(fineTune)]), 'finetune.jsonl'),
        purpose: 'fine-tune',
      });
      expect(result.status).toEqual('uploaded');
    });
  }
  it('handles Uint8Array', async function () {
    const result = await client.files.create({
      file: await toFile(new TextEncoder().encode(fineTune), 'finetune.jsonl'),
      purpose: 'fine-tune',
    });
    expect(result.status).toEqual('uploaded');
  });
  it('handles ArrayBuffer', async function () {
    const result = await client.files.create({
      file: await toFile(new TextEncoder().encode(fineTune).buffer, 'finetune.jsonl'),
      purpose: 'fine-tune',
    });
    expect(result.status).toEqual('uploaded');
  });
  it('handles ArrayBuffer', async function () {
    const result = await client.files.create({
      file: await toFile(new DataView(new TextEncoder().encode(fineTune).buffer), 'finetune.jsonl'),
      purpose: 'fine-tune',
    });
    expect(result.status).toEqual('uploaded');
  });
});
