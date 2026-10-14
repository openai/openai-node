import { BrowserToolset } from 'openai/helpers/browser';
import type {
  BrowserDriver,
  BrowserMember,
  BrowserReadV1,
  BrowserResult,
  BrowserTextReadV1,
} from 'openai/helpers/browser';
import type { ResponseFunctionToolCall, ResponseInputItem } from 'openai/resources/responses/responses';
import { expect, expectTypeOf, test, vi } from 'vitest';

const state = () => ({ tabs: [] });
const diagnostic = { tab_id: null, source: 'console', limit: 10 };
const script = { tab_id: null, source: '1 + 1', timeout_ms: 1000 };
const report = { version: 1, text: 'Warnings: 1', elements: [], omitted: [] };
const members = ['read_diagnostics', 'run_script'] as const;

function call(member: BrowserMember, args: unknown): ResponseFunctionToolCall {
  return {
    type: 'function_call',
    id: 'item',
    call_id: 'call',
    status: 'completed',
    name: `browser_${member}`,
    arguments: JSON.stringify(args),
  };
}
function payload(result: ResponseInputItem.FunctionCallOutput) {
  if (!Array.isArray(result.output) || result.output[0]?.type !== 'input_text') {
    throw new Error('Expected text output');
  }
  return JSON.parse(result.output[0].text);
}
function driver(value: unknown, observe: BrowserDriver['state'] = state): BrowserDriver {
  // SAFETY: Test untyped custom-driver results at the public boundary.
  return {
    state: observe,
    read_diagnostics: () => value as BrowserTextReadV1,
    run_script: () => value as string,
  };
}

test.each(members)('%s is hidden and cannot read state without explicit selection', async (member) => {
  const observe = vi.fn(state);
  const tools = new BrowserToolset(driver(report, observe));
  expect(tools.tools().map((tool) => tool.name)).toEqual(['browser_list_tabs']);
  await expect(tools.execute(call(member, member === 'run_script' ? script : diagnostic))).rejects.toThrow(
    'registered call',
  );
  expect(observe).not.toHaveBeenCalled();
});

test.each(members)('%s requires and honors per-call consent', async (member) => {
  const handler = vi.fn();
  const supplied = { state, [member]: handler };
  expect(() => new BrowserToolset(supplied, { members: [member] })).toThrow('requires confirm');
  const tools = new BrowserToolset(supplied, { members: [member], confirm: () => false });
  expect(payload(await tools.execute(call(member, member === 'run_script' ? script : diagnostic))).ok).toBe(
    false,
  );
  expect(handler).not.toHaveBeenCalled();
});

test('diagnostic result is a detached text-only report before final state', async () => {
  expectTypeOf<BrowserReadV1>().not.toExtend<BrowserResult<'read_diagnostics'>>();
  const value = structuredClone(report);
  let observed = 0;
  const tools = new BrowserToolset(
    driver(value, () => {
      observed += 1;
      if (observed === 2) {
        value.text = 'Private later value';
      }
      return state();
    }),
    { members: ['read_diagnostics'], confirm: () => true },
  );
  expect(payload(await tools.execute(call('read_diagnostics', diagnostic))).result).toEqual(report);
});

test.each([
  null,
  'raw console',
  { ...report, elements: [{ ref: 'element', label: 'Button', role: 'button' }] },
])('diagnostics reject non-text reports: %j', async (value) => {
  const tools = new BrowserToolset(driver(value), { members: ['read_diagnostics'], confirm: () => true });
  await expect(tools.execute(call('read_diagnostics', diagnostic))).rejects.toThrow('read report failed');
});

test.each([
  ['read_diagnostics', { ...diagnostic, source: 'headers' }],
  ['read_diagnostics', { ...diagnostic, limit: 0 }],
  ['read_diagnostics', { ...diagnostic, limit: 101 }],
  ['read_diagnostics', { ...diagnostic, limit: true }],
  ['run_script', { ...script, source: '' }],
  ['run_script', { ...script, source: 123 }],
  ['run_script', { ...script, source: '\uD800' }],
  ['run_script', { ...script, timeout_ms: 0 }],
  ['run_script', { ...script, timeout_ms: 30_001 }],
  ['run_script', { ...script, timeout_ms: false }],
  ['run_script', { ...script, extra: true }],
] satisfies [BrowserMember, unknown][])(
  'rejects malformed %s before permission and execution',
  async (member, args) => {
    const handler = vi.fn();
    const confirm = vi.fn(() => true);
    const tools = new BrowserToolset({ state, [member]: handler }, { members: [member], confirm });
    expect(payload(await tools.execute(call(member, args))).ok).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  },
);

test.each(['', 'é'.repeat(8192), 'é'.repeat(32_768)])(
  'accepts script text and supplies the cancellation signal',
  async (value) => {
    const handler = vi.fn(() => value);
    const args = { ...script, source: `/*${value}*/return 1` };
    const confirm = vi.fn(() => true);
    const controller = new AbortController();
    const tools = new BrowserToolset({ state, run_script: handler }, { members: ['run_script'], confirm });
    expect(payload(await tools.execute(call('run_script', args), { signal: controller.signal })).result).toBe(
      value,
    );
    expect(confirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ member: 'run_script', arguments: args }),
      { signal: controller.signal },
    );
    expect(handler).toHaveBeenCalledExactlyOnceWith(args, { signal: controller.signal });
  },
);

test.each([null, undefined, {}, '\uD800'])('stops on invalid script output: %j', async (value) => {
  const observe = vi.fn(state);
  const tools = new BrowserToolset(driver(value, observe), {
    members: ['run_script'],
    confirm: () => true,
  });
  await expect(tools.execute(call('run_script', script))).rejects.toThrow('script result failed');
  expect(observe).toHaveBeenCalledTimes(1);
});
