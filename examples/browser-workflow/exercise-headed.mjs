// The launch boundary is local-only; a Linux display is not required for this contract check.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve, openWorkflow } from './workflow.mjs';

const original = chromium.launch;
const platform = Object.getOwnPropertyDescriptor(process, 'platform');
const originalEnv = process.env;
const values = {
  DISPLAY: ':77',
  WAYLAND_DISPLAY: 'wayland-77',
  XAUTHORITY: '/tmp/local-display-cookie',
  XDG_RUNTIME_DIR: '/tmp/local-wayland-runtime',
};
const fixture = await serve();
try {
  process.env = {
    ...originalEnv,
    ...values,
    OPENAI_API_KEY: 'synthetic-secret-never-forward',
    NODE_OPTIONS: '--synthetic-must-not-reach-chromium',
  };
  Object.defineProperty(process, 'platform', { value: 'linux' });
  // oxlint-disable no-await-in-loop -- Each boundary observation owns exactly one launch attempt.
  for (const headed of [true, false]) {
    let observed;
    chromium.launch = async (options) => {
      observed = options;
      throw new Error('Controlled launch boundary');
    };
    await assert.rejects(openWorkflow(fixture, 'A', { headed, confirm: async () => true }), /Controlled/u);
    assert.equal(observed.headless, !headed);
    assert.deepEqual(
      Object.keys(observed.env).toSorted(),
      ['HOME', 'PATH', 'TMPDIR', ...(headed ? Object.keys(values) : [])].toSorted(),
    );
    if (headed) {
      for (const [key, value] of Object.entries(values)) {
        assert.equal(observed.env[key], value);
      }
    }
  }
  // oxlint-enable no-await-in-loop
  console.log(
    'PASS Linux headed workflow forwards only4display variables; headless and credentials stay excluded',
  );
} finally {
  chromium.launch = original;
  process.env = originalEnv;
  Object.defineProperty(process, 'platform', platform);
  await fixture.close();
}
