// oxlint-disable eslint/no-await-in-loop -- Each fixture restores its private Chromium launcher before the next starts.
// No API or VM: fixed mixed observations, finite native holds, and task capabilities.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { OpenAI } from 'openai';
import { ComputerToolset } from 'openai/helpers/computer';
import * as mixed from '../responses/browser/mixed-session.mjs';
import { executeDemo } from './runner.mjs';
import { Desktop } from '../computer-desktop/desktop.mjs';
import { createFieldworkMixed } from './mixed-session.mjs';

const checks = [];
const failures = [];
const unexpected = () => {
  throw new Error('The fixed observation must not execute input.');
};
async function check(name, body) {
  try {
    await body();
    checks.push(name);
  } catch (error) {
    failures.push({ name, error: String(error) });
  }
}
async function deadline() {
  await delay(800);
  throw new Error('Controlled Stop did not settle');
}
async function bounded(promise) {
  return Promise.race([promise, deadline()]);
}
for (const taskId of ['support', 'stock', 'reservation', 'service', 'files']) {
  await check(`form capability ${taskId}`, async () => {
    let frames = 0;
    const run = {
      taskId,
      owner: 'agent',
      ownerVersion: 0,
      api: 'responses',
      mode: 'rehearsal',
      controller: new AbortController(),
      addEvent() {
        return true;
      },
    };
    run.session = {
      base: { state: unexpected, get_page_text: unexpected, screenshot: unexpected },
      async capture() {
        frames += 1;
        run.controller.abort();
      },
    };
    await executeDemo({ origin: 'http://127.0.0.1', apiKey: 'synthetic', models: {}, run });
    const names = run.session
      .toolset()
      .tools()
      .map((tool) => tool.name)
      .toSorted();
    const required = [
      'browser_list_tabs',
      'browser_read_page',
      'browser_get_page_text',
      'browser_switch_tab',
      'browser_click',
      'browser_type',
      'browser_select_option',
    ];
    if (taskId === 'support' || taskId === 'stock') {
      required.push('browser_screenshot');
    }
    assert.deepEqual(names, required.toSorted());
    assert.equal(frames, 2, 'initial and terminal UI capture path remains active');
  });
}
for (const fail of ['none', 'desktop', 'fixture']) {
  await check(`predelegate cleanup ${fail}`, async () => {
    const attempts = [];
    const stop = async (name) => {
      attempts.push(name);
      if (name === fail) {
        throw new Error('Controlled private cleanup refusal');
      }
    };
    const work = mixed.cleanupMixedSetup({ stop: () => stop('desktop') }, { close: () => stop('fixture') });
    await (fail === 'none'
      ? work
      : assert.rejects(
          work,
          (error) =>
            error instanceof mixed.MixedSetupCleanupError &&
            error.message === 'Mixed workspace initialization cleanup failed.' &&
            !error.message.includes('private'),
        ));
    assert.deepEqual(attempts.toSorted(), ['desktop', 'fixture']);
  });
}
for (const operation of ['control', 'read', 'verify']) {
  for (const boundary of ['initial', 'final']) {
    await check(`${operation} ${boundary}`, async () => {
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      let held = false;
      let requests = 0;
      let verifies = 0;
      let watching = false;
      const stop = new AbortController();
      const hold = async () => {
        if (!watching || held) {
          return;
        }
        const expected = boundary === 'initial' ? 0 : 1;
        if (verifies !== expected) {
          return;
        }
        held = true;
        entered.resolve();
        await release.promise;
      };
      const originalLaunch = chromium.launch;
      chromium.launch = async function launch(options) {
        const browser = await originalLaunch.call(this, options);
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (...contextOptions) => {
          const context = await newContext(...contextOptions);
          context.on('page', (page) => {
            const locate = page.locator.bind(page);
            page.locator = (...args) => {
              const locator = locate(...args);
              if (operation === 'control' && args[0] === 'button[data-result]') {
                const getHandle = locator.elementHandle.bind(locator);
                locator.elementHandle = async (...handleOptions) => {
                  const handle = await getHandle(...handleOptions);
                  const evaluate = handle.evaluate.bind(handle);
                  handle.evaluate = async (...values) => {
                    const result = await evaluate(...values);
                    await hold();
                    return result;
                  };
                  return handle;
                };
              }
              return locator;
            };
            const frame = page.mainFrame();
            const frameLocate = frame.locator.bind(frame);
            frame.locator = (...args) => {
              const locator = frameLocate(...args);
              if (operation === 'read' && args[0] === 'html') {
                const evaluate = locator.evaluateHandle.bind(locator);
                locator.evaluateHandle = async (...values) => {
                  const result = await evaluate(...values);
                  await hold();
                  return result;
                };
              }
              return locator;
            };
          });
          return context;
        };
        return browser;
      };
      const fixture = await mixed.createMixedFixture();
      const input = {
        click: unexpected,
        double_click: unexpected,
        drag: unexpected,
        keypress: unexpected,
        move: unexpected,
        scroll: unexpected,
        type: unexpected,
        wait: unexpected,
        screenshot() {
          return { type: 'computer_screenshot', file_id: 'fixture_image' };
        },
      };
      const desktop = {
        id: 'local-fixture',
        uncertainEffects: false,
        async stop() {
          return true;
        },
        async verify({ signal } = {}) {
          if (operation === 'verify' && watching && verifies === (boundary === 'initial' ? 0 : 1)) {
            entered.resolve();
            await (signal
              ? // oxlint-disable-next-line promise/avoid-new -- The finite fake observes the native verification Stop signal.
                new Promise((resolve, reject) => {
                  const aborted = () => {
                    reject(signal.reason);
                  };
                  signal.addEventListener('abort', aborted, { once: true });
                  release.promise.then(() => {
                    signal.removeEventListener('abort', aborted);
                    resolve();
                  });
                })
              : release.promise);
          }
          verifies += 1;
          return { file_matches: false, file_empty: true, browser_matches: false, browser_effects: 0 };
        },
        async withComputer(work, { signal }) {
          return work(new ComputerToolset(input), signal);
        },
      };
      const client = new OpenAI({
        apiKey: 'synthetic',
        maxRetries: 0,
        baseURL: 'http://fixture.invalid/v1',
        fetch: async () => {
          requests += 1;
          return Response.json({
            id: 'response_one',
            object: 'response',
            model: '',
            status: 'completed',
            output: [
              {
                type: 'message',
                id: 'message_one',
                status: 'completed',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'done', annotations: [] }],
              },
            ],
          });
        },
      });
      let phase;
      let session;
      try {
        session = await mixed.createMixedSession({ desktop, fixture });
        watching = true;
        phase = session.runPhase({ client, model: '', signal: stop.signal, approve: async () => true });
        await bounded(entered.promise);
        stop.abort();
        const result = await bounded(phase);
        assert.equal(result.status, 'stopped');
        assert.equal(result.verified, false);
        assert.equal(requests, boundary === 'initial' ? 0 : 1);
      } finally {
        release.resolve();
        if (phase) {
          await phase;
        }
        await (session ? session.close() : Promise.allSettled([desktop.stop(), fixture.close()]));
        chromium.launch = originalLaunch;
      }
    });
  }
}
for (const operation of ['frame', 'input']) {
  await check(`close cancels host ${operation} before guest retirement`, async () => {
    const entered = Promise.withResolvers();
    const guestEntered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const originalCreate = Desktop.create;
    const originalLaunch = chromium.launch;
    let browser;
    let route;
    let session;
    let work;
    let closing;
    let guestStops = 0;
    Desktop.create = async () => ({
      id: 'controlled-close-order',
      uncertainEffects: false,
      verify: async () => ({
        file_matches: false,
        file_empty: true,
        browser_matches: false,
        browser_effects: 0,
      }),
      async stop() {
        guestStops += 1;
        guestEntered.resolve();
        await release.promise;
      },
    });
    chromium.launch = async function launch(options) {
      browser = await originalLaunch.call(this, options);
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...args) => {
        const context = await newContext(...args);
        context.on('page', (page) => {
          const locate = page.locator.bind(page);
          page.locator = (...selectors) => {
            const locator = locate(...selectors);
            if (selectors[0] === '#route') {
              const handle = locator.elementHandle.bind(locator);
              locator.elementHandle = async (...values) => {
                route = await handle(...values);
                return route;
              };
            }
            return locator;
          };
        });
        return context;
      };
      return browser;
    };
    const run = {
      owner: 'agent',
      ownerVersion: 0,
      started: performance.now(),
      checkpointSequence: 0,
      checkpointBytes: 0,
      checkpointDropped: 0,
      checkpoints: [],
      stop() {
        this.owner = 'stopped';
      },
    };
    try {
      session = await createFieldworkMixed({ runtimeDir: 'controlled-only', run });
      run.owner = 'human';
      run.ownerVersion += 1;
      const hold = async () => {
        const disconnected = once(browser, 'disconnected');
        entered.resolve();
        await Promise.race([disconnected, release.promise]);
        throw new Error('Controlled browser operation ended');
      };
      if (operation === 'frame') {
        browser.contexts()[0].pages()[0].screenshot = hold;
        work = session.refreshView();
      } else {
        assert.ok(route);
        route.boundingBox = hold;
        work = session.humanInput({ type: 'click', button: 'left', x: 0, y: 0 });
      }
      const settled = Promise.allSettled([work]);
      await bounded(entered.promise);
      closing = session.close();
      let finished = false;
      void closing
        .finally(() => {
          finished = true;
        })
        .catch(() => null);
      await bounded(guestEntered.promise);
      const [result] = await bounded(settled);
      assert.equal(result.status, 'rejected');
      assert.equal(browser.isConnected(), false);
      assert.equal(finished, false, 'Cleanup still owns the pending guest retirement');
      release.resolve();
      await closing;
      assert.equal(guestStops, 1, 'The inner session owns its guest retirement');
    } finally {
      release.resolve();
      await Promise.allSettled([work, closing ?? session?.close()]);
      await browser?.close();
      Desktop.create = originalCreate;
      chromium.launch = originalLaunch;
    }
  });
}
console.log(JSON.stringify({ count: checks.length + failures.length, checks, failures }, null, 2));
if (failures.length) {
  process.exitCode = 1;
}
