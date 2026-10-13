/* oxlint-disable no-await-in-loop -- Each record case changes the same owned workflow before verifying its recovery. */
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { serve, openWorkflow } from './workflow.mjs';

const [mode] = process.argv.slice(2);
const fixture = await serve();
try {
  if (mode === 'storage') {
    const workflow = await openWorkflow(fixture, 'A', { confirm: async () => true });
    try {
      for (const key of ['bookings', 'correspondence']) {
        for (const value of [null, [], ['REQ-401'], 17, true, 'booked']) {
          await workflow.page.evaluate(
            ({ key: recordKey, value: invalidRecord }) => {
              localStorage.setItem(`workflow.A.${recordKey}`, JSON.stringify(invalidRecord));
              localStorage.setItem('workflow.A.selected', JSON.stringify('REQ-401'));
              localStorage.setItem(`workflow.B.${recordKey}`, JSON.stringify({ keep: 'other fixture' }));
            },
            { key, value },
          );
          await workflow.page.goto(`${fixture.origin}/dispatch?fixture=A`);
          const result = await workflow.page.evaluate(
            (recordKey) => ({
              invalid: localStorage.getItem(`workflow.A.${recordKey}`),
              selected: localStorage.getItem('workflow.A.selected'),
              other: localStorage.getItem(`workflow.B.${recordKey}`),
            }),
            key,
          );
          assert.deepEqual(
            result,
            { invalid: null, selected: '"REQ-401"', other: '{"keep":"other fixture"}' },
            `${key} ${JSON.stringify(value)}`,
          );
          assert.deepEqual(await workflow.stored(), { bookings: {}, correspondence: {} });
          assert.equal(await workflow.verify(), false);
        }
      }
      await workflow.page.evaluate(() =>
        localStorage.setItem(
          'workflow.A.bookings',
          JSON.stringify({ obsolete: { request: 'obsolete', slot: 'R2', time: '10:00' }, 'REQ-401': null }),
        ),
      );
      await workflow.page.goto(`${fixture.origin}/dispatch?fixture=A`);
      assert.equal(await workflow.page.locator('[data-send]').count(), 0);
      assert.equal(await workflow.page.locator('[data-revise]').count(), 2);
      await workflow.page.locator('[data-revise="obsolete"]').click();
      await workflow.page.locator('[data-revise="REQ-401"]').click();
      assert.deepEqual(await workflow.stored(), { bookings: {}, correspondence: {} });
      assert.equal(await workflow.verify(), false);
      const correct = {
        bookings: { 'REQ-401': { request: 'REQ-401', slot: 'R2', time: '10:00' } },
        correspondence: { 'REQ-401': { request: 'REQ-401', slot: 'R2', recipient: 'cedar@example.test' } },
      };
      for (const key of ['bookings', 'correspondence']) {
        for (const value of [null, [], 17, {}, { slot: 'R2' }]) {
          const records = { ...correct, [key]: { 'REQ-401': value } };
          await workflow.page.evaluate((saved) => {
            localStorage.setItem('workflow.A.bookings', JSON.stringify(saved.bookings));
            localStorage.setItem('workflow.A.correspondence', JSON.stringify(saved.correspondence));
          }, records);
          assert.equal(await workflow.verify(), false, `${key} ${JSON.stringify(value)}`);
          assert.deepEqual(workflow.verifiedRecords, records, 'Verification must preserve saved evidence');
        }
      }
      await workflow.page.evaluate((saved) => {
        localStorage.setItem('workflow.A.bookings', JSON.stringify(saved.bookings));
        localStorage.setItem('workflow.A.correspondence', JSON.stringify(saved.correspondence));
      }, correct);
      assert.equal(await workflow.verify(), true, 'Valid records remain verifiable after malformed ones');
    } finally {
      await workflow.close();
    }
    assert.equal(workflow.page.isClosed(), true);
    console.log(
      'PASS storage:12 invalid collection types,10 malformed selected records, valid saved proof,2 stale records revised, close',
    );
  } else if (mode === 'startup') {
    let held;
    const slow = createServer((_req, res) => {
      held = res;
    });
    slow.listen(0, '127.0.0.1');
    await once(slow, 'listening');
    const received = once(slow, 'request', { signal: AbortSignal.timeout(7000) });
    const stopped = new AbortController();
    const started = openWorkflow({ ...fixture, origin: `http://127.0.0.1:${slow.address().port}` }, 'A', {
      confirm: async () => true,
      stopped,
    });
    let outcome = 'pending';
    const result = (async () => {
      try {
        const workflow = await started;
        outcome = 'opened';
        await workflow.close();
      } catch {
        outcome = 'stopped';
      }
    })();
    try {
      await received;
      stopped.abort(new Error('Controlled Stop during navigation'));
      await Promise.race([result, delay(1200)]);
      assert.equal(outcome, 'stopped', 'Owned setup must settle before the held response is released');
      console.log('PASS startup: Stop drains owned browser during finite held navigation');
    } finally {
      held?.end();
      await result;
      slow.closeAllConnections();
      await promisify(slow.close.bind(slow))();
    }
  } else {
    throw new Error('Use storage or startup');
  }
} finally {
  await fixture.close();
}
