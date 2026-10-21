import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { compiledFixture } from './utils/compiled-fixtures';

test.each(['resource ID', 'credential keys'])(
  'redacts long %s without blocking public logging',
  (scenario) => {
    // The deadline must live outside the SDK process: a blocking regex also blocks
    // that process's timers. Use a generous bound, not a performance benchmark.
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `
        const assert = require('node:assert/strict');
        const OpenAI = require(process.argv[1]).default;
        const records = [];
        const capture = (...args) => records.push(args);
        const client = new OpenAI({
          apiKey: 'synthetic-api-secret',
          logLevel: 'debug',
          logger: { debug: capture, info: capture, warn: capture, error: capture },
          fetch: async (url, options) => {
            assert.equal(options.headers.get('authorization'), 'Bearer synthetic-api-secret');
            return Response.json({ id: 'file_synthetic', object: 'file' });
          },
        });
        (async () => {
          if (process.argv[2] === 'resource ID') {
            const id = 'file_' + 'a'.repeat(1024 * 1024);
            const response = await client.files.retrieve(id);
            assert.equal(response.id, 'file_synthetic');
            assert.ok(JSON.stringify(records).includes(id), 'resource ID must remain visible in logs');
          } else {
            const visibleKey = 'api'.repeat(262_144);
            const secretKey = visibleKey + 'key';
            const value = { [visibleKey]: 'visible', [secretKey]: 'synthetic-field-secret' };
            client.logger.debug(value);
            assert.equal(records[0][0][visibleKey], 'visible');
            assert.equal(records[0][0][secretKey], '[REDACTED]');
            assert.equal(value[secretKey], 'synthetic-field-secret', 'input must not be mutated');
          }
          client.logger.debug('https://synthetic-user:synthetic-password@proxy.example/visible');
          assert.equal(records.at(-1)[0], 'https://[REDACTED]@proxy.example/visible');
          const logged = JSON.stringify(records);
          for (const secret of ['synthetic-api-secret', 'synthetic-field-secret', 'synthetic-user', 'synthetic-password']) {
            assert.ok(!logged.includes(secret), 'credential must remain masked: ' + secret);
          }
          console.log('completed');
        })().catch(error => { console.error(error); process.exitCode = 1; });
      `,
        compiledFixture('src', 'index.ts'),
        scenario,
      ],
      {
        encoding: 'utf-8',
        timeout: 15_000,
        killSignal: 'SIGKILL',
        env: { ...process.env, NODE_OPTIONS: '' },
      },
    );
    expect(result.error, `${scenario}: ${result.error?.message ?? result.stderr}`).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('completed');
  },
);
