/* oxlint-disable no-await-in-loop -- Each workflow step depends on the prior browser action; sessions are disposed before the next case. */
import { strict as assert } from 'node:assert';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import OpenAI from 'openai';
import { ResponsesToolRunner, ResponsesToolRunnerError } from 'openai/helpers/responses-tool-runner';
import { serve, openWorkflow } from './workflow.mjs';

async function storedAfterStop(workflow, variant) {
  return JSON.parse(
    await workflow.page.evaluate(
      (id) =>
        JSON.stringify({
          bookings: JSON.parse(localStorage.getItem(`workflow.${id}.bookings`) || '{}'),
          correspondence: JSON.parse(localStorage.getItem(`workflow.${id}.correspondence`) || '{}'),
        }),
      variant,
    ),
  );
}

const { values } = parseArgs({ options: { output: { type: 'string' } } });
const server = await serve();
const receipt = [];
try {
  const approvals = [];
  const navigation = await openWorkflow(server, 'A', {
    confirm: async (action) => {
      approvals.push(action.member);
      return true;
    },
  });
  try {
    const initialURL = navigation.page.url();
    for (const url of [
      `${server.origin}/fixtures.json`,
      `${server.origin}/app.js`,
      'about:blank',
      `${server.origin}/inbox?fixture=B`,
    ]) {
      const result = await navigation.execute('navigate', { tab_id: null, url });
      assert.equal(result.ok, false, 'Navigation must stay within the selected workflow pages');
      assert.equal(navigation.page.url(), initialURL);
      assert.deepEqual(approvals, []);
    }
    for (const route of ['/schedule', '/dispatch', '/inbox']) {
      const url = `${server.origin}${route}?fixture=A`;
      const result = await navigation.execute('navigate', { tab_id: null, url });
      assert.equal(result.ok, true);
      assert.equal(navigation.page.url(), url);
      await navigation.observe();
    }
    assert.deepEqual(approvals, ['navigate', 'navigate', 'navigate']);
  } finally {
    await navigation.close();
  }
  const originalRun = ResponsesToolRunner.prototype.run;
  try {
    const client = new OpenAI({
      apiKey: 'synthetic-no-requests',
      fetch: async () => {
        throw new Error('No API call is allowed in this receipt check.');
      },
    });
    for (const stage of ['runner', 'verification']) {
      const current = await openWorkflow(server, 'A', { confirm: async () => true });
      try {
        if (stage === 'runner') {
          ResponsesToolRunner.prototype.run = async () => {
            throw new ResponsesToolRunnerError('Maximum tool steps reached.', [], []);
          };
        } else {
          ResponsesToolRunner.prototype.run = async () => ({ output: [] });
          current.page.evaluate = async () => {
            throw new ResponsesToolRunnerError('PRIVATE_VERIFICATION_SENTINEL', [], []);
          };
        }
        await assert.rejects(current.run(client, 'local', 'responses'), ResponsesToolRunnerError);
        assert.deepEqual(
          current.metrics.runnerError,
          stage === 'runner'
            ? { name: 'ResponsesToolRunnerError', message: 'Maximum tool steps reached.' }
            : null,
        );
        assert.doesNotMatch(JSON.stringify(current.metrics), /PRIVATE_VERIFICATION_SENTINEL/u);
      } finally {
        await current.close();
      }
    }
  } finally {
    ResponsesToolRunner.prototype.run = originalRun;
  }
  for (const [variant, id, slot, recipient] of [
    ['A', 'REQ-401', 'R2 Garden', 'cedar@example.test'],
    ['B', 'REQ-718', 'T2 Garden', 'aster@example.test'],
  ]) {
    const w = await openWorkflow(server, variant, { confirm: async () => true });
    try {
      assert.equal(await w.verify(), false, 'Done at the start must stay unverified');
      assert.match(JSON.parse(await w.observe()).lastVerification, /No booking is saved/u);
      const checks = [];
      for (const label of [`Open ${id}`, `Reserve ${slot}`, 'Outgoing', `Send ${id} to ${recipient}`]) {
        const observation = JSON.parse(await w.observe());
        const actions = await w.candidates(JSON.stringify(observation));
        checks.push({
          text: observation.text,
          actions: actions.map(({ id: candidateId, description, done }) => ({
            id: candidateId,
            description,
            done: !!done,
          })),
        });
        const action = actions.find((item) => item.description === `Click ${label}`);
        assert.ok(action, `No ${label} in ${JSON.stringify(checks.at(-1))}`);
        const result = await action.execute();
        assert.equal(result.ok, true, JSON.stringify(result));
      }
      await w.page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(await w.verify(), true, 'Saved records must pass after reload');
      receipt.push({ variant, checks, stored: await w.stored(), verified: true });
    } finally {
      await w.close();
    }
  }

  const staleStore = await openWorkflow(server, 'A', { confirm: async () => true });
  try {
    await staleStore.page.evaluate(() => {
      localStorage.setItem('workflow.A.bookings', '{"unfinished":');
      localStorage.setItem('workflow.A.selected', JSON.stringify('REQ-401'));
    });
    await staleStore.page.goto(`${server.origin}/dispatch?fixture=A`);
    assert.match(await staleStore.page.locator('#app').textContent(), /No saved bookings/u);
    assert.deepEqual(
      await staleStore.page.evaluate(() => ({
        bookings: localStorage.getItem('workflow.A.bookings'),
        selected: localStorage.getItem('workflow.A.selected'),
      })),
      { bookings: null, selected: JSON.stringify('REQ-401') },
    );
    assert.equal(await staleStore.verify(), false);
    await staleStore.page.evaluate(() => {
      localStorage.setItem(
        'workflow.A.bookings',
        JSON.stringify({
          obsolete: { request: 'obsolete', slot: 'R2', time: '10:00' },
          'REQ-401': null,
        }),
      );
    });
    await staleStore.page.goto(`${server.origin}/dispatch?fixture=A`);
    assert.equal(await staleStore.page.locator('[data-send]').count(), 0);
    assert.equal(await staleStore.page.locator('[data-revise]').count(), 2);
    await staleStore.page.locator('[data-revise="obsolete"]').click();
    await staleStore.page.locator('[data-revise="REQ-401"]').click();
    assert.deepEqual(await staleStore.stored(), { bookings: {}, correspondence: {} });
    assert.equal(await staleStore.verify(), false);
  } finally {
    await staleStore.close();
  }
  for (const loss of ['page', 'context']) {
    const session = await openWorkflow(server, 'A', { confirm: async () => true });
    try {
      assert.equal(session.stopped.signal.aborted, false);
      await (loss === 'page' ? session.page.close() : session.page.context().close());
      assert.equal(session.stopped.signal.aborted, true, loss);
    } finally {
      await session.close();
    }
  }
  let allowRevision = true;
  const wrong = await openWorkflow(server, 'A', { confirm: async () => allowRevision });
  try {
    for (const label of [
      'Open REQ-401',
      'Reserve R1 Marina',
      'Outgoing',
      'Send REQ-401 to cedar@example.test',
    ]) {
      const actions = await wrong.candidates(await wrong.observe());
      const result = await actions.find((a) => a.description === `Click ${label}`).execute();
      assert.equal(result.ok, true);
    }
    assert.equal(await wrong.verify(), false, 'An approved room that is too small must stay unverified');
    const wrongStore = await wrong.stored();
    assert.equal(wrongStore.bookings['REQ-401'].slot, 'R1', 'Do not repair a wrong choice');
    assert.match(JSON.parse(await wrong.observe()).lastVerification, /do not meet the request/u);
    for (const label of [
      'Rooms',
      'Revise booking REQ-401',
      'Reserve R2 Garden',
      'Outgoing',
      'Send REQ-401 to cedar@example.test',
      'Rooms',
    ]) {
      const actions = await wrong.candidates(await wrong.observe());
      const result = await actions.find((a) => a.description === `Click ${label}`).execute();
      assert.equal(result.ok, true);
      if (label === 'Revise booking REQ-401') {
        assert.deepEqual(await wrong.stored(), { bookings: {}, correspondence: {} });
        assert.equal(
          JSON.parse(await wrong.observe()).lastVerification,
          null,
          'Revision invalidates feedback about removed records',
        );
      }
    }
    await wrong.page.waitForURL('**/schedule?fixture=A');
    assert.equal(await wrong.verify(), true, 'An approved revision can correct the saved result');
    const corrected = await wrong.stored();
    const revisionChoices = await wrong.candidates(await wrong.observe());
    const revise = revisionChoices.find((a) => a.description === 'Click Revise booking REQ-401');
    allowRevision = false;
    await assert.rejects(() => revise.execute());
    assert.deepEqual(
      await storedAfterStop(wrong, 'A'),
      corrected,
      'Refusing revision preserves both saved records',
    );
  } finally {
    await wrong.close();
  }

  const refused = await openWorkflow(server, 'A', { confirm: async () => false });
  try {
    const choices = await refused.candidates(await refused.observe());
    const action = choices.find((a) => a.description === 'Click Open REQ-401');
    try {
      await action.execute();
    } catch {
      assert.equal(refused.stopped.signal.aborted, true);
    }
    assert.equal(refused.stopped.signal.aborted, true, 'Refusal must stop later attempts');
    assert.equal(refused.refused, true, 'A refusal must remain distinct from Stop');
    await assert.rejects(() => action.execute());
    assert.deepEqual(await storedAfterStop(refused, 'A'), { bookings: {}, correspondence: {} });
  } finally {
    await refused.close();
  }

  const stale = await openWorkflow(server, 'A', { confirm: async () => true });
  try {
    const oldActions = await stale.candidates(await stale.observe());
    const old = oldActions.find((a) => a.description === 'Click Open REQ-401');
    await stale.observe();
    const result = await old.execute();
    assert.equal(result.ok, false, 'Do not follow refs replaced by a newer observation');
    assert.deepEqual(await stale.stored(), { bookings: {}, correspondence: {} });
    const nextActions = await stale.candidates(await stale.observe());
    const stopped = nextActions.find((a) => a.description === 'Click Open REQ-401');
    stale.stopped.abort();
    assert.equal(stale.refused, false, 'Stop is not a refusal');
    await assert.rejects(() => stopped.execute());
    assert.deepEqual(await storedAfterStop(stale, 'A'), { bookings: {}, correspondence: {} });
  } finally {
    await stale.close();
  }
  if (values.output) {
    await writeFile(values.output, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'workflow-fixture-'));
  try {
    const fixture = structuredClone(server.fixtures.A);
    fixture.requestId = 'REQ-401';
    fixture.task = 'Complete request REQ-401. Reserve the cheapest eligible room and send confirmation.';
    fixture.requests.unshift({ ...fixture.requests[0], id: 'REQ-4', name: '<b>literal value</b>' });
    const fixturePath = path.join(directory, 'fixtures.json');
    await writeFile(fixturePath, JSON.stringify({ C: fixture }));
    const { readFile } = fs.promises;
    let custom;
    // Replace the file after its first read to exercise startup snapshot consistency.
    fs.promises.readFile = async (...args) => {
      const bytes = await readFile(...args);
      if (String(args[0]) === fixturePath) {
        await writeFile(fixturePath, JSON.stringify({ C: { ...fixture, task: 'Replacement file' } }));
      }
      return bytes;
    };
    syncBuiltinESMExports();
    try {
      custom = await serve(fixturePath);
    } finally {
      fs.promises.readFile = readFile;
      syncBuiltinESMExports();
    }
    try {
      await writeFile(fixturePath, '{}');
      const response = await fetch(`${custom.origin}/fixtures.json`);
      const delivered = await response.json();
      assert.deepEqual(delivered, custom.fixtures, 'The served data must remain the startup snapshot');
      await assert.rejects(
        openWorkflow(custom, 'constructor', { confirm: async () => true }),
        /Unknown fixture ID/u,
      );
      const w = await openWorkflow(custom, 'C', { confirm: async () => true });
      try {
        const browserFixtures = await w.page.evaluate(() => window.workflowFixtures);
        assert.deepEqual(browserFixtures, delivered, 'Browser and verifier must use the same startup data');
        assert.equal(await w.page.locator('#app b').count(), 0, 'Custom field values must remain text');
        for (const label of [
          'Open REQ-401',
          'Reserve R2 Garden',
          'Outgoing',
          'Send REQ-401 to cedar@example.test',
        ]) {
          const actions = await w.candidates(await w.observe());
          const action = actions.find((item) => item.description === `Click ${label}`);
          assert.ok(action);
          const result = await action.execute();
          assert.equal(result.ok, true);
        }
        assert.equal(await w.verify(), true, 'Verification must use the exact selected ID');
      } finally {
        await w.close();
      }
    } finally {
      await custom.close();
    }
    for (const requestId of ['constructor', '__proto__']) {
      const named = structuredClone(server.fixtures.A);
      named.requestId = requestId;
      named.requests[0].id = requestId;
      await writeFile(fixturePath, JSON.stringify({ C: named }));
      const namedServer = await serve(fixturePath);
      try {
        const session = await openWorkflow(namedServer, 'C', { confirm: async () => true });
        try {
          for (const label of [
            `Open ${requestId}`,
            'Reserve R2 Garden',
            'Outgoing',
            `Send ${requestId} to cedar@example.test`,
          ]) {
            const candidates = await session.candidates(await session.observe());
            const action = candidates.find((item) => item.description === `Click ${label}`);
            assert.ok(action, `Missing enabled action: ${label}`);
            const executed = await action.execute();
            assert.equal(executed.ok, true);
          }
          assert.equal(
            await session.verify(),
            true,
            JSON.stringify({ requestId, stored: await session.stored() }),
          );
          await session.page.reload();
          assert.equal(await session.verify(), true, 'Saved IDs survive JSON storage and reload');
        } finally {
          await session.close();
        }
      } finally {
        await namedServer.close();
      }
    }
    for (const [group, field, value] of [
      ['requests', 'name', null],
      ['requests', 'recipient', 3],
      ['requests', 'time', ''],
      ['requests', 'equipment', []],
      ['requests', 'people', true],
      ['requests', 'people', 1.5],
      ['requests', 'people', Number.MAX_SAFE_INTEGER + 1],
      ['requests', 'budget', -1],
      ['requests', 'budget', null],
      ['requests', 'budget', Number.MAX_SAFE_INTEGER + 1],
      ['slots', 'id', false],
      ['slots', 'room', []],
      ['slots', 'time', ''],
      ['slots', 'equipment', 'projector'],
      ['slots', 'equipment', [7]],
      ['slots', 'capacity', 0],
      ['slots', 'capacity', 1.5],
      ['slots', 'capacity', Number.MAX_SAFE_INTEGER + 1],
      ['slots', 'price', -1],
      ['slots', 'price', null],
      ['slots', 'price', 1e100],
    ]) {
      const invalid = structuredClone(server.fixtures.A);
      invalid[group][0][field] = value;
      await writeFile(fixturePath, JSON.stringify({ C: invalid }));
      await assert.rejects(
        async () => {
          const accepted = await serve(fixturePath);
          await accepted.close();
        },
        new RegExp(`${group}\\[0\\]\\.${field} is invalid`, 'u'),
      );
    }
    for (const group of ['requests', 'slots']) {
      const invalid = structuredClone(server.fixtures.A);
      invalid[group][1].id = invalid[group][0].id;
      await writeFile(fixturePath, JSON.stringify({ C: invalid }));
      await assert.rejects(async () => {
        const accepted = await serve(fixturePath);
        await accepted.close();
      }, /unique|one exact requestId/u);
    }
    fixture.requests.push({ ...fixture.requests[1] });
    await writeFile(fixturePath, JSON.stringify({ C: fixture }));
    await assert.rejects(serve(fixturePath), /one exact requestId/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  console.log(
    'PASS A, B, persisted IDs, approved revision, refused revision, invalid custom data, early Done, Stop and stale refs.',
  );
} finally {
  await server.close();
}
