const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');

module.exports = function checkVertexTimeout(OpenAI, vertex) {
  return Promise.all(
    ['recover', 'exhaust', 'cancel', 'failure'].map(async (outcome) => {
      let attempts = 0;
      let requests = 0;
      const controller = new AbortController();
      const client = new OpenAI({
        provider: vertex({
          baseURL: 'https://vertex.example/v1',
          tokenProvider: async () => {
            attempts += 1;
            if (outcome === 'failure') {
              throw new Error('synthetic auth failure');
            }
            if (attempts === 1 || outcome === 'exhaust') {
              await delay(50);
              if (outcome === 'cancel') {
                controller.abort();
              }
            }
            return 'fixture-token';
          },
        }),
        timeout: 10,
        maxRetries: 1,
        fetch: () => {
          requests += 1;
          return Promise.resolve(Response.json({ id: 'resp_fixture', output: [] }));
        },
      });
      const response = client.responses.create(
        { model: 'fixture', input: 'hello' },
        { signal: controller.signal },
      );
      if (outcome === 'recover') {
        const result = await response;
        assert.equal(result.id, 'resp_fixture');
        assert.equal(requests, 1);
      } else {
        const timeoutOrAbort =
          outcome === 'cancel' ? OpenAI.APIUserAbortError : OpenAI.APIConnectionTimeoutError;
        await assert.rejects(
          response,
          outcome === 'failure' ? /Vertex authentication failed/u : timeoutOrAbort,
        );
        assert.equal(requests, 0);
      }
      assert.equal(attempts, outcome === 'recover' || outcome === 'exhaust' ? 2 : 1);
    }),
  );
};
