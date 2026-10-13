import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import OpenAI from 'openai';
import { ComputerToolset } from 'openai/helpers/computer';
import { Desktop } from '../../computer-desktop/desktop.mjs';
import { createMixedFixture, createMixedSession, receiptText, runMixed } from './mixed-session.mjs';

const { values } = parseArgs({ options: { 'runtime-dir': { type: 'string' } } });
class SimulatedDesktop {
  controller = new AbortController();
  active = false;
  uncertainEffects = false;
  saved = false;
  typed = null;
  computer = new ComputerToolset({
    click: () => null,
    double_click: () => assert.fail('Unexpected double click.'),
    drag: () => assert.fail('Unexpected drag.'),
    move: () => null,
    scroll: () => assert.fail('Unexpected scroll.'),
    wait: () => null,
    type: (action) => {
      this.typed = action.text;
    },
    keypress: (action) => {
      if (action.keys.includes('S')) {
        this.saved = true;
      }
    },
    screenshot: () => ({ type: 'computer_screenshot', image_url: 'data:image/png;base64,AQ==' }),
  });
  async withComputer(work) {
    this.controller.signal.throwIfAborted();
    assert.equal(this.active, false);
    this.active = true;
    try {
      return await work(this.computer, this.controller.signal);
    } finally {
      this.active = false;
    }
  }
  async verify() {
    this.controller.signal.throwIfAborted();
    assert.equal(this.active, false, 'verification must happen after runner admission ends');
    return {
      file_matches: this.saved && this.typed === receiptText,
      file_empty: !this.saved,
      browser_matches: false,
      browser_effects: 0,
    };
  }
  async stop() {
    this.controller.abort();
  }
}

{
  const fixture = await createMixedFixture();
  const failure = new Error('Controlled workspace authorization failure');
  let context;
  let session;
  fixture.authorize = async (value) => {
    context = value;
    throw failure;
  };
  try {
    session = await createMixedSession({ desktop: new SimulatedDesktop(), fixture });
    assert.fail('Workspace setup unexpectedly succeeded');
  } catch (error) {
    assert.equal(error, failure);
    await assert.rejects(context.newPage(), /closed/u);
  } finally {
    await session?.close();
    await fixture.close();
  }
}

