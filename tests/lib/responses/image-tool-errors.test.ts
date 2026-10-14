import OpenAI from 'openai';
import { expect, test } from 'vitest';

for (const beta of [false, true]) {
  for (const errorCase of ['values', 'nulls', 'no_moderation', 'no_error']) {
    test(`image tool errors survive transport: beta=${beta}, errorCase=${errorCase}`, async () => {
      const error = {
        code: errorCase === 'nulls' ? null : 'moderation_blocked',
        param: errorCase === 'nulls' ? null : 'input[0]',
        type: 'image_tool_error',
        message: 'Synthetic moderation failure',
        ...(errorCase === 'no_moderation'
          ? {}
          : {
              moderation_details: { moderation_stage: 'output', categories: ['synthetic_future_category'] },
            }),
      };
      let requests = 0;
      const client = new OpenAI({
        apiKey: 'fake-test-key',
        baseURL: 'https://example.test',
        fetch: async (url, init) => {
          requests += 1;
          const requestURL = new URL(String(url));
          expect(requestURL.pathname).toBe('/responses/resp_synthetic');
          expect(requestURL.searchParams.get('beta')).toBe(beta ? 'true' : null);
          expect(init?.method).toBe('GET');
          return Response.json({
            id: 'resp_synthetic',
            output: [
              {
                id: 'img_synthetic',
                type: 'image_generation_call',
                status: 'failed',
                result: null,
                ...(errorCase === 'no_error' ? {} : { error }),
              },
            ],
          });
        },
      });
      const response = await (beta ? client.beta.responses : client.responses).retrieve('resp_synthetic');
      expect(requests).toBe(1);
      const [item] = response.output;
      if (!item || item.type !== 'image_generation_call') {
        throw new Error('Expected an image tool call');
      }
      if (errorCase === 'no_error') {
        expect(item.error).toBeUndefined();
        return;
      }
      if (!item.error) {
        throw new Error('Expected image tool error details');
      }
      expect(item.error.code).toBe(errorCase === 'nulls' ? null : 'moderation_blocked');
      expect(item.error.param).toBe(errorCase === 'nulls' ? null : 'input[0]');
      expect(item.error.type).toBe('image_tool_error');
      expect(item.error.message).toBe('Synthetic moderation failure');
      if (errorCase === 'no_moderation') {
        expect(item.error.moderation_details).toBeUndefined();
      } else {
        expect(item.error.moderation_details?.moderation_stage).toBe('output');
        expect(item.error.moderation_details?.categories).toEqual(['synthetic_future_category']);
      }
    });
  }
}
