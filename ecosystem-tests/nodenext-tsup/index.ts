import { OpenAI } from 'openai';

const openai = new OpenAI();

function assertEqual(actual: any, expected: any) {
  if (actual === expected) {
    return;
  }

  console.error('expected', expected);
  console.error('actual  ', actual);
  throw new Error('expected values to be equal');
}

async function main() {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: 'What is the capital of the United States?',
      },
    ],
  });
  // smoke test for responses
  if (!completion.choices[0]?.message.content) {
    console.dir(completion, { depth: 4 });
    throw new Error('no response content!');
  }

  assertEqual(
    decodeURIComponent((openai as any).stringifyQuery({ foo: { nested: { a: true, b: 'foo' } } })),
    'foo[nested][a]=true&foo[nested][b]=foo',
  );
  assertEqual(
    decodeURIComponent((openai as any).stringifyQuery({ foo: { nested: { a: ['hello', 'world'] } } })),
    'foo[nested][a][]=hello&foo[nested][a][]=world',
  );
}

main();
