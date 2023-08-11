#!/usr/bin/env yarn tsn -T

import OpenAI from 'openai';

// gets API Key from environment variable OPENAI_API_KEY
const client = new OpenAI();

async function main() {
  // getting just raw Response:
  {
    const response = await client.completions
      .create({
        prompt: 'Say this is a test',
        model: 'text-davinci-003',
      })
      .asResponse();
    console.log(`response headers: `, Object.fromEntries(response.headers.entries()));
    console.log(`response json: `, await response.json());
  }

  // getting the usual return value plus raw Response:
  {
    const { data: completion, response } = await client.completions
      .create({
        prompt: 'Say this is a test',
        model: 'text-davinci-003',
      })
      .withResponse();
    console.log(`response headers: `, Object.fromEntries(response.headers.entries()));
    console.log(`completion: `, completion);
  }
}

main().catch(console.error);
