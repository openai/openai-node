const assert = require('node:assert/strict');
const { mock } = require('node:test');
const { GoogleAuth } = require('google-auth-library');

module.exports = async function checkVertexADC(OpenAI, vertex) {
  const getClient = mock.method(GoogleAuth.prototype, 'getClient', () =>
    Promise.resolve({
      getRequestHeaders: () => Promise.resolve(new Headers({ authorization: 'Bearer fixture-adc-token' })),
    }),
  );
  try {
    const client = new OpenAI({
      provider: vertex({ baseURL: 'https://vertex.example/v1' }),
      fetch: (_url, init) => {
        assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-adc-token');
        return Promise.resolve(Response.json({ id: 'resp_adc', output: [] }));
      },
    });
    const response = await client.responses.create({ model: 'fixture', input: 'hello' });
    assert.equal(response.id, 'resp_adc');
    assert.equal(getClient.mock.callCount(), 1);
  } finally {
    mock.restoreAll();
  }
};
