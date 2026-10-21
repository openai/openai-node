import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import OpenAI, { APIError } from 'openai';
import { vertex } from 'openai/providers/vertex';
import { VERSION } from 'openai/version';

// Reused by Vitest against source and, when copied out of the checkout, by Node
// against a built package installed in a separate consumer. Never invokes a shell tool.
export async function runVertexAcceptance() {
  if (process.env['OPENAI_VERTEX_LIVE'] !== '1') {
    return;
  }
  const model = process.env['OPENAI_VERTEX_MODEL'];
  const reportPath = process.env['OPENAI_VERTEX_REPORT'];
  const mode = process.env['OPENAI_VERTEX_BUILD_MODE'] ?? 'source';
  let revision = process.env['OPENAI_VERTEX_REVISION'];
  if (!model || !reportPath) {
    throw new Error('Set OPENAI_VERTEX_MODEL and OPENAI_VERTEX_REPORT.');
  }
  if (mode === 'installed' && !revision) {
    throw new Error(
      'Installed mode requires OPENAI_VERTEX_REVISION from the checkout used to build the tarball.',
    );
  }
  revision ??= execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  const client = new OpenAI({
    provider: vertex({
      project: process.env['GOOGLE_CLOUD_PROJECT'],
      location: process.env['GOOGLE_CLOUD_LOCATION'],
      baseURL: process.env['OPENAI_VERTEX_BASE_URL'],
    }),
    logLevel: 'off',
    timeout: 60_000,
    maxRetries: 0,
  });
  const results = {};
  const checks = {
    async create_nonstored() {
      const response = await client.responses.create({ model, input: 'Say hello.', store: false });
      assert.ok(response.id && response.status === 'completed' && response.output_text);
    },
    async stream_completion() {
      const events = await client.responses.create({
        model,
        input: 'Say hello.',
        stream: true,
        store: false,
      });
      let completed = false;
      for await (const event of events) {
        assert.ok(!['response.failed', 'response.incomplete', 'error'].includes(event.type));
        if (event.type === 'response.completed') {
          completed = Boolean(event.response.id && event.response.status === 'completed');
        }
      }
      assert.ok(completed);
    },
    async function_tools_roundtrip() {
      const response = await client.responses.create({
        model,
        input: 'Use the test tool.',
        store: false,
        tools: [
          {
            type: 'function',
            name: 'test_tool',
            parameters: { type: 'object', properties: {} },
            strict: false,
          },
        ],
        tool_choice: { type: 'function', name: 'test_tool' },
      });
      assert.ok(response.status === 'completed');
      const call = response.output.find((item) => item.type === 'function_call');
      assert.ok(call);
      const result = await client.responses.create({
        model,
        store: false,
        input: [...response.output, { type: 'function_call_output', call_id: call.call_id, output: 'ok' }],
      });
      assert.ok(result.id && result.status === 'completed' && result.output.length);
    },
    async create_retrieve_previous_delete() {
      const response = await client.responses.create({ model, input: 'Remember 42.', store: true });
      try {
        assert.ok(response.id && response.status === 'completed');
        const retrieved = await client.responses.retrieve(response.id);
        assert.ok(retrieved.id === response.id);
        const followup = await client.responses.create({
          model,
          previous_response_id: response.id,
          input: 'What number did I give you?',
          store: false,
        });
        assert.ok(followup.id && followup.status === 'completed' && followup.output.length);
      } finally {
        await client.responses.delete(response.id);
      }
    },
    async compact() {
      const response = await client.responses.compact({ model, input: 'Say hello.' });
      assert.ok(response.id && response.output.length);
    },
  };
  for (const [name, operation] of Object.entries(checks)) {
    try {
      // Sequential live requests bound project usage and allow independent checks after failure.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await operation();
      results[name] = { status: 'pass' };
    } catch (error) {
      // Only SDK class and HTTP status. No arbitrary message/code/body, URLs or credentials.
      results[name] = { status: 'fail', exception: error instanceof Error ? error.name : 'Error' };
      if (error instanceof APIError && error.status !== undefined) {
        results[name].http_status = error.status;
      }
    }
  }
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp_utc: new Date().toISOString(),
        revision,
        build_mode: mode,
        package_version: VERSION,
        endpoint_origin: new URL(client.baseURL).origin,
        model,
        results,
      },
      null,
      2,
    ),
  );
  assert.ok(
    Object.values(results).every((result) => result.status === 'pass'),
    'Some checks failed; see private report.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env['OPENAI_VERTEX_LIVE'] === '1') {
    try {
      await runVertexAcceptance();
    } catch (error) {
      // Console output must not dump errors that can carry raw requests or credentials.
      console.error(
        'Vertex acceptance failed:',
        error instanceof Error ? error.name : 'Error',
        '- see private report.',
      );
      process.exitCode = 1;
    }
  } else {
    console.log('Vertex live acceptance skipped (OPENAI_VERTEX_LIVE is not 1).');
  }
}
