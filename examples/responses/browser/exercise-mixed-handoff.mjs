import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { access, readFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import OpenAI from 'openai';
import { ComputerToolset } from 'openai/helpers/computer';
import { createMixedFixture, createMixedSession, receiptText } from './mixed-session.mjs';

const unexpectedAction = () => assert.fail('Unexpected computer action in the mixed handoff');

class Native {
  id = 'synthetic-owned-desktop';
  controller = new AbortController();
  uncertainEffects = false;
  active = false;
  text = '';
  saved = '';
  hold;
  computer = new ComputerToolset({
    click: () => null,
    double_click: unexpectedAction,
    drag: unexpectedAction,
    move: () => null,
    scroll: unexpectedAction,
    wait: () => null,
    type: async ({ text }) => {
      if (this.hold) {
        const gate = this.hold;
        gate.started.resolve();
        await gate.release.promise;
      }
      this.text = text;
    },
    keypress: ({ keys }) => {
      if (keys.includes('A')) {
        this.text = '';
      }
      if (keys.includes('S')) {
        this.saved = this.text;
      }
    },
    screenshot: () => ({ type: 'computer_screenshot', image_url: 'data:image/png;base64,AQ==' }),
  });
  async withComputer(work) {
    assert.equal(this.active, false, 'native lease must be exclusive');
    this.controller.signal.throwIfAborted();
    this.active = true;
    try {
      return await work(this.computer, this.controller.signal);
    } finally {
      this.active = false;
    }
  }
  async verify() {
    assert.equal(this.active, false, 'fresh verifier must wait for native input');
    this.controller.signal.throwIfAborted();
    return {
      file_matches: this.saved === receiptText,
      file_empty: !this.saved,
      browser_matches: false,
      browser_effects: 0,
    };
  }
  async stop() {
    this.controller.abort();
  }
}

function script(fixture, snapshots) {
  let requests = 0;
  let next = 'read';
  const client = new OpenAI({
    apiKey: 'fixture-only',
    maxRetries: 0,
    fetch: async (_, options) => {
      requests += 1;
      const body = JSON.parse(options.body);
      if (requests === 1) {
        snapshots.push(body);
        assert.equal(body.input.length, 1, 'new phases never replay history');
        const [{ content }] = body.input;
        assert.ok(content.some((item) => item.type === 'input_image'));
        assert.ok(content[0].text.includes('checked'));
      }
      // IDs deliberately collide across phases. The owner counts them in distinct phases.
      const id = `step-${requests}`;
      const outputs = body.input.filter((item) => item.type === 'function_call_output');
      const fn = (name, args) => ({
        type: 'function_call',
        id,
        call_id: id,
        status: 'completed',
        name,
        arguments: JSON.stringify(args),
      });
      let output;
      if (next === 'read') {
        output = fn('browser_read_page', { tab_id: null, filter: 'all' });
        next = 'route';
      } else if (next === 'route' && !fixture.proof().browserRouted) {
        const observed = JSON.parse(outputs.at(-1).output[0].text);
        const route = observed.result.elements.find((element) => element.label === 'Route D-2201');
        output = fn('browser_click', { tab_id: null, target: route.ref });
        next = 'receipt';
      } else if (next === 'receipt' || next === 'route') {
        output = fn('approved_receipt', { case_id: 'D-2201' });
        next = 'editor';
      } else if (next === 'editor') {
        assert.equal(outputs.at(-1).output, receiptText);
        output = {
          type: 'computer_call',
          id,
          call_id: id,
          status: 'completed',
          pending_safety_checks: [],
          actions: [
            { type: 'click', button: 'left', x: 700, y: 180 },
            { type: 'type', text: receiptText },
            { type: 'keypress', keys: ['CTRL', 'S'] },
          ],
        };
        next = 'done';
      } else {
        output = {
          type: 'message',
          id,
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'done', annotations: [] }],
        };
      }
      return Response.json({ id: `response-${id}`, status: 'completed', output: [output] });
    },
  });
  return client;
}

async function phase(owner, fixture, signal, approve, snapshots = []) {
  return owner.runPhase({
    client: script(fixture, snapshots),
    model: 'synthetic',
    signal,
    approve,
  });
}

