#!/usr/bin/env -S npm run tsn -- -T

import OpenAI from 'openai';

async function createProvider(region: string) {
  const auth = process.env['BEDROCK_AUTH'] ?? 'sigv4';

  if (auth === 'bearer') {
    const apiKey = process.env['AWS_BEARER_TOKEN_BEDROCK'];
    if (!apiKey) {
      throw new Error('Bearer authentication requires AWS_BEARER_TOKEN_BEDROCK.');
    }

    const { bedrock } = await import('openai/providers/bedrock');
    return bedrock({ endpoint: 'runtime', region, apiKey });
  }

  if (auth !== 'sigv4') {
    throw new Error('BEDROCK_AUTH must be either sigv4 or bearer.');
  }

  const { bedrock } = await import('openai/providers/bedrock/aws');
  const profile = process.env['AWS_PROFILE'];
  return bedrock({
    endpoint: 'runtime',
    region,
    // Ignore a stale AWS_BEARER_TOKEN_BEDROCK when using AWS credentials.
    apiKey: null,
    ...(profile ? { profile } : {}),
  });
}

async function main() {
  const region = process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'] ?? 'us-east-1';
  const model = process.env['BEDROCK_MODEL'] ?? 'us.openai.gpt-5.6-sol';
  const client = new OpenAI({ provider: await createProvider(region) });
  const request = {
    model,
    messages: [{ role: 'user' as const, content: 'Say hello from Amazon Bedrock Runtime!' }],
  };

  const completion = await client.chat.completions.create(request);
  console.log('Non-streaming:');
  console.log(completion.choices[0]?.message.content);

  if (process.env['BEDROCK_STREAM'] !== '1') {
    return;
  }

  console.log('\nStreaming:');
  const stream = await client.chat.completions.create({ ...request, stream: true });
  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
  }
  process.stdout.write('\n');
}

async function run() {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

void run();
