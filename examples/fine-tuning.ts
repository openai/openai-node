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

  let file = await client.files.create({
    file: fs.createReadStream('./examples/fine-tune-data.jsonl'),
    purpose: 'fine-tune',
  });
  console.log(`Uploaded file with ID: ${file.id}`);
  console.log('-----');

  // Wait for the file to be processed
  console.log(`Waiting for file to be processed`);
  while (true) {
    file = await client.files.retrieve(file.id);
    console.log(`File status: ${file.status}`);

    if (file.status === 'processed') {
      break;
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
  let after: string | undefined;
  while (fineTune.status !== 'succeeded') {
    fineTune = await client.fineTuning.jobs.retrieve(fineTune.id);
    console.log(`${fineTune.status}`);

    const options = after ? { limit: 50, after } : { limit: 50 };
    const events = await client.fineTuning.jobs.listEvents(fineTune.id, options);
    for (const event of events.data.reverse()) {
      console.log(`- ${event.created_at}: ${event.message}`);
    }

    if (events.data.length > 0) {
      after = events.data[events.data.length - 1]?.id;
      console.log(after);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