for (const pause of ['Host browser', 'Local function', 'Isolated desktop']) {
  const desktop = new Native();
  // Each case has independent controls, one grant and one receipt endpoint.
  // oxlint-disable-next-line eslint/no-await-in-loop
  const fixture = await createMixedFixture();
  // oxlint-disable-next-line eslint/no-await-in-loop
  const owner = await createMixedSession({ desktop, fixture });
  const stop = new AbortController();
  const entered = Promise.withResolvers();
  const gate = Promise.withResolvers();
  const snapshots = [];
  try {
    const running = phase(
      owner,
      fixture,
      stop.signal,
      async (label) => {
        if (label.startsWith(pause)) {
          entered.resolve();
          await gate.promise;
          return true;
        }
        return true;
      },
      snapshots,
    );
    // oxlint-disable-next-line eslint/no-await-in-loop
    await entered.promise;
    const ledger = owner.ledgerDirectory;
    assert.ok(ledger, 'pending phase has a private checkpoint');
    // oxlint-disable-next-line eslint/no-await-in-loop
    const files = await readdir(ledger);
    assert.ok(files.length > 0);
    // oxlint-disable-next-line eslint/no-await-in-loop
    const stored = JSON.parse(await readFile(`${ledger}/${files[0]}`, 'utf-8'));
    assert.ok(stored.consumed_requests >= 1);
    assert.ok(Array.isArray(stored.history));
    const consumed = owner.consumedRequests;
    stop.abort();
    // oxlint-disable-next-line eslint/no-await-in-loop
    await assert.rejects(owner.observe(), /busy|stopped/u);
    // oxlint-disable-next-line eslint/no-await-in-loop
    await assert.rejects(
      owner.humanInput('guest', { type: 'click', button: 'left', x: 700, y: 180 }),
      /busy|stopped/u,
    );
    // Abort did not admit human work or remove the in-flight ledger.
    // oxlint-disable-next-line eslint/no-await-in-loop
    await access(ledger);
    gate.resolve();
    // oxlint-disable-next-line eslint/no-await-in-loop
    const paused = await running;
    assert.equal(paused.status, 'stopped');
    // oxlint-disable-next-line eslint/no-await-in-loop
    await assert.rejects(access(ledger));
    // oxlint-disable-next-line eslint/no-await-in-loop
    const fresh = await owner.observe();
    assert.equal(fresh.verified, false);
    assert.equal(owner.permits('guest', { type: 'click', button: 'left', x: 120, y: 210 }), false);
    assert.equal(owner.permits('host', { type: 'type', text: receiptText }), false);
    assert.equal(owner.permits('guest', { type: 'type', text: receiptText }), pause === 'Isolated desktop');
    // oxlint-disable-next-line eslint/no-await-in-loop
    const final = await phase(owner, fixture, undefined, async () => true, snapshots);
    assert.equal(final.status, 'verified', JSON.stringify(final));
    assert.equal(final.verified, true);
    assert.deepEqual(final.host, { routes: 1, resultRequests: 1, browserRouted: true });
    assert.ok(final.consumedRequests > consumed && final.consumedRequests <= 20);
    assert.ok(final.attempted >= final.completed);
    assert.equal(snapshots.length, 2);
    const [{ text }] = snapshots[1].input[0].content;
    const observed = JSON.parse(text.slice(text.indexOf('\n') + 1));
    assert.equal(observed.checked.host.browserRouted, pause !== 'Host browser');
    assert.equal(observed.checked.transfer.completed, pause === 'Isolated desktop');
    assert.equal(Object.hasOwn(observed, 'approvedReceipt'), pause === 'Isolated desktop');
    if (observed.approvedReceipt) {
      assert.equal(observed.approvedReceipt, receiptText);
    }
    const total = owner.consumedRequests;
    // Already saved: Return verifies without spending another API turn.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const again = await phase(owner, fixture, undefined, async () =>
      assert.fail('no approval after completion'),
    );
    assert.equal(again.verified, true);
    assert.equal(owner.consumedRequests, total);
    console.log(
      JSON.stringify({ pause, requests: total, attempted: final.attempted, completed: final.completed }),
    );
  } finally {
    gate.resolve();
    // oxlint-disable-next-line eslint/no-await-in-loop
    await owner.close();
  }
}

