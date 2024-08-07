import OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

const openai = new OpenAI();

// `z.lazy()` can't infer recursive types so we have to explicitly
// define the type ourselves here
interface UI {
  type: 'div' | 'button' | 'header' | 'section' | 'field' | 'form';
  label: string;
  children: Array<UI>;
  attributes: {
    value: string;
    name: string;
  }[];
}

const UISchema: z.ZodType<UI> = z.lazy(() =>
  z.object({
    type: z.enum(['div', 'button', 'header', 'section', 'field', 'form']),
    label: z.string(),
    children: z.array(UISchema),
    attributes: z.array(
      z.object({
        name: z.string(),
        value: z.string(),
      }),
    ),
  }),
);

async function main() {
  const completion = await openai.beta.chat.completions.parse({
    model: 'gpt-4o-2024-08-06',
    messages: [
      {
        role: 'system',
        content: 'You are a UI generator AI. Convert the user input into a UI.',
      },
      { role: 'user', content: 'Make a User Profile Form' },
    ],
    response_format: zodResponseFormat(UISchema, 'ui'),
  });

  const message = completion.choices[0]!.message;
  const ui = message.parsed;
  console.dir(ui, { depth: 10 });
}

main();
