import { zodResponseFormat } from 'openai/helpers/zod';
import OpenAI from 'openai/index';
import { z } from 'zod';

const Step = z.object({
  explanation: z.string(),
  output: z.string(),
});

const MathResponse = z.object({
  steps: z.array(Step),
  final_answer: z.string(),
});

async function main() {
  const client = new OpenAI();

  const stream = client.beta.chat.completions
    .stream({
      model: 'gpt-4o-2024-08-06',
      messages: [
        {
          role: 'user',
          content: `What's the weather like in SF?`,
        },
      ],
      response_format: zodResponseFormat(MathResponse, 'math_response'),
    })
    .on('refusal.delta', ({ delta }) => {
      process.stdout.write(delta);
    })
    .on('refusal.done', () => console.log('\n\nrequest refused 😱'))
    .on('content.delta', ({ snapshot, parsed }) => {
      console.log('content:', snapshot);
      console.log('parsed:', parsed);
      console.log();
    })
    .on('content.done', (props) => {
      if (props.parsed) {
        console.log('\n\nfinished parsing!');
        console.log(`answer: ${props.parsed.final_answer}`);
      }
    });

  await stream.done();

  const completion = await stream.finalChatCompletion();

  console.dir(completion, { depth: 5 });

  const message = completion.choices[0]?.message;
  if (message?.parsed) {
    console.log(message.parsed.steps);
  }
}

main();
