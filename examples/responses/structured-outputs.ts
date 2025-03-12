#!/usr/bin/env -S npm run tsn -T

import { OpenAI } from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const Step = z.object({
  explanation: z.string(),
  output: z.string(),
});

const MathResponse = z.object({
  steps: z.array(Step),
  final_answer: z.string(),
});

const client = new OpenAI();

async function main() {
  const rsp = await client.responses.parse({
    input: 'solve 8x + 31 = 2',
    model: 'gpt-4o-2024-08-06',
    text: {
      format: zodTextFormat(MathResponse, 'math_response'),
    },
  });

  console.log(rsp.output_parsed);
  console.log('answer: ', rsp.output_parsed?.final_answer);
}

main().catch(console.error);
