import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { expect, test } from 'vitest';

const source = readFileSync('examples/chat-completions/stream-to-client-raw.ts', 'utf-8');
const commentedRecipe = source.match(/\/\/ {3}fetch\([\s\S]*?\/\/ {3}\}\)\n/u)?.[0];
if (!commentedRecipe) {
  throw new Error('The raw streaming example must include its fetch consumer recipe.');
}
const recipe = commentedRecipe.replaceAll(/^\/\/ ?/gmu, '');

test.each([
  {
    name: 'preserves multibyte characters split across response chunks',
    bytes: new TextEncoder().encode('café 日本語 🐕'),
    expected: 'café 日本語 🐕',
  },
  {
    name: 'flushes an incomplete final character at EOF',
    bytes: Uint8Array.of(65, 0xe2, 0x82),
    expected: 'A\uFFFD',
  },
  {
    name: 'handles an empty response body',
    bytes: new Uint8Array(),
    expected: '',
  },
])('$name', async ({ bytes, expected }) => {
  const output: string[] = [];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) {
        controller.enqueue(Uint8Array.of(byte));
      }
      controller.close();
    },
  });

  // Execute the documented consumer itself so reverting the example also fails this test.
  await runInNewContext(recipe, {
    fetch: async () => new Response(body),
    TextDecoder,
    TextDecoderStream,
    console: {
      log: (line: string) => output.push(line.replace(/^chunk: /u, '')),
    },
  });

  expect(output.join('')).toBe(expected);
});
