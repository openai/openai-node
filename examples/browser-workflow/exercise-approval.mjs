import { strict as assert } from 'node:assert';
import { chromium } from 'playwright';
import { BrowserError } from 'openai/helpers/browser';
import { createBrowserDriver } from '../responses/browser/driver.mjs';
import { approvalText, openWorkflow, serve } from './workflow.mjs';

const server = await serve();
try {
  let asked = [];
  const workflow = await openWorkflow(server, 'A', {
    confirm: async (action) => {
      const question = await approvalText(workflow.driver, action);
      asked.push(question);
      return !question.includes('Reserve');
    },
  });
  try {
    const read = JSON.parse(await workflow.observe());
    const original = read.elements.find((e) => e.label === 'Open REQ-401');
    assert.ok(original);
    const args = { tab_id: null, target: original.ref };
    const { driver } = workflow;
    assert.deepEqual(await driver.describe_target(args), { role: 'button', label: 'Open REQ-401' });
    assert.deepEqual(await driver.describe_target(args), { role: 'button', label: 'Open REQ-401' });
    assert.deepEqual(await workflow.stored(), { bookings: {}, correspondence: {} });
    const opened = await workflow.execute('click', args);
    assert.equal(opened.ok, true, 'describing must leave the ref valid');
    assert.deepEqual(asked, ['Allow click {"label":"Open REQ-401","role":"button"}? [y/N] ']);
    const second = JSON.parse(await workflow.observe());
    const booking = second.elements.find((e) => e.label === 'Reserve R2 Garden');
    assert.ok(booking);
    await assert.rejects(workflow.execute('click', { tab_id: null, target: booking.ref }));
    assert.ok(asked.at(-1).includes('Reserve R2 Garden'));
    assert.ok(!asked.at(-1).includes(booking.ref), 'opaque refs do not convey the intended effect');
    assert.equal(workflow.stopped.signal.aborted, true);
    assert.deepEqual(await workflow.stored({ signal: AbortSignal.timeout(5000) }), {
      bookings: {},
      correspondence: {},
    });
  } finally {
    await workflow.close();
  }

  asked = [];
  const renamed = await openWorkflow(server, 'A', {
    confirm: async (action) => {
      asked.push(await approvalText(renamed.driver, action));
      return true;
    },
  });
  try {
    const read = JSON.parse(await renamed.observe());
    const original = read.elements.find((e) => e.label === 'Open REQ-401');
    const args = { tab_id: null, target: original.ref };
    await renamed.page.locator('[data-request="REQ-401"]').evaluate((button) => {
      button.textContent = 'Open a different request';
    });
    await assert.rejects(() => renamed.driver.describe_target(args), BrowserError);
    const failed = await renamed.execute('click', args);
    assert.equal(failed.ok, false);
    assert.deepEqual(asked, [], 'do not ask approval against a changed label');
    assert.deepEqual(await renamed.stored(), { bookings: {}, correspondence: {} });
    const refreshed = JSON.parse(await renamed.observe());
    const replacement = refreshed.elements.find((e) => e.label === 'Open a different request');
    await renamed.observe();
    await assert.rejects(
      () => renamed.driver.describe_target({ tab_id: null, target: replacement.ref }),
      BrowserError,
    );
    assert.deepEqual(await renamed.stored(), { bookings: {}, correspondence: {} });
  } finally {
    await renamed.close();
  }

  const browser = await chromium.launch({
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? '/tmp' },
  });
  try {
    const context = await browser.newContext();
    assert.equal(
      createBrowserDriver(context).describe_target,
      undefined,
      'ordinary driver cannot describe owned refs',
    );
  } finally {
    await browser.close();
  }
  console.log(
    'PASS checked approval labels, refusal before booking, stale/renamed refs, no effect and owned-only description.',
  );
} finally {
  await server.close();
}
