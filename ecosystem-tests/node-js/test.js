const assert = require('node:assert/strict');
const OpenAI = require('openai');

const requests = [];
const options = {
  apiKey: 'synthetic-test-key',
  baseURL: 'https://example.test/v1',
  defaultQuery: { caller: 'present' },
  fetch: (url) => {
    requests.push(new URL(url));
    return Promise.resolve(
      Response.json({ id: 'synthetic-model', object: 'model', created: 0, owned_by: 'test' }),
    );
  },
};

class DerivedClient extends OpenAI {
  marker() {
    return this.baseURL;
  }

  defaultQuery() {
    return { ...super.defaultQuery(), from_subclass: 'true' };
  }
}

// oxlint-disable-next-line max-classes-per-file -- Verify constructor forwarding through two inheritance levels.
class GrandchildClient extends DerivedClient {}

void (async () => {
  try {
    assert.equal(typeof OpenAI, 'function');
    assert.equal(OpenAI.OpenAI, OpenAI.default);
    assert.equal(OpenAI.APIError, OpenAI.default.APIError);
    assert.equal(OpenAI.toFile, OpenAI.default.toFile);

    // Preserve construction with and without `new`, including the existing export aliases.
    for (const client of [new OpenAI(options), OpenAI(options), new OpenAI.default(options)]) {
      assert.ok(client instanceof OpenAI.default);
      assert.ok(client instanceof OpenAI, 'the CommonJS constructor should recognize its instances');
      assert.equal(client.apiKey, options.apiKey);
    }
    assert.equal(OpenAI.DEFAULT_TIMEOUT, OpenAI.default.DEFAULT_TIMEOUT);
    assert.equal(DerivedClient.DEFAULT_TIMEOUT, OpenAI.default.DEFAULT_TIMEOUT);

    const derived = new DerivedClient(options);
    const cloned = derived.withOptions({ maxRetries: 0 });
    const grandchild = new GrandchildClient(options);
    const clients = [derived, cloned, grandchild];
    for (const client of clients) {
      assert.ok(client instanceof OpenAI);
      assert.ok(client instanceof OpenAI.default);
      assert.ok(client instanceof DerivedClient);
      assert.equal(client.marker(), options.baseURL);
    }
    const models = await Promise.all(clients.map((client) => client.models.retrieve('synthetic-model')));
    for (const model of models) {
      assert.equal(model.id, 'synthetic-model');
    }
    assert.equal(derived.constructor, DerivedClient);
    assert.equal(cloned.constructor, DerivedClient);
    assert.ok(grandchild instanceof GrandchildClient);
    assert.equal(grandchild.constructor, GrandchildClient);
    assert.equal(requests.length, 3);
    for (const url of requests) {
      assert.equal(url.origin, 'https://example.test');
      assert.equal(url.pathname, '/v1/models/synthetic-model');
      assert.equal(url.searchParams.get('caller'), 'present');
      assert.equal(url.searchParams.get('from_subclass'), 'true');
    }

    console.log('CommonJS constructor compatibility checks passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
