#!/usr/bin/env -S npm run tsn -T

/**
 * Demonstrates how to retrieve and consume file content from OpenAI.
 *
 * The files.content() method returns a Response object, which can be
 * consumed in different formats depending on the file type.
 */

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'],
});

async function main() {
  // Example 1: Retrieve text file content (e.g., JSONL for fine-tuning)
  {
    console.log('Fetching text file content...');
    const response = await client.files.content('file-abc123');
    const textContent = await response.text();
    console.log('File content as text:', textContent);
  }

  // Example 2: Retrieve binary file content (e.g., images)
  {
    console.log('Fetching binary file content...');
    const response = await client.files.content('file-xyz789');
    const blobContent = await response.blob();
    console.log('File content as blob:', blobContent);
  }

  // Example 3: Retrieve as ArrayBuffer for low-level operations
  {
    console.log('Fetching file as ArrayBuffer...');
    const response = await client.files.content('file-def456');
    const buffer = await response.arrayBuffer();
    console.log('File size in bytes:', buffer.byteLength);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
