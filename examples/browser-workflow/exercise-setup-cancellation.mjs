// oxlint-disable eslint/no-await-in-loop -- Each finite case owns and restores the launcher and process receipt before the next.
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { main, openWorkflow } from './workflow.mjs';

const { launch } = chromium;
const { exitCode } = process;
const key = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL;
const tmp = await mkdtemp(path.join(tmpdir(), 'cu48-main-'));
const results = [];
try {
  process.env.OPENAI_API_KEY = 'synthetic-local-not-a-key';
  process.env.OPENAI_MODEL = 'synthetic-local';
  for (const failure of [false, true]) {
    for (const immediate of [false, true]) {
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const closed = Promise.withResolvers();
      let contexts = 0;
      let closes = 0;
      chromium.launch = async () => {
        entered.resolve();
        if (immediate) {
          process.emit('SIGINT');
        }
        await release.promise;
        return {
          async newContext() {
            contexts += 1;
            throw new Error('Stopped setup admitted a context');
          },
          async close() {
            closes += 1;
            closed.resolve();
            if (failure) {
              throw new Error('Controlled close failure');
            }
          },
        };
      };
      const receipt = path.join(tmp, `${failure}-${immediate}.json`);
      let work;
      try {
        work = main({ values: { mode: 'run', api: 'responses', fixture: 'A', receipt } });
        const outcome = Promise.allSettled([work]);
        await entered.promise;
        if (!immediate) {
          process.emit('SIGINT');
        }
        const returned = await Promise.race([outcome, delay(500, 'pending')]);
        assert.notEqual(returned, 'pending', 'Stop waits for launch in CLI');
        assert.equal(returned[0].status, 'fulfilled');
        const saved = JSON.parse(await readFile(receipt, 'utf-8'));
        assert.deepEqual(saved, { status: 'failed', cleanup: false, requests: 0, calls: [], stored: null });
        assert.equal(contexts, 0);
        assert.equal(closes, 0);
        release.resolve();
        await closed.promise;
        await delay(20);
        assert.equal(contexts, 0);
        assert.equal(closes, 1);
        assert.deepEqual(JSON.parse(await readFile(receipt, 'utf-8')), saved);
        results.push({ failure, immediate, pass: true });
      } finally {
        release.resolve();
        await Promise.allSettled([work]);
        chromium.launch = launch;
      }
    }
  }
  chromium.launch = async () => {
    throw new Error('Ordinary launch failure');
  };
  await assert.rejects(
    openWorkflow({ origin: 'http://127.0.0.1:1', fixtures: { A: {} } }, 'A', { confirm: async () => true }),
    (error) => error.message === 'Ordinary launch failure' && error.cleanup === undefined,
  );
  console.log(JSON.stringify({ results, api_calls: 0, vm_calls: 0 }));
} finally {
  chromium.launch = launch;
  process.exitCode = exitCode;
  if (key === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = key;
  }
  if (model === undefined) {
    delete process.env.OPENAI_MODEL;
  } else {
    process.env.OPENAI_MODEL = model;
  }
  await rm(tmp, { recursive: true, force: true });
}
