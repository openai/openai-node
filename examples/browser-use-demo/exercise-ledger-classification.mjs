// No VM or API: a task-owned guest probe ends its phase before the real ledger closes.
import assert from 'node:assert/strict';
import { readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Desktop } from '../computer-desktop/desktop.mjs';
import { createDemoServer } from './server.mjs';

const original = Desktop.create;
let checks = 0;
// oxlint-disable eslint/no-await-in-loop -- Each bounded case owns its app, guest and ledger independently.
for (const verified of [true, false]) {
  for (const failClose of [true, false]) {
    const before = new Set(await readdir(tmpdir()));
    let stopped = false;
    let app;
    Desktop.create = async () => ({
      id: 'local-ledger-check',
      uncertainEffects: false,
      captureFrame: async () => ({ frame: Buffer.from('local pixels'), width: 1024, height: 768 }),
      async verify() {
        if (failClose) {
          const entries = await readdir(tmpdir());
          const created = entries.filter((name) => name.startsWith('desktop-evidence-') && !before.has(name));
          assert.equal(created.length, 1);
          // Only this phase's freshly created path is removed, producing a finite close rejection.
          await rm(path.join(tmpdir(), created[0]), { recursive: true });
        }
        if (!verified) {
          throw new Error('Controlled pre-verification failure');
        }
        return { file_matches: true, browser_matches: true };
      },
      async withComputer() {
        assert.fail('No model request or input may be dispatched.');
      },
      async stop() {
        stopped = true;
      },
    });
    try {
      app = await createDemoServer({
        port: 0,
        apiKey: 'local-unused',
        models: { responses: 'local-unused' },
        desktopRuntime: 'local-no-vm',
      });
      const token = new URL(app.launchUrl).hash.slice('#token='.length);
      const call = async (route, body, expected = 200) => {
        const response = await fetch(`${app.origin}${route}`, {
          method: body ? 'POST' : 'GET',
          headers: {
            'X-Demo-Token': token,
            Origin: app.origin,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        assert.equal(response.status, expected, route);
        return response.json();
      };
      await call('/api/start', { environment: 'desktop', taskId: 'desktop', api: 'responses', mode: 'live' });
      let state;
      const deadline = performance.now() + 4000;
      do {
        ({ run: state } = await call('/api/state'));
        if (stopped && state.owner === 'stopped' && !['pending', 'not_started'].includes(state.cleanup)) {
          break;
        }
        await delay(10);
      } while (performance.now() < deadline);
      const receipt = await call(`/api/export?run=${state.id}`);
      const phaseStatus = verified ? 'complete' : 'failed';
      assert.equal(receipt.status, failClose ? 'cleanup_failed' : phaseStatus);
      assert.equal(receipt.result, verified ? 'verified' : 'unverified');
      assert.equal(receipt.cleanup, failClose ? 'failed' : 'completed');
      assert.equal(receipt.requests, 0);
      assert.equal(stopped, true);
      if (failClose) {
        await call(
          '/api/start',
          { environment: 'desktop', taskId: 'desktop', api: 'responses', mode: 'live' },
          409,
        );
        await assert.rejects(app.close(), AggregateError);
      } else {
        await app.close();
      }
      app = undefined;
      checks += 6;
    } finally {
      await app?.close().catch(() => null);
      Desktop.create = original;
    }
  }
}
// oxlint-enable eslint/no-await-in-loop
console.log(JSON.stringify({ checks, api_calls: 0, vendor_calls: 0 }));
