#!/usr/bin/env -S npm run tsn -- -T

/**
 * Fine-tuning allows you to train models on your own data.
 *
 * See this guide for more information:
 * - https://platform.openai.com/docs/guides/fine-tuning
 */

import fs from 'node:fs';
import OpenAI from 'openai';
import type { FineTuningJobEvent } from 'openai/resources/fine-tuning';

// Gets the API Key from the environment variable `OPENAI_API_KEY`
const client = new OpenAI();

async function main() {
  console.log(`Uploading file`);

  let file = await client.files.create({
    file: fs.createReadStream('./examples/fine-tuning/fine-tuning-data.jsonl'),
    purpose: 'fine-tune',
  });
  console.log(`Uploaded file with ID: ${file.id}`);

  console.log('-----');

  console.log(`Waiting for file to be processed`);
  while (true) {
    file = await client.files.retrieve(file.id);
    console.log(`File status: ${file.status}`);

    if (file.status === 'processed') {
      break;
    } else if (file.status === 'error') {
      throw new Error(`File processing failed for ${file.id}`);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log('-----');

  console.log(`Starting fine-tuning`);
  let fineTune = await client.fineTuning.jobs.create({ model: 'gpt-3.5-turbo', training_file: file.id });
  console.log(`Fine-tuning ID: ${fineTune.id}`);

  console.log('-----');

  console.log(`Track fine-tuning progress:`);

  const events: Record<string, FineTuningJobEvent> = {};

  while (
    fineTune.status === 'validating_files' ||
    fineTune.status === 'queued' ||
    fineTune.status === 'running'
  ) {
    fineTune = await client.fineTuning.jobs.retrieve(fineTune.id);
    console.log(`${fineTune.status}`);

    const { data } = await client.fineTuning.jobs.listEvents(fineTune.id, { limit: 100 });
    for (let index = data.length - 1; index >= 0; index -= 1) {
      const event = data[index];
      if (event === undefined) {
        continue;
      }

      if (event.id in events) {
        continue;
      }
      events[event.id] = event;
      const timestamp = new Date(event.created_at * 1000);
      console.log(`- ${timestamp.toLocaleTimeString()}: ${event.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
