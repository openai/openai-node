import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { makeSnapshotRequest } from '../utils/mock-snapshots';

jest.setTimeout(1000 * 30);

describe('.parse()', () => {
  describe('zod', () => {
    it('deserialises response_format', async () => {
      const completion = await makeSnapshotRequest((openai) =>
        openai.beta.chat.completions.parse({
          model: 'gpt-4o-2024-08-06',
          messages: [
            {
              role: 'user',
              content: "What's the weather like in SF?",
            },
          ],
          response_format: zodResponseFormat(
            z.object({
              city: z.string(),
              units: z.enum(['c', 'f']).default('f'),
            }),
            'location',
          ),
        }),
      );

      expect(completion.choices[0]).toMatchInlineSnapshot(`
        {
          "finish_reason": "stop",
          "index": 0,
          "logprobs": null,
          "message": {
            "content": "{"city":"San Francisco","units":"f"}",
            "parsed": {
              "city": "San Francisco",
              "units": "f",
            },
            "role": "assistant",
            "tool_calls": [],
          },
        }
      `);
    });
  });
});
