import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDemoServer } from './server.mjs';
import { createDiagnosticCapture, readDiagnosticTrace } from './diagnostics.mjs';

const secret = 'synthetic-diagnostic-credential';
const capture = createDiagnosticCapture({ secrets: [secret] });
const originalFetch = globalThis.fetch;
let app;
let requests = 0;
try {
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).pathname, '/v1/decisions');
    const body = await request.json();
    const label = ['Click Technical', 'Click Technical', 'Click Account'][requests];
    const choice = body.questions[0].choices.find((item) => item.description === label)?.value;
    assert.ok(choice, 'The controlled wrong choice must come from the actual offered list.');
    requests += 1;
    return Response.json({
      object: 'decision',
      id: `local-${requests}`,
      model: 'local-diagnostic-check',
      answers: [
        {
          name: 'next_action',
          type: 'choice',
          choice,
          confidence: 1,
          probabilities: [{ value: choice, probability: 1 }],
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 1,
        total_tokens: 11,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    });
  };
  app = await createDemoServer({
    port: 0,
    apiKey: secret,
    models: { decisions: 'local-diagnostic-check' },
    diagnosticCapture: capture,
  });
  const pageResponse = await originalFetch(app.origin);
  const html = await pageResponse.text();
  const token = new URL(app.launchUrl).hash.slice('#token='.length);
  assert.ok(!html.includes(token), 'Public HTML cannot authorize controls.');
  assert.ok(token);
  const call = async (pathname, body) => {
    const response = await originalFetch(`${app.origin}${pathname}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Demo-Token': token, Origin: app.origin, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  await call('/api/start', { taskId: 'support', api: 'decisions', mode: 'live' });
  let run;
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline) {
    // The current run must finish and close before reading its final trace.
    // oxlint-disable-next-line no-await-in-loop
    const current = await call('/api/state');
    ({ run } = current);
    if (run.owner === 'stopped' && !run.closing) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop
    await delay(20);
  }
  assert.equal(run.result, 'unverified');
  assert.equal(requests, 3);
  const exported = await call(`/api/export?run=${run.id}`);
  assert.equal(exported.cleanup, 'completed');
  assert.deepEqual(exported.diagnostics.usage, {
    recordedRequests: 3,
    missingRequests: 0,
    complete: true,
    inputTokens: 30,
    outputTokens: 3,
    totalTokens: 33,
  });
  const publicText = JSON.stringify(exported);
  for (const value of [secret, 'Charged twice', 'Technical', capture.directory, 'data:image/']) {
    assert.equal(publicText.includes(value), false);
  }
  const filename = path.join(capture.directory, 'run-1.jsonl');
  const trace = readDiagnosticTrace(filename);
  assert.equal(trace.incomplete, false);
  const choices = trace.records.find((record) => record.kind === 'choices').data;
  const selected = trace.records.find(
    (record) => record.kind === 'runner' && record.data.stage === 'selection',
  ).data;
  assert.equal(choices.find((choice) => choice.id === selected.call_id).description, 'Click Technical');
  assert.ok(
    trace.records.some(
      (record) => record.kind === 'observation' && JSON.stringify(record.data).includes('Charged twice'),
    ),
  );
  assert.ok(
    trace.records.some(
      (record) => record.kind === 'effect' && record.data.state.results[0].choice === 'Technical',
    ),
  );
  assert.ok(trace.records.some((record) => record.kind === 'verification' && record.data.verified === false));
  assert.equal(readFileSync(filename, 'utf-8').includes('data:image/'), false);
  const privateFile = await originalFetch(`${app.origin}/run-1.jsonl`, {
    headers: { 'X-Demo-Token': token, Origin: app.origin },
  });
  assert.equal(privateFile.status, 404);
  console.log(
    'PASS actual wrong choice is reconstructible from private trace; safe export retains actual usage only',
  );
} finally {
  await app?.close();
  globalThis.fetch = originalFetch;
  rmSync(capture.directory, { recursive: true, force: true });
}
