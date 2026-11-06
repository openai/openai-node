import OpenAI from 'openai';
import { expect, test } from 'vitest';

test.each([
  ['value', { reasoning: { effort: 'high' } }, { effort: 'high' }],
  ['null', { reasoning: null }, null],
  ['omitted', {}, undefined],
] as const)('retrieves SVG reasoning when %s', async (_name, svg, expected) => {
  const requests: string[] = [];
  const client = new OpenAI({
    apiKey: 'test-key',
    baseURL: 'https://example.test/v1',
    fetch: async (url) => {
      requests.push(String(url));
      return Response.json({ tools: [{ type: 'image_generation', svg }] });
    },
  });

  const response = await client.responses.retrieve('resp_fixture');
  const [tool] = response.tools;
  expect(requests).toEqual(['https://example.test/v1/responses/resp_fixture']);
  if (tool?.type !== 'image_generation' || !tool.svg) {
    throw new Error('Missing image tool SVG settings');
  }
  expect(tool.svg.reasoning).toEqual(expected);
});
