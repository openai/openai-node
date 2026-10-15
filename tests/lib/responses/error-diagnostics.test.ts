import OpenAI from 'openai';
import { expect, test } from 'vitest';

for (const route of ['responses', 'beta', 'videos']) {
  for (const errorCase of ['values', 'nulls', 'omitted']) {
    test(`error diagnostics survive transport: ${route}/${errorCase}`, async () => {
      const video = route === 'videos';
      const identifier = video ? 'video_synthetic' : 'resp_synthetic';
      let requests = 0;
      const client = new OpenAI({
        apiKey: 'fake-test-key',
        baseURL: 'https://example.test',
        maxRetries: 0,
        fetch: async (url, init) => {
          requests += 1;
          const requestURL = new URL(String(url));
          expect(requestURL.pathname).toBe(`/${video ? 'videos' : 'responses'}/${identifier}`);
          expect(requestURL.searchParams.get('beta')).toBe(route === 'beta' ? 'true' : null);
          expect(init?.method).toBe('GET');
          return Response.json({
            id: identifier,
            error: {
              code: 'server_error',
              message: 'Synthetic failure',
              ...(errorCase === 'omitted'
                ? {}
                : {
                    type: errorCase === 'values' ? 'synthetic_error' : null,
                    param: errorCase === 'values' ? 'input[0]' : null,
                  }),
            },
          });
        },
      });
      const result = video
        ? await client.videos.retrieve(identifier)
        : await (route === 'beta' ? client.beta.responses : client.responses).retrieve(identifier);
      expect(requests).toBe(1);
      if (!result.error) {
        throw new Error('Expected error diagnostics');
      }
      const absent = errorCase === 'nulls' ? null : undefined;
      expect(result.error.type).toBe(errorCase === 'values' ? 'synthetic_error' : absent);
      expect(result.error.param).toBe(errorCase === 'values' ? 'input[0]' : absent);
      expect(result.error.code).toBe('server_error');
      expect(result.error.message).toBe('Synthetic failure');
    });
  }
}
