import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import OpenAI from 'openai';
import { approvalText, openWorkflow, serve } from './workflow.mjs';

const stopped = new AbortController();
let forwarded;
const description = {
  async describe_target(_args, execution) {
    forwarded = execution.signal;
    stopped.abort();
    execution.signal.throwIfAborted();
  },
};
await assert.rejects(
  approvalText(description, { member: 'click', arguments: {} }, { signal: stopped.signal }),
);
assert.equal(forwarded, stopped.signal);

const records = {
  bookings: { 'REQ-401': { request: 'REQ-401', slot: 'R2', time: '10:00' } },
  correspondence: { 'REQ-401': { request: 'REQ-401', slot: 'R2', recipient: 'cedar@example.test' } },
};
const server = await serve();
try {
  const workflow = await openWorkflow(server, 'A', { confirm: async () => true });
  try {
    await workflow.page.evaluate((saved) => {
      localStorage.setItem('workflow.A.bookings', JSON.stringify(saved.bookings));
      localStorage.setItem('workflow.A.correspondence', JSON.stringify(saved.correspondence));
    }, records);
    assert.equal(await workflow.verify(), true);
    const evaluate = workflow.page.evaluate.bind(workflow.page);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    workflow.page.evaluate = async (...args) => {
      const value = await evaluate(...args);
      entered.resolve();
      await release.promise;
      return value;
    };
    let requests = 0;
    const client = new OpenAI({
      apiKey: 'local-fixture',
      maxRetries: 0,
      fetch: async () => {
        requests += 1;
        return Response.json({
          id: 'response',
          object: 'response',
          status: 'completed',
          output: [
            {
              id: 'message',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'Done', annotations: [] }],
            },
          ],
        });
      },
    });
    const running = workflow.run(client, '', 'responses');
    await entered.promise;
    workflow.stopped.abort();
    try {
      await assert.rejects(
        Promise.race([
          running,
          delay(750).then(() => {
            throw new Error('read did not stop');
          }),
        ]),
        (error) => error.message !== 'read did not stop',
      );
    } finally {
      release.resolve();
      await running.catch(() => null);
    }
    assert.equal(requests, 1);
    assert.equal(workflow.stopped.signal.aborted, true);
    assert.deepEqual(workflow.verifiedRecords, records);
    assert.equal(workflow.metrics.runnerError, null);
  } finally {
    await workflow.close();
  }
} finally {
  await server.close();
}
console.log(JSON.stringify({ checks: 2, passed: true, api_calls: 0, vendor_calls: 0 }));
