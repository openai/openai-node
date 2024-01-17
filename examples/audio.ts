#!/usr/bin/env -S npm run tsn -T
import 'openai/shims/node';

import OpenAI, { toFile } from 'openai';
import fs from 'fs';
import path from 'path';

// gets API Key from environment variable OPENAI_API_KEY
const openai = new OpenAI();

const speechFile = path.resolve(__dirname, './speech.mp3');

async function main() {
  await streamingDemoNode();
  await blockingDemo();
}
main();

async function streamingDemoNode() {
  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'alloy',
    input: 'the quick brown chicken jumped over the lazy dogs',
  });

  const stream = response.body;

  console.log(`Streaming response to ${speechFile}`);
  await streamToFile(stream, speechFile);
  console.log('Finished streaming');
}

async function blockingDemo() {
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

/**
 * Note, this is Node-specific.
 *
 * Other runtimes would need a different `fs`,
 * and would also use a web ReadableStream,
 * which is different from a Node ReadableStream.
 */
async function streamToFile(stream: NodeJS.ReadableStream, path: fs.PathLike) {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(path).on('error', reject).on('finish', resolve);

    // If you don't see a `stream.pipe` method and you're using Node you might need to add `import 'openai/shims/node'` at the top of your entrypoint file.
    stream.pipe(writeStream).on('error', (error) => {
      writeStream.close();
      reject(error);
    });
  });
}
