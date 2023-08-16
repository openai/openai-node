#!/usr/bin/env -S npm run tsn -T

/**
 * Fine-tuning allows you to train models on your own data.
 *
 * See these guides for more information:
 * - https://help.openai.com/en/articles/5528730-fine-tuning-a-classifier-to-improve-truthfulness
 * - https://platform.openai.com/docs/guides/fine-tuning
 */

import fs from 'fs';
import OpenAI from 'openai';

// Gets the API Key from the environment variable `OPENAI_API_KEY`
const client = new OpenAI();

async function main() {
  console.log(`Uploading file`);
  const file = await client.files.create({
    file: fs.createReadStream('examples/fine-tune-data.jsonl'),
    purpose: 'fine-tune',
  });
  console.log(`Uploaded file with ID: ${file.id}`);
  console.log('-----');

  console.log(`Starting fine-tuning`);
  const fineTune = await client.fineTunes.create({ model: 'babbage', training_file: file.id });
  console.log(`Fine-tuning ID: ${fineTune.id}`);
  console.log('-----');

  console.log(`Streaming fine-tuning progress:`);
  const stream = await client.fineTunes.listEvents(fineTune.id, { stream: true });
  for await (const part of stream) {
    console.log(part.message);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
