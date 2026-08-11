#!/usr/bin/env -S npm run tsn -- -T

import OpenAI, { toFile } from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// gets API Key from environment variable OPENAI_API_KEY
const openai = new OpenAI();

const speechFile = path.resolve(__dirname, './speech.mp3');

/** Runs streaming and buffered speech-generation examples sequentially. */
async function main(): Promise<void> {
  await streamingDemoNode();
  await blockingDemo();
}
main();

/** Streams synthesized speech directly to a file without buffering the complete response. */
async function streamingDemoNode(): Promise<void> {
  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'alloy',
    input: 'the quick brown chicken jumped over the lazy dogs',
  });

  const stream = response.body;
  if (!stream) {
    throw new Error('Speech response did not include an audio stream.');
  }

  console.log(`Streaming response to ${speechFile}`);
  await streamToFile(Readable.fromWeb(stream), speechFile);
  console.log('Finished streaming');
}

/** Buffers synthesized speech before submitting it for transcription and translation. */
async function blockingDemo(): Promise<void> {
  const mp3 = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'alloy',
    input: 'the quick brown fox jumped over the lazy dogs',
  });

  const buffer = Buffer.from(await mp3.arrayBuffer());
  await fs.promises.writeFile(speechFile, buffer);

  const transcription = await openai.audio.transcriptions.create({
    file: await toFile(buffer, 'speech.mp3'),
    model: 'whisper-1',
  });
  console.log(transcription.text);

  const translation = await openai.audio.translations.create({
    file: await toFile(buffer, 'speech.mp3'),
    model: 'whisper-1',
  });
  console.log(translation.text);
}

/** Writes a Node.js readable stream to disk and propagates source or destination errors. */
async function streamToFile(stream: NodeJS.ReadableStream, destination: fs.PathLike): Promise<void> {
  await pipeline(stream, fs.createWriteStream(destination));
}
