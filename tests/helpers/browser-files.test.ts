// oxlint-disable eslint/max-classes-per-file -- A valid outcome and an outcome with unknown data exercise distinct public results.
import { BrowserToolset } from 'openai/helpers/browser';
import type { BrowserDriver, BrowserFileOutcome } from 'openai/helpers/browser';
import type { ResponseFunctionToolCall, ResponseInputItem } from 'openai/resources/responses/responses';
import { expect, test, vi } from 'vitest';

const members = ['upload_file', 'download_file'] as const;
const args = { grant_id: 'task-grant' };
const completed = { version: 1, status: 'completed', effect: 'completed', cleanup: 'completed' } as const;
const state = () => ({ tabs: [] });

function call(member: (typeof members)[number], input: unknown = args): ResponseFunctionToolCall {
  return {
    type: 'function_call',
    id: 'item',
    call_id: 'call',
    status: 'completed',
    name: `browser_${member}`,
    arguments: JSON.stringify(input),
  };
}

function payload(result: ResponseInputItem.FunctionCallOutput) {
  if (!Array.isArray(result.output) || result.output[0]?.type !== 'input_text') {
    throw new Error('Expected text output');
  }
  return JSON.parse(result.output[0].text);
}

function driver(value: unknown, observe: BrowserDriver['state'] = state): BrowserDriver {
  // SAFETY: Exercise untyped custom-driver results at the public boundary.
  return {
    state: observe,
    upload_file: () => value as BrowserFileOutcome,
    download_file: () => value as BrowserFileOutcome,
  };
}

test.each(members)('%s stays disabled until selected and requires approval', async (member) => {
  const observe = vi.fn(state);
  const handler = vi.fn(() => completed);
  const supplied = { state: observe, [member]: handler };
  const hidden = new BrowserToolset(supplied);
  expect(hidden.tools().map((tool) => tool.name)).toEqual(['browser_list_tabs']);
  await expect(hidden.execute(call(member))).rejects.toThrow('registered call');
  expect(observe).not.toHaveBeenCalled();
  expect(() => new BrowserToolset(supplied, { members: [member] })).toThrow('requires confirm');
  const refused = new BrowserToolset(supplied, { members: [member], confirm: () => false });
  expect(payload(await refused.execute(call(member))).ok).toBe(false);
  expect(handler).not.toHaveBeenCalled();
});

test.each([
  {},
  { grant_id: '' },
  { grant_id: 1 },
  { grant_id: 'é'.repeat(129) },
  { grant_id: '\uD800' },
  { ...args, path: '/private/file' },
])('rejects invalid grants before permission: %j', async (input) => {
  const confirm = vi.fn(() => true);
  const handler = vi.fn(() => completed);
  const tools = new BrowserToolset({ state, upload_file: handler }, { members: ['upload_file'], confirm });
  expect(payload(await tools.execute(call('upload_file', input))).ok).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
  expect(handler).not.toHaveBeenCalled();
});

const outcomes: BrowserFileOutcome[] = [
  completed,
  { version: 1, status: 'refused', effect: 'none', cleanup: 'not_started' },
  { version: 1, status: 'unknown', effect: 'unknown', cleanup: 'pending' },
  { version: 1, status: 'interrupted', effect: 'none', cleanup: 'completed' },
  { version: 1, status: 'interrupted', effect: 'unknown', cleanup: 'pending' },
];

test.each(members)('%s snapshots each terminal outcome and passes cancellation', async (member) => {
  for (const outcome of outcomes) {
    const value = { ...outcome };
    let reads = 0;
    const handler = vi.fn(() => value);
    const tools = new BrowserToolset(
      {
        state: () => {
          reads += 1;
          if (reads === 2) {
            value.cleanup = 'not_started';
          }
          return state();
        },
        [member]: handler,
      },
      { members: [member], confirm: () => true },
    );
    const controller = new AbortController();
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each result must be observed before its fixture changes.
    const result = payload(await tools.execute(call(member), { signal: controller.signal }));
    expect(result.result).toEqual(outcome);
    expect(result.ok).toBe(outcome.status === 'completed');
    expect(handler).toHaveBeenCalledExactlyOnceWith(args, { signal: controller.signal });
  }
});

// oxlint-disable eslint/class-methods-use-this -- Test supported constant and private-backed getters on returned outcomes.
test.each(members)(
  '%s captures a configured class outcome once, keeping cleanup and effect',
  async (member) => {
    const visited = vi.fn();
    class Completed implements Extract<BrowserFileOutcome, { status: 'completed' }> {
      #cleanup: BrowserFileOutcome['cleanup'] = 'pending';
      get version() {
        visited('version');
        return 1 as const;
      }
      get status() {
        visited('status');
        return 'completed' as const;
      }
      get effect() {
        visited('effect');
        return 'completed' as const;
      }
      get cleanup() {
        visited('cleanup');
        return this.#cleanup;
      }
      finish() {
        this.#cleanup = 'completed';
      }
    }
    const value = new Completed();
    let reads = 0;
    const observe = vi.fn(() => {
      reads += 1;
      if (reads === 2) {
        value.finish();
      }
      return state();
    });
    const tools = new BrowserToolset(driver(value, observe), { members: [member], confirm: () => true });
    expect(payload(await tools.execute(call(member)))).toEqual({
      ok: true,
      state: state(),
      result: { ...completed, cleanup: 'pending' },
    });
    expect(visited.mock.calls.flat()).toEqual(
      expect.arrayContaining(['cleanup', 'effect', 'status', 'version']),
    );
    expect(visited).toHaveBeenCalledTimes(4);
    expect(observe).toHaveBeenCalledTimes(2);
  },
);

test('configured class file outcome still rejects unknown own emitted fields', async () => {
  class Completed {
    path = '/private/file';
    get version() {
      return 1 as const;
    }
    get status() {
      return 'completed' as const;
    }
    get effect() {
      return 'completed' as const;
    }
    get cleanup() {
      return 'completed' as const;
    }
  }
  const observe = vi.fn(state);
  const tools = new BrowserToolset(driver(new Completed(), observe), {
    members: [...members],
    confirm: () => true,
  });
  await expect(tools.execute(call('download_file'))).rejects.toThrow('file result failed');
  expect(observe).toHaveBeenCalledTimes(1);
});
// oxlint-enable eslint/class-methods-use-this

test.each([
  null,
  undefined,
  'uploaded',
  {},
  { ...completed, version: true },
  { ...completed, status: 'in_progress' },
  { ...completed, status: 'refused' },
  { ...completed, effect: 'unknown' },
  { ...completed, cleanup: 'failed' },
  { ...completed, path: '/private/file' },
])('invalid file outcomes stop before final state: %j', async (value) => {
  const observe = vi.fn(state);
  const tools = new BrowserToolset(driver(value, observe), { members: [...members], confirm: () => true });
  await expect(tools.execute(call('download_file'))).rejects.toThrow('file result failed');
  expect(observe).toHaveBeenCalledTimes(1);
});
