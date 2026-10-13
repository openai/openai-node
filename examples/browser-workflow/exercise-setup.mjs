import { strict as assert } from 'node:assert';
import { chromium } from 'playwright';
import { main, openWorkflow, serve } from './workflow.mjs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const directory = await mkdtemp(path.join(tmpdir(), 'workflow-setup-'));
const launch = chromium.launch.bind(chromium);
const browsers = [];
let fault = 'none';
chromium.launch = async (options) => {
  const browser = await launch(options);
  browsers.push(browser);
  if (fault === 'stop-launch') {
    process.emit('SIGINT');
  }
  const newContext = browser.newContext.bind(browser);
  const close = browser.close.bind(browser);
  browser.newContext = async (contextOptions) => {
    if (fault === 'context' || fault === 'close') {
      throw new Error('Synthetic context failure.');
    }
    const context = await newContext(contextOptions);
    if (fault === 'stop-context') {
      process.emit('SIGINT');
    }
    if (fault === 'stop-guard') {
      const route = context.route.bind(context);
      context.route = async (...args) => {
        await route(...args);
        process.emit('SIGINT');
      };
    }
    if (fault === 'guard') {
      context.route = async () => {
        throw new Error('Synthetic route failure.');
      };
    }
    if (fault === 'navigation' || fault === 'stop-navigation') {
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        const goto = page.goto.bind(page);
        page.goto = async (...args) => {
          if (fault === 'navigation') {
            throw new Error('Synthetic navigation failure.');
          }
          const result = await goto(...args);
          process.emit('SIGINT');
          return result;
        };
        return page;
      };
    }
    return context;
  };
  browser.close = async () => {
    if (fault === 'close') {
      throw new Error('Synthetic close failure.');
    }
    await close();
  };
  return browser;
};
const server = await serve();
try {
  const getuid = Object.getOwnPropertyDescriptor(process, 'getuid');
  try {
    Object.defineProperty(process, 'getuid', { value: undefined, configurable: true });
    await assert.rejects(
      main({ values: { mode: 'run', fixture: 'A', receipt: path.join(directory, 'unsupported.json') } }),
      /owner-only POSIX file permissions/u,
    );
    assert.equal(browsers.length, 0, 'unsupported private receipts fail before a browser or API call');
  } finally {
    if (getuid) {
      Object.defineProperty(process, 'getuid', getuid);
    } else {
      delete process.getuid;
    }
  }
  await assert.rejects(openWorkflow(server, 'A'), /approval callback/u);
  assert.equal(browsers.length, 0, 'invalid confirm must fail before Chromium launch');
  for (const failure of ['context', 'guard', 'navigation']) {
    fault = failure;
    // oxlint-disable-next-line no-await-in-loop -- Check and dispose each failed setup before changing the injected stage.
    await assert.rejects(openWorkflow(server, 'A', { confirm: async () => true }), /Synthetic/u);
    assert.equal(browsers.at(-1).isConnected(), false, `Close Chromium after ${failure} failure`);
  }

  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  const { exitCode } = process;
  const receipt = path.join(directory, 'failed-cleanup.json');
  try {
    process.env.OPENAI_API_KEY = 'synthetic-local-not-a-key';
    process.env.OPENAI_MODEL = 'synthetic-local';
    for (const stage of ['guard', 'navigation']) {
      fault = stage;
      const failedReceipt = path.join(directory, `failed-${stage}.json`);
      // oxlint-disable-next-line no-await-in-loop -- Each setup failure owns a separate browser and receipt.
      await main({ values: { mode: 'run', api: 'responses', fixture: 'A', receipt: failedReceipt } });
      // oxlint-disable-next-line no-await-in-loop -- Read the matching completed receipt.
      const failed = JSON.parse(await readFile(failedReceipt, 'utf-8'));
      assert.equal(failed.status, 'failed');
      assert.equal(failed.cleanup, true);
      assert.equal(failed.requests, 0);
    }
    for (const stage of ['launch', 'context', 'guard', 'navigation']) {
      fault = `stop-${stage}`;
      const stoppedReceipt = path.join(directory, `stopped-${stage}.json`);
      // oxlint-disable-next-line no-await-in-loop -- Stop each owned setup before starting the next.
      await main({ values: { mode: 'run', api: 'responses', fixture: 'A', receipt: stoppedReceipt } });
      assert.equal(process.exitCode, 1);
      assert.equal(browsers.at(-1).isConnected(), false, `stop during ${stage} closed Chromium`);
      // oxlint-disable-next-line no-await-in-loop -- Inspect each matching receipt.
      const stopped = JSON.parse(await readFile(stoppedReceipt, 'utf-8'));
      assert.deepEqual(stopped, { status: 'stopped', cleanup: true, requests: 0, calls: [], stored: null });
    }
    fault = 'close';
    await main({ values: { mode: 'run', api: 'responses', fixture: 'A', receipt } });
    assert.equal(process.exitCode, 1);
    assert.equal(browsers.at(-1).isConnected(), true, 'the injected cleanup failure is real');
    const saved = JSON.parse(await readFile(receipt, 'utf-8'));
    assert.deepEqual(saved, { status: 'failed', cleanup: false, requests: 0, calls: [], stored: null });
    const file = await stat(receipt);
    // oxlint-disable-next-line no-bitwise -- Check Unix owner-only permission bits.
    assert.equal(file.mode & 0o777, 0o600);
  } finally {
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
    fault = 'none';
  }
  console.log(
    'PASS invalid confirm never launches; context, guard and navigation failures close Chromium; failed cleanup receipt is truthful.',
  );
} finally {
  for (const browser of browsers) {
    // oxlint-disable-next-line no-await-in-loop -- Close each task-owned browser even when setup intentionally failed.
    await browser.close();
  }
  chromium.launch = launch;
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
