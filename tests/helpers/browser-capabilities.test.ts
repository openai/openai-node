/* oxlint-disable max-classes-per-file -- Exercise typed driver results and option receivers without altering prototypes. */
import OpenAI from 'openai';
import {
  BROWSER_MEMBERS,
  DEFAULT_BROWSER_MEMBERS,
  BrowserError,
  BrowserToolset,
} from 'openai/helpers/browser';
import type {
  BrowserDriver,
  BrowserConfirmContext,
  BrowserReadConfirmContext,
  BrowserMember,
  BrowserResult,
  BrowserScopedReadV1,
  BrowserReadOptions,
  BrowserState,
} from 'openai/helpers/browser';
import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseInputImageContent,
} from 'openai/resources/responses/responses';
import { describe, expect, expectTypeOf, test, vi } from 'vitest';

function deferred() {
  let resolve!: () => void;
  // oxlint-disable-next-line promise/avoid-new, promise/param-names -- Tests control when an active driver settles.
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const state = () => ({
  tabs: [{ id: 'task', title: 'Fixture', url: 'https://fixture.invalid/', active: true }],
});
const click = { tab_id: null, x: 20, y: 40, button: 'middle', click_count: 2, keys: ['Shift'] };
const drag = {
  tab_id: null,
  path: [
    { x: 0, y: 0 },
    { x: 20, y: 40 },
  ],
  keys: [],
};
const hold = { tab_id: null, keys: ['ArrowDown'], duration_ms: 200 };
const read = { tab_id: null, root: null, depth: 3, filter: 'all' };
const calls: [BrowserMember, Record<string, unknown>][] = [
  ['click_at', click],
  ['drag_path', drag],
  ['hold_keys', hold],
  ['read_page_scoped', read],
];

function call(member: BrowserMember, args: Record<string, unknown>): ResponseFunctionToolCall {
  return {
    type: 'function_call',
    id: 'fc',
    call_id: 'call',
    status: 'completed',
    name: `browser_${member}`,
    arguments: JSON.stringify(args),
  };
}

function payload(result: ResponseInputItem.FunctionCallOutput) {
  if (!Array.isArray(result.output) || result.output[0]?.type !== 'input_text') {
    throw new Error('Expected browser text output');
  }
  return JSON.parse(result.output[0].text);
}

function report(): BrowserScopedReadV1 {
  return {
    version: 1,
    text: 'Current orders',
    omitted: [],
    elements: [{ ref: 'button:1', role: 'button', label: 'Open' }],
    scopes: [{ ref: 'scope:1', label: 'Orders' }],
  };
}

describe('explicit browser capabilities', () => {
  test('direct browser execution preserves an empty native call ID', async () => {
    const handler = vi.fn((): BrowserResult<'click_at'> => 'selected');
    const helper = new BrowserToolset(
      { state, click_at: handler },
      { additionalMembers: ['click_at'], confirm: () => true },
    );
    const result = await helper.execute({ ...call('click_at', click), call_id: '' });
    expect(result.call_id).toBe('');
    expect(payload(result).result).toBe('selected');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('direct browser replay validates native JSON before state, policy or effects', async () => {
    const handler = vi.fn((): BrowserResult<'click_at'> => 'selected');
    const reporter = vi.fn(state);
    const confirm = vi.fn(() => true);
    const helper = new BrowserToolset(
      { state: reporter, click_at: handler },
      { additionalMembers: ['click_at'], confirm },
    );
    const item = { ...call('click_at', click), audit: 1n };
    await expect(helper.execute(item)).rejects.toThrow();
    expect(reporter).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    const native = {
      ...call('click_at', click),
      audit: { at: new Date('2026-01-02T03:04:05.000Z'), values: ['kept', null] },
      created_by: 1n,
      parsed_arguments: 1n,
    };
    expect(payload(await helper.execute(native)).result).toBe('selected');
    expect(native.audit.at.toJSON()).toBe('2026-01-02T03:04:05.000Z');
    expect(native.created_by).toBe(1n);
    expect(native.parsed_arguments).toBe(1n);
  });

  test('direct replay rejects an array-shaped call before browser state or policy', async () => {
    const handler = vi.fn((): BrowserResult<'click_at'> => 'selected');
    const reporter = vi.fn(state);
    const confirm = vi.fn(() => true);
    const helper = new BrowserToolset(
      { state: reporter, click_at: handler },
      { additionalMembers: ['click_at'], confirm },
    );
    const native = call('click_at', click);
    const arrayCall = Object.assign([], native);
    await expect(helper.execute(arrayCall)).rejects.toThrow('completed registered call');
    expect(reporter).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(payload(await helper.execute(native)).result).toBe('selected');
    expect(handler).toHaveBeenCalledTimes(1);
  });
  test.each([
    { label: 'empty selection', members: [] },
    { label: 'nested argument schemas', members: ['read_page', 'drag_path'] },
  ] satisfies { label: string; members: BrowserMember[] }[])(
    'advertised browser tools own their JSON conversion for $label',
    async ({ members }) => {
      const readPage = vi.fn(() => 'fixture page');
      const dragPath = vi.fn();
      const driver = { state, read_page: readPage, drag_path: dragPath };
      const browser = new BrowserToolset(driver, { members, confirm: () => true });
      const tools = browser.tools();
      const original = structuredClone(tools);
      const received: unknown[] = [];
      const client = new OpenAI({
        apiKey: 'synthetic-test-key',
        maxRetries: 0,
        fetch: async (url, init) => {
          received.push(await new Request(url, init).json());
          return Response.json({ id: 'resp_fixture', object: 'response', status: 'completed', output: [] });
        },
      });
      await client.responses.create({ model: 'fixture', input: 'Inspect the fixture', tools });
      expect(received).toEqual([{ model: 'fixture', input: 'Inspect the fixture', tools: original }]);
      expect(tools.map(({ name }) => name)).toEqual(members.map((member) => `browser_${member}`));
      const records: object[] = [tools];
      for (const record of records) {
        expect(Object.getOwnPropertyDescriptor(record, 'toJSON')).toEqual({
          value: undefined,
          enumerable: false,
          writable: true,
          configurable: true,
        });
        const values: unknown[] = Object.values(record);
        for (const value of values) {
          if (value !== null && typeof value === 'object') {
            records.push(value);
          }
        }
      }
      expect(Object.getOwnPropertyDescriptor(driver, 'toJSON')).toBeUndefined();
      expect(readPage).not.toHaveBeenCalled();
      expect(dragPath).not.toHaveBeenCalled();
      expect(browser.tools()).toEqual(original);
    },
  );

  test.each(['tool array', 'parameter schema', 'inserted property'] as const)(
    'advertised browser tools preserve caller JSON conversion on %s',
    async (placement) => {
      const browser = new BrowserToolset(
        { state, read_page: () => 'fixture page' },
        { members: ['read_page'] },
      );
      const tools = browser.tools();
      const initial = structuredClone(tools);
      const expected = structuredClone(initial);
      const [expectedTool] = expected;
      const parameters = tools[0]?.parameters;
      if (!parameters || !expectedTool) {
        throw new Error('Expected browser_read_page parameters');
      }
      const replacements = {
        'tool array': [],
        'parameter schema': { type: 'object', properties: {}, required: [], additionalProperties: false },
        'inserted property': { type: 'string', enum: ['caller-selected'] },
      };
      const hook = vi.fn(() => replacements[placement]);
      if (placement === 'tool array') {
        Object.defineProperty(tools, 'toJSON', { value: hook });
      } else if (placement === 'parameter schema') {
        Object.defineProperty(parameters, 'toJSON', { value: hook });
      } else {
        parameters['properties'] = { query: { toJSON: hook } };
        parameters['required'] = ['query'];
      }
      if (placement === 'tool array') {
        expected.splice(0);
      } else if (placement === 'parameter schema') {
        expectedTool.parameters = {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        };
      } else {
        expectedTool.parameters = {
          ...expectedTool.parameters,
          properties: { query: { type: 'string', enum: ['caller-selected'] } },
          required: ['query'],
        };
      }
      const received: unknown[] = [];
      const client = new OpenAI({
        apiKey: 'synthetic-test-key',
        maxRetries: 0,
        fetch: async (url, init) => {
          received.push(await new Request(url, init).json());
          return Response.json({ id: 'resp_fixture', object: 'response', status: 'completed', output: [] });
        },
      });
      await client.responses.create({ model: 'fixture', input: 'Inspect the fixture', tools });
      expect(received).toEqual([{ model: 'fixture', input: 'Inspect the fixture', tools: expected }]);
      expect(hook).toHaveBeenCalledOnce();
      expect(browser.tools()).toEqual(initial);
    },
  );

  test.each([
    ['navigate', false],
    ['navigate', true],
    ['click_at', false],
    ['click_at', true],
  ] as const)('approval owns captured observation for %s with observation %s', async (member, supplied) => {
    const observation = {
      version: 1 as const,
      sequence: 1,
      dropped_changes: 0,
      title_truncated: false,
      changes: [{ type: 'navigation' as const, sequence: 1, tab_id: 'task' }],
    };
    const driverState: BrowserState = { ...state(), ...(supplied ? { observation } : {}) };
    const original = structuredClone(driverState);
    const projected = {
      tabs: [{ id: 'task', title: 'Fixture', url: 'https://fixture.invalid', active: true }],
      ...(supplied ? { observation } : {}),
    };
    const capture = vi.fn((context: BrowserConfirmContext) => ({
      observation: Object.getOwnPropertyDescriptor(context.state, 'observation'),
      // oxlint-disable-next-line unicorn/prefer-structured-clone -- Check actual JSON omissions separately from callback descriptors.
      state: JSON.parse(JSON.stringify(context.state)),
      beforeRead: 'phase' in context,
    }));
    const handler = vi.fn();
    const urlPolicy = vi.fn((context: BrowserConfirmContext) => {
      capture(context);
      context.state.tabs.length = 0;
      Reflect.deleteProperty(context.state, 'observation');
      return true;
    });
    const confirm = vi.fn((context: BrowserConfirmContext) => {
      capture(context);
      context.state.tabs.length = 0;
      Reflect.deleteProperty(context.state, 'observation');
      return true;
    });
    const browser = new BrowserToolset(
      { state: () => driverState, navigate: handler, click_at: handler },
      { members: [member], urlPolicy, confirm },
    );
    const args = member === 'navigate' ? { tab_id: null, url: 'https://fixture.invalid/next' } : click;
    const output = await browser.execute(call(member, args));
    expect(payload(output)).toStrictEqual({ ok: true, state: projected });
    expect(driverState).toStrictEqual(original);
    expect(handler).toHaveBeenCalledExactlyOnceWith(args, { signal: undefined });
    expect(confirm).toHaveBeenCalledOnce();
    expect(urlPolicy).toHaveBeenCalledTimes(member === 'navigate' ? 1 : 0);
    expect(capture).toHaveBeenCalledTimes(member === 'navigate' ? 2 : 1);
    for (const result of capture.mock.results) {
      expect(result).toStrictEqual({
        type: 'return',
        value: {
          observation: {
            value: supplied ? observation : undefined,
            enumerable: true,
            writable: true,
            configurable: true,
          },
          state: projected,
          beforeRead: false,
        },
      });
    }
  });

  test.each(['navigate', 'drag_path', 'read_page_scoped'] as const)(
    'browser consent snapshots shield their owned JSON for %s',
    async (member) => {
      const observed: BrowserState = {
        ...state(),
        observation: {
          version: 1,
          sequence: 1,
          dropped_changes: 0,
          title_truncated: false,
          changes: [{ type: 'navigation', sequence: 1, tab_id: 'task' }],
        },
      };
      const original = structuredClone(observed);
      const reporter = vi.fn(() => observed);
      const navigate = vi.fn();
      const dragPath = vi.fn();
      const readContent = vi.fn(report);
      const inspect = vi.fn((context: BrowserConfirmContext | BrowserReadConfirmContext) => {
        const records: object[] = [context, context.arguments];
        if ('phase' in context) {
          expect(context.state).toBeNull();
        } else {
          records.push(context.state, context.state.tabs, ...context.state.tabs);
          if (context.state.observation) {
            records.push(
              context.state.observation,
              context.state.observation.changes,
              ...context.state.observation.changes,
            );
          }
          if (context.member === 'drag_path') {
            records.push(context.arguments.path, ...context.arguments.path, context.arguments.keys);
          }
        }
        const descriptors = records.map((record) => Object.getOwnPropertyDescriptor(record, 'toJSON'));
        const before = JSON.stringify(context);
        const hook = vi.fn(() => ({ approval_only: true }));
        Object.defineProperty(context, 'toJSON', { value: hook });
        const customized = JSON.stringify(context);
        return { descriptors, before, customized, hookCalls: hook.mock.calls.length };
      });
      const urlPolicy = vi.fn((context: BrowserConfirmContext) => {
        inspect(context);
        return true;
      });
      const confirm = vi.fn((context: BrowserConfirmContext | BrowserReadConfirmContext) => {
        inspect(context);
        return member !== 'read_page_scoped';
      });
      const browser = new BrowserToolset(
        { state: reporter, navigate, drag_path: dragPath, read_page_scoped: readContent },
        {
          members: [member],
          confirmReads: member === 'read_page_scoped' ? [member] : [],
          urlPolicy,
          confirm,
        },
      );
      const args = {
        navigate: { tab_id: null, url: 'https://fixture.invalid/next' },
        drag_path: drag,
        read_page_scoped: read,
      }[member];
      const input = call(member, args);
      const savedInput = structuredClone(input);
      const output = payload(await browser.execute(input));
      expect(confirm).toHaveBeenCalledOnce();
      expect(urlPolicy).toHaveBeenCalledTimes(member === 'navigate' ? 1 : 0);
      expect(inspect).toHaveBeenCalledTimes(member === 'navigate' ? 2 : 1);
      expect(observed).toStrictEqual(original);
      expect(input).toStrictEqual(savedInput);
      for (const record of [observed, observed.tabs, observed.tabs[0], observed.observation]) {
        expect(Object.getOwnPropertyDescriptor(record, 'toJSON')).toBeUndefined();
      }
      for (const captured of inspect.mock.results) {
        expect(captured.type).toBe('return');
        if (captured.type !== 'return') {
          throw captured.value;
        }
        expect(captured.value.descriptors.length).toBeGreaterThanOrEqual(
          member === 'read_page_scoped' ? 2 : 7,
        );
        for (const descriptor of captured.value.descriptors) {
          expect(descriptor).toEqual({
            value: undefined,
            enumerable: false,
            writable: true,
            configurable: true,
          });
        }
        // oxlint-disable-next-line unicorn/prefer-structured-clone -- Check real JSON as an approval callback would serialize it.
        const wire = JSON.parse(captured.value.before);
        expect(wire).toMatchObject({ member, arguments: args, call_id: 'call' });
        expect(captured.value).toMatchObject({ customized: '{"approval_only":true}', hookCalls: 1 });
        if (member === 'read_page_scoped') {
          expect(wire).toEqual({
            phase: 'before_read',
            member,
            arguments: args,
            call_id: 'call',
            state: null,
          });
        } else {
          expect(wire.state).toEqual(output.state);
          expect('phase' in wire).toBe(false);
        }
      }
      if (member === 'read_page_scoped') {
        expect(output).toEqual({ ok: false, error: 'Read declined.' });
        expect(reporter).not.toHaveBeenCalled();
        expect(readContent).not.toHaveBeenCalled();
      } else {
        expect(output.ok).toBe(true);
        expect(member === 'navigate' ? navigate : dragPath).toHaveBeenCalledExactlyOnceWith(args, {
          signal: undefined,
        });
      }
    },
  );

  test('ordinary reads keep optional consent lazy', async () => {
    const confirm = vi.fn(() => true);
    const readContent = vi.fn(() => 'Visible page');
    const browser = new BrowserToolset({ state, get_page_text: readContent }, { confirm });
    expect(payload(await browser.execute(call('get_page_text', { tab_id: null })))).toMatchObject({
      ok: true,
      result: 'Visible page',
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(readContent).toHaveBeenCalledOnce();
  });

  test.each(['name', 'type', 'call_id', 'status', 'arguments'] as const)(
    'requires the emitted %s on a native call before consent or state',
    async (field) => {
      const observe = vi.fn(state);
      const readContent = vi.fn(() => 'Fixture page');
      const confirm = vi.fn(() => true);
      const browser = new BrowserToolset(
        { state: observe, get_page_text: readContent },
        { confirmReads: ['get_page_text'], confirm },
      );
      const request = call('get_page_text', { tab_id: null });
      Reflect.deleteProperty(request, field);
      await expect(browser.execute(request)).rejects.toThrow('completed registered call');
      expect(confirm).not.toHaveBeenCalled();
      expect(observe).not.toHaveBeenCalled();
      expect(readContent).not.toHaveBeenCalled();
    },
  );

  test('keeps supplied malformed arguments on the existing tool-output path', async () => {
    const observe = vi.fn(state);
    const readContent = vi.fn(() => 'Fixture page');
    const browser = new BrowserToolset({ state: observe, get_page_text: readContent });
    const request = call('get_page_text', { tab_id: null });
    request.arguments = '{';
    expect(payload(await browser.execute(request))).toMatchObject({ ok: false });
    expect(observe).toHaveBeenCalledTimes(2);
    expect(readContent).not.toHaveBeenCalled();
  });

  test.each(['confirm', 'read', 'url'] as const)(
    '%s approval sees the execution signal and can stop before dispatch',
    async (stage) => {
      const controller = new AbortController();
      const reason = new Error('approval cancelled');
      const observe = vi.fn(state);
      const effect = vi.fn();
      const diagnostic = vi.fn();
      const seen: (AbortSignal | undefined)[] = [];
      const browser = new BrowserToolset(
        {
          state: observe,
          navigate: effect,
          get_page_text: () => {
            effect();
            return 'page';
          },
        },
        {
          members: ['navigate', 'get_page_text'],
          confirmReads: stage === 'read' ? ['get_page_text'] : [],
          confirm: (_context: BrowserConfirmContext | BrowserReadConfirmContext, execution) => {
            if (stage !== 'url') {
              seen.push(execution?.signal);
              if (execution?.signal === controller.signal) {
                controller.abort(reason);
              }
            }
            return true;
          },
          urlPolicy: (_context, _url, execution) => {
            if (stage === 'url') {
              seen.push(execution?.signal);
              if (execution?.signal === controller.signal) {
                controller.abort(reason);
              }
            }
            return true;
          },
        },
      );
      const request =
        stage === 'read'
          ? call('get_page_text', { tab_id: null })
          : call('navigate', { tab_id: null, url: 'https://fixture.invalid/next' });
      await expect(browser.executeWithStatus(request, controller.signal, false, diagnostic)).rejects.toBe(
        reason,
      );
      expect(seen).toEqual([controller.signal]);
      expect(effect).not.toHaveBeenCalled();
      expect(observe).toHaveBeenCalledTimes(stage === 'read' ? 0 : 1);
      if (stage === 'read') {
        expect(diagnostic.mock.calls.map(([entry]) => [entry.stage, entry.reason])).toEqual([
          ['approval', 'cancelled'],
        ]);
      }
    },
  );

  test('a cancelled throwing read approval touches no state and returns the abort reason', async () => {
    const controller = new AbortController();
    const reason = new Error('cancel protected read');
    const observe = vi.fn(state);
    const readContent = vi.fn(() => 'private');
    const browser = new BrowserToolset(
      { state: observe, get_page_text: readContent },
      {
        confirmReads: ['get_page_text'],
        confirm: (_context: BrowserConfirmContext | BrowserReadConfirmContext, execution) => {
          if (execution?.signal === controller.signal) {
            controller.abort(reason);
          }
          throw new Error('private confirmation details');
        },
      },
    );
    await expect(
      browser.execute(call('get_page_text', { tab_id: null }), { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(observe).not.toHaveBeenCalled();
    expect(readContent).not.toHaveBeenCalled();
  });

  test('browser approval remains busy during abort until a noncooperative callback settles', async () => {
    const entered = deferred();
    const held = deferred();
    const observe = vi.fn(state);
    const readContent = vi.fn(() => 'private');
    const browser = new BrowserToolset(
      { state: observe, get_page_text: readContent },
      {
        confirmReads: ['get_page_text'],
        confirm: async () => {
          entered.resolve();
          await held.promise;
          return true;
        },
      },
    );
    const request = call('get_page_text', { tab_id: null });
    const controller = new AbortController();
    const reason = new Error('cancel protected read');
    const active = browser.execute(request, { signal: controller.signal });
    const settled = expect(active).rejects.toBe(reason);
    await entered.promise;
    controller.abort(reason);
    await expect(browser.execute(request)).rejects.toThrow('busy');
    expect(browser.close()).toEqual({ status: 'draining' });
    held.resolve();
    await settled;
    expect(browser.close()).toEqual({ status: 'closed' });
    expect(observe).not.toHaveBeenCalled();
    expect(readContent).not.toHaveBeenCalled();
  });

  test('diagnostic observers cannot rewrite a read result before it is returned', async () => {
    const original = report();
    const browser = new BrowserToolset(
      { state, read_page_scoped: () => original },
      {
        members: ['read_page_scoped'],
        onDiagnostic(event) {
          if (event.stage === 'action' && event.reason === 'completed') {
            original.text = 'observer change';
            original.elements.length = 0;
          }
        },
      },
    );
    const result = await browser.execute(call('read_page_scoped', read));
    expect(payload(result)).toMatchObject({
      result: { text: 'Current orders', elements: [{ ref: 'button:1' }] },
    });
  });

  test('unknown image getters are not evaluated and nonstring call IDs stop before state', async () => {
    const extra = vi.fn(() => 'metadata');
    const image = { type: 'input_image' as const, detail: 'auto' as const, file_id: 'file_fixture' };
    Object.defineProperty(image, 'extra', { get: extra, enumerable: true });
    const reportState = vi.fn(state);
    const browser = new BrowserToolset({ state: reportState, screenshot: () => image });
    await expect(browser.execute(call('screenshot', { tab_id: null }))).rejects.toThrow('input_image');
    expect(extra).not.toHaveBeenCalled();
    reportState.mockClear();
    const malformed = call('screenshot', { tab_id: null });
    Reflect.set(malformed, 'call_id', 7);
    await expect(browser.execute(malformed)).rejects.toThrow('completed registered call');
    expect(reportState).not.toHaveBeenCalled();
  });

  test('state projects only validated indexed observation changes', async () => {
    const changes = [{ type: 'download' as const, tab_id: null, sequence: 1, status: 'blocked' as const }];
    const iterated = vi.fn(function* otherChanges() {
      yield { type: 'download' as const, tab_id: null, sequence: 1, status: 'failed' as const };
    });
    Object.defineProperty(changes, Symbol.iterator, { value: iterated });
    const browser = new BrowserToolset({
      state: () => ({
        ...state(),
        observation: { version: 1, sequence: 1, dropped_changes: 0, title_truncated: false, changes },
      }),
    });
    const output = await browser.execute(call('list_tabs', {}));
    expect(payload(output)).toMatchObject({ state: { observation: { changes: [{ status: 'blocked' }] } } });
    expect(iterated).not.toHaveBeenCalled();
  });
  test('a partial driver adds one capability while excluded getters stay untouched', async () => {
    const disabled = vi.fn(() => {
      throw new Error('excluded');
    });
    const driver = {
      state,
      get_page_text: () => 'Current orders',
      read_page_scoped: report,
      get click_at(): NonNullable<BrowserDriver['click_at']> {
        return disabled();
      },
    };
    const helper = new BrowserToolset(driver, { additionalMembers: ['read_page_scoped'] });
    expect(helper.tools().map(({ name }) => name)).toEqual([
      'browser_read_page_scoped',
      'browser_get_page_text',
      'browser_list_tabs',
    ]);
    expect(payload(await helper.execute(call('read_page_scoped', read))).result).toEqual(report());
    expect(disabled).not.toHaveBeenCalled();
    expect(BROWSER_MEMBERS).toContain('read_page_scoped');
    expect(DEFAULT_BROWSER_MEMBERS).not.toContain('read_page_scoped');
    expect(Object.isFrozen(BROWSER_MEMBERS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_BROWSER_MEMBERS)).toBe(true);
  });

  test('registered class selections are captured, while live class policies keep their receiver', async () => {
    const selection = vi.fn((): readonly ['read_page_scoped'] => ['read_page_scoped']);
    const gated = vi.fn((): readonly ['get_page_text'] => ['get_page_text']);
    const approve = vi.fn(() => true);
    const refuse = vi.fn(() => false);
    const observed = vi.fn();
    class Options implements BrowserReadOptions {
      #callback = approve;
      #diagnostic = observed;
      #selection = selection;
      #gated = gated;

      get additionalMembers() {
        return this.#selection();
      }

      get confirmReads() {
        return this.#gated();
      }

      get confirm() {
        return this.#callback;
      }

      get onDiagnostic() {
        return this.#diagnostic;
      }

      decline() {
        this.#callback = refuse;
      }
    }
    const options = new Options();
    const content = vi.fn(() => 'Current orders');
    const driver = { state, get_page_text: content, read_page_scoped: report };
    const defaults = new BrowserToolset(driver);
    expect(defaults.tools().map(({ name }) => name)).toEqual(['browser_get_page_text', 'browser_list_tabs']);
    const helper = new BrowserToolset(driver, options);
    expect(helper.tools().map(({ name }) => name)).toEqual([
      'browser_read_page_scoped',
      'browser_get_page_text',
      'browser_list_tabs',
    ]);
    const request = call('get_page_text', { tab_id: null });
    expect(payload(await helper.execute(request))).toMatchObject({ ok: true, result: 'Current orders' });
    options.decline();
    expect(payload(await helper.execute(request))).toEqual({ ok: false, error: 'Read declined.' });
    expect(content).toHaveBeenCalledTimes(1);
    expect(selection).toHaveBeenCalledTimes(1);
    expect(gated).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(refuse).toHaveBeenCalledTimes(1);
    expect(observed).toHaveBeenCalled();
  });

  test('additional names are explicit, unique and implemented', () => {
    expect(() => new BrowserToolset({ state }, { additionalMembers: ['read_page_scoped'] })).toThrow(
      'not implemented',
    );
    expect(() => new BrowserToolset({ state }, { additionalMembers: ['list_tabs', 'list_tabs'] })).toThrow(
      'unique',
    );
    expect(() => new BrowserToolset({ state }, { members: [], additionalMembers: [] })).toThrow(
      'either members or additionalMembers',
    );
  });

  test('class driver methods retain their receiver and missing members stay unavailable', async () => {
    class Driver implements BrowserDriver {
      #content = 'Current orders';
      #state = state();

      state() {
        return this.#state;
      }

      get_page_text() {
        return this.#content;
      }
    }
    const driver = new Driver();
    const browser = new BrowserToolset(driver);
    expect(browser.tools().map(({ name }) => name)).toEqual(['browser_get_page_text', 'browser_list_tabs']);
    expect(payload(await browser.execute(call('get_page_text', { tab_id: null })))).toMatchObject({
      ok: true,
      result: 'Current orders',
    });
    expect(() => new BrowserToolset(driver, { members: ['find'] })).toThrow('not implemented');
  });

  test.each(['members', 'additionalMembers', 'confirmReads'] as const)(
    '%s requires present array entries and reads own entries once',
    (option) => {
      const driver = { state, get_page_text: () => 'Current orders' };
      const missing: BrowserMember[] = [];
      missing.length = 1;
      expect(() => new BrowserToolset(driver, { [option]: missing, confirm: () => true })).toThrow();
      const selection: BrowserMember[] = ['get_page_text'];
      const readEntry = vi.fn(() => 'get_page_text');
      Object.defineProperty(selection, '0', { get: readEntry, enumerable: true });
      const browser = new BrowserToolset(driver, { [option]: selection, confirm: () => true });
      expect(browser.tools().map(({ name }) => name)).toContain('browser_get_page_text');
      expect(readEntry).toHaveBeenCalledTimes(1);
    },
  );

  test('consent carries the original call identity and narrows arguments by member', async () => {
    const observed: string[] = [];
    const handler = vi.fn((): BrowserResult<'click_at'> => 'selected');
    const helper = new BrowserToolset(
      { state, click_at: handler },
      {
        additionalMembers: ['click_at'],
        confirm: (context) => {
          if (context.member === 'click_at') {
            expectTypeOf(context.arguments.x).toEqualTypeOf<number>();
            expectTypeOf(context.arguments.click_count).toEqualTypeOf<1 | 2 | 3>();
            observed.push(context.call_id);
          }
          return true;
        },
      },
    );
    expect(payload(await helper.execute(call('click_at', click))).result).toBe('selected');
    expect(observed).toEqual(['call']);
  });

  test('busy helpers refuse overlapping calls and closing from inside a driver cannot deadlock', async () => {
    const entered = deferred();
    const held = deferred();
    // oxlint-disable-next-line prefer-const -- Declared first because the driver closes its owning helper.
    let helper: BrowserToolset;
    const closeStates: string[] = [];
    const driver = {
      state,
      async get_page_text() {
        closeStates.push(helper.close().status);
        entered.resolve();
        await held.promise;
        return 'visible';
      },
    };
    helper = new BrowserToolset(driver);
    const active = helper.execute(call('get_page_text', { tab_id: null }));
    await entered.promise;
    await expect(helper.execute(call('get_page_text', { tab_id: null }))).rejects.toThrow('closed');
    expect(closeStates).toEqual(['draining']);
    held.resolve();
    expect(payload(await active).result).toBe('visible');
    expect(helper.close()).toEqual({ status: 'closed' });
  });

  test.each([false, true])('driver context is available with signal=%s', async (withSignal) => {
    const signal = withSignal ? new AbortController().signal : undefined;
    const getPageText: NonNullable<BrowserDriver['get_page_text']> = vi.fn((_args, { signal: received }) => {
      expect(received).toBe(signal);
      return 'visible text';
    });
    const driver: BrowserDriver = { state, get_page_text: getPageText };
    expect(await driver.state()).toEqual(state());
    const helper = new BrowserToolset(driver);
    const result = await helper.execute(call('get_page_text', { tab_id: null }), signal ? { signal } : {});
    expect(payload(result)).toMatchObject({ ok: true, result: 'visible text' });
    expect(getPageText).toHaveBeenCalledTimes(1);
  });

  test('execution captures a class-owned signal once and preserves its receiver', async () => {
    const controller = new AbortController();
    let reads = 0;
    class Execution {
      #signal = controller.signal;
      get signal() {
        reads += 1;
        return this.#signal;
      }
    }
    const getPageText: NonNullable<BrowserDriver['get_page_text']> = vi.fn((_args, context) => {
      expect(context.signal).toBe(controller.signal);
      return 'visible text';
    });
    const helper = new BrowserToolset({ state, get_page_text: getPageText });
    expect(
      payload(await helper.execute(call('get_page_text', { tab_id: null }), new Execution())).result,
    ).toBe('visible text');
    expect(reads).toBe(1);
  });

  test('output serialization preserves nested reports and caller-owned records', async () => {
    const value = report();
    const before = structuredClone(value);
    const observed = state();
    const helper = new BrowserToolset(
      { state: () => observed, read_page_scoped: () => value },
      { members: ['read_page_scoped'] },
    );
    expect(payload(await helper.execute(call('read_page_scoped', read)))).toEqual({
      ok: true,
      result: before,
      state: { tabs: [{ id: 'task', title: 'Fixture', url: 'https://fixture.invalid', active: true }] },
    });
    expect(value).toEqual(before);
    for (const record of [value, value.elements, value.elements[0], value.scopes, observed, observed.tabs]) {
      expect(Object.getOwnPropertyDescriptor(record, 'toJSON')).toBeUndefined();
    }
  });

  test('output serialization treats a non-string driver error message as private', async () => {
    const detail = { note: 'private driver detail' };
    const error = new BrowserError('controlled message');
    Object.defineProperty(error, 'message', { value: detail });
    const helper = new BrowserToolset({
      state,
      get_page_text() {
        throw error;
      },
    });
    expect(payload(await helper.execute(call('get_page_text', { tab_id: null })))).toEqual({
      ok: false,
      error: 'Browser operation failed.',
      state: { tabs: [{ id: 'task', title: 'Fixture', url: 'https://fixture.invalid', active: true }] },
    });
    expect(detail).toEqual({ note: 'private driver detail' });
    expect(Object.getOwnPropertyDescriptor(detail, 'toJSON')).toBeUndefined();
  });

  test.each(['image', 'declined', 'failed'] as const)(
    'direct browser %s output keeps its owned structure through a native Responses request',
    async (kind) => {
      const image: ResponseInputImageContent = {
        type: 'input_image',
        file_id: 'file_fixture',
        prompt_cache_breakpoint: { mode: 'explicit' },
      };
      const observed = state();
      const screenshot = vi.fn(() => {
        if (kind === 'failed') {
          throw new BrowserError('Fixture screenshot failed.');
        }
        return image;
      });
      const browser = new BrowserToolset(
        { state: () => observed, screenshot },
        { confirmReads: ['screenshot'], confirm: () => kind !== 'declined' },
      );
      const output = await browser.execute(call('screenshot', { tab_id: null }));
      const received: unknown[] = [];
      const client = new OpenAI({
        apiKey: 'synthetic-test-key',
        maxRetries: 0,
        fetch: async (url, init) => {
          received.push(await new Request(url, init).json());
          return Response.json({ id: 'resp_fixture', object: 'response', status: 'completed', output: [] });
        },
      });
      await client.responses.create({ model: 'fixture', input: [output] });
      expect(received).toEqual([{ model: 'fixture', input: [output] }]);
      expect(screenshot).toHaveBeenCalledTimes(kind === 'declined' ? 0 : 1);
      if (kind === 'declined') {
        expect(payload(output)).toEqual({ ok: false, error: 'Read declined.' });
      } else if (kind === 'failed') {
        expect(payload(output)).toEqual({
          ok: false,
          error: 'Fixture screenshot failed.',
          state: { tabs: [{ id: 'task', title: 'Fixture', url: 'https://fixture.invalid', active: true }] },
        });
      } else {
        expect(payload(output)).toEqual({
          ok: true,
          state: { tabs: [{ id: 'task', title: 'Fixture', url: 'https://fixture.invalid', active: true }] },
        });
        expect(output.output).toContainEqual(image);
      }
      if (!Array.isArray(output.output)) {
        throw new TypeError('Expected native browser content blocks');
      }
      const records: object[] = [output, output.output, ...output.output];
      if (kind === 'image') {
        const [, last] = output.output;
        if (last?.type !== 'input_image' || !last.prompt_cache_breakpoint) {
          throw new Error('Expected projected image breakpoint');
        }
        records.push(last.prompt_cache_breakpoint);
      }
      for (const record of records) {
        expect(Object.getOwnPropertyDescriptor(record, 'toJSON')).toEqual({
          value: undefined,
          enumerable: false,
          writable: true,
          configurable: true,
        });
      }
      for (const record of [image, image.prompt_cache_breakpoint, observed, observed.tabs]) {
        expect(Object.getOwnPropertyDescriptor(record, 'toJSON')).toBeUndefined();
      }
    },
  );

  test('direct browser output still permits an explicit caller-owned serialization hook', async () => {
    const browser = new BrowserToolset({ state, get_page_text: () => 'visible text' });
    const output = await browser.execute(call('get_page_text', { tab_id: null }));
    const ownHook = vi.fn(() => ({ ...output, call_id: 'caller-selected' }));
    Object.defineProperty(output, 'toJSON', { value: ownHook });
    expect(JSON.stringify(output)).toBe(JSON.stringify({ ...output, call_id: 'caller-selected' }));
    expect(ownHook).toHaveBeenCalledOnce();
  });

  test.each([1, 2])('state probe %s receives cancellation and drains close', async (blockedProbe) => {
    const entered = deferred();
    let reports = 0;
    const driver: BrowserDriver = {
      async state(options) {
        const signal = options?.signal;
        reports += 1;
        if (reports === blockedProbe) {
          const stopped = deferred();
          signal?.addEventListener('abort', stopped.resolve, { once: true });
          entered.resolve();
          await stopped.promise;
          signal?.throwIfAborted();
        }
        return state();
      },
      get_page_text: () => 'visible text',
    };
    const helper = new BrowserToolset(driver);
    const controller = new AbortController();
    const reason = new Error('state cancelled');
    const result = helper.execute(call('get_page_text', { tab_id: null }), { signal: controller.signal });
    const rejected = expect(result).rejects.toBe(reason);
    await entered.promise;
    expect(helper.close()).toEqual({ status: 'draining' });
    controller.abort(reason);
    await rejected;
    expect(helper.close()).toEqual({ status: 'closed' });
  });

  test.each(['screenshot', 'zoom'] as const)(
    'projects the native image breakpoint on %s before reading final state',
    async (member) => {
      const image = {
        type: 'input_image' as const,
        detail: 'auto' as const,
        file_id: 'file_observed',
        prompt_cache_breakpoint: { mode: 'explicit' as const },
      };
      const original = structuredClone(image);
      let reports = 0;
      const helper = new BrowserToolset({
        state() {
          reports += 1;
          if (reports === 2) {
            Reflect.set(image.prompt_cache_breakpoint, 'mode', 'changed');
          }
          return state();
        },
        screenshot: () => image,
        zoom: () => image,
      });
      const args = member === 'screenshot' ? { tab_id: null } : { tab_id: null, region: [0, 0, 10, 10] };
      const result = await helper.execute(call(member, args));
      expect(result.output).toContainEqual(original);
    },
  );

  test.each(['screenshot', 'zoom'] as const)(
    'owns declared class image and breakpoint fields for %s before final state',
    async (member) => {
      const reads: string[] = [];
      class Breakpoint {
        #mode = 'explicit' as const;

        get mode() {
          reads.push('mode');
          return this.#mode;
        }
      }
      class Image implements ResponseInputImageContent {
        #image = {
          type: 'input_image' as const,
          detail: null,
          image_url: 'data:image/png;base64,Zml4dHVyZQ==',
          file_id: 'file_captured',
          prompt_cache_breakpoint: new Breakpoint(),
        };

        get type() {
          reads.push('type');
          return this.#image.type;
        }

        get detail() {
          reads.push('detail');
          return this.#image.detail;
        }

        get image_url() {
          reads.push('image_url');
          return this.#image.image_url;
        }

        get file_id() {
          reads.push('file_id');
          return this.#image.file_id;
        }

        get prompt_cache_breakpoint() {
          reads.push('prompt_cache_breakpoint');
          return this.#image.prompt_cache_breakpoint;
        }

        recycle() {
          this.#image.file_id = 'file_recycled';
        }
      }
      const image = new Image();
      let reports = 0;
      const helper = new BrowserToolset({
        state() {
          reports += 1;
          if (reports === 2) {
            image.recycle();
          }
          return state();
        },
        screenshot: () => image,
        zoom: () => image,
      });
      const args = member === 'screenshot' ? { tab_id: null } : { tab_id: null, region: [0, 0, 10, 10] };
      const result = await helper.execute(call(member, args));
      expect(result.output).toContainEqual({
        type: 'input_image',
        detail: null,
        image_url: 'data:image/png;base64,Zml4dHVyZQ==',
        file_id: 'file_captured',
        prompt_cache_breakpoint: { mode: 'explicit' },
      });
      expect(reads).toEqual(['type', 'detail', 'image_url', 'file_id', 'prompt_cache_breakpoint', 'mode']);
      expect(reports).toBe(2);
    },
  );

  test.each([
    ['screenshot', { tab_id: null }],
    ['zoom', { tab_id: null, region: [0, 0, 10, 10] }],
  ] as const)('rejects blank image references and invalid breakpoint values for %s', async (member, args) => {
    await Promise.all(
      [
        { image_url: '  ' },
        { file_id: 'file_ok', prompt_cache_breakpoint: { mode: 'automatic' } },
        { file_id: 'file_ok', prompt_cache_breakpoint: {} },
        { file_id: 'file_ok', prompt_cache_breakpoint: { mode: 'explicit', private: 'omit' } },
      ].map(async (invalid) => {
        const image = { type: 'input_image' as const, detail: 'auto' as const };
        Object.assign(image, invalid);
        const imageDriver = () => image;
        const helper = new BrowserToolset({ state, screenshot: imageDriver, zoom: imageDriver });
        await expect(helper.execute(call(member, args))).rejects.toThrow('must return an input_image');
      }),
    );
  });

  test('cooperative navigation receives Stop and cannot be replayed while active', async () => {
    const entered = deferred();
    const navigate: NonNullable<BrowserDriver['navigate']> = vi.fn(async (_args, { signal }) => {
      entered.resolve();
      const stopped = deferred();
      signal?.addEventListener('abort', stopped.resolve, { once: true });
      await stopped.promise;
    });
    const helper = new BrowserToolset({ state, navigate }, { confirm: () => true, urlPolicy: () => true });
    const controller = new AbortController();
    const input = call('navigate', { tab_id: null, url: 'https://fixture.invalid/next' });
    const active = helper.execute(input, { signal: controller.signal });
    await entered.promise;
    await expect(helper.execute(input)).rejects.toThrow('busy');
    controller.abort();
    await expect(active).rejects.toThrow();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  test.each(['get_page_text', 'list_tabs', 'screenshot'] as const)(
    'refusing %s reads neither state nor content',
    async (member) => {
      const observe = vi.fn(() => ({
        tabs: [{ id: 'private', title: 'secret title', url: 'https://private.invalid/', active: true }],
      }));
      const readContent = vi.fn(() => 'secret content');
      const shot = vi.fn(() => ({
        type: 'input_image' as const,
        detail: 'auto' as const,
        image_url: 'secret image',
      }));
      const confirm = vi.fn(() => false);
      const helper = new BrowserToolset(
        { state: observe, get_page_text: readContent, screenshot: shot },
        {
          confirmReads: [member],
          confirm,
        },
      );
      const args = member === 'list_tabs' ? {} : { tab_id: null };
      const output = await helper.execute(call(member, args));
      expect(payload(output)).toEqual({ ok: false, error: 'Read declined.' });
      expect(confirm).toHaveBeenCalledExactlyOnceWith(
        {
          phase: 'before_read',
          member,
          arguments: args,
          state: null,
          call_id: 'call',
        },
        { signal: undefined },
      );
      expect(observe).not.toHaveBeenCalled();
      expect(readContent).not.toHaveBeenCalled();
      expect(shot).not.toHaveBeenCalled();
      expect(JSON.stringify(output)).not.toMatch(/secret|private/u);
    },
  );
  test('protected reads must be enabled; validation never reads excluded driver getters', () => {
    expect(
      () => new BrowserToolset({ state }, { confirmReads: ['screenshot'], confirm: () => false }),
    ).toThrow('enabled browser read');
    const disabled = vi.fn(() => {
      throw new Error('excluded getter');
    });
    expect(
      () =>
        new BrowserToolset(
          {
            state,
            get screenshot(): NonNullable<BrowserDriver['screenshot']> {
              return disabled();
            },
          },
          { members: [], confirmReads: ['screenshot'], confirm: () => false },
        ),
    ).toThrow('enabled browser read');
    expect(disabled).not.toHaveBeenCalled();
  });

  test('new pointer and checkbox members are opt-ins with strict fields and consent', async () => {
    const hover = vi.fn(() => 'visible');
    const set = vi.fn(() => 'checked');
    const driver = { state, hover_at: hover, set_checked: set };
    expect(new BrowserToolset(driver).tools().map((tool) => tool.name)).toEqual(['browser_list_tabs']);
    const helper = new BrowserToolset(driver, {
      additionalMembers: ['hover_at', 'set_checked'],
      confirm: () => true,
    });
    expect(payload(await helper.execute(call('hover_at', { tab_id: null, x: 7, y: 9 }))).ok).toBe(true);
    expect(
      payload(await helper.execute(call('set_checked', { tab_id: null, target: 'ref', checked: true }))).ok,
    ).toBe(true);
    expect(
      payload(await helper.execute(call('set_checked', { tab_id: null, target: 'ref', checked: 1 }))).ok,
    ).toBe(false);
    expect(set).toHaveBeenCalledExactlyOnceWith(
      { tab_id: null, target: 'ref', checked: true },
      { signal: undefined },
    );
    expect(hover).toHaveBeenCalledExactlyOnceWith({ tab_id: null, x: 7, y: 9 }, { signal: undefined });
  });

  test('triple click remains one confirmed, cancellation-aware driver call', async () => {
    const handler = vi.fn(() => 'selected');
    const confirm = vi.fn(() => true);
    const tools = new BrowserToolset({ state, click_at: handler }, { members: ['click_at'], confirm });
    const args = { ...click, click_count: 3 };
    expect(payload(await tools.execute(call('click_at', args))).ok).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledExactlyOnceWith(args, { signal: undefined });
  });

  test.each(calls)('%s stays disabled before any driver or policy access', async (member, args) => {
    const observe = vi.fn(state);
    const policy = vi.fn(() => true);
    const handler = vi.fn(() => report());
    const driver = { state: observe, [member]: handler };
    const implicit = new BrowserToolset(driver, { confirm: policy });
    const explicit = new BrowserToolset(driver, { members: [], confirm: policy });
    expect(implicit.tools().map((tool) => tool.name)).toEqual(['browser_list_tabs']);
    expect(explicit.tools()).toEqual([]);
    await Promise.all(
      [implicit, explicit].map((toolset) =>
        expect(toolset.execute(call(member, args))).rejects.toThrow('completed registered call'),
      ),
    );
    expect(observe).not.toHaveBeenCalled();
    expect(policy).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  test.each(calls)('%s requires an implementation when selected', (member) => {
    expect(() => new BrowserToolset({ state }, { members: [member], confirm: () => true })).toThrow(
      'not implemented',
    );
  });

  test.each(calls.slice(0, 3))('%s requires consent and receives cancellation', async (member, args) => {
    const handler = vi.fn(() => 'done');
    const driver = { state, [member]: handler };
    expect(() => new BrowserToolset(driver, { members: [member] })).toThrow('requires confirm');
    const denied = new BrowserToolset(driver, { members: [member], confirm: () => false });
    expect(payload(await denied.execute(call(member, args))).ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    const controller = new AbortController();
    const allowed = new BrowserToolset(driver, { members: [member], confirm: () => true });
    expect(payload(await allowed.execute(call(member, args), { signal: controller.signal })).result).toBe(
      'done',
    );
    expect(handler).toHaveBeenCalledExactlyOnceWith(args, { signal: controller.signal });
  });

  test('consent cannot replace the nested drag path', async () => {
    const handler = vi.fn(() => 'done');
    const toolset = new BrowserToolset(
      { state, drag_path: handler },
      {
        members: ['drag_path'],
        confirm: (context) => {
          const { path } = context.arguments;
          if (Array.isArray(path)) {
            path.length = 0;
          }
          return true;
        },
      },
    );
    await toolset.execute(call('drag_path', drag));
    expect(handler).toHaveBeenCalledExactlyOnceWith(drag, { signal: undefined });
  });

  test('cancellation during consent does not send held keys', async () => {
    const controller = new AbortController();
    const handler = vi.fn();
    const toolset = new BrowserToolset(
      { state, hold_keys: handler },
      {
        members: ['hold_keys'],
        confirm: () => {
          controller.abort();
          return true;
        },
      },
    );
    await expect(toolset.execute(call('hold_keys', hold), { signal: controller.signal })).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  const invalid: [BrowserMember, Record<string, unknown>][] = [
    ['click_at', { ...click, x: -1 }],
    ['click_at', { ...click, y: 0.5 }],
    ['click_at', { ...click, x: true }],
    ['click_at', { ...click, button: 'wheel' }],
    ['click_at', { ...click, click_count: 4 }],
    ['click_at', { ...click, keys: ['Shift', 'Shift'] }],
    ['click_at', { ...click, keys: ['ArrowDown'] }],
    ['drag_path', { ...drag, path: [{ x: 0, y: 0 }] }],
    [
      'drag_path',
      {
        ...drag,
        path: [
          { a: 0, b: 0 },
          { a: 1, b: 1 },
        ],
      },
    ],
    [
      'drag_path',
      {
        ...drag,
        path: [
          { x: 0, y: 0 },
          { x: 1, y: 1, z: 1 },
        ],
      },
    ],
    ['drag_path', { ...drag, path: Array.from({ length: 101 }, () => ({ x: 0, y: 0 })) }],
    ['hold_keys', { ...hold, keys: [] }],
    ['hold_keys', { ...hold, keys: [''] }],
    ['hold_keys', { ...hold, keys: ['ArrowDown', 'ArrowDown'] }],
    ['hold_keys', { ...hold, keys: ['é'.repeat(33)] }],
    ['hold_keys', { ...hold, keys: ['\uD800'] }],
    ['hold_keys', { ...hold, duration_ms: 3001 }],
    ['hold_keys', { ...hold, duration_ms: false }],
    ['read_page_scoped', { ...read, depth: 0 }],
    ['read_page_scoped', { ...read, depth: 33 }],
    ['read_page_scoped', { ...read, root: '' }],
    ['read_page_scoped', { ...read, root: 'x'.repeat(257) }],
    ['read_page_scoped', { ...read, extra: true }],
  ];
  test.each(invalid)('rejects invalid %s arguments before consent or effect (%j)', async (member, args) => {
    const handler = vi.fn(() => 'done');
    const confirm = vi.fn(() => true);
    const toolset = new BrowserToolset({ state, [member]: handler }, { members: [member], confirm });
    expect(payload(await toolset.execute(call(member, args))).ok).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});

function scopedDriver(value: unknown, observe: BrowserDriver['state'] = state): BrowserDriver {
  // SAFETY: Exercise invalid customer-driver values at the public runtime boundary.
  return { state: observe, read_page_scoped: () => value as BrowserScopedReadV1 };
}

describe('scoped browser reports', () => {
  test('detaches scope data before final state and ignores unknown metadata', async () => {
    const value = report();
    const expected = structuredClone(value);
    Object.defineProperty(value, 'private', {
      enumerable: true,
      get() {
        throw new Error('Private data read');
      },
    });
    let observations = 0;
    const toolset = new BrowserToolset(
      scopedDriver(value, () => {
        observations += 1;
        if (observations === 2) {
          const [first] = value.scopes;
          if (!first) {
            throw new Error('Missing scope');
          }
          first.label = 'Changed after operation';
          value.scopes.push({ ref: 'later', label: 'Later' });
        }
        return state();
      }),
      { members: ['read_page_scoped'] },
    );
    expect(payload(await toolset.execute(call('read_page_scoped', read)))).toEqual({
      ok: true,
      result: expected,
      state: { tabs: [{ id: 'task', title: 'Fixture', url: 'https://fixture.invalid', active: true }] },
    });
  });

  test.each([
    undefined,
    null,
    'legacy text',
    { ...report(), scopes: null },
    { ...report(), scopes: [{ ref: 'scope:1', label: '' }] },
    { ...report(), scopes: [{ ref: 'button:1', label: 'Duplicate element' }] },
    {
      ...report(),
      scopes: [
        { ref: 'scope:1', label: 'One' },
        { ref: 'scope:1', label: 'Two' },
      ],
    },
    { ...report(), scopes: [{ ref: 'scope:1', label: '\uD800' }] },
  ])('stops on an invalid scoped result: %j', async (value) => {
    const observe = vi.fn(state);
    const toolset = new BrowserToolset(scopedDriver(value, observe), { members: ['read_page_scoped'] });
    await expect(toolset.execute(call('read_page_scoped', read))).rejects.toThrow(
      'scoped read report failed',
    );
    expect(observe).toHaveBeenCalledTimes(1);
  });

  test('preserves large reports and their distinct scope refs', async () => {
    const value = {
      version: 1,
      text: '🦄'.repeat(20_000),
      omitted: [],
      elements: Array.from({ length: 60 }, (_, i) => ({
        ref: `element:${i}:${'x'.repeat(200)}`,
        role: 'button',
        label: 'x'.repeat(256),
      })),
      scopes: Array.from({ length: 60 }, (_, i) => ({
        ref: `scope:${i}:${'x'.repeat(200)}`,
        label: 'x'.repeat(256),
      })),
    };
    const toolset = new BrowserToolset(scopedDriver(value), { members: ['read_page_scoped'] });
    expect(payload(await toolset.execute(call('read_page_scoped', read))).result).toEqual(value);
  });
});
