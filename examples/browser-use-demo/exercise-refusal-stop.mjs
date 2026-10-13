import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createDemoServer } from './server.mjs';

const originalFetch = globalThis.fetch;
// oxlint-disable eslint/no-await-in-loop -- Each scenario owns one server and releases its finite request.
for (const stopped of [false, true]) {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let app;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).hostname === '127.0.0.1') {
      return originalFetch(request);
    }
    assert.equal(new URL(request.url).pathname, '/v1/decisions');
    entered.resolve();
    if (stopped) {
      await Promise.race([release.promise, delay(5000)]);
    }
    return Response.json({
      model: 'local-fixture',
      answers: [{ type: 'refusal', name: 'next_action' }],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    });
  };
  try {
    app = await createDemoServer({
      port: 0,
      apiKey: 'local-fixture',
      models: { decisions: 'local-fixture' },
    });
    const token = new URL(app.launchUrl).hash.slice('#token='.length);
    const call = async (route, body) => {
      const response = await originalFetch(app.origin + route, {
        method: body ? 'POST' : 'GET',
        headers: { 'X-Demo-Token': token, Origin: app.origin, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    await call('/api/start', { taskId: 'support', api: 'decisions', mode: 'live' });
    await Promise.race([entered.promise, delay(5000).then(() => assert.fail('Request did not start.'))]);
    if (stopped) {
      const { run: current } = await call('/api/state');
      await call('/api/stop', { runId: current.id });
      const { run: first } = await call('/api/state');
      assert.equal(first.owner, 'stopped');
      assert.equal(first.closing, true);
      await delay(40);
      const { run: second } = await call('/api/state');
      const exported = await call(`/api/export?run=${second.id}`);
      assert.ok(second.elapsedMs > first.elapsedMs, 'Duration advances while the request drains.');
      assert.ok(exported.elapsedMs >= second.elapsedMs, 'Export includes the current duration.');
      release.resolve();
    }
    let run;
    const deadline = performance.now() + 8000;
    do {
      ({ run } = await call('/api/state'));
      if (run.owner === 'stopped' && !run.closing) {
        break;
      }
      await delay(10);
    } while (performance.now() < deadline);
    assert.equal(run.status, stopped ? 'stopped' : 'refused');
    assert.equal(run.result, 'unverified');
    const exported = await call(`/api/export?run=${run.id}`);
    assert.equal(exported.status, run.status);
    assert.equal(exported.result, 'unverified');
    assert.equal(exported.cleanup, 'completed');
    await delay(20);
    const { run: completed } = await call('/api/state');
    assert.equal(completed.elapsedMs, run.elapsedMs, 'Completed duration is stable.');
    console.log(`PASS ${stopped ? 'Stop duration and cleanup' : 'refusal status and unverified result'}`);
  } finally {
    release.resolve();
    await app?.close();
    globalThis.fetch = originalFetch;
  }
}
// oxlint-enable eslint/no-await-in-loop
