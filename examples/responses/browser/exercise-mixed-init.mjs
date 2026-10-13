/* eslint-disable no-await-in-loop -- Each controlled initialization restores the original browser launcher. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { runMixed } from './mixed-session.mjs';

const original = chromium.launch;
try {
  chromium.launch = async () => {
    throw new Error('Controlled initialization refusal');
  };
  for (const failing of ['none', 'desktop', 'fixture']) {
    const attempts = { desktop: 0, fixture: 0 };
    const stop = async (owner) => {
      attempts[owner] += 1;
      if (failing === owner && attempts[owner] === 1) {
        throw new Error('Controlled first cleanup refusal');
      }
    };
    const desktop = { uncertainEffects: false, stop: () => stop('desktop') };
    const fixture = { proof: () => ({ routed: false }), close: () => stop('fixture') };
    const result = await runMixed({ desktop, fixture });
    assert.equal(result.status, failing === 'none' ? 'failed' : 'cleanup_failed');
    assert.equal(result.verified, false);
    assert.deepEqual(attempts, { desktop: 2, fixture: 2 });
  }
  console.log('PASS successful retry cannot erase failed mixed setup cleanup; clean refusal stays failed');
} finally {
  chromium.launch = original;
}
