import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import { TranscriptionCreateParams } from 'openai/resources/audio';

export const config = {
  runtime: 'edge',
  unstable_allowDynamic: [
    // This is currently required because `qs` uses `side-channel` which depends on this.
    //
    // Warning: Some features may be broken at runtime because of this.
    '/node_modules/function-bind/**',
  ],
};

export default async (request: NextRequest) => {
  const openai = new OpenAI();

  async function typeTests() {
    // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
    await openai.audio.transcriptions.create({ file: { foo: true }, model: 'whisper-1' });
    // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
    await openai.audio.transcriptions.create({ file: null, model: 'whisper-1' });
    // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
    await openai.audio.transcriptions.create({ file: 'test', model: 'whisper-1' });
  }

  const rsp = await fetch('https://audio-samples.github.io/samples/mp3/blizzard_biased/sample-1.mp3');

  const params: TranscriptionCreateParams = {
    model: 'whisper-1',
    file: await toFile(rsp, 'sample-1.mp3'),
  };
  const transcription = await openai.audio.transcriptions.create(params);

  return NextResponse.json(transcription);
};