function scripted(fixture, test) {
  let calls = 0;
  let phase = 'read';
  const client = new OpenAI({
    apiKey: 'local-noncredential',
    maxRetries: 0,
    fetch: async (_, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      if (fixture.resultURL) {
        assert.equal(JSON.stringify(body).includes(new URL(fixture.resultURL()).pathname), false);
      }
      const id = `local_${calls}`;
      const outputs = body.input.filter((item) => item.type === 'function_call_output');
      const last = outputs.at(-1);
      const result = () => JSON.parse(last.output[0].text);
      const fn = (name, args) => ({
        type: 'function_call',
        status: 'completed',
        id,
        call_id: `call_${id}`,
        name,
        arguments: JSON.stringify(args),
      });
      let output;
      switch (phase) {
        case 'read': {
          if (test === 'premature-post') {
            const unadmitted = await fetch(`${fixture.origin}/route`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ case_id: 'D-2201', action: 'route' }),
            });
            assert.equal(unadmitted.status, 403);
            const deniedPage = await fetch(`${fixture.origin}/dispatch`);
            const deniedResult = await fetch(`${fixture.origin}/result`);
            assert.equal(deniedPage.status, 403);
            assert.equal(deniedResult.status, 403);
            assert.deepEqual(fixture.proof(), { routes: 0, resultRequests: 0, browserRouted: false });
          }
          output = fn('browser_read_page', { tab_id: null, filter: 'all' });
          phase = 'route';
          break;
        }
        case 'route': {
          const observed = result();
          assert.equal(observed.ok, true);
          const page = observed.result;
          const route = page.elements.find((element) => element.label === 'Route D-2201');
          assert.ok(route, 'must find the real host browser reference');
          output =
            test === 'navigation'
              ? fn('browser_navigate', { tab_id: null, url: `${fixture.origin}/result` })
              : fn('browser_click', { tab_id: null, target: route.ref });
          phase = 'wait';
          break;
        }
        case 'wait': {
          output = fn('browser_get_page_text', { tab_id: null });
          phase = 'receipt';
          break;
        }
        case 'receipt': {
          if (test === 'premature-post') {
            const deniedResult = await fetch(`${fixture.origin}/result`);
            assert.equal(deniedResult.status, 403);
            assert.equal(fixture.proof().resultRequests, 0);
          }
          if (!result().result.text.includes('Routed D-2201')) {
            output = fn('browser_get_page_text', { tab_id: null });
            break;
          }
          let args = { case_id: 'D-2201' };
          if (test === 'wrong-case') {
            args = { case_id: 'D-2202' };
          }
          if (test === 'extra-path') {
            args = { ...args, path: '/not-allowed' };
          }
          if (test === 'extra-url') {
            args = { ...args, url: `${fixture.origin}/result` };
          }
          output = fn('approved_receipt', args);
          phase = 'editor';
          break;
        }
        case 'editor': {
          assert.equal(last.output, receiptText, 'only verified fixed text reaches the model');
          output = {
            id,
            call_id: `call_${id}`,
            type: 'computer_call',
            status: 'completed',
            pending_safety_checks: [],
            actions: [
              { type: 'click', button: 'left', x: 700, y: 180 },
              { type: 'type', text: receiptText },
              { type: 'keypress', keys: ['CTRL', 'S'] },
            ],
          };
          phase = 'done';
          break;
        }
        case 'done': {
          output = {
            type: 'message',
            id,
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Finished', annotations: [] }],
          };
          break;
        }
        default: {
          throw new Error('Invalid exercise step');
        }
      }
      return Response.json({ id: `resp_${id}`, object: 'response', status: 'completed', output: [output] });
    },
  });
  return client;
}

const cases = values['runtime-dir']
  ? ['complete', 'native-denied']
  : [
      'complete',
      'browser-denied',
      'file-denied',
      'native-denied',
      'wrong-case',
      'extra-path',
      'extra-url',
      'altered',
      'partial',
      'premature-post',
      'navigation',
      'held-stop',
    ];
