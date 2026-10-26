const assert = require('node:assert/strict');
const { mock } = require('node:test');
const { GoogleAuth, OAuth2Client } = require('google-auth-library');

class FixtureCredentials extends OAuth2Client {
  refreshes = 0;

  constructor() {
    super();
    this.quotaProjectId = 'fixture-quota';
    this.setCredentials({ refresh_token: 'fixture-refresh-token', expiry_date: 0 });
  }

  async refreshTokenNoCache() {
    this.refreshes += 1;
    await Promise.resolve();
    return {
      tokens: { access_token: `fixture-token-${this.refreshes}`, expiry_date: Date.now() + 3_600_000 },
      res: null,
    };
  }
}

module.exports = async function checkVertexADC(OpenAI, vertex) {
  // Use Google's real header generation, expiry and refresh deduplication, with synthetic token exchange.
  const credentials = new FixtureCredentials();
  const seen = [];
  const credentialClient = new OpenAI({
    provider: vertex({ baseURL: 'https://vertex.example/v1', credentials }),
    fetch: (_url, init) => {
      seen.push(new Headers(init.headers));
      return Promise.resolve(Response.json({ id: 'resp_credentials', output: [] }));
    },
  });
  const params = { model: 'fixture', input: 'hello' };
  await Promise.all(Array.from({ length: 8 }, () => credentialClient.responses.create(params)));
  assert.equal(credentials.refreshes, 1);
  assert(seen.every((headers) => headers.get('authorization') === 'Bearer fixture-token-1'));
  credentials.credentials.expiry_date = Date.now() - 3_600_000;
  await credentialClient.responses.create(params);
  assert.equal(credentials.refreshes, 2);
  assert.equal(seen.at(-1).get('authorization'), 'Bearer fixture-token-2');
  assert(seen.every((headers) => headers.get('x-goog-user-project') === 'fixture-quota'));

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
