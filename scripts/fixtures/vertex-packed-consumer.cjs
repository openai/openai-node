const assert = require('node:assert/strict');

module.exports = async function checkVertex(OpenAI, vertex) {
  assert.throws(() => require.resolve('google-auth-library'), { code: 'MODULE_NOT_FOUND' });
  let requests = 0;
  const fetch = (_url, init) => {
    requests += 1;
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-token');
    return Promise.resolve(Response.json({ id: 'resp_fixture', object: 'response', output: [] }));
  };
  const baseURL = 'https://vertex.example/v1';
  const params = { model: 'fixture', input: 'hello' };
  const callback = new OpenAI({ provider: vertex({ baseURL, tokenProvider: () => 'fixture-token' }), fetch });
  await callback.responses.create(params);
  const adc = new OpenAI({ provider: vertex({ baseURL }), fetch });
  await assert.rejects(adc.responses.create(params), {
    message: 'Vertex authentication failed. Check ADC and google-auth-library, or supply tokenProvider.',
  });
  assert.equal(requests, 1);
};
