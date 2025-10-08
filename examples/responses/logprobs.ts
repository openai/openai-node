#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';

const openai = new OpenAI();

async function main() {
  const result = await openai.responses
    .create({
      model: 'gpt-4o-2024-08-06',
      input: 'solve 8x + 31 = 2',
      include: ['message.output_text.logprobs'],
      top_logprobs: 20,
    });

    for(const output of result.output) {
        if(output.type === 'message') {
            const logprobs = output.content.filter(content => content.type === 'output_text')
            for(const logprob of logprobs) {
                if(logprob.type === 'output_text') {

                    // Top Logprobs
                    console.log(logprob.logprobs?.[0]?.top_logprobs);

                    // Token
                    console.log(logprob.logprobs?.[0]?.token);

                    // Token Logprobs
                    console.log(logprob.logprobs?.[0]?.logprob);

                    // Bytes
                    console.log(logprob.logprobs?.[0]?.bytes);
                }
            }
        }
    }
}
main();
