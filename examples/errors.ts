#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';

// gets API Key from environment variable OPENAI_API_KEY
const client = new OpenAI();

async function main() {
  try {
    await client.files.retrieve('file-abc123');
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      console.log('Caught APIError!');
      console.log('request_id:', err.request_id);
      console.log('status:', err.status);
      console.log('name:', err.name);
      console.log('message:', err.message);
      console.log('headers:', err.headers);
    } else {
      throw err;
    }
  }
}

main().catch(console.error);
