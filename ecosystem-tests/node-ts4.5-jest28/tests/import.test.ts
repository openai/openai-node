import OpenAI from 'openai';
import type { RunnableTools } from 'openai/lib/RunnableFunction';

test('loads the CommonJS entrypoint through Jest 28', () => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Verify that the installed package exports a callable constructor in this module-loading environment.
  expect(typeof OpenAI).toBe('function');
  expect(() => new OpenAI({ apiKey: 'test', dangerouslyAllowBrowser: true })).not.toThrow();
});

test('types fixed runnable tool tuples on TypeScript 4.5', () => {
  const tools: RunnableTools<[{ city: string }, string]> = [
    {
      type: 'function',
      function: {
        function: (args) => args.city,
        parse: (city) => ({ city }),
        parameters: {},
        description: 'Returns the parsed city',
      },
    },
    {
      type: 'function',
      function: {
        function: (args) => args.toUpperCase(),
        parameters: {},
        description: 'Returns the raw arguments',
      },
    },
  ];

  expect(tools.map((tool) => tool.type)).toEqual(['function', 'function']);
});
