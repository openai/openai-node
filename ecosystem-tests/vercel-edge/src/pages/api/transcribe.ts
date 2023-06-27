import { NextRequest, NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';

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

  const rsp = await fetch('https://audio-samples.github.io/samples/mp3/blizzard_biased/sample-1.mp3');

  const transcription = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: await toFile(rsp, 'sample-1.mp3'),
  });

  return NextResponse.json(transcription);
};
