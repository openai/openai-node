#!/usr/bin/env -S npm run tsn -- -T

import OpenAI from 'openai';
import { bedrock } from 'openai/providers/bedrock';

const client = new OpenAI({
  provider: bedrock({ region: 'us-west-2' }),
});

// For refreshed Bedrock bearer tokens:
// const client = new OpenAI({
//   provider: bedrock({ region: 'us-west-2', tokenProvider: getBedrockToken }),
// });

async function main() {
  const response = await client.responses.create({
    model: 'openai.gpt-oss-120b',
    input: 'Say hello!',
  });

  console.log(response.output_text);
}

main().catch(console.error);
