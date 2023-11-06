#!/usr/bin/env -S npm run tsn -T

import OpenAI, { toFile } from 'openai';
import fs from 'fs/promises';
import path from 'path';

// gets API Key from environment variable OPENAI_API_KEY
const openai = new OpenAI();

const speechFile = path.resolve(__dirname, './speech.mp3');

async function main() {
  const mp3 = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'alloy',
    input: 'the quick brown fox jumped over the lazy dogs',
  });

  const buffer = Buffer.from(await mp3.arrayBuffer());
  await fs.writeFile(speechFile, buffer);

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

main();