// A human type can ignore cancellation too: Return cannot read or run the model underneath it.
{
  const fixture = await createMixedFixture();
  const desktop = new Native();
  const owner = await createMixedSession({ desktop, fixture });
  const stop = new AbortController();
  try {
    const paused = await phase(owner, fixture, stop.signal, async (label) => {
      if (label.startsWith('Isolated desktop')) {
        stop.abort();
      }
      return true;
    });
    assert.equal(paused.transfer.disclosed, true);
    desktop.hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
    const typing = owner.humanInput('guest', { type: 'type', text: receiptText });
    await desktop.hold.started.promise;
    const consumed = owner.consumedRequests;
    await assert.rejects(owner.observe(), /busy|stopped/u);
    await assert.rejects(
      phase(owner, fixture, undefined, async () => true),
      /busy|stopped/u,
    );
    assert.equal(owner.consumedRequests, consumed);
    desktop.hold.release.resolve();
    await typing;
    desktop.hold = undefined;
    await owner.humanInput('guest', { type: 'keypress', keys: ['CTRL', 'S'] });
    const completed = await phase(owner, fixture, undefined, async () => assert.fail('already saved'));
    assert.equal(completed.verified, true);
    assert.equal(owner.consumedRequests, consumed);
    console.log(JSON.stringify({ test: 'held-human-input', requests: consumed }));
  } finally {
    desktop.hold?.release.resolve();
    await owner.close();
  }
}

{
  const fixture = await createMixedFixture({ partial: true });
  const owner = await createMixedSession({ desktop: new Native(), fixture });
  try {
    const proof = await phase(owner, fixture, undefined, async () => true);
    assert.equal(proof.transfer.status, 'unknown');
    assert.equal(owner.hasUncertainEffects(), true);
    await assert.rejects(owner.observe(), /cannot be resumed/u);
    console.log(JSON.stringify({ test: 'unknown-transfer', requests: proof.consumedRequests }));
  } finally {
    await owner.close();
  }
}

