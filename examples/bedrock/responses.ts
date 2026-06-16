#!/usr/bin/env -S npm run tsn -T

import { BedrockOpenAI } from 'openai';

const client = new BedrockOpenAI();

// For refreshed Bedrock bearer tokens:
// const client = new BedrockOpenAI({ awsRegion: 'us-west-2', bedrockTokenProvider: getBedrockToken });

async function main() {
  const response = await client.responses.create({
    model: 'openai.gpt-5.4',
    input: 'Say hello!',
  });

  console.log(response.output_text);
}

main().catch(console.error);
