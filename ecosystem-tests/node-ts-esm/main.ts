import fetch from 'node-fetch';
import OpenAI from 'openai';

import type { Uploadable } from 'openai/core';

const openai = new OpenAI();

async function main() {
  if (false as any) {
    typeTests();
  }

  const url = 'https://audio-samples.github.io/samples/mp3/blizzard_biased/sample-1.mp3';
  console.log(`Fetching ${url}`);
  const rsp = await fetch(url);

  console.log('Sending request to OpenAI');
  console.log(await openai.audio.transcriptions.create({ file: rsp, model: 'whisper-1' }));
}

async function typeTests() {
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  fileParam(null);

  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await openai.audio.transcriptions.create({ file: { foo: true }, model: 'whisper-1' });
}

function fileParam(_file: Uploadable) {
  //
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