// Hold the fixture's private receipt response in a task-local proxy after BP16 admission.
// A pending effect must not become sticky uncertainty if the admitted request completes.
{
  const original = await createMixedFixture();
  const resultPath = new URL(original.resultURL()).pathname;
  const requested = Promise.withResolvers();
  const release = Promise.withResolvers();
  const proxy = createServer(async (request, response) => {
    assert.ok(['/dispatch', '/route', resultPath].includes(request.url));
    const upstreamHeaders = {};
    if (request.url === resultPath) {
      assert.equal(request.headers.cookie, undefined, 'The file owner strips workspace authentication');
    } else if (request.headers.cookie) {
      upstreamHeaders.cookie = request.headers.cookie;
    }
    if (request.method === 'POST') {
      upstreamHeaders['content-type'] = request.headers['content-type'];
      upstreamHeaders['content-length'] = request.headers['content-length'];
    }
    const source = await fetch(`${original.origin}${request.url}`, {
      method: request.method,
      headers: upstreamHeaders,
      ...(request.method === 'POST'
        ? {
            body: request,
            duplex: 'half',
          }
        : {}),
    });
    const bytes = Buffer.from(await source.arrayBuffer());
    if (request.url === resultPath) {
      requested.resolve();
      await release.promise;
    }
    const headers = Object.fromEntries(source.headers);
    delete headers.connection;
    delete headers['keep-alive'];
    delete headers['transfer-encoding'];
    headers['content-length'] = String(bytes.length);
    response.writeHead(source.status, headers);
    response.end(bytes);
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const { port } = proxy.address();
  const origin = `http://127.0.0.1:${port}`;
  const fixture = { ...original, port, origin, resultURL: () => `${origin}${resultPath}` };
  const owner = await createMixedSession({ desktop: new Native(), fixture });
  const stop = new AbortController();
  try {
    const running = phase(owner, fixture, stop.signal, async () => true);
    await requested.promise;
    assert.equal(
      owner.hasUncertainEffects(),
      false,
      'an admitted transfer is still pending, not terminal unknown',
    );
    const ledger = owner.ledgerDirectory;
    stop.abort();
    await assert.rejects(owner.observe(), /busy|stopped/u);
    await access(ledger);
    release.resolve();
    const paused = await running;
    assert.deepEqual(paused.transfer, {
      status: 'completed',
      attempted: true,
      completed: true,
      disclosed: false,
    });
    assert.equal(owner.hasUncertainEffects(), false);
    let disclosures = 0;
    const snapshots = [];
    const completed = await phase(
      owner,
      fixture,
      undefined,
      async (label) => {
        if (label.startsWith('Local function')) {
          disclosures += 1;
        }
        return true;
      },
      snapshots,
    );
    assert.equal(completed.verified, true);
    assert.equal(disclosures, 1, 'completed transfer requires fresh disclosure-only consent');
    assert.equal(fixture.proof().resultRequests, 1);
    const [{ text }] = snapshots[0].input[0].content;
    const facts = JSON.parse(text.slice(text.indexOf('\n') + 1));
    assert.equal(facts.checked.transfer.completed, true);
    assert.equal(
      Object.hasOwn(facts, 'approvedReceipt'),
      false,
      'undisclosed text stays out of fresh history',
    );
    console.log(JSON.stringify({ test: 'held-healthy-transfer', requests: completed.consumedRequests }));
  } finally {
    release.resolve();
    await owner.close();
    await promisify(proxy.close.bind(proxy))();
  }
}

// Stop retires the environments while a noncooperative fetch still owns its private ledger.
{
  const fixture = await createMixedFixture();
  const desktop = new Native();
  const owner = await createMixedSession({ desktop, fixture });
  const pending = Promise.withResolvers();
  const release = Promise.withResolvers();
  const client = new OpenAI({
    apiKey: 'fixture',
    maxRetries: 0,
    fetch: async (_, options) => {
      const body = JSON.parse(options.body);
      const [{ text }] = body.input[0].content;
      const facts = JSON.parse(text.slice(text.indexOf('\n') + 1));
      const target = facts.host.elements.find((element) => element.label === 'Route D-2201').ref;
      pending.resolve();
      await release.promise;
      return Response.json({
        id: 'late',
        status: 'completed',
        output: [
          {
            type: 'function_call',
            id: 'late',
            call_id: 'late',
            status: 'completed',
            name: 'browser_click',
            arguments: JSON.stringify({ tab_id: null, target }),
          },
        ],
      });
    },
  });
  const running = owner.runPhase({
    client,
    model: 'synthetic',
    approve: async () => assert.fail('late consent after Stop'),
  });
  try {
    await pending.promise;
    const ledger = owner.ledgerDirectory;
    const closing = owner.close();
    await access(ledger);
    await assert.rejects(owner.observe(), /busy|stopped/u);
    await assert.rejects(desktop.verify());
    assert.deepEqual(fixture.proof(), { routes: 0, resultRequests: 0, browserRouted: false });
    release.resolve();
    await closing;
    const stopped = await running;
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.verified, false);
    assert.deepEqual(stopped.host, { routes: 0, resultRequests: 0, browserRouted: false });
    await assert.rejects(access(ledger));
    console.log(JSON.stringify({ test: 'retire-during-held-fetch', requests: stopped.consumedRequests }));
  } finally {
    release.resolve();
    await running;
    await owner.close();
  }
}

// Fixed total logical request budget across aborted phases, even when IDs repeat.
{
  const fixture = await createMixedFixture();
  const owner = await createMixedSession({ desktop: new Native(), fixture });
  try {
    for (let index = 0; index < 20; index += 1) {
      const stop = new AbortController();
      const client = new OpenAI({
        apiKey: 'fixture',
        maxRetries: 0,
        fetch: async () => {
          stop.abort();
          await delay(0);
          return Response.json({ id: 'late', status: 'completed', output: [] });
        },
      });
      // oxlint-disable-next-line eslint/no-await-in-loop
      await owner.runPhase({ client, model: 'synthetic', signal: stop.signal, approve: async () => true });
    }
    assert.equal(owner.consumedRequests, 20);
    const exhausted = await phase(owner, fixture, undefined, async () => assert.fail('budget exhausted'));
    assert.equal(exhausted.status, 'failed');
    assert.equal(owner.consumedRequests, 20);
    console.log(JSON.stringify({ test: 'shared-budget', requests: owner.consumedRequests }));
  } finally {
    await owner.close();
  }
}
console.log(
  'Eight controlled mixed handoff cases passed; real host Chromium/HTTP, simulated native desktop.',
);
