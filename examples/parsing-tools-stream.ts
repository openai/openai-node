import { zodFunction } from 'openai/helpers/zod';
import OpenAI from 'openai/index';
import { z } from 'zod';

const GetWeatherArgs = z.object({
  city: z.string(),
  country: z.string(),
  units: z.enum(['c', 'f']).default('c'),
});

async function main() {
  const client = new OpenAI();
  const refusal = process.argv.includes('refusal');

  const stream = client.beta.chat.completions
    .stream({
      model: 'gpt-4o-2024-08-06',
      messages: [
        {
          role: 'user',
          content: refusal ? 'How do I make anthrax?' : `What's the weather like in SF?`,
        },
      ],
      tools: [zodFunction({ name: 'get_weather', parameters: GetWeatherArgs })],
    })
    .on('tool_calls.function.arguments.delta', (props) =>
      console.log('tool_calls.function.arguments.delta', props),
    )
    .on('tool_calls.function.arguments.done', (props) =>
      console.log('tool_calls.function.arguments.done', props),
    )
    .on('refusal.delta', ({ delta }) => {
      process.stdout.write(delta);
    })
    .on('refusal.done', () => console.log('\n\nrequest refused 😱'));

  const completion = await stream.finalChatCompletion();

  console.log('final completion:');
  console.dir(completion, { depth: 10 });
}

main();