for (const test of cases) {
  const stop = new AbortController();
  // Each case needs its own browser, grant and receipt server; effects never cross cases.
  // oxlint-disable-next-line no-await-in-loop
  const fixture = await createMixedFixture(
    test === 'altered' ? { result: Buffer.from('Desktop receipt D-2202') } : { partial: test === 'partial' },
  );
  let desktop;
  try {
    desktop = values['runtime-dir']
      ? // oxlint-disable-next-line no-await-in-loop
        await Desktop.create({ runtimeDir: values['runtime-dir'] })
      : new SimulatedDesktop();
  } catch {
    // The runner never received ownership if guest startup failed.
    // oxlint-disable-next-line no-await-in-loop
    await fixture.close();
    throw new Error('Isolated desktop startup failed.');
  }
  let readyToDeny = false;
  const approve = async (label, signal) => {
    if (test === 'held-stop' && label.startsWith('Local function')) {
      stop.abort();
      await Promise.resolve();
      // Deliberately suppress cancellation. The application must still refuse.
      return true;
    }
    readyToDeny =
      (test === 'browser-denied' && label.startsWith('Host browser')) ||
      (test === 'file-denied' && label.startsWith('Local function')) ||
      (test === 'native-denied' && label.startsWith('Isolated desktop'));
    return !readyToDeny && !signal.aborted;
  };
  // oxlint-disable-next-line no-await-in-loop
  const proof = await runMixed({
    client: scripted(fixture, test),
    model: 'local-fixture',
    desktop,
    fixture,
    signal: stop.signal,
    approve,
  });
  const succeeds = test === 'complete' || test === 'premature-post';
  assert.equal(proof.verified, succeeds, JSON.stringify({ test, proof }));
  if (succeeds) {
    assert.deepEqual(proof.host, { routes: 1, resultRequests: 1, browserRouted: true });
    assert.equal(proof.transfer.disclosed, true);
    assert.equal(proof.guest.browserEffects, 0);
  } else {
    assert.equal(proof.transfer.disclosed, test === 'native-denied');
    assert.equal(proof.host.routes, ['browser-denied', 'navigation'].includes(test) ? 0 : 1);
    assert.equal(proof.host.resultRequests, ['native-denied', 'altered', 'partial'].includes(test) ? 1 : 0);
  }
  if (test === 'file-denied') {
    assert.deepEqual(proof.transfer, {
      status: 'refused',
      attempted: false,
      completed: false,
      disclosed: false,
    });
    assert.deepEqual(proof.uncertainEffects, { file: false, desktop: false });
  }
  if (test === 'altered' || test === 'partial') {
    assert.deepEqual(proof.transfer, {
      status: 'unknown',
      attempted: true,
      completed: false,
      disclosed: false,
    });
    assert.deepEqual(proof.uncertainEffects, { file: true, desktop: false });
  }
  // A stopped owner cannot be reused for another operation or verifier.
  // oxlint-disable-next-line no-await-in-loop
  await assert.rejects(desktop.verify());
  console.log(JSON.stringify({ test, proof }));
}
if (!values['runtime-dir']) {
  {
    const setup = await createMixedFixture();
    const stopped = new AbortController();
    let setupContext;
    let closedDuringSetup = false;
    setup.authorize = async (context) => {
      setupContext = context;
      const closed = once(context, 'close');
      stopped.abort();
      const outcome = await Promise.race([closed, delay(1000)]);
      closedDuringSetup = outcome !== undefined;
    };
    try {
      await assert.rejects(
        createMixedSession({ fixture: setup, desktop: new SimulatedDesktop(), signal: stopped.signal }),
      );
      await assert.rejects(setupContext.newPage(), /closed/u);
      assert.equal(closedDuringSetup, true, 'Stop must close the owned browser during the held setup await');
      assert.equal(
        setupContext.browser()?.isConnected() ?? false,
        false,
        'Browser teardown drains before setup returns',
      );
      assert.deepEqual(setup.proof(), { routes: 0, resultRequests: 0, browserRouted: false });
      console.log('PASS Stop during authorization closes the partial mixed context with no fixture effects');
    } finally {
      await setup.close();
    }
  }
  for (const stage of ['final', 'initial']) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each disposable workspace carries its own receipt.
    const fixtureForStop = await createMixedFixture();
    const desktopForStop = new SimulatedDesktop();
    // oxlint-disable-next-line eslint/no-await-in-loop
    const session = await createMixedSession({ desktop: desktopForStop, fixture: fixtureForStop });
    const stopped = new AbortController();
    const verify = desktopForStop.verify.bind(desktopForStop);
    try {
      if (stage === 'initial') {
        // oxlint-disable-next-line eslint/no-await-in-loop
        const first = await session.runPhase({
          client: scripted(fixtureForStop, 'complete'),
          model: 'fixture',
          approve: async () => true,
        });
        assert.equal(first.status, 'verified');
      }
      desktopForStop.verify = async () => {
        const observation = await verify();
        if (observation.file_matches) {
          stopped.abort();
        }
        return observation;
      };
      // oxlint-disable-next-line eslint/no-await-in-loop
      const proof = await session.runPhase({
        client: scripted(fixtureForStop, 'complete'),
        model: 'fixture',
        approve: async () => true,
        signal: stopped.signal,
      });
      assert.equal(proof.status, 'stopped', stage);
      assert.equal(proof.verified, true, 'Keep the settled business observation separate from Stop');
      assert.deepEqual(proof.host, { routes: 1, resultRequests: 1, browserRouted: true });
      console.log('PASS Stop during mixed verification', stage);
    } finally {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await session.close();
    }
  }
  {
    const disconnectedFixture = await createMixedFixture();
    const authorize = disconnectedFixture.authorize.bind(disconnectedFixture);
    let ownedBrowser;
    disconnectedFixture.authorize = async (context) => {
      ownedBrowser = context.browser();
      await authorize(context);
    };
    const session = await createMixedSession({
      desktop: new SimulatedDesktop(),
      fixture: disconnectedFixture,
    });
    const entered = Promise.withResolvers();
    let requestAborted = false;
    const client = new OpenAI({
      apiKey: 'local-noncredential',
      maxRetries: 0,
      fetch: async (_input, options) => {
        const blocked = Promise.withResolvers();
        entered.resolve();
        options.signal.addEventListener(
          'abort',
          () => {
            requestAborted = true;
            blocked.reject(options.signal.reason);
          },
          { once: true },
        );
        await blocked.promise;
        assert.fail('A disconnected browser cannot complete the held API request');
      },
    });
    const phase = session.runPhase({ client, model: 'fixture', approve: async () => true });
    try {
      await entered.promise;
      await ownedBrowser.close();
      const proof = await Promise.race([phase, delay(2000, null)]);
      assert.notEqual(proof, null, 'Browser disconnection must interrupt the admitted request');
      assert.equal(requestAborted, true);
      assert.equal(proof.status, 'browser_closed');
      assert.equal(proof.verified, false);
      assert.equal(proof.host.routes, 0);
      console.log('PASS mixed browser loss aborts an in-flight request without frame polling');
    } finally {
      await session.close();
    }
  }
  const fixture = await createMixedFixture();
  const { launch } = chromium;
  try {
    chromium.launch = async () => {
      throw new Error('Expected local startup failure');
    };
    const proof = await runMixed({ fixture, desktop: new SimulatedDesktop() });
    assert.equal(proof.status, 'failed');
    await fixture.close();
    console.log('PASS startup failure preserves its status and fixture close is idempotent');
  } finally {
    chromium.launch = launch;
    await fixture.close();
  }

  const cleanupFixture = await createMixedFixture();
  const remove = fs.rm;
  let retainedDirectory;
  fs.rm = async (target, options) => {
    if (path.basename(target).startsWith('desktop-evidence-') && options?.recursive) {
      retainedDirectory = target;
      throw new Error('Expected private ledger cleanup failure');
    }
    return remove(target, options);
  };
  syncBuiltinESMExports();
  try {
    const proof = await runMixed({
      fixture: cleanupFixture,
      desktop: new SimulatedDesktop(),
      client: scripted(cleanupFixture, 'complete'),
      model: 'local-fixture',
      approve: async () => true,
    });
    assert.equal(proof.status, 'cleanup_failed');
    assert.equal(proof.verified, true);
    assert.deepEqual(proof.transfer, {
      status: 'completed',
      attempted: true,
      completed: true,
      disclosed: true,
    });
    assert.deepEqual(proof.host, { routes: 1, resultRequests: 1, browserRouted: true });
    assert.deepEqual(proof.uncertainEffects, { file: false, desktop: false });
    assert.ok(proof.attempted > 0);
    assert.ok(proof.completed > 0);
    assert.ok(proof.consumedRequests > 0);
    console.log('PASS failed ledger cleanup preserves completed effects and request counts');
  } finally {
    fs.rm = remove;
    syncBuiltinESMExports();
    await cleanupFixture.close();
    if (retainedDirectory) {
      await remove(retainedDirectory, { recursive: true });
    }
  }
}

console.log(
  values['runtime-dir']
    ? 'Real isolated desktop lane complete'
    : 'Real Chromium and HTTP; native computer simulated only',
);
