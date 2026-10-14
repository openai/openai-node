// oxlint-disable max-classes-per-file -- Independent request options fixtures verify own and inherited accessors.
import OpenAI, { OpenAIError } from 'openai';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import { buildHeaders } from 'openai/internal/headers';
import { ComputerToolset } from 'openai/helpers/computer';
import type {
  ComputerCallInput,
  ComputerDriver,
  ComputerExecutionOptions,
  ComputerRunOptions,
} from 'openai/helpers/computer';
import { hasOwn, isObj } from 'openai/internal/utils/values';
import type {
  ComputerAction,
  Response as SDKResponse,
  ResponseComputerToolCall,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses';
import { describe, expect, test, vi } from 'vitest';

const image = { type: 'computer_screenshot', image_url: 'data:image/png;base64,c3ludGhldGlj' } as const;
const call = (actions: ComputerAction[]): ResponseComputerToolCall => ({
  id: 'cu_test',
  type: 'computer_call',
  call_id: 'call_test',
  pending_safety_checks: [],
  status: 'completed',
  actions,
});

const message = {
  type: 'message',
  id: 'msg_test',
  status: 'completed',
  role: 'assistant',
  created_by: 'synthetic-provenance',
  content: [{ type: 'output_text', text: 'done', annotations: [] }],
};

function harness(
  outputs: unknown[][],
  configure?: (driver: ComputerDriver, performed: ComputerAction[]) => void,
) {
  const performed: ComputerAction[] = [];
  const bodies: Record<string, unknown>[] = [];
  const headers: Headers[] = [];
  const urls: string[] = [];
  let requests = 0;
  const effect = vi.fn((action: ComputerAction) => {
    performed.push(action);
  });
  const driver: ComputerDriver = {
    click: effect,
    double_click: effect,
    drag: effect,
    keypress: effect,
    move: effect,
    scroll: effect,
    type: effect,
    wait: effect,
    screenshot: vi.fn(() => {
      performed.push({ type: 'screenshot' });
      return image;
    }),
  };
  configure?.(driver, performed);
  const client = new OpenAI({
    apiKey: 'synthetic-test-key',
    maxRetries: 0,
    fetch: async (url, init) => {
      const request = new Request(url, init);
      const body = await request.json();
      if (!isObj(body)) {
        throw new Error('Expected JSON object request');
      }
      bodies.push(body);
      headers.push(request.headers);
      urls.push(request.url);
      const output = outputs[requests];
      requests += 1;
      if (!output) {
        throw new Error('Unexpected additional request');
      }
      return Response.json({ id: 'resp_test', object: 'response', status: 'completed', output });
    },
  });
  return { bodies, headers, urls, performed, driver, client, toolset: new ComputerToolset(driver) };
}

const ownGuard = (value: unknown) => {
  expect(Object.getOwnPropertyDescriptor(value, 'toJSON')).toMatchObject({
    value: undefined,
    enumerable: false,
    writable: true,
    configurable: true,
  });
};

describe('ComputerToolset', () => {
  test.each(['value', 'undefined', 'getter'] as const)(
    'computed history cannot be replaced by own enumerable body (%s)',
    async (kind) => {
      const h = harness([[message]]);
      const requestOptions: OpenAI.RequestOptions = { headers: { 'x-fixture': 'kept' } };
      const getter = vi.fn(() => ({ input: 'other' }));
      Object.defineProperty(
        requestOptions,
        'body',
        kind === 'getter'
          ? { enumerable: true, get: getter }
          : { enumerable: true, value: kind === 'value' ? { input: 'other' } : undefined },
      );
      await expect(h.toolset.run(h.client, { input: 'fixture' }, { requestOptions })).rejects.toThrow(
        'requestOptions.body',
      );
      expect(getter).not.toHaveBeenCalled();
      expect(h.bodies).toEqual([]);
      expect(h.performed).toEqual([]);
    },
  );

  test('computed history rejects a body added before a later logical create', async () => {
    const h = harness([[call([{ type: 'wait' }])], [message]]);
    const requestOptions: OpenAI.RequestOptions = { headers: { 'Idempotency-Key': 'fixture' } };
    const getter = vi.fn(() => ({ input: 'other' }));
    await expect(
      h.toolset.run(
        h.client,
        { input: 'fixture' },
        {
          requestOptions,
          signal: new AbortController().signal,
          beforeAction: () => {
            Object.defineProperty(requestOptions, 'body', {
              enumerable: true,
              configurable: true,
              get: getter,
            });
            return true;
          },
        },
      ),
    ).rejects.toThrow('requestOptions.body');
    expect(getter).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(1);
    expect(h.performed.map((action) => action.type)).toEqual(['wait', 'screenshot']);
  });

  test.each(['inherited', 'nonenumerable'] as const)(
    'computed history ignores %s body just as native options spreading does',
    async (kind) => {
      const h = harness([[call([{ type: 'wait' }])], [message]]);
      const getter = vi.fn(() => ({ input: 'other' }));
      const requestOptions: OpenAI.RequestOptions = { headers: { 'x-fixture': 'kept' } };
      if (kind === 'inherited') {
        Object.setPrototypeOf(
          requestOptions,
          Object.defineProperty({}, 'body', { enumerable: true, get: getter }),
        );
      } else {
        Object.defineProperty(requestOptions, 'body', { get: getter });
      }
      await h.toolset.run(h.client, { input: 'fixture' }, { requestOptions });
      expect(getter).not.toHaveBeenCalled();
      expect(h.headers.every((header) => header.get('x-fixture') === 'kept')).toBe(true);
      expect(h.bodies[1]?.['input']).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'computer_call_output' })]),
      );
    },
  );
  test.each(
    (['paired', 'output-only'] as const).flatMap((history) =>
      (['call-id', 'empty-call-id', 'item-id'] as const).map((collision) => ({ history, collision })),
    ),
  )(
    'supplied $history history reserves $collision before sibling effects',
    async ({ history, collision }) => {
      const prior = {
        ...call([{ type: 'wait' }]),
        call_id: collision === 'empty-call-id' ? '' : 'past_call',
      };
      const output = {
        type: 'computer_call_output' as const,
        id: 'past_output',
        call_id: prior.call_id,
        output: image,
      };
      const fresh = { ...call([{ type: 'wait' }]), id: 'fresh_item', call_id: 'fresh_call' };
      const reservedId = history === 'paired' ? prior.id : output.id;
      const repeated = {
        ...call([{ type: 'wait' }]),
        id: collision === 'item-id' ? reservedId : 'repeated_item',
        call_id: collision === 'item-id' ? 'new_call' : prior.call_id,
      };
      const h = harness([[fresh, repeated]]);
      const approve = vi.fn(() => true);
      await expect(
        h.toolset.run(
          h.client,
          { input: history === 'paired' ? [prior, output] : [output] },
          { beforeAction: approve },
        ),
      ).rejects.toThrow('duplicate');
      expect(h.bodies).toHaveLength(1);
      expect(approve).not.toHaveBeenCalled();
      expect(h.performed).toEqual([]);
    },
  );

  test('supplied item references reserve the item-ID namespace', async () => {
    const h = harness([[call([{ type: 'wait' }])]]);
    await expect(
      h.toolset.run(h.client, { input: [{ type: 'item_reference', id: 'cu_test' }] }),
    ).rejects.toThrow('duplicate output item identity');
    expect(h.performed).toEqual([]);
  });

  test.each([false, true])(
    'supplied history keeps identity namespaces and empty item IDs distinct: %s',
    async (empty) => {
      const prior = { ...call([{ type: 'wait' }]), id: empty ? '' : 'past_item', call_id: 'past_call' };
      const output = { type: 'computer_call_output' as const, call_id: prior.call_id, output: image };
      const next = { ...call([{ type: 'wait' }]), id: empty ? '' : prior.call_id, call_id: prior.id };
      const h = harness([[next], [message]]);
      await h.toolset.run(h.client, { input: [prior, output] });
      expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
      expect(h.bodies[1]?.['input']).toContainEqual(next);
    },
  );

  test('direct execution preserves an empty native call ID', async () => {
    const h = harness([]);
    const item = { ...call([{ type: 'wait' }]), call_id: '' };
    await expect(h.toolset.execute(item)).resolves.toMatchObject({ call_id: '' });
    expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
  });

  test('computer run replays an empty native call ID', async () => {
    const item = { ...call([{ type: 'wait' }]), call_id: '' };
    const h = harness([[item], [message]]);
    await h.toolset.run(h.client, { input: 'fixture' });
    expect(h.bodies[1]?.['input']).toContainEqual(item);
    expect(h.bodies[1]?.['input']).toContainEqual(
      expect.objectContaining({ type: 'computer_call_output', call_id: '' }),
    );
    expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
  });

  test('direct execution rejects an array-shaped computer call before effects', async () => {
    const h = harness([]);
    const approval = vi.fn(() => true);
    const item = Object.assign([], call([{ type: 'wait' }]));
    await expect(h.toolset.execute(item, { beforeAction: approval })).rejects.toThrow();
    expect(approval).not.toHaveBeenCalled();
    expect(h.performed).toEqual([]);
  });

  test.each([false, true])(
    'top-level signal overrides an unread request signal: aborted=%s',
    async (aborted) => {
      const h = harness([[call([{ type: 'wait' }])], [message]]);
      const controller = new AbortController();
      const reason = new Error('caller stopped');
      if (aborted) {
        controller.abort(reason);
      }
      const getter = vi.fn(() => {
        throw new Error('overridden signal must not be read');
      });
      const requestOptions = { headers: { 'x-fixture': 'kept' } };
      Object.defineProperty(requestOptions, 'signal', { enumerable: true, get: getter });
      const result = h.toolset.run(
        h.client,
        { input: 'fixture' },
        { requestOptions, signal: controller.signal },
      );
      if (aborted) {
        await expect(result).rejects.toBe(reason);
        expect(h.bodies).toEqual([]);
        expect(h.performed).toEqual([]);
      } else {
        await expect(result).resolves.toHaveProperty('status', 'completed');
        expect(h.headers.every((header) => header.get('x-fixture') === 'kept')).toBe(true);
      }
      expect(getter).not.toHaveBeenCalled();
    },
  );

  test.each(['batch', 'legacy'] as const)(
    'direct replay rejects array drag points in a %s call',
    async (version) => {
      const h = harness([]);
      const point = Object.assign([], { x: -1, y: 2 });
      const drag: ComputerAction = { type: 'drag', path: [point] };
      const { actions: _actions, ...base } = call([]);
      const item = version === 'batch' ? call([drag]) : { ...base, action: drag };
      const approval = vi.fn(() => true);
      await expect(h.toolset.execute(item, { beforeAction: approval })).rejects.toThrow(
        'invalid computer action',
      );
      expect(approval).not.toHaveBeenCalled();
      expect(h.performed).toEqual([]);
      expect(h.driver.screenshot).not.toHaveBeenCalled();
    },
  );

  test.each(['first', 'later', 'call'] as const)(
    'direct replay checks %s non-JSON extensions before any effect',
    async (where) => {
      const h = harness([]);
      const first = { type: 'wait' } as const;
      const later = { type: 'click', x: 1, y: 2, button: 'left' } as const;
      const item = call([first, later]);
      Object.assign({ first, later, call: item }[where], { audit: 1n });
      const approval = vi.fn(() => true);
      await expect(h.toolset.execute(item, { beforeAction: approval })).rejects.toThrow();
      expect(approval).not.toHaveBeenCalled();
      expect(h.performed).toEqual([]);
      expect(h.driver.screenshot).not.toHaveBeenCalled();
    },
  );

  test.each(['batch', 'legacy'] as const)(
    'direct %s replay preserves native extensions and isolated approval JSON',
    async (version) => {
      const h = harness([]);
      const at = new Date('2026-01-02T03:04:05.000Z');
      const action = {
        type: 'click',
        x: -1,
        y: 2,
        button: 'left',
        audit: { at, details: ['kept', null] },
      } as const;
      const { actions: _actions, ...base } = call([]);
      const item = {
        ...(version === 'batch' ? call([action]) : { ...base, action }),
        pending_safety_checks: [{ id: 'review', audit: { fields: ['allowed'] } }],
        // Native replay drops this output-only field before encoding.
        created_by: 1n,
      };
      const output = await h.toolset.execute(item, {
        approveSafetyChecks(view) {
          ownGuard(view);
          ownGuard(view.pending_safety_checks);
          ownGuard(view.pending_safety_checks[0]);
          return true;
        },
        beforeAction(current, view) {
          ownGuard(current);
          ownGuard(view);
          if (version === 'batch') {
            expect(Object.getOwnPropertyDescriptor(view, 'actions')?.get).toBeTypeOf('function');
            ownGuard(view.actions);
            ownGuard(view.actions?.[0]);
          } else {
            ownGuard(view.action);
          }
          ownGuard(view.pending_safety_checks);
          if (current.type === 'click') {
            // SAFETY: This callback's only click is the fixture with audit metadata above.
            const projected = current as typeof action;
            ownGuard(projected.audit);
            ownGuard(projected.audit.details);
            expect(projected.audit.at).toBeInstanceOf(Date);
            expect(JSON.stringify(current)).toContain(`"at":"${at.toISOString()}"`);
            Object.defineProperty(current, 'toJSON', {
              value: () => ({ callerApproval: true }),
              configurable: true,
            });
            expect(JSON.stringify(current)).toBe('{"callerApproval":true}');
          }
          return true;
        },
      });
      expect(h.performed).toEqual([
        expect.objectContaining({ type: 'click', x: -1, y: 2 }),
        { type: 'screenshot' },
      ]);
      expect(output.acknowledged_safety_checks).toEqual(item.pending_safety_checks);
      expect(Object.getOwnPropertyDescriptor(item, 'toJSON')).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(action, 'toJSON')).toBeUndefined();
    },
  );
  test.each(['add', 'delete', 'hide'] as const)(
    'signal overlay follows own request-option keys that callbacks %s',
    async (change) => {
      const h = harness([[call([{ type: 'wait' }])], [message]]);
      const requestOptions: OpenAI.RequestOptions =
        change === 'add'
          ? {}
          : {
              timeout: 12_000,
              headers: { 'x-live': 'first' },
            };
      const observed: OpenAI.RequestOptions[] = [];
      const create = h.client.responses.create.bind(h.client.responses);
      vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) => {
        observed.push({ ...options });
        return create(params, options);
      });
      await h.toolset.run(
        h.client,
        { input: 'begin' },
        {
          signal: new AbortController().signal,
          requestOptions,
          beforeAction: () => {
            if (change === 'add') {
              requestOptions.timeout = 13_000;
              requestOptions.headers = { 'x-live': 'added' };
            } else if (change === 'delete') {
              Reflect.deleteProperty(requestOptions, 'timeout');
              Reflect.deleteProperty(requestOptions, 'headers');
            } else {
              Object.defineProperty(requestOptions, 'headers', { enumerable: false });
            }
            return true;
          },
        },
      );
      expect(h.headers.map((headers) => headers.get('x-live'))).toEqual(
        change === 'add' ? [null, 'added'] : ['first', null],
      );
      if (change === 'delete') {
        expect(observed[1]).not.toHaveProperty('timeout');
      } else {
        expect(observed[1]).toHaveProperty('timeout', change === 'add' ? 13_000 : 12_000);
      }
      expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
    },
  );

  test.each(
    (['signal', 'continuation'] as const).flatMap((phase) =>
      [false, true].map((frozen) => ({ phase, frozen })),
    ),
  )(
    'create wrappers can edit a $phase overlay without changing caller options (frozen=$frozen)',
    async ({ phase, frozen }) => {
      const h = harness([[call([{ type: 'wait' }])], [message]]);
      const { signal } = new AbortController();
      const requestOptions: OpenAI.RequestOptions = {
        timeout: 12_000,
        maxRetries: 0,
        headers: {
          'x-supplied': 'kept',
          ...(phase === 'continuation' ? { 'idempotency-key': 'first' } : {}),
        },
      };
      const before = { ...requestOptions };
      if (frozen) {
        Object.freeze(requestOptions);
      }
      const create = h.client.responses.create.bind(h.client.responses);
      const query = { fixture: 'routed' };
      let requests = 0;
      vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) => {
        requests += 1;
        if (phase === 'signal' || requests > 1) {
          if (!options) {
            throw new Error('Expected run request options');
          }
          options.headers = buildHeaders([options.headers, { 'x-wrapper': phase }]);
          options.timeout = 14_000;
          delete options.maxRetries;
          Object.defineProperty(options, 'query', { value: query, enumerable: true });
          expect(options.timeout).toBe(14_000);
          expect('maxRetries' in options).toBe(false);
          expect(Object.keys(options)).not.toContain('maxRetries');
          expect(Object.getOwnPropertyDescriptor(options, 'maxRetries')).toBeUndefined();
          expect(Object.getOwnPropertyDescriptor(options, 'query')).toMatchObject({
            value: { fixture: 'routed' },
            writable: false,
            configurable: false,
          });
          expect(Reflect.deleteProperty(options, 'query')).toBe(false);
        }
        return create(params, options);
      });
      await expect(
        h.toolset.run(
          h.client,
          { input: 'begin' },
          { requestOptions, ...(phase === 'signal' ? { signal } : {}) },
        ),
      ).resolves.toHaveProperty('status', 'completed');
      expect(requestOptions).toEqual(before);
      const modified = phase === 'signal' ? [0, 1] : [1];
      for (const index of modified) {
        expect(h.headers[index]?.get('x-wrapper')).toBe(phase);
        expect(h.headers[index]?.get('x-supplied')).toBe('kept');
        expect(h.headers[index]?.get('x-stainless-timeout')).toBe('14');
        expect(new URL(h.urls[index] ?? '').searchParams.get('fixture')).toBe('routed');
      }
      if (phase === 'continuation') {
        expect(h.headers[0]?.get('idempotency-key')).toBe('first');
        expect(h.headers[1]?.get('idempotency-key')).toBeTruthy();
        expect(h.headers[1]?.get('idempotency-key')).not.toBe('first');
      }
      expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
    },
  );

  test.each(
    ['execute', 'run'].flatMap((operation) =>
      ['legacy', 'batch'].flatMap((variant) => [false, true].map((array) => ({ operation, variant, array }))),
    ),
  )(
    'computer action records use $operation $variant with array=$array',
    async ({ operation, variant, array }) => {
      const action: ComputerAction = { type: 'click', x: 10, y: 20, button: 'left', keys: null };
      const value = array ? Object.assign([], action) : action;
      const { actions: _actions, ...base } = call([action]);
      const pending = variant === 'legacy' ? { ...base, action } : { ...base, actions: [action] };
      const h = harness([[pending], [message]]);
      const setAction = (target: ComputerCallInput) =>
        Reflect.set(
          target,
          variant === 'legacy' ? 'action' : 'actions',
          variant === 'legacy' ? value : [value],
        );
      const beforeAction = vi.fn(() => true);
      if (operation === 'run') {
        const create = h.client.responses.create.bind(h.client.responses);
        vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) =>
          create(params, options)._thenUnwrap((response) => {
            if ('output' in response) {
              const returned = response.output.find((item) => item.type === 'computer_call');
              if (returned) {
                setAction(returned);
              }
            }
            return response;
          }),
        );
      } else {
        setAction(pending);
      }
      const result =
        operation === 'run'
          ? h.toolset.run(h.client, { input: 'begin' }, { beforeAction })
          : h.toolset.execute(pending, { beforeAction });
      if (array) {
        await expect(result).rejects.toBeInstanceOf(OpenAIError);
        expect(beforeAction).not.toHaveBeenCalled();
        expect(h.performed).toEqual([]);
        expect(h.bodies).toHaveLength(operation === 'run' ? 1 : 0);
      } else {
        await result;
        expect(h.performed).toEqual([action, { type: 'screenshot' }]);
      }
    },
  );

  test.each(['same', 'later'] as const)(
    'FR rejects a repeated call_id in %s response before that batch',
    async (where) => {
      const first = call([{ type: 'wait' }]);
      const second = { ...call([{ type: 'click', x: 1, y: 2, button: 'left' }]), id: 'cu_second' };
      const h = harness(where === 'same' ? [[first, second], [message]] : [[first], [second], [message]]);
      await expect(h.toolset.run(h.client, { input: 'begin' })).rejects.toThrow(
        'duplicate computer call identity',
      );
      expect(h.performed).toEqual(where === 'same' ? [] : [{ type: 'wait' }, { type: 'screenshot' }]);
      expect(h.bodies).toHaveLength(where === 'same' ? 1 : 2);
    },
  );

  test.each(['execute', 'run'] as const)(
    'FR empty safety ID remains a native string in %s',
    async (operation) => {
      const pending = {
        ...call([{ type: 'wait' }]),
        pending_safety_checks: [{ id: '', code: null, message: null }],
      };
      const h = harness([[pending], [message]]);
      const approveSafetyChecks = vi.fn(() => true);
      if (operation === 'execute') {
        await expect(h.toolset.execute(pending, { approveSafetyChecks })).resolves.toMatchObject({
          acknowledged_safety_checks: pending.pending_safety_checks,
        });
      } else {
        await h.toolset.run(h.client, { input: 'begin' }, { approveSafetyChecks });
        expect(h.bodies[1]?.['input']).toContainEqual(
          expect.objectContaining({
            acknowledged_safety_checks: pending.pending_safety_checks,
          }),
        );
      }
      expect(approveSafetyChecks).toHaveBeenCalledTimes(1);
      expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
    },
  );

  test.each([
    ['execute', 'batch'],
    ['execute', 'legacy'],
    ['run', 'batch'],
    ['run', 'legacy'],
  ] as const)(
    'safety callbacks own optional native fields without changing %s %s wire checks',
    async (operation, callKind) => {
      const checks = [
        { id: 'omitted', extension: { note: 'ordinary metadata' } },
        { id: 'code-only', code: 'sensitive_domain' },
        { id: 'message-only', message: 'Review the fixture.' },
        { id: 'nulls', code: null, message: null },
        { id: 'provided', code: 'review', message: 'Ordinary check.' },
      ];
      const inputActions: ComputerAction[] = [{ type: 'wait' }];
      const { actions: _actions, ...base } = call(inputActions);
      const pending: ComputerCallInput = {
        ...base,
        ...(callKind === 'batch' ? { actions: inputActions } : { action: { type: 'wait' } as const }),
        pending_safety_checks: checks,
      };
      const original = structuredClone(pending);
      const h = harness([[pending], [message]]);
      const inspect = (view: ResponseComputerToolCall) => {
        expect(view.pending_safety_checks).toEqual(checks);
        for (const [index, check] of view.pending_safety_checks.entries()) {
          const provided = checks[index];
          if (!provided) {
            throw new Error('Unexpected callback check');
          }
          for (const key of ['code', 'message'] as const) {
            expect(Object.getOwnPropertyDescriptor(check, key)).toEqual({
              value: Object.getOwnPropertyDescriptor(provided, key)?.value,
              writable: true,
              enumerable: true,
              configurable: true,
            });
          }
        }
        const [first] = view.pending_safety_checks;
        if (!first) {
          throw new Error('Missing fixture safety check');
        }
        return first;
      };
      const approveSafetyChecks = vi.fn((view: ResponseComputerToolCall) => {
        const first = inspect(view);
        first.code = 'caller-only';
        first.message = 'callback edit';
        view.pending_safety_checks.push({ id: 'callback-only' });
        return true;
      });
      const beforeAction = vi.fn((_action: ComputerAction, view: ResponseComputerToolCall) => {
        inspect(view).message = 'action-only';
        return true;
      });
      const options = { approveSafetyChecks, beforeAction };
      if (operation === 'execute') {
        const output = await h.toolset.execute(pending, options);
        expect(output.acknowledged_safety_checks).toStrictEqual(checks);
      } else {
        await h.toolset.run(h.client, { input: 'fixture' }, options);
        expect(h.bodies[1]?.['input']).toContainEqual(
          expect.objectContaining({ pending_safety_checks: checks }),
        );
        expect(h.bodies[1]?.['input']).toContainEqual(
          expect.objectContaining({ acknowledged_safety_checks: checks }),
        );
      }
      expect(approveSafetyChecks).toHaveBeenCalledOnce();
      expect(beforeAction).toHaveBeenCalledTimes(2);
      expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
      expect(pending).toStrictEqual(original);
      expect(ComputerToolset.validate(pending).pending_safety_checks).toStrictEqual(checks);
    },
  );

  test.each(['bigint', 'json'] as const)(
    'FR direct acknowledged checks are JSON-admitted before effects: %s',
    async (kind) => {
      const h = harness([]);
      const checks = [
        {
          id: 'review',
          audit: kind === 'bigint' ? 42n : { date: new Date('2026-01-02T03:04:05Z'), fields: [null, 'kept'] },
        },
      ];
      const pending = { ...call([{ type: 'wait' }]), pending_safety_checks: checks };
      const approveSafetyChecks = vi.fn((_value: ResponseComputerToolCall) => true);
      if (kind === 'bigint') {
        await expect(h.toolset.execute(pending, { approveSafetyChecks })).rejects.toThrow();
        expect(approveSafetyChecks).not.toHaveBeenCalled();
        expect(h.performed).toEqual([]);
      } else {
        const output = await h.toolset.execute(pending, { approveSafetyChecks });
        expect(approveSafetyChecks.mock.calls[0]?.[0].pending_safety_checks).toEqual(checks);
        expect(output.acknowledged_safety_checks).toEqual([
          {
            id: 'review',
            audit: {
              date: '2026-01-02T03:04:05.000Z',
              fields: [null, 'kept'],
            },
          },
        ]);
        expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
      }
    },
  );

  test('FR snapshots a changing item discriminator before entire-batch preflight', async () => {
    const h = harness([
      [call([{ type: 'wait' }]), { ...call([{ type: 'wait' }]), id: 'cu_next', call_id: 'call_next' }],
    ]);
    let reads = 0;
    const create = h.client.responses.create.bind(h.client.responses);
    vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) =>
      create(params, options)._thenUnwrap((response) => {
        if ('output' in response && response.output[1]) {
          const [, item] = response.output;
          Reflect.set(item, 'actions', [{ type: 'click' }]);
          Object.defineProperty(item, 'type', {
            enumerable: true,
            configurable: true,
            get() {
              reads += 1;
              return reads === 1 ? 'reasoning' : 'computer_call';
            },
          });
        }
        return response;
      }),
    );
    await expect(h.toolset.run(h.client, { input: 'begin' })).rejects.toThrow();
    expect(h.performed).toEqual([]);
    expect(reads).toBe(1);
  });

  test('FR snapshots call discriminator and tolerates unrelated passive checklist extensions', async () => {
    const h = harness([[call([{ type: 'wait' }]), message], [{ ...message, id: 'msg_final' }]]);
    let reads = 0;
    const create = h.client.responses.create.bind(h.client.responses);
    vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) =>
      create(params, options)._thenUnwrap((response) => {
        if ('output' in response && response.output[0]?.type === 'computer_call' && response.output[1]) {
          Object.defineProperty(response.output[1], 'pending_safety_checks', {
            enumerable: true,
            get() {
              reads += 1;
              return ['passive-extension'];
            },
          });
        }
        return response;
      }),
    );
    await h.toolset.run(h.client, { input: 'begin' });
    expect(reads).toBe(1);
    expect(h.bodies[1]?.['input']).toContainEqual(
      expect.objectContaining({ pending_safety_checks: ['passive-extension'] }),
    );
  });

  test('FR consistently accessor-backed computer types still refuse checklist getters without reading them', async () => {
    const h = harness([[call([{ type: 'wait' }])]]);
    let types = 0;
    let checks = 0;
    const create = h.client.responses.create.bind(h.client.responses);
    vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) =>
      create(params, options)._thenUnwrap((response) => {
        if ('output' in response && response.output[0]) {
          const [item] = response.output;
          Object.defineProperties(item, {
            type: {
              enumerable: true,
              get() {
                types += 1;
                return 'computer_call';
              },
            },
            pending_safety_checks: {
              enumerable: true,
              get() {
                checks += 1;
                return [];
              },
            },
          });
        }
        return response;
      }),
    );
    await expect(h.toolset.run(h.client, { input: 'begin' })).rejects.toThrow('own enumerable data');
    expect(types).toBe(1);
    expect(checks).toBe(0);
    expect(h.performed).toEqual([]);
  });

  test('AM a repeated nonempty output identity stops before later computer effects', async () => {
    const first = call([{ type: 'wait' }]);
    const h = harness([
      [first],
      [{ ...first, call_id: 'new-call', actions: [{ type: 'click', button: 'left', x: 1, y: 1 }] }],
      [message],
    ]);
    await expect(h.toolset.run(h.client, { input: 'begin' })).rejects.toThrow(
      'duplicate output item identity',
    );
    expect(h.bodies).toHaveLength(2);
    expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
  });

  test('AM separately returned empty native IDs retain compatibility', async () => {
    const h = harness([
      [{ ...call([{ type: 'wait' }]), id: '', call_id: 'first' }],
      [{ ...call([{ type: 'wait' }]), id: '', call_id: 'second' }],
      [message],
    ]);
    await expect(h.toolset.run(h.client, { input: 'begin' })).resolves.toMatchObject({ status: 'completed' });
    expect(h.bodies).toHaveLength(3);
  });

  test.each(['call', 'message'] as const)(
    'checks %s replay before any computer action when a custom transport attaches a non-JSON extension',
    async (location) => {
      const h = harness([[call([{ type: 'wait' }]), message], [message]]);
      const create = h.client.responses.create.bind(h.client.responses);
      vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) =>
        create(params, options)._thenUnwrap((response) => {
          if ('output' in response && response.output[0]?.type === 'computer_call') {
            const item = response.output[location === 'call' ? 0 : 1];
            if (item) {
              Reflect.set(item, 'database_revision', 42n);
            }
          }
          return response;
        }),
      );
      await expect(h.toolset.run(h.client, { model: '', input: 'fixture' })).rejects.toThrow();
      expect(h.performed).toEqual([]);
      expect(h.bodies).toHaveLength(1);
    },
  );

  test('preserves supported date and JSON extras through computer replay', async () => {
    const h = harness([[call([{ type: 'wait' }]), message], [{ ...message, id: 'msg_final' }]]);
    const create = h.client.responses.create.bind(h.client.responses);
    vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) =>
      create(params, options)._thenUnwrap((response) => {
        if ('output' in response && response.output[0]?.type === 'computer_call') {
          Reflect.set(response.output[0], 'audit', {
            at: new Date('2026-01-02T03:04:05.000Z'),
            fields: ['kept', null, 7],
          });
        }
        return response;
      }),
    );
    await h.toolset.run(h.client, { input: 'fixture' });
    expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
    expect(h.bodies[1]?.['input']).toContainEqual(
      expect.objectContaining({
        type: 'computer_call',
        audit: { at: '2026-01-02T03:04:05.000Z', fields: ['kept', null, 7] },
      }),
    );
  });

  test('uses configured response status and output getters once, and refuses missing output', async () => {
    const h = harness([[call([{ type: 'wait' }])], [message]]);
    const reads: string[] = [];
    class ConfiguredResponse {
      #status;
      #output;
      constructor(source: { status: NonNullable<SDKResponse['status']>; output: SDKResponse['output'] }) {
        this.#status = source.status;
        this.#output = source.output;
      }
      get status() {
        reads.push('status');
        return this.#status;
      }
      get output() {
        reads.push('output');
        return this.#output;
      }
    }
    const create = h.client.responses.create.bind(h.client.responses);
    vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) =>
      create(params, options)._thenUnwrap((response) => {
        if (!('output' in response) || response.status === undefined) {
          return response;
        }
        const { status, output, ...metadata } = response;
        return Object.assign(new ConfiguredResponse({ status, output }), metadata);
      }),
    );
    await h.toolset.run(h.client, { model: '', input: 'fixture' });
    expect(reads).toEqual(['status', 'output', 'status', 'output']);
    expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
    const absent = harness([[call([{ type: 'wait' }])]]);
    const missing = absent.client.responses.create.bind(absent.client.responses);
    vi.spyOn(absent.client.responses, 'create').mockImplementation((params, options) =>
      missing(params, options)._thenUnwrap((response) => {
        Reflect.deleteProperty(response, 'output');
        return response;
      }),
    );
    await expect(absent.toolset.run(absent.client, { input: 'fixture' })).rejects.toThrow('invalid output');
    expect(absent.performed).toEqual([]);
  });

  test.each(['execute', 'run'] as const)(
    'uses a class-backed safety policy once for %s',
    async (operation) => {
      const item = { ...call([{ type: 'wait' }]), pending_safety_checks: [{ id: 'review' }] };
      const h = harness([[item], [message]]);
      const events: string[] = [];
      class Policy implements ComputerRunOptions {
        #name = 'configured';
        get approveSafetyChecks() {
          events.push('get-safety');
          return this.approve;
        }
        approve(_call: ResponseComputerToolCall) {
          events.push(this.#name);
          return true;
        }
        beforeAction(action: ComputerAction) {
          events.push(`${this.#name}:${action.type}`);
          return true;
        }
      }
      const policy = new Policy();
      await (operation === 'execute'
        ? h.toolset.execute(item, policy)
        : h.toolset.run(h.client, { input: 'fixture' }, policy));
      expect(events).toEqual(['get-safety', 'configured', 'configured:wait', 'configured:screenshot']);
      expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
      const denied = harness([[item]]);
      const work =
        operation === 'execute'
          ? denied.toolset.execute(item)
          : denied.toolset.run(denied.client, { input: 'fixture' });
      await expect(work).rejects.toThrow('explicit approval');
      expect(denied.performed).toEqual([]);
    },
  );

  test('server compaction preserves opaque native content in computer continuation', async () => {
    const compact = {
      type: 'compaction',
      id: 'cmp_1',
      encrypted_content: 'opaque fixture',
      extra: 'preserve',
    };
    const h = harness([[compact, call([{ type: 'wait' }])], [message]]);
    await h.toolset.run(h.client, {
      model: '',
      input: 'fixture',
      context_management: [{ type: 'compaction', compact_threshold: 1000 }],
    });
    expect(h.bodies[1]?.['input']).toContainEqual(compact);
    expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
  });
  test.each([
    { type: 'compaction', encrypted_content: 'opaque' },
    { type: 'compaction', id: 'cmp_1' },
    { type: 'compaction', id: 'cmp_1', encrypted_content: null },
    { type: 'compaction', id: 'cu_test', encrypted_content: '' },
  ])('preflights invalid compaction before computer effects: %o', async (compact) => {
    const h = harness([[call([{ type: 'wait' }]), compact], [message]]);
    await expect(h.toolset.run(h.client, { model: '', input: 'fixture' })).rejects.toBeInstanceOf(
      OpenAIError,
    );
    expect(h.performed).toEqual([]);
    expect(h.bodies).toHaveLength(1);
  });
  test('accepts private-backed screenshot getters once and refuses an empty screenshot', async () => {
    let reads = 0;
    class Screenshot {
      #id = 'file_fixture';
      type = 'computer_screenshot' as const;
      get file_id() {
        reads += 1;
        return this.#id;
      }
    }
    const good = harness([], (driver) => {
      driver.screenshot = () => new Screenshot();
    });
    const captured = await good.toolset.execute(call([{ type: 'screenshot' }]));
    expect(captured.output).toEqual({ type: 'computer_screenshot', file_id: 'file_fixture' });
    expect(reads).toBe(1);
    const empty = harness([], (driver) => {
      // SAFETY: Deliberately missing required result for the public driver boundary.
      driver.screenshot = () => ({}) as ReturnType<ComputerDriver['screenshot']>;
    });
    await expect(empty.toolset.execute(call([{ type: 'screenshot' }]))).rejects.toBeInstanceOf(OpenAIError);
  });
  test.each(['inherited', 'own accessor', 'own nonenumerable'] as const)(
    'preflights native response output slots: %s',
    async (kind) => {
      const h = harness([[call([{ type: 'wait' }])], [message]]);
      const read = vi.fn(() => call([{ type: 'wait' }]));
      const create = h.client.responses.create.bind(h.client.responses);
      vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) =>
        create(params, options)._thenUnwrap((response) => {
          if ('output' in response && response.output[0]?.type === 'computer_call') {
            const output: typeof response.output = [];
            output.length = 1;
            if (kind === 'inherited') {
              const prototype = Object.create(Array.prototype);
              Object.defineProperty(prototype, '0', { get: read });
              Object.setPrototypeOf(output, prototype);
            } else if (kind === 'own accessor') {
              Object.defineProperty(output, '0', { get: read, enumerable: true });
            } else {
              Object.defineProperty(output, '0', { value: call([{ type: 'wait' }]) });
            }
            response.output = output;
          }
          return response;
        }),
      );
      if (kind === 'inherited') {
        await expect(h.toolset.run(h.client, { input: 'fixture' })).rejects.toThrow();
        expect(read).not.toHaveBeenCalled();
        expect(h.performed).toEqual([]);
      } else {
        await h.toolset.run(h.client, { input: 'fixture' });
        expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
        if (kind === 'own accessor') {
          expect(read).toHaveBeenCalledTimes(1);
        }
      }
    },
  );
  test.each([undefined, null, 17])('rejects native id %s before any sibling effect', async (id) => {
    const malformed = call([{ type: 'wait' }]);
    Reflect.set(malformed, 'id', id);
    const h = harness([[call([{ type: 'wait' }]), malformed]]);
    await expect(h.toolset.run(h.client, { model: '', input: 'fixture' })).rejects.toThrow('completed call');
    expect(h.performed).toEqual([]);
  });

  test('an empty native string ID remains allowed', async () => {
    const h = harness([]);
    await expect(h.toolset.execute({ ...call([{ type: 'wait' }]), id: '' })).resolves.toMatchObject({
      call_id: 'call_test',
    });
  });

  test('a mutating driver cannot remove approval for the implicit screenshot', async () => {
    const h = harness([], (driver, performed) => {
      driver.wait = (action) => {
        performed.push({ type: 'wait' });
        Reflect.set(action, 'type', 'screenshot');
      };
    });
    const beforeAction = vi.fn((action: ComputerAction) => action.type !== 'screenshot');
    await expect(h.toolset.execute(call([{ type: 'wait' }]), { beforeAction })).rejects.toThrow();
    expect(beforeAction.mock.calls.map(([action]) => action.type)).toEqual(['wait', 'screenshot']);
    expect(h.performed).toEqual([{ type: 'wait' }]);
  });

  test('the original abort reason takes precedence over a wrapped request rejection', async () => {
    const abort = new AbortController();
    const reason = new Error('original cancellation');
    const h = harness([]);
    const client = new OpenAI({
      apiKey: 'synthetic-test-key',
      maxRetries: 0,
      fetch: () => {
        abort.abort(reason);
        throw new Error('other transport failure');
      },
    });
    await expect(
      h.toolset.run(client, { model: '', input: 'fixture' }, { signal: abort.signal }),
    ).rejects.toBe(reason);
    expect(h.performed).toEqual([]);
  });

  test('rejects an accessor checklist before reading it or running actions', async () => {
    const h = harness([]);
    const pending = call([{ type: 'wait' }]);
    const checks = vi
      .fn()
      .mockReturnValueOnce([{ id: 'safe_original' }])
      .mockReturnValue([]);
    Object.defineProperty(pending, 'pending_safety_checks', { enumerable: true, get: checks });
    await expect(h.toolset.execute(pending)).rejects.toThrow('safety checks');
    expect(checks).not.toHaveBeenCalled();
    expect(h.performed).toEqual([]);
  });

  test('refuses a class-declared checklist unless an own serializable checklist shadows it', async () => {
    const reads = vi.fn((id: string) => [{ id }]);
    class ChecklistCall {
      readonly id = 'cu_class';
      readonly type = 'computer_call';
      readonly call_id = 'class_fixture';
      readonly status = 'completed';
      readonly actions: ComputerAction[] = [{ type: 'wait' }];
      get pending_safety_checks() {
        return reads(this.call_id);
      }
    }
    const h = harness([]);
    await expect(h.toolset.execute(new ChecklistCall())).rejects.toThrow('safety checks');
    expect(reads).not.toHaveBeenCalled();
    expect(h.performed).toEqual([]);
    const shadow = Object.defineProperty(new ChecklistCall(), 'pending_safety_checks', {
      value: [],
      enumerable: true,
    });
    await h.toolset.execute(shadow);
    expect(reads).not.toHaveBeenCalled();
    expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
  });

  test('validates and approves the same captured safety checklist', async () => {
    const h = harness([]);
    const checks = [{ id: 'safe_original' }];
    const [entry] = checks;
    Object.defineProperty(entry, 'id', {
      enumerable: true,
      get() {
        checks.length = 0;
        return 'safe_original';
      },
    });
    const approve = vi.fn(() => false);
    await expect(
      h.toolset.execute(
        { ...call([{ type: 'wait' }]), pending_safety_checks: checks },
        {
          approveSafetyChecks: approve,
        },
      ),
    ).rejects.toThrow('explicit approval');
    expect(approve).toHaveBeenCalledTimes(1);
    expect(h.performed).toEqual([]);
  });

  test.each(['wait', 'screenshot'] as const)(
    'preserves cancellation when the %s driver rejects with a different error',
    async (member) => {
      const controller = new AbortController();
      const reason = new Error('original cancellation');
      const h = harness([], (driver) => {
        driver[member] = vi.fn(() => {
          controller.abort(reason);
          throw new Error('driver interruption');
        });
      });
      await expect(h.toolset.execute(call([{ type: 'wait' }]), { signal: controller.signal })).rejects.toBe(
        reason,
      );
    },
  );

  test.each([
    { keys: undefined, legacy: false },
    { keys: null, legacy: false },
    { keys: ['Shift'], legacy: false },
    { keys: undefined, legacy: true },
    { keys: null, legacy: true },
    { keys: ['Shift'], legacy: true },
  ])('accepts native double-click modifiers $keys with legacy=$legacy', async ({ keys, legacy }) => {
    const h = harness([]);
    const action: ComputerAction = { type: 'double_click', x: 1, y: 2, keys: null };
    if (keys === undefined) {
      Reflect.deleteProperty(action, 'keys');
    } else {
      action.keys = keys;
    }
    const input = call([action]);
    if (legacy) {
      delete input.actions;
      input.action = action;
    }
    const approved: ComputerAction[] = [];
    await h.toolset.execute(input, {
      beforeAction: (next) => {
        approved.push(next);
        return true;
      },
    });
    const expected = [{ type: 'double_click', x: 1, y: 2, keys: keys ?? null }, { type: 'screenshot' }];
    expect(h.performed).toEqual(expected);
    expect(approved).toEqual(expected);
    expect(action.keys).toBe(keys);
  });

  test('replays the same normalized double-click action that the driver received', async () => {
    const action: ComputerAction = { type: 'double_click', x: 1, y: 2, keys: null };
    Reflect.deleteProperty(action, 'keys');
    const input = call([action]);
    const h = harness([[input], [message]]);
    await h.toolset.run(h.client, { input: 'go' });
    expect(h.performed[0]).toEqual({ type: 'double_click', x: 1, y: 2, keys: null });
    expect(h.bodies[1]?.['input']).toEqual(
      expect.arrayContaining([expect.objectContaining({ actions: [h.performed[0]] })]),
    );
    expect(action).not.toHaveProperty('keys');
  });

  test.each([
    { type: 'click', x: 1, y: 2, button: 'left' },
    { type: 'drag', path: [{ x: 1, y: 2 }] },
    { type: 'move', x: 1, y: 2 },
    { type: 'scroll', x: 1, y: 2, scroll_x: 0, scroll_y: 4 },
  ] satisfies ComputerAction[])(
    'FR2 omitted optional $type keys stay absent on wire and fixed for approval and driver',
    async (action) => {
      const h = harness([[call([action])], [message]]);
      const approvals: ComputerAction[] = [];
      await h.toolset.run(
        h.client,
        { input: 'begin' },
        {
          beforeAction(value) {
            approvals.push(value);
            return true;
          },
        },
      );
      const [approved] = approvals;
      const [performed] = h.performed;
      expect(approved).toMatchObject(action);
      expect(performed).toMatchObject(action);
      expect(Object.getOwnPropertyDescriptor(approved, 'keys')).toMatchObject({
        value: undefined,
        enumerable: true,
      });
      expect(Object.getOwnPropertyDescriptor(performed, 'keys')).toMatchObject({
        value: undefined,
        enumerable: true,
      });
      expect(h.bodies[1]?.['input']).toContainEqual(
        expect.objectContaining({ type: 'computer_call', actions: [action] }),
      );
      expect(Object.getOwnPropertyDescriptor(action, 'keys')).toBeUndefined();
    },
  );

  test.each([
    { type: 'click', x: 1, y: 2, button: 'left', keys: null },
    { type: 'drag', path: [], keys: ['SHIFT'] },
    { type: 'move', x: 1, y: 2, keys: null },
    { type: 'scroll', x: 1, y: 2, scroll_x: 0, scroll_y: 4, keys: ['CTRL'] },
  ] satisfies ComputerAction[])(
    'FR2 supplied $type modifiers retain their original value',
    async (action) => {
      const h = harness([[call([action])], [message]]);
      const approvals: ComputerAction[] = [];
      await h.toolset.run(
        h.client,
        { input: 'begin' },
        {
          beforeAction(value) {
            approvals.push(value);
            return true;
          },
        },
      );
      expect(approvals[0]).toEqual(action);
      expect(h.performed[0]).toEqual(action);
      expect(h.bodies[1]?.['input']).toContainEqual(
        expect.objectContaining({ type: 'computer_call', actions: [action] }),
      );
    },
  );

  test('FR2 native replay rejects a finite cyclic extension before any computer effect', async () => {
    const h = harness([[call([{ type: 'wait' }]), message]]);
    const create = h.client.responses.create.bind(h.client.responses);
    vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) =>
      create(params, options)._thenUnwrap((response) => {
        if ('output' in response && response.output[0]) {
          const [item] = response.output;
          Reflect.set(item, 'audit', { owner: item });
        }
        return response;
      }),
    );
    await expect(h.toolset.run(h.client, { input: 'begin' })).rejects.toThrow();
    expect(h.performed).toEqual([]);
    expect(h.bodies).toHaveLength(1);
  });

  test.each([false, true])(
    'keeps approved call context and action diagnostics isolated from driver edits (legacy=%s)',
    async (legacy) => {
      const keypress: ComputerAction = { type: 'keypress', keys: ['SHIFT', 'A'] };
      const pending = call([keypress]);
      if (legacy) {
        delete pending.actions;
        pending.action = keypress;
      }
      const h = harness([[pending], [message]], (driver) => {
        driver.keypress = (action) => {
          action.keys.splice(0, action.keys.length, 'shift', 'a');
          Reflect.set(action, 'adapter', { normalized: true });
          Reflect.set(action, 'type', 'wait');
        };
      });
      const approvals: ComputerCallInput[] = [];
      const members: (string | null)[] = [];
      await h.toolset.run(
        h.client,
        { input: 'fixture' },
        {
          beforeAction: (_action, observed) => {
            approvals.push(observed);
            return true;
          },
          onDiagnostic: (event) => {
            if (event.stage === 'action') {
              members.push(event.member);
            }
          },
        },
      );
      expect(approvals).toHaveLength(2);
      expect(approvals[1]).toEqual(approvals[0]);
      expect(legacy ? approvals[1]?.action : approvals[1]?.actions).toEqual(legacy ? keypress : [keypress]);
      expect(members).toEqual(['keypress', 'screenshot']);
      expect(h.bodies[1]?.['input']).toContainEqual(pending);
    },
  );

  test.each([
    { type: 'click', x: 'bad', y: -1, button: 'left' },
    { type: 'click', x: -0.5, y: 1, button: 'back' },
    { type: 'click', x: 1, y: 2, button: 'other' },
    { type: 'keypress', keys: ['Shift', 2] },
    { type: 'double_click', x: 1, y: 2, keys: [2] },
    { type: 'drag', path: [{ x: 1, y: null }] },
    { type: 'scroll', x: 0, y: 0, scroll_x: 0, scroll_y: 'bad' },
    { type: 'type', text: 2 },
  ])('validates the complete native action batch before any effect: $type', async (bad) => {
    const first = call([{ type: 'wait' }]);
    Reflect.set(first, 'actions', [{ type: 'wait' }, bad]);
    const h = harness([[first]]);
    await expect(h.toolset.run(h.client, { input: 'go' })).rejects.toThrow('invalid computer action');
    expect(h.performed).toEqual([]);
    expect(h.bodies).toHaveLength(1);
  });

  test.each(['keypress', 'click', 'drag'] as const)(
    'rejects sparse %s arrays before an earlier action can run',
    async (kind) => {
      const keys: string[] = [];
      keys.length = 1;
      let action: ComputerAction;
      if (kind === 'keypress') {
        action = { type: 'keypress', keys };
      } else if (kind === 'click') {
        action = { type: 'click', x: 1, y: 2, button: 'left', keys };
      } else {
        const path: { x: number; y: number }[] = [];
        path.length = 1;
        action = { type: 'drag', path };
      }
      const h = harness([]);
      await expect(h.toolset.execute(call([{ type: 'wait' }, action]))).rejects.toThrow(
        'invalid computer action',
      );
      expect(h.performed).toEqual([]);
      expect(h.bodies).toEqual([]);
    },
  );

  test.each(
    [17, true, 'input', [], null].flatMap((value) => [
      { value, wrapped: false },
      { value, wrapped: true },
    ]),
  )(
    'rejects a non-object serialized computer request $value, wrapped=$wrapped, before transport',
    async ({ value, wrapped }) => {
      const params = wrapped ? { input: 'go', toJSON: () => value } : value;
      const h = harness([]);
      // @ts-expect-error Untyped callers can supply a non-object request.
      await expect(h.toolset.run(h.client, params)).rejects.toThrow('request must be an object');
      expect(h.bodies).toEqual([]);
      expect(h.performed).toEqual([]);
    },
  );

  test('refuses inherited actions before an earlier action can run', async () => {
    const actions: ComputerAction[] = [{ type: 'wait' }];
    actions.length = 2;
    const h = harness([]);
    const previous = Object.getOwnPropertyDescriptor(Array.prototype, '1');
    let pending: ReturnType<ComputerToolset['execute']>;
    try {
      // oxlint-disable-next-line no-extend-native -- Restore the ambient array slot before awaiting the public call.
      Object.defineProperty(Array.prototype, '1', {
        value: { type: 'wait' },
        writable: true,
        configurable: true,
      });
      pending = h.toolset.execute(call(actions));
    } finally {
      if (previous) {
        // oxlint-disable-next-line no-extend-native -- Restore the original descriptor after the admission check.
        Object.defineProperty(Array.prototype, '1', previous);
      } else {
        Reflect.deleteProperty(Array.prototype, '1');
      }
    }
    await expect(pending).rejects.toThrow('invalid computer action');
    expect(h.performed).toEqual([]);
  });

  test('keeps native signed coordinates and serializes admitted request hooks once', async () => {
    const h = harness([[call([{ type: 'click', x: -5, y: 125, button: 'back' }])], [message]]);
    let serializations = 0;
    const metadata = {
      toJSON() {
        serializations += 1;
        return { task: 'serialized' };
      },
    };
    const params = { input: 'go' };
    Reflect.set(params, 'metadata', metadata);
    await h.toolset.run(h.client, params);
    expect(serializations).toBe(1);
    expect(h.bodies.map((body) => body['metadata'])).toEqual([
      { task: 'serialized' },
      { task: 'serialized' },
    ]);
    expect(h.performed[0]).toEqual({ type: 'click', x: -5, y: 125, button: 'back' });
  });

  test('rejects a mode exposed by request serialization before transport', async () => {
    const h = harness([]);
    const params = { input: 'go', toJSON: () => ({ input: 'go', background: true }) };
    await expect(h.toolset.run(h.client, params)).rejects.toThrow('foreground');
    expect(h.bodies).toEqual([]);
    expect(h.performed).toEqual([]);
  });
  test.each(['required', { type: 'computer' }] as const)(
    'snapshots the validated run request and limits forced choice %j to the initial response',
    async (choice) => {
      const h = harness([[call([{ type: 'wait' }])], [message]]);
      const tools: NonNullable<ResponseCreateParamsNonStreaming['tools']> = [{ type: 'computer' }];
      const params: ResponseCreateParamsNonStreaming = {
        input: 'begin',
        tool_choice: choice,
        tools,
      };
      await h.toolset.run(h.client, params, {
        beforeAction() {
          params.background = true;
          params.conversation = 'conv_other';
          tools.push({ type: 'web_search' });
          return true;
        },
      });
      expect(h.bodies.map(({ tool_choice }) => tool_choice)).toEqual([choice, 'auto']);
      expect(h.bodies[1]).toMatchObject({ tools: [{ type: 'computer' }] });
      expect(h.bodies[1]).not.toHaveProperty('background', true);
      expect(h.bodies[1]).not.toHaveProperty('conversation');
    },
  );

  test('projects reused screenshots into separate continuation observations', async () => {
    const reused = {
      type: 'computer_screenshot' as const,
      file_id: 'file_before',
      extra: 'not an image field',
    };
    let captures = 0;
    const h = harness(
      [
        [call([{ type: 'wait' }])],
        [{ ...call([{ type: 'wait' }]), id: 'cu_second', call_id: 'call_second' }],
        [message],
      ],
      (driver) => {
        driver.screenshot = () => {
          captures += 1;
          reused.file_id = `file_${captures}`;
          return reused;
        };
      },
    );
    await h.toolset.run(h.client, { input: 'begin' });
    const history = h.bodies[2]?.['input'];
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'computer_call_output',
          output: { type: 'computer_screenshot', file_id: 'file_1' },
        }),
        expect.objectContaining({
          type: 'computer_call_output',
          output: { type: 'computer_screenshot', file_id: 'file_2' },
        }),
      ]),
    );
    expect(JSON.stringify(history)).not.toContain('not an image field');
  });

  test.each(['headers', 'header value', 'idempotencyKey'] as const)(
    'captures an absent continuation key from a changing %s accessor',
    async (kind) => {
      const h = harness([]);
      const keys: (string | null)[] = [];
      let continuation = false;
      let reads = 0;
      const nextKey = () => {
        if (!continuation) {
          return 'initial-key';
        }
        reads += 1;
        return reads === 1 ? undefined : 'initial-key';
      };
      const requestOptions: OpenAI.RequestOptions = {};
      if (kind === 'headers') {
        Object.defineProperty(requestOptions, 'headers', {
          enumerable: true,
          get: () => ({ 'Idempotency-Key': nextKey() }),
        });
      } else if (kind === 'header value') {
        requestOptions.headers = {
          get 'Idempotency-Key'() {
            return nextKey();
          },
        };
      } else {
        Object.defineProperty(requestOptions, 'idempotencyKey', {
          enumerable: true,
          get: nextKey,
        });
      }
      class Client extends OpenAI {
        protected override idempotencyHeader = 'Idempotency-Key';
      }
      const client = new Client({
        apiKey: 'synthetic-test-key',
        fetch: async (url, init) => {
          keys.push(new Request(url, init).headers.get('idempotency-key'));
          continuation = true;
          return Response.json({
            id: `resp_${keys.length}`,
            object: 'response',
            status: 'completed',
            output: keys.length === 1 ? [call([{ type: 'wait' }])] : [message],
          });
        },
      });
      await h.toolset.run(client, { input: 'fixture' }, { requestOptions });
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBe('initial-key');
      expect(keys[1]).not.toBe('initial-key');
      expect(reads).toBe(1);
    },
  );

  test('uses a different caller-supplied idempotency header for every response', async () => {
    const h = harness([
      [call([{ type: 'wait' }])],
      [{ ...call([{ type: 'wait' }]), id: 'cu_second', call_id: 'call_second' }],
      [message],
    ]);
    await h.toolset.run(
      h.client,
      { input: 'begin' },
      {
        requestOptions: { headers: new Headers({ 'IDEMPOTENCY-KEY': 'first', 'x-request-test': 'kept' }) },
      },
    );
    const keys = h.headers.map((header) => header.get('idempotency-key'));
    expect(keys[0]).toBe('first');
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(3);
    expect(h.headers.map((header) => header.get('x-request-test'))).toEqual(['kept', 'kept', 'kept']);
  });

  test.each(['default', 'request', 'remove', 'none'] as const)(
    'continuation idempotency uses effective client headers without losing hooks (%s)',
    async (source) => {
      const h = harness([]);
      const sent: Headers[] = [];
      class FixtureClient extends OpenAI {
        prepares = 0;

        protected override async prepareOptions(options: FinalRequestOptions): Promise<void> {
          this.prepares += 1;
          options.headers = buildHeaders([options.headers, { 'x-prepared': String(this.prepares) }]);
        }
      }
      const client = new FixtureClient({
        apiKey: 'synthetic-test-key',
        maxRetries: 0,
        defaultHeaders: {
          ...(source === 'none' ? {} : { 'Idempotency-Key': 'client-fixed' }),
          'x-default': 'remove-this',
          'x-kept': 'client',
        },
        fetch: async (url, init) => {
          sent.push(new Request(url, init).headers);
          const output =
            sent.length < 3
              ? [{ ...call([{ type: 'wait' }]), id: `cu_${sent.length}`, call_id: `call_${sent.length}` }]
              : [message];
          return Response.json({ id: 'resp_test', object: 'response', status: 'completed', output });
        },
      });
      const headers = {
        'x-default': null,
        ...(source === 'request' ? { 'IDEMPOTENCY-KEY': 'request-first' } : {}),
        ...(source === 'remove' ? { 'idempotency-key': null } : {}),
      };
      await h.toolset.run(client, { input: 'begin' }, { requestOptions: { headers } });
      const keys = sent.map((header) => header.get('idempotency-key'));
      if (source === 'remove' || source === 'none') {
        expect(keys).toEqual([null, null, null]);
      } else {
        expect(keys[0]).toBe(source === 'request' ? 'request-first' : 'client-fixed');
        expect(keys.every(Boolean)).toBe(true);
        expect(new Set(keys).size).toBe(3);
      }
      expect(client.prepares).toBe(3);
      expect(sent.map((header) => header.get('x-prepared'))).toEqual(['1', '2', '3']);
      expect(sent.map((header) => header.get('x-default'))).toEqual([null, null, null]);
      expect(sent.map((header) => header.get('x-kept'))).toEqual(['client', 'client', 'client']);
    },
  );

  test.each(['freeze', 'seal', 'preventExtensions'] as const)(
    'native create wrappers can %s request-option overlays without reading getters early',
    async (method) => {
      const h = harness([[call([{ type: 'wait' }])], [message]]);
      let reads = 0;
      const source: OpenAI.RequestOptions = {
        get headers() {
          reads += 1;
          return { 'x-supplied': 'kept', 'idempotency-key': 'first' };
        },
        timeout: 12_000,
      };
      Object.freeze(source);
      const create = h.client.responses.create.bind(h.client.responses);
      let requests = 0;
      vi.spyOn(h.client.responses, 'create').mockImplementation((params, options) => {
        if (!options) {
          throw new Error('Expected request options');
        }
        const before = reads;
        if (method === 'freeze') {
          Object.freeze(options);
        } else if (method === 'seal') {
          Object.seal(options);
        } else {
          Object.preventExtensions(options);
        }
        expect(reads).toBe(before);
        expect(Object.isExtensible(options)).toBe(false);
        expect(Object.keys(options)).toContain('headers');
        expect(Reflect.set(options, 'newOption', true)).toBe(false);
        if (method === 'freeze') {
          expect(Reflect.set(options, 'timeout', 1)).toBe(false);
          expect(Reflect.deleteProperty(options, 'timeout')).toBe(false);
        }
        requests += 1;
        return create(params, options);
      });
      await h.toolset.run(
        h.client,
        { input: 'begin' },
        {
          requestOptions: source,
          signal: new AbortController().signal,
        },
      );
      expect(requests).toBe(2);
      expect(h.headers.map((value) => value.get('x-supplied'))).toEqual(['kept', 'kept']);
      expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
      expect(source.timeout).toBe(12_000);
    },
  );

  test('continuation includes computer results after a native hook replaces input', async () => {
    const h = harness([]);
    const sent: { input: unknown[] }[] = [];
    class FixtureClient extends OpenAI {
      prepares = 0;

      protected override async prepareOptions(options: FinalRequestOptions): Promise<void> {
        this.prepares += 1;
        if (this.prepares === 1 && isObj(options.body) && Array.isArray(options.body['input'])) {
          options.body['input'] = [...options.body['input'], { role: 'user', content: 'prepared input' }];
        }
      }
    }
    const client = new FixtureClient({
      apiKey: 'synthetic-test-key',
      maxRetries: 0,
      fetch: async (url, init) => {
        const body: unknown = await new Request(url, init).json();
        if (!isObj(body) || !Array.isArray(body['input'])) {
          throw new Error('Expected request input');
        }
        sent.push({ input: body['input'] });
        return Response.json({
          id: 'resp_test',
          object: 'response',
          status: 'completed',
          output: sent.length === 1 ? [call([{ type: 'wait' }])] : [message],
        });
      },
    });
    await h.toolset.run(client, { input: 'begin' });
    expect(sent[1]?.input).toEqual([
      { role: 'user', content: 'begin' },
      { role: 'user', content: 'prepared input' },
      expect.objectContaining({ type: 'computer_call' }),
      expect.objectContaining({ type: 'computer_call_output' }),
    ]);
    expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
  });

  test('FR trusted prepareOptions can assign its own body serializer on each request', async () => {
    const h = harness([]);
    const sent: unknown[] = [];
    class FixtureClient extends OpenAI {
      prepares = 0;

      protected override async prepareOptions(options: FinalRequestOptions): Promise<void> {
        this.prepares += 1;
        const { body } = options;
        if (!isObj(body)) {
          throw new Error('Expected an object request body');
        }
        body['toJSON'] = () => ({ ...body, metadata: { prepared: String(this.prepares) } });
      }
    }
    const client = new FixtureClient({
      apiKey: 'synthetic-test-key',
      maxRetries: 0,
      fetch: async (url, init) => {
        sent.push(await new Request(url, init).json());
        const output = sent.length === 1 ? [call([{ type: 'wait' }])] : [message];
        return Response.json({ id: 'resp_test', object: 'response', status: 'completed', output });
      },
    });
    await h.toolset.run(client, { input: 'begin', tool_choice: 'required' });
    expect(client.prepares).toBe(2);
    expect(sent).toMatchObject([
      { tool_choice: 'required', metadata: { prepared: '1' } },
      { tool_choice: 'auto', metadata: { prepared: '2' } },
    ]);
    expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
  });

  test('later responses use the admitted signal after a caller changes native request options', async () => {
    const admitted = new AbortController();
    const replacement = new AbortController();
    replacement.abort(new Error('unrelated caller signal'));
    const h = harness([[call([{ type: 'wait' }])], [message]]);
    const requestOptions = { signal: admitted.signal, headers: { 'x-fixture': 'first' } };
    const create = vi.spyOn(h.client.responses, 'create');
    await h.toolset.run(
      h.client,
      { input: 'fixture' },
      {
        requestOptions,
        beforeAction: () => {
          requestOptions.signal = replacement.signal;
          requestOptions.headers['x-fixture'] = 'updated';
          return true;
        },
      },
    );
    expect(create.mock.calls[0]?.[1]).toBe(requestOptions);
    expect(create.mock.calls[1]?.[1]?.signal).toBe(admitted.signal);
    expect(h.headers.map((entry) => entry.get('x-fixture'))).toEqual(['first', 'updated']);
    expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
  });

  test.each([false, true].flatMap((rotate) => [false, true].map((frozen) => ({ rotate, frozen }))))(
    'signal overlay keeps native own getters live on every request, rotating headers=$rotate frozen=$frozen',
    async ({ rotate, frozen }) => {
      const h = harness([[call([{ type: 'wait' }])], [message]]);
      class NativeOptions implements OpenAI.RequestOptions {
        declare readonly timeout: number;
        declare readonly maxRetries: number;
        declare readonly fetchOptions: NonNullable<OpenAI.RequestOptions['fetchOptions']>;
        declare readonly headers: NonNullable<OpenAI.RequestOptions['headers']>;
        #revision = 0;

        constructor() {
          Object.defineProperties(this, {
            timeout: {
              enumerable: true,
              get() {
                return 10_000 + this.#revision;
              },
            },
            maxRetries: {
              enumerable: true,
              get() {
                return this.#revision;
              },
            },
            fetchOptions: {
              enumerable: true,
              get() {
                return { cache: this.#revision === 1 ? 'no-store' : 'reload' };
              },
            },
            headers: {
              enumerable: true,
              get() {
                return {
                  'x-revision': String(this.#revision),
                  ...(rotate ? { 'idempotency-key': 'first' } : {}),
                };
              },
            },
          });
        }

        advance(revision: number) {
          this.#revision = revision;
        }
      }
      const requestOptions = new NativeOptions();
      if (frozen) {
        Object.freeze(requestOptions);
      }
      class Client extends OpenAI {
        readonly effective: {
          timeout: number | undefined;
          maxRetries: number | undefined;
          cache: string | undefined;
        }[] = [];
        protected override async prepareOptions(options: FinalRequestOptions): Promise<void> {
          this.effective.push({
            timeout: options.timeout,
            maxRetries: options.maxRetries,
            cache: options.fetchOptions?.cache,
          });
        }
      }
      const headers: Headers[] = [];
      const client = new Client({
        apiKey: 'synthetic-test-key',
        fetch: async (url, init) => {
          headers.push(new Request(url, init).headers);
          return Response.json({
            id: 'resp_test',
            object: 'response',
            status: 'completed',
            output: headers.length === 1 ? [call([{ type: 'wait' }])] : [message],
          });
        },
      });
      const create = client.responses.create.bind(client.responses);
      vi.spyOn(client.responses, 'create').mockImplementation((params, options) => {
        requestOptions.advance(headers.length + 1);
        return create(params, options);
      });
      await h.toolset.run(
        client,
        { input: 'fixture' },
        { requestOptions, signal: new AbortController().signal },
      );
      expect(client.effective).toEqual([
        { timeout: 10_001, maxRetries: 1, cache: 'no-store' },
        { timeout: 10_002, maxRetries: 2, cache: 'reload' },
      ]);
      expect(headers[0]?.get('x-revision')).toBe('1');
      // Continuations capture headers before create, including an absent idempotency key.
      expect(headers[1]?.get('x-revision')).toBe('1');
      const keys = headers.map((value) => value.get('idempotency-key'));
      if (rotate) {
        expect(keys[0]).toBe('first');
        expect(keys[1]).not.toBe('first');
      } else {
        expect(keys).toEqual([null, null]);
      }
    },
  );

  test('native Responses create and signal overlay both omit prototype-only request fields', async () => {
    class Client extends OpenAI {
      readonly seen: unknown[] = [];
      protected override async prepareOptions(options: FinalRequestOptions): Promise<void> {
        this.seen.push({
          timeout: options.timeout,
          maxRetries: options.maxRetries,
          fetchOptions: options.fetchOptions,
        });
      }
    }
    class NativeOptions implements OpenAI.RequestOptions {
      #configured = { timeout: 20_000, maxRetries: 7, fetchOptions: { cache: 'no-store' as const } };
      get timeout() {
        return this.#configured.timeout;
      }
      get maxRetries() {
        return this.#configured.maxRetries;
      }
      get fetchOptions() {
        return this.#configured.fetchOptions;
      }
    }
    const client = new Client({
      apiKey: 'synthetic-test-key',
      fetch: async () =>
        Response.json({ id: 'resp_test', object: 'response', status: 'completed', output: [message] }),
    });
    const options = new NativeOptions();
    await client.responses.create({ input: 'fixture' }, options);
    const h = harness([]);
    await h.toolset.run(
      client,
      { input: 'fixture' },
      { requestOptions: options, signal: new AbortController().signal },
    );
    expect(client.seen).toHaveLength(2);
    expect(client.seen[1]).toEqual(client.seen[0]);
    expect(client.seen[0]).not.toMatchObject({ timeout: 20_000, maxRetries: 7 });
  });

  test('direct and managed computer observations serialize the same projected fields and permit an own caller hook', async () => {
    const supplied = {
      type: 'computer_screenshot' as const,
      image_url: 'data:image/png;base64,c2NyZWVu',
      note: 'local-only',
    };
    const h = harness([[call([{ type: 'wait' }])], [message]]);
    vi.mocked(h.driver.screenshot).mockResolvedValue(supplied);
    const direct = await h.toolset.execute(call([{ type: 'wait' }]));
    await h.toolset.run(h.client, { input: 'fixture' });
    // oxlint-disable-next-line unicorn/prefer-structured-clone -- Verify native JSON encoding of the public output.
    const encoded: unknown = JSON.parse(JSON.stringify(direct));
    expect(h.bodies[1]?.['input']).toEqual(expect.arrayContaining([encoded]));
    expect(JSON.stringify(direct)).not.toContain('local-only');
    expect(Object.keys(direct.output)).toEqual(['type', 'image_url']);
    Object.defineProperty(direct.output, 'toJSON', {
      value: () => ({ type: 'computer_screenshot', file_id: 'file_caller_selected' }),
      configurable: true,
    });
    // oxlint-disable-next-line unicorn/prefer-structured-clone -- JSON must respect an explicit caller-owned toJSON hook.
    expect(JSON.parse(JSON.stringify(direct))).toMatchObject({
      output: { type: 'computer_screenshot', file_id: 'file_caller_selected' },
    });
    expect(supplied).toEqual({
      type: 'computer_screenshot',
      image_url: 'data:image/png;base64,c2NyZWVu',
      note: 'local-only',
    });
  });

  test('rejects a sparse safety checklist before approval or computer effects', async () => {
    const h = harness([]);
    const approveSafetyChecks = vi.fn(() => true);
    const pending = call([{ type: 'wait' }]);
    pending.pending_safety_checks.length = 1;
    await expect(h.toolset.execute(pending, { approveSafetyChecks })).rejects.toThrow();
    expect(approveSafetyChecks).not.toHaveBeenCalled();
    expect(h.performed).toEqual([]);
  });

  test('rotates a key introduced by approval while native retries retain one logical key', async () => {
    const h = harness([]);
    const headers: Headers[] = [];
    const requestHeaders = { 'x-default': null, 'x-fixture': 'initial' };
    const client = new OpenAI({
      apiKey: 'synthetic-test-key',
      maxRetries: 1,
      defaultHeaders: { 'x-default': 'removed' },
      fetch: async (url, init) => {
        const request = new Request(url, init);
        headers.push(request.headers);
        if (headers.length === 2) {
          return new Response('retry fixture', { status: 500, headers: { 'retry-after-ms': '1' } });
        }
        const output =
          headers.length < 4
            ? [{ ...call([{ type: 'wait' }]), id: `cu_${headers.length}`, call_id: `call_${headers.length}` }]
            : [message];
        return Response.json({ id: 'resp_test', object: 'response', status: 'completed', output });
      },
    });
    await h.toolset.run(
      client,
      { model: '', input: 'fixture' },
      {
        requestOptions: { headers: requestHeaders },
        beforeAction: () => {
          Reflect.set(requestHeaders, 'Idempotency-Key', 'introduced-during-approval');
          requestHeaders['x-fixture'] = 'updated';
          return true;
        },
      },
    );
    const keys = headers.map((header) => header.get('idempotency-key'));
    expect(keys[0]).toBeNull();
    expect(keys[1]).toBe(keys[2]);
    expect(new Set([keys[0], keys[1], keys[3]]).size).toBe(3);
    expect(keys.slice(1)).not.toContain('introduced-during-approval');
    expect(headers.map((header) => header.get('x-fixture'))).toEqual([
      'initial',
      'updated',
      'updated',
      'updated',
    ]);
    expect(headers.every((header) => header.get('x-default') === null)).toBe(true);
    expect(h.performed).toEqual([
      { type: 'wait' },
      { type: 'screenshot' },
      { type: 'wait' },
      { type: 'screenshot' },
    ]);
  });

  test.each(['safety', 'action'] as const)(
    'approval %s can cooperatively observe run requestOptions abort',
    async (stage) => {
      const controller = new AbortController();
      const reason = new Error('stop interactive approval');
      const requested = { ...call([{ type: 'wait' }]), pending_safety_checks: [{ id: 'review' }] };
      const h = harness([[requested]]);
      const signals: (AbortSignal | undefined)[] = [];
      const diagnostics: { stage: string; reason: string; member: string | null }[] = [];
      let markEntered!: () => void;
      // oxlint-disable-next-line promise/avoid-new -- Tests control when approval has begun.
      const entered = new Promise<void>((resolve) => {
        markEntered = resolve;
      });
      const approve = (_value: unknown, context?: { signal: AbortSignal | undefined }): Promise<boolean> => {
        signals.push(context?.signal);
        markEntered();
        // oxlint-disable-next-line promise/avoid-new -- The simulated approval settles when its signal aborts.
        return new Promise((resolve) => {
          if (!context?.signal) {
            resolve(false);
            return;
          }
          context.signal.addEventListener('abort', () => resolve(true), { once: true });
        });
      };
      const result = h.toolset.run(
        h.client,
        { input: 'fixture' },
        {
          requestOptions: { signal: controller.signal },
          approveSafetyChecks: (item, context) => (stage === 'safety' ? approve(item, context) : true),
          beforeAction: (action, _item, context) => (stage === 'action' ? approve(action, context) : true),
          onDiagnostic: (event) => diagnostics.push(event),
        },
      );
      const settled = expect(result).rejects.toBe(reason);
      await entered;
      controller.abort(reason);
      await settled;
      expect(
        diagnostics.find((event) => event.stage === 'approval' && event.reason === 'cancelled'),
      ).toMatchObject({
        reason: 'cancelled',
        member: stage === 'safety' ? null : 'wait',
      });
      expect(signals).toEqual([controller.signal]);
      expect(h.performed).toEqual([]);
      expect(h.bodies).toHaveLength(1);
    },
  );

  test('abort does not release a still-running noncooperative approval', async () => {
    const h = harness([]);
    const requested = { ...call([{ type: 'wait' }]), pending_safety_checks: [{ id: 'review' }] };
    const controller = new AbortController();
    const reason = new Error('approval stopped');
    let finish!: (approved: boolean) => void;
    const result = h.toolset.execute(requested, {
      signal: controller.signal,
      approveSafetyChecks: () =>
        // oxlint-disable-next-line promise/avoid-new -- A held callback must retain the toolset until explicit release.
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    });
    const settled = expect(result).rejects.toBe(reason);
    controller.abort(reason);
    await expect(h.toolset.execute(requested)).rejects.toThrow('busy');
    expect(h.toolset.close()).toEqual({ status: 'draining' });
    expect(h.performed).toEqual([]);
    finish(true);
    await settled;
    expect(h.toolset.close()).toEqual({ status: 'closed' });
  });

  test('modern input may omit checks; native callback projection does not change replay', async () => {
    const modern: ComputerCallInput = {
      id: 'cu_modern',
      type: 'computer_call',
      call_id: 'modern',
      status: 'completed',
      actions: [{ type: 'wait' }],
    };
    const beforeAction = vi.fn((_action: ComputerAction, item: ResponseComputerToolCall) => {
      expect(item.pending_safety_checks).toEqual([]);
      item.pending_safety_checks.push({ id: 'callback-only' });
      return true;
    });
    const direct = harness([]);
    await direct.toolset.execute(modern, { beforeAction });
    expect(Object.getOwnPropertyDescriptor(modern, 'pending_safety_checks')).toBeUndefined();
    const loop = harness([[modern], [message]]);
    await loop.toolset.run(loop.client, { input: 'fixture' }, { beforeAction });
    expect(loop.bodies[1]?.['input']).toContainEqual(modern);
    expect(JSON.stringify(loop.bodies)).not.toContain('callback-only');
    expect(beforeAction).toHaveBeenCalledTimes(4);
  });

  test('modern own undefined checklist follows JSON omission, but legacy still requires checks', async () => {
    const h = harness([]);
    const modern: ComputerCallInput = {
      id: 'cu_modern',
      type: 'computer_call',
      call_id: 'modern',
      status: 'completed',
      actions: [{ type: 'wait' }],
      pending_safety_checks: undefined,
    };
    const callback = vi.fn((_action: ComputerAction, _call: ResponseComputerToolCall) => true);
    await h.toolset.execute(modern, { beforeAction: callback });
    expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.calls[0]?.[1]).toMatchObject({ pending_safety_checks: [] });
    const legacy = { ...modern, actions: undefined, action: { type: 'wait' } };
    // @ts-expect-error Invalid legacy checklist under the native contract.
    await expect(h.toolset.execute(legacy)).rejects.toThrow();
  });

  test('computer run captures an accessor-backed request signal once for transport and driver', async () => {
    const first = new AbortController();
    const second = new AbortController();
    const h = harness([[call([{ type: 'wait' }])], [message]]);
    const getter = vi.fn().mockReturnValueOnce(first.signal).mockReturnValue(second.signal);
    class NativeOptions {
      declare readonly headers: Record<string, string>;
      declare readonly signal: AbortSignal;
      #headers = { 'x-fixture': 'kept' };
      constructor() {
        Object.defineProperties(this, {
          signal: { enumerable: true, get: getter },
          headers: {
            enumerable: true,
            get(this: NativeOptions) {
              return this.#headers;
            },
          },
        });
      }
    }
    const requestOptions = new NativeOptions();
    const create = h.client.responses.create.bind(h.client.responses);
    const seen: (AbortSignal | null | undefined)[] = [];
    vi.spyOn(h.client.responses, 'create').mockImplementation((body, options) => {
      seen.push(options?.signal);
      return create(body, options);
    });
    await h.toolset.run(h.client, { input: 'fixture' }, { requestOptions });
    expect(seen).toEqual([first.signal, first.signal]);
    expect(getter).toHaveBeenCalledTimes(1);
    expect(h.headers.every((header) => header.get('x-fixture') === 'kept')).toBe(true);
  });

  test.each(['absent', 'undefined', 'own', 'class'] as const)(
    'computer admits configured outer run options once: %s',
    async (kind) => {
      const h = harness([[call([{ type: 'wait' }])], [message]]);
      const supplied = { headers: { 'x-fixture': 'kept' } };
      const reads: string[] = [];
      class RunOptions implements ComputerRunOptions {
        #request = supplied;
        #steps = 2;
        get maxSteps() {
          reads.push('maxSteps');
          return this.#steps;
        }
        get requestOptions() {
          reads.push('requestOptions');
          return this.#request;
        }
      }
      const options: ComputerRunOptions = {
        absent: {},
        undefined: {},
        own: { maxSteps: 2, requestOptions: supplied },
        class: new RunOptions(),
      }[kind];
      if (kind === 'undefined') {
        Object.defineProperties(options, {
          maxSteps: { value: undefined, enumerable: true },
          requestOptions: { value: undefined, enumerable: true },
        });
      }
      const create = h.client.responses.create.bind(h.client.responses);
      const calls = vi
        .spyOn(h.client.responses, 'create')
        .mockImplementation((params, requestOptions) => create(params, requestOptions));
      await h.toolset.run(h.client, { input: 'fixture' }, options);
      expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
      expect(h.bodies).toHaveLength(2);
      expect(reads).toEqual(kind === 'class' ? ['maxSteps', 'requestOptions'] : []);
      expect(h.headers.map((header) => header.get('x-fixture'))).toEqual(
        kind === 'class' || kind === 'own' ? ['kept', 'kept'] : [null, null],
      );
      if (kind === 'class' || kind === 'own') {
        expect(calls.mock.calls[0]?.[1]).toBe(supplied);
      }
    },
  );

  test.each(['inherited accessor', 'inherited data', 'nonenumerable data'] as const)(
    '%s request signal reaches the real native transport',
    async (kind) => {
      const stopped = new AbortController();
      const reason = new Error('synthetic cancellation');
      const h = harness([]);
      let observed = false;
      class NativeOptions {
        #signal = stopped.signal;
        get signal() {
          return this.#signal;
        }
      }
      const client = new OpenAI({
        apiKey: 'synthetic-test-key',
        maxRetries: 0,
        fetch: (_url, init) => {
          stopped.abort(reason);
          observed = init?.signal?.aborted === true;
          return Promise.resolve(Response.json({ id: 'resp_test', status: 'completed', output: [message] }));
        },
      });
      let requestOptions: OpenAI.RequestOptions = new NativeOptions();
      if (kind !== 'inherited accessor') {
        requestOptions = {};
        if (kind === 'inherited data') {
          Object.setPrototypeOf(requestOptions, { signal: stopped.signal });
        } else {
          Object.defineProperty(requestOptions, 'signal', { value: stopped.signal });
        }
      }
      await expect(h.toolset.run(client, { input: 'fixture' }, { requestOptions })).rejects.toBe(reason);
      expect(observed).toBe(true);
      expect(h.performed).toEqual([]);
    },
  );

  test.each(['enumerable', 'nonenumerable', 'inherited'] as const)(
    'continuation key rotation preserves native %s header visibility',
    async (kind) => {
      const h = harness([[call([{ type: 'wait' }])], [message]]);
      const headers = { 'x-fixture': 'kept', cookie: 'synthetic-cookie' };
      const requestOptions: OpenAI.RequestOptions = { idempotencyKey: 'first' };
      if (kind === 'inherited') {
        Object.setPrototypeOf(requestOptions, { headers });
      } else {
        Object.defineProperty(requestOptions, 'headers', {
          value: headers,
          enumerable: kind === 'enumerable',
        });
      }
      await h.toolset.run(h.client, { input: 'fixture' }, { requestOptions });
      expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
      expect(h.headers.map((header) => header.get('x-fixture'))).toEqual(
        kind === 'enumerable' ? ['kept', 'kept'] : [null, null],
      );
      expect(h.headers.map((header) => header.get('cookie'))).toEqual(
        kind === 'enumerable' ? ['synthetic-cookie', 'synthetic-cookie'] : [null, null],
      );
    },
  );

  test('large native replay history avoids the engine argument limit', async () => {
    const items = Array.from({ length: 130_000 }, (_, index) => ({
      type: 'reasoning',
      id: `rs_${index}`,
      summary: [],
    }));
    const h = harness([[...items, call([{ type: 'wait' }])], [message]]);
    await h.toolset.run(h.client, { input: 'fixture' });
    expect(h.bodies).toHaveLength(2);
    expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
    expect(h.bodies[1]?.['input']).toHaveLength(130_003);
  });

  test.each(['safety', 'action'] as const)(
    'abort during %s refusal keeps the abort reason and diagnostic',
    async (member) => {
      const h = harness([]);
      const controller = new AbortController();
      const reason = new Error('approval cancelled');
      const diagnostics: string[] = [];
      const refuse = () => {
        controller.abort(reason);
        return false;
      };
      await expect(
        h.toolset.execute(
          { ...call([{ type: 'wait' }]), pending_safety_checks: [{ id: 'safety' }] },
          {
            signal: controller.signal,
            approveSafetyChecks: member === 'safety' ? refuse : () => true,
            ...(member === 'action' ? { beforeAction: refuse } : {}),
            onDiagnostic: (event) => {
              diagnostics.push(event.reason);
            },
          },
        ),
      ).rejects.toBe(reason);
      expect(diagnostics).toContain('cancelled');
      expect(h.performed).toEqual([]);
    },
  );

  test.each(['inherited', 'nonenumerable'] as const)(
    'run preserves the original %s policy and receiver',
    async (kind) => {
      const h = harness([[{ ...call([{ type: 'wait' }]), pending_safety_checks: [{ id: 'check' }] }]]);
      const approvals: string[] = [];
      const options: ComputerRunOptions & { label: string } = { label: 'original' };
      const policy = {
        approveSafetyChecks(this: typeof options) {
          approvals.push(`${this.label}: safety`);
          return true;
        },
        beforeAction(this: typeof options, action: ComputerAction) {
          approvals.push(`${this.label}: ${action.type}`);
          return false;
        },
      };
      if (kind === 'inherited') {
        Object.setPrototypeOf(options, policy);
      } else {
        Object.defineProperties(options, {
          approveSafetyChecks: { value: policy.approveSafetyChecks },
          beforeAction: { value: policy.beforeAction },
        });
      }
      await expect(h.toolset.run(h.client, { input: 'begin' }, options)).rejects.toThrow('declined');
      expect(approvals).toEqual(['original: safety', 'original: wait']);
      expect(h.performed).toEqual([]);
      expect(h.bodies).toHaveLength(1);
    },
  );

  test('checks cancellation between screenshot approval and capture', async () => {
    const h = harness([]);
    const controller = new AbortController();
    await expect(
      h.toolset.execute(call([{ type: 'screenshot' }]), {
        signal: controller.signal,
        beforeAction: () => {
          queueMicrotask(() => {
            queueMicrotask(() => controller.abort(new Error('cancel before capture')));
          });
          return true;
        },
      }),
    ).rejects.toThrow('cancel before capture');
    expect(h.performed).toEqual([]);
  });

  test('audit direct inherited approval keeps its receiver and call policy after safety approval', async () => {
    const h = harness([]);
    const approvals: string[] = [];
    const options: ComputerExecutionOptions & { label: string } = { label: 'prototype receiver' };
    const inherited = {
      beforeAction(this: typeof options, action: ComputerAction) {
        approvals.push(`${this.label}: ${action.type}`);
        return action.type !== 'screenshot';
      },
      approveSafetyChecks(this: typeof options, requested: ResponseComputerToolCall) {
        approvals.push(`${this.label}: ${requested.pending_safety_checks[0]?.id}`);
        Reflect.deleteProperty(inherited, 'beforeAction');
        return true;
      },
    };
    Object.setPrototypeOf(options, inherited);
    await expect(
      h.toolset.execute(
        {
          ...call([{ type: 'wait' }]),
          pending_safety_checks: [{ id: 'safe_original' }],
        },
        options,
      ),
    ).rejects.toThrow('declined');
    expect(approvals).toEqual([
      'prototype receiver: safe_original',
      'prototype receiver: wait',
      'prototype receiver: screenshot',
    ]);
    expect(h.performed).toEqual([{ type: 'wait' }]);
  });

  test('audit direct execution captures original policy and receiver through mutation', async () => {
    const approvals: string[] = [];
    const options: ComputerExecutionOptions & { label: string } = {
      label: 'original receiver',
      beforeAction(action) {
        approvals.push(`${this.label}: ${action.type}`);
        return action.type !== 'type';
      },
    };
    const h = harness([], (driver, performed) => {
      driver.click = (action) => {
        performed.push(action);
        delete options.beforeAction;
      };
    });
    await expect(
      h.toolset.execute(
        call([
          { type: 'click', x: 1, y: 2, button: 'left' },
          { type: 'type', text: 'must be declined' },
        ]),
        options,
      ),
    ).rejects.toThrow('declined');
    expect(approvals).toEqual(['original receiver: click', 'original receiver: type']);
    expect(h.performed).toEqual([{ type: 'click', x: 1, y: 2, button: 'left' }]);
  });

  test('runs batched and legacy actions once in wire order and replays store:false cleanly', async () => {
    const actions: ComputerAction[] = [
      { type: 'click', x: 1, y: 2, button: 'right', keys: ['Shift'] },
      { type: 'double_click', x: 3, y: 4, keys: null },
      {
        type: 'drag',
        path: [
          { x: 3, y: 4 },
          { x: 7, y: 8 },
        ],
        keys: ['Alt'],
      },
      { type: 'keypress', keys: ['Control', 'L'] },
      { type: 'move', x: 9, y: 10 },
      { type: 'scroll', x: 9, y: 10, scroll_x: -4, scroll_y: 35 },
      { type: 'type', text: 'synthetic data' },
      { type: 'wait' },
      { type: 'screenshot' },
    ];
    const firstCall = call(actions);
    const { actions: _, ...commonCall } = firstCall;
    const legacy = {
      ...commonCall,
      id: 'cu_old',
      call_id: 'call_old',
      action: { type: 'click', x: 4, y: 5, button: 'left' },
    };
    const reasoning = {
      type: 'reasoning',
      id: 'rs_test',
      summary: [],
      encrypted_content: 'synthetic-encrypted',
      created_by: 'synthetic-provenance',
    };
    const h = harness([[reasoning, firstCall], [message, legacy], [{ ...message, id: 'msg_final' }]]);
    const response = await h.toolset.run(
      h.client,
      { model: 'synthetic-model', input: 'begin', store: false, instructions: 'keep this' },
      { requestOptions: { headers: { 'x-request-test': 'kept' } } },
    );
    expect(response.output_text).toBe('done');
    expect(h.performed).toEqual([...actions, legacy.action, { type: 'screenshot' }]);
    expect(h.bodies).toHaveLength(3);
    expect(h.headers.every((hdr) => hdr.get('x-request-test') === 'kept')).toBe(true);
    expect(h.bodies[0]).toMatchObject({
      instructions: 'keep this',
      store: false,
      tools: [{ type: 'computer' }],
      include: ['reasoning.encrypted_content'],
      input: [{ role: 'user', content: 'begin' }],
    });
    expect(h.bodies[2]?.['input']).toEqual([
      { role: 'user', content: 'begin' },
      { type: 'reasoning', id: 'rs_test', summary: [], encrypted_content: 'synthetic-encrypted' },
      firstCall,
      { type: 'computer_call_output', call_id: 'call_test', output: image },
      { type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: message.content },
      legacy,
      { type: 'computer_call_output', call_id: 'call_old', output: image },
    ]);
    expect(h.bodies.every((body) => !('previous_response_id' in body))).toBe(true);
  });

  test('accepts a modern screenshot call with an omitted safety checklist from Responses', async () => {
    const { pending_safety_checks: _checks, ...modern } = call([{ type: 'screenshot' }]);
    const h = harness([[modern], [message]]);
    const result = await h.toolset.run(h.client, { input: 'fixture', model: '' });
    expect(result.output_text).toBe('done');
    expect(h.performed).toEqual([{ type: 'screenshot' }]);
    expect(h.bodies[1]?.['input']).toContainEqual({
      type: 'computer_call_output',
      call_id: modern.call_id,
      output: image,
    });
  });

  test.each(['inherited', 'nonenumerable'] as const)(
    'rejects %s safety checks before the execute snapshot can omit them',
    async (kind) => {
      const { pending_safety_checks: _checks, ...wire } = call([{ type: 'wait' }]);
      const pending = [{ id: 'requires_approval' }];
      const item =
        kind === 'inherited'
          ? Object.assign(Object.create({ pending_safety_checks: pending }), wire)
          : Object.defineProperty(wire, 'pending_safety_checks', { value: pending, enumerable: false });
      const h = harness([]);
      await expect(h.toolset.execute(item)).rejects.toThrow('safety');
      expect(h.performed).toEqual([]);
    },
  );

  test('requires legacy checklists and rejects every malformed present checklist before effects', async () => {
    const original = call([{ type: 'wait' }]);
    const { pending_safety_checks: _checks, actions: _actions, ...base } = original;
    for (const invalid of [
      { ...base, action: { type: 'wait' } },
      { ...original, pending_safety_checks: null },
      { ...original, pending_safety_checks: 'not-an-array' },
      { ...original, pending_safety_checks: {} },
      { ...original, pending_safety_checks: [null] },
      { ...original, pending_safety_checks: [{ code: 'missing-id' }] },
      { ...original, pending_safety_checks: [{ id: 'check_one', message: {} }] },
      { ...base, action: { type: 'wait' }, pending_safety_checks: null },
    ]) {
      const h = harness([[invalid]]);
      // Check independent wire cases against a real SDK fetch boundary.
      // oxlint-disable-next-line no-await-in-loop
      await expect(h.toolset.run(h.client, { input: 'fixture', model: '' })).rejects.toThrow();
      expect(h.performed).toEqual([]);
    }
  });

  test('requires explicit approval, then sends only approved checks for the call', async () => {
    const pending = {
      ...call([{ type: 'click', x: 1, y: 2, button: 'left' }]),
      pending_safety_checks: [{ id: 'safety_test', code: 'synthetic', message: 'Review this call' }],
    };
    const blocked = harness([[pending]]);
    await expect(blocked.toolset.run(blocked.client, { input: 'begin' })).rejects.toThrow('approval');
    expect(blocked.performed).toEqual([]);
    expect(blocked.bodies).toHaveLength(1);
    const h = harness([[pending], [message]]);
    const events: string[] = [];
    await h.toolset.run(
      h.client,
      { input: 'begin' },
      {
        approveSafetyChecks: (requested) => {
          events.push('approve');
          return requested.call_id === pending.call_id;
        },
        beforeAction: (action) => {
          events.push(action.type);
          return true;
        },
      },
    );
    expect(events).toEqual(['approve', 'click', 'screenshot']);
    expect(h.bodies[1]?.['input']).toContainEqual({
      type: 'computer_call_output',
      call_id: 'call_test',
      output: image,
      acknowledged_safety_checks: pending.pending_safety_checks,
    });
  });

  test('execute rejects a non-computer item before any driver effects', async () => {
    const h = harness([]);
    // SAFETY: This deliberately malformed test fixture models an untrusted wire discriminator; production must reject it.
    const invalid = { ...call([{ type: 'wait' }]), type: 'unknown_call' as 'computer_call' };
    await expect(h.toolset.execute(invalid)).rejects.toThrow('completed call');
    expect(h.performed).toEqual([]);
  });

  test('execute honors policy for final screenshot and stops after a driver failure without capture', async () => {
    const h = harness([], (driver) => {
      driver.click = () => {
        throw new Error('synthetic driver failure');
      };
    });
    await expect(
      h.toolset.execute(call([{ type: 'wait' }]), {
        beforeAction: (action) => action.type !== 'screenshot',
      }),
    ).rejects.toThrow('declined');
    expect(h.performed).toEqual([{ type: 'wait' }]);
    await expect(
      h.toolset.execute(
        call([
          { type: 'click', x: 1, y: 2, button: 'left' },
          { type: 'type', text: 'must not run' },
        ]),
      ),
    ).rejects.toThrow('synthetic driver failure');
    expect(h.performed).toEqual([{ type: 'wait' }]);
  });

  test('preflights malformed calls, unknown actions and mixed outputs before all effects', async () => {
    const good = call([{ type: 'click', x: 1, y: 2, button: 'left' }]);
    for (const bad of [
      {},
      { ...good, id: undefined },
      { ...good, actions: [{ type: 'click', button: 'left' }] },
      { ...good, actions: [{ type: 'drag', path: [{ a: 1, b: 2 }] }] },
      { ...good, actions: [{ type: 'type' }] },
      { ...good, id: 'invalid', actions: [{ type: 'constructor' }] },
      { ...good, status: 'incomplete' },
      { ...good, actions: [] },
      { ...good, action: { type: 'wait' } },
      { ...good, pending_safety_checks: null },
      { type: 'function_call', name: 'transfer', arguments: '{}', call_id: 'fn_test' },
      { type: 'mcp_approval_request', id: 'mcp_test' },
      { type: 'unrecognized_future_tool' },
    ]) {
      const h = harness([[good, bad]]);
      // Independent test fixtures run sequentially for deterministic error reporting.
      // oxlint-disable-next-line no-await-in-loop
      await expect(h.toolset.run(h.client, { input: 'begin' })).rejects.toThrow();
      expect(h.performed).toEqual([]);
      expect(h.bodies).toHaveLength(1);
    }
  });

  test('binds configured class driver methods to their original receiver', async () => {
    class Driver implements ComputerDriver {
      #waits = 0;
      click = vi.fn();
      double_click = vi.fn();
      drag = vi.fn();
      keypress = vi.fn();
      move = vi.fn();
      scroll = vi.fn();
      type = vi.fn();
      wait() {
        this.#waits += 1;
      }
      screenshot() {
        expect(this.#waits).toBe(1);
        return image;
      }
    }
    const toolset = new ComputerToolset(new Driver());
    expect(await toolset.execute(call([{ type: 'wait' }]))).toMatchObject({ output: image });
  });

  test('limits total API requests and reserves the last one before any disallowed effects', async () => {
    const batch = call([{ type: 'wait' }]);
    const one = harness([[batch]]);
    await expect(one.toolset.run(one.client, { input: 'begin' }, { maxSteps: 1 })).rejects.toThrow(
      'maxSteps',
    );
    expect(one.performed).toEqual([]);
    const h = harness([[batch], [{ ...batch, id: 'cu_next', call_id: 'call_next' }]]);
    await expect(h.toolset.run(h.client, { input: 'begin' }, { maxSteps: 2 })).rejects.toThrow('maxSteps');
    expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
    for (const maxSteps of [0, -1, 0.5, Infinity]) {
      const invalid = harness([]);
      // Independent test fixtures run sequentially for deterministic error reporting.
      // oxlint-disable-next-line no-await-in-loop
      await expect(invalid.toolset.run(invalid.client, {}, { maxSteps })).rejects.toThrow(TypeError);
      expect(invalid.bodies).toEqual([]);
    }
  });

  test('rejects an explicit null maxSteps before making a request', async () => {
    const h = harness([[call([{ type: 'wait' }])], [message]]);
    await expect(
      // @ts-expect-error An explicit null is not a supported ComputerRunOptions budget.
      h.toolset.run(h.client, { input: 'begin' }, { maxSteps: null }),
    ).rejects.toThrow('positive safe integer');
    expect(h.bodies).toEqual([]);
    expect(h.performed).toEqual([]);
  });

  test('rejects explicit null tools before calling the API or driver', async () => {
    const h = harness([[call([{ type: 'wait' }])], [message]]);
    await expect(
      // @ts-expect-error Exercise invalid JavaScript input at the public boundary.
      h.toolset.run(h.client, { input: 'begin', tools: null }),
    ).rejects.toThrow(TypeError);
    expect(h.bodies).toEqual([]);
    expect(h.performed).toEqual([]);
  });

  test('rejects explicit null input before calling the API or driver', async () => {
    const h = harness([[call([{ type: 'wait' }])], [message]]);
    await expect(
      // @ts-expect-error Native input is optional but not nullable.
      h.toolset.run(h.client, { instructions: 'fixture', input: null }),
    ).rejects.toThrow(TypeError);
    expect(h.bodies).toEqual([]);
    expect(h.performed).toEqual([]);
  });

  test('rejects unsupported state and tools before calling the API', async () => {
    for (const params of [
      { conversation: 'conv_test' },
      { previous_response_id: 'resp_previous' },
      { background: true },
      { tools: [] },
      { tools: [{ type: 'computer' as const }, { type: 'computer' as const }] },
      { tools: [{ type: 'function' as const, name: 'other', parameters: {}, strict: false }] },
    ]) {
      const h = harness([]);
      // Independent test fixtures run sequentially for deterministic error reporting.
      // oxlint-disable-next-line no-await-in-loop
      await expect(h.toolset.run(h.client, params)).rejects.toThrow(TypeError);
      expect(h.bodies).toEqual([]);
    }
  });

  test('abort via requestOptions stops before next action even when policy approves', async () => {
    const controller = new AbortController();
    const diagnostics: { member: string | null; reason: string }[] = [];
    const h = harness(
      [[call([{ type: 'wait' }, { type: 'type', text: 'must not run' }])]],
      (driver, performed) => {
        driver.wait = (action) => {
          performed.push(action);
          controller.abort(new Error('cancel driver'));
        };
      },
    );
    await expect(
      h.toolset.run(
        h.client,
        { input: 'begin' },
        {
          requestOptions: { signal: controller.signal },
          beforeAction: () => true,
          onDiagnostic: (event) => diagnostics.push(event),
        },
      ),
    ).rejects.toThrow('cancel driver');
    expect(h.performed).toEqual([{ type: 'wait' }]);
    expect(h.bodies).toHaveLength(1);
    expect(diagnostics.filter((event) => event.member === 'wait').map((event) => event.reason)).toEqual([
      'completed',
      'cancelled',
    ]);
  });

  test.each([
    { ...message, id: null },
    { type: 'message', role: 'assistant', status: 'completed', content: [] },
    { ...message, role: 'user' },
    { ...message, content: null },
    { ...message, content: [{ type: 'output_text', text: null }] },
    { ...message, content: [{ type: 'output_text' }] },
    { ...message, content: [{ type: 'refusal' }] },
    { ...message, content: [{ type: 'other', text: 'fixture' }] },
    { ...message, phase: 'unsupported' },
    { ...message, content: [{ type: 'output_text', text: 'fixture' }] },
    { ...message, content: [{ type: 'output_text', text: 'fixture', annotations: null }] },
    { ...message, content: [{ type: 'output_text', text: 'fixture', annotations: [null] }] },
    {
      ...message,
      content: [
        {
          type: 'output_text',
          text: 'fixture',
          annotations: [{ type: 'file_citation', file_id: 'f', index: 0 }],
        },
      ],
    },
    {
      ...message,
      content: [
        {
          type: 'output_text',
          text: 'fixture',
          annotations: [
            { type: 'url_citation', url: 'fixture', title: 'fixture', start_index: 0, end_index: '1' },
          ],
        },
      ],
    },
    {
      ...message,
      content: [
        {
          type: 'output_text',
          text: 'fixture',
          annotations: [
            { type: 'container_file_citation', file_id: 'f', filename: 'f', start_index: 0, end_index: 1 },
          ],
        },
      ],
    },
    {
      ...message,
      content: [
        {
          type: 'output_text',
          text: 'fixture',
          annotations: [{ type: 'file_path', file_id: 'f', index: null }],
        },
      ],
    },
    { ...message, content: [{ type: 'output_text', text: 'fixture', annotations: [{ type: 'unknown' }] }] },
    { ...message, content: [{ type: 'output_text', text: 'fixture', annotations: [], logprobs: 'invalid' }] },
    { ...message, content: [{ type: 'output_text', text: 'fixture', annotations: [], logprobs: [null] }] },
    {
      ...message,
      content: [
        {
          type: 'output_text',
          text: 'fixture',
          annotations: [],
          logprobs: [{ token: 'x', bytes: [null], logprob: -1, top_logprobs: [] }],
        },
      ],
    },
    {
      ...message,
      content: [
        {
          type: 'output_text',
          text: 'fixture',
          annotations: [],
          logprobs: [{ token: 'x', bytes: [120], logprob: -1, top_logprobs: [null] }],
        },
      ],
    },
    {
      ...message,
      content: [
        {
          type: 'output_text',
          text: 'fixture',
          annotations: [],
          logprobs: [
            {
              token: 'x',
              bytes: [120],
              logprob: -1,
              top_logprobs: [{ token: 'x', bytes: [120], logprob: 'invalid' }],
            },
          ],
        },
      ],
    },
    { ...message, status: 'unknown' },
    { type: 'reasoning', summary: [] },
    { type: 'reasoning', id: null, summary: [] },
    { type: 'reasoning', id: 'rs', summary: null },
    { type: 'reasoning', id: 'rs', summary: [{ type: 'summary_text', text: null }] },
    { type: 'reasoning', id: 'rs', summary: [], content: [null] },
    { type: 'reasoning', id: 'rs', summary: [], content: 'invalid' },
    { type: 'reasoning', id: 'rs', summary: [], content: [{ type: 'reasoning_text' }] },
    { type: 'reasoning', id: 'rs', summary: [], content: [{ type: 'summary_text', text: '' }] },
    { type: 'reasoning', id: 'rs', summary: [], encrypted_content: {} },
    { type: 'reasoning', id: 'rs', summary: [], status: 'other' },
    { type: 'reasoning', id: 'rs', summary: [], status: null },
    { type: 'reasoning', id: 'rs', summary: [], content: null },
  ])('invalid replay sibling stops the computer batch before effects: %j', async (sibling) => {
    const h = harness([[call([{ type: 'wait' }]), sibling], [message]]);
    await expect(h.toolset.run(h.client, { input: 'begin' })).rejects.toThrow();
    expect(h.performed).toEqual([]);
    expect(h.bodies).toHaveLength(1);
  });
  test.each([
    { ...call([{ type: 'wait' }]), call_id: 'other_call' },
    { ...message, id: 'cu_test' },
    { type: 'reasoning', id: 'cu_test', summary: [], encrypted_content: '' },
  ])('duplicate $type platform identity stops before computer effects', async (sibling) => {
    const h = harness([[call([{ type: 'wait' }]), sibling], [message]]);
    await expect(h.toolset.run(h.client, { input: 'begin' })).rejects.toThrow(/identity/iu);
    expect(h.performed).toEqual([]);
    expect(h.bodies).toHaveLength(1);
  });

  test('preserves native citation/logprob metadata, nulls, and extensions on replay', async () => {
    const metadata = {
      id: '',
      phase: null,
      extension: { kept: 'message' },
      content: [
        {
          type: 'output_text',
          text: 'fixture',
          extension: { kept: 'part' },
          annotations: [
            { type: 'file_citation', file_id: '', filename: '', index: -1, extension: 'file' },
            {
              type: 'url_citation',
              url: 'opaque',
              title: '',
              start_index: -2,
              end_index: 3,
              extension: 'url',
            },
            {
              type: 'container_file_citation',
              container_id: '',
              file_id: '',
              filename: '',
              start_index: 0,
              end_index: 1,
              extension: 'container',
            },
            { type: 'file_path', file_id: '', index: 0, extension: 'path' },
          ],
          logprobs: [
            {
              token: '',
              bytes: [-1, 256],
              logprob: -0.25,
              extension: 'token',
              top_logprobs: [{ token: '', bytes: [120], logprob: 0, extension: 'top' }],
            },
          ],
        },
        { type: 'output_text', text: 'nullable output', annotations: [], logprobs: null },
        { type: 'output_text', text: 'omitted logprobs', annotations: [] },
        { type: 'refusal', refusal: 'fixture refusal', extension: 'refusal' },
      ],
    };

    const h = harness([[call([{ type: 'wait' }]), { ...message, ...metadata }], [message]]);
    await h.toolset.run(h.client, { input: 'begin' });
    expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
    expect(h.bodies[1]?.['input']).toEqual(expect.arrayContaining([expect.objectContaining(metadata)]));
  });

  test.each(['incomplete', 'in_progress', 'completed'])(
    'replays native %s intermediate commentary with computer calls',
    async (status) => {
      const h = harness([
        [{ ...message, id: 'msg_commentary', status, phase: 'commentary' }, call([{ type: 'wait' }])],
        [message],
      ]);
      await h.toolset.run(h.client, { input: 'begin' });
      expect(h.performed).toEqual([{ type: 'wait' }, { type: 'screenshot' }]);
      expect(h.bodies[1]?.['input']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'message', role: 'assistant', status, phase: 'commentary' }),
        ]),
      );
    },
  );

  test.each([
    { phase: undefined, final: true },
    { phase: null, final: true },
    { phase: 'final_answer', final: true },
    { phase: 'commentary', final: false },
  ])('uses the emitted final message phase $phase', async ({ phase, final }) => {
    const h = harness([[phase === undefined ? message : { ...message, phase }]]);
    const result = h.toolset.run(h.client, { input: 'fixture' });
    await (final
      ? expect(result).resolves.toMatchObject({
          status: 'completed',
          output: [expect.objectContaining({ type: 'message' })],
        })
      : expect(result).rejects.toThrow('final message'));
    expect(h.performed).toEqual([]);
    expect(h.bodies).toHaveLength(1);
  });

  test('rejects empty, reasoning-only, and commentary-only responses', async () => {
    for (const output of [
      [],
      [{ type: 'reasoning', id: 'rs_test', summary: [] }],
      [{ ...message, phase: 'commentary' }],
      [{ ...message, status: 'incomplete' }],
    ]) {
      const h = harness([output]);
      // Independent test fixtures run sequentially for deterministic error reporting.
      // oxlint-disable-next-line no-await-in-loop
      await expect(h.toolset.run(h.client, { input: 'begin' })).rejects.toThrow('final message');
      expect(h.performed).toEqual([]);
    }
  });

  test('snapshots approval state and isolates callback mutations from later driver execution', async () => {
    const h = harness([]);
    const pending = {
      ...call([{ type: 'click', x: 1, y: 2, button: 'left' }]),
      pending_safety_checks: [{ id: 'safe_original' }],
    };
    const output = await h.toolset.execute(pending, {
      approveSafetyChecks: (observed) => {
        observed.call_id = 'mutated';
        observed.pending_safety_checks.splice(0, 1);
        observed.actions?.push({ type: 'type', text: 'injected' });
        return true;
      },
      beforeAction: (action, observed) => {
        if (action.type === 'click') {
          action.x = 300;
        }
        observed.actions?.push({ type: 'wait' });
        return true;
      },
    });
    expect(h.performed).toEqual([{ type: 'click', x: 1, y: 2, button: 'left' }, { type: 'screenshot' }]);
    expect(output.call_id).toBe('call_test');
    expect(output.acknowledged_safety_checks).toEqual([{ id: 'safe_original' }]);
  });

  test('materializes only the modern batch an approval uses and preserves mutable isolated call views', async () => {
    const actions: ComputerAction[] = [{ type: 'wait' }, { type: 'move', x: 1, y: 2 }, { type: 'wait' }];
    const checks = [{ id: 'safe_original', message: 'Review the synthetic fixture.' }];
    const pending = { ...call(actions), pending_safety_checks: checks };
    const h = harness([]);
    const views: ResponseComputerToolCall[] = [];
    await h.toolset.execute(pending, {
      approveSafetyChecks: () => true,
      beforeAction: (_action, view) => {
        const stage = views.length;
        views.push(view);
        expect(Object.keys(view)).toEqual(Object.keys(pending));
        expect(Object.getOwnPropertyDescriptor(view, 'actions')).toMatchObject({
          configurable: true,
          enumerable: true,
          get: expect.any(Function),
        });
        if (stage === 0) {
          // Metadata-only policy keeps its copy until after the entire call.
          expect(view.call_id).toBe(pending.call_id);
        } else if (stage === 1) {
          expect(structuredClone(view)).toEqual(pending);
          expect(JSON.stringify(view)).toBe(JSON.stringify(pending));
          view.actions?.push({ type: 'screenshot' });
          view.pending_safety_checks.push({ id: 'callback_only', code: null, message: null });
        } else if (stage === 2) {
          // Assignment before reading must not load the original list.
          view.actions = [];
          view.pending_safety_checks = [];
          expect(view.actions).toEqual([]);
          expect(view.pending_safety_checks).toEqual([]);
        } else {
          expect(Reflect.deleteProperty(view, 'actions')).toBe(true);
          expect(hasOwn(view, 'actions')).toBe(false);
          expect(Reflect.deleteProperty(view, 'pending_safety_checks')).toBe(true);
          expect(hasOwn(view, 'pending_safety_checks')).toBe(false);
        }
        return true;
      },
    });
    expect(h.performed).toEqual([...actions, { type: 'screenshot' }]);
    expect(views).toHaveLength(4);
    expect(views[0]?.actions).toEqual(actions);
    expect(views[0]?.pending_safety_checks).toEqual(checks);
    expect(views[1]?.actions).toEqual([...actions, { type: 'screenshot' }]);
    expect(views[1]?.pending_safety_checks).toEqual([
      ...checks,
      { id: 'callback_only', code: null, message: null },
    ]);
    expect(views[2]?.actions).toEqual([]);
    expect(views[2]?.pending_safety_checks).toEqual([]);
    expect(checks).toEqual([{ id: 'safe_original', message: 'Review the synthetic fixture.' }]);
    expect(pending).toEqual({ ...call(actions), pending_safety_checks: checks });
  });

  test.each(['freeze', 'seal'] as const)(
    'can %s a modern approval view before reading its batch',
    async (mode) => {
      const actions: ComputerAction[] = [{ type: 'wait' }, { type: 'screenshot' }];
      const checks = [{ id: 'safe_original', message: 'Review the synthetic fixture.' }];
      const pending = { ...call(actions), pending_safety_checks: checks };
      const h = harness([]);
      await h.toolset.execute(pending, {
        approveSafetyChecks: () => true,
        beforeAction: (_action, view) => {
          if (mode === 'freeze') {
            Object.freeze(view);
          } else {
            Object.seal(view);
          }
          expect(view.actions).toEqual(actions);
          expect(view.actions).toBe(view.actions);
          view.actions?.push({ type: 'wait' });
          expect(view.pending_safety_checks).toEqual(checks);
          expect(view.pending_safety_checks).toBe(view.pending_safety_checks);
          view.pending_safety_checks.push({ id: 'callback_only', code: null, message: null });
          if (mode === 'freeze') {
            expect(() => {
              view.pending_safety_checks = [];
            }).toThrow(TypeError);
          } else {
            view.pending_safety_checks = [];
            expect(view.pending_safety_checks).toEqual([]);
          }
          return true;
        },
      });
      expect(h.performed).toEqual(actions);
      expect(pending.actions).toEqual(actions);
      expect(pending.pending_safety_checks).toEqual([
        { id: 'safe_original', message: 'Review the synthetic fixture.' },
      ]);
    },
  );

  test('allows a file_id capture, checks all screenshot actions, but only captures the final observation', async () => {
    const h = harness([], (driver) => {
      driver.screenshot = () => ({ type: 'computer_screenshot', file_id: 'file_synthetic' });
    });
    const seen: string[] = [];
    const output = await h.toolset.execute(call([{ type: 'screenshot' }, { type: 'wait' }]), {
      beforeAction: (action) => {
        seen.push(action.type);
        return true;
      },
    });
    expect(seen).toEqual(['screenshot', 'wait', 'screenshot']);
    expect(output.output).toEqual({ type: 'computer_screenshot', file_id: 'file_synthetic' });
  });

  test('checks abort after a screenshot so a cancelled capture is never sent', async () => {
    const controller = new AbortController();
    const diagnostics: { stage: string; reason: string; member: string | null }[] = [];
    const h = harness([[call([{ type: 'screenshot' }])]], (driver) => {
      driver.screenshot = () => {
        controller.abort(new Error('cancel screenshot'));
        return image;
      };
    });
    await expect(
      h.toolset.run(
        h.client,
        { input: 'begin' },
        {
          signal: controller.signal,
          onDiagnostic: (event) => diagnostics.push(event),
        },
      ),
    ).rejects.toThrow('cancel screenshot');
    expect(h.bodies).toHaveLength(1);
    expect(diagnostics.filter((event) => event.stage === 'action')).toEqual([
      expect.objectContaining({ member: 'screenshot', reason: 'cancelled' }),
    ]);
  });

  test('never executes items from a failed or incomplete response', async () => {
    for (const status of ['failed', 'incomplete', 'in_progress', 'queued', 'cancelled']) {
      const h = harness([]);
      const client = new OpenAI({
        apiKey: 'synthetic-test-key',
        fetch: async () => Response.json({ status, output: [call([{ type: 'wait' }])] }),
      });
      // Independent test fixtures run sequentially for deterministic error reporting.
      // oxlint-disable-next-line no-await-in-loop
      await expect(h.toolset.run(client, { input: 'begin' })).rejects.toThrow('not completed');
      expect(h.performed).toEqual([]);
    }
  });
});

test.each([
  { actions: [{ type: 'wait' }], action: null },
  { actions: null, action: { type: 'wait' } },
])('rejects explicit null computer alternatives before effects and replay', async (fields) => {
  const h = harness([[{ ...call([]), ...fields }], [message]]);
  await expect(h.toolset.run(h.client, { model: '', input: 'fixture' })).rejects.toThrow(/exactly one/u);
  expect(h.performed).toEqual([]);
  expect(h.bodies).toHaveLength(1);
});

test.each(['type', 'screenshot'] as const)(
  'rejects missing required %s before any computer effect',
  (member) => {
    const h = harness([]);
    Reflect.set(h.driver, member, undefined);
    expect(() => new ComputerToolset(h.driver)).toThrow(/driver/u);
    expect(h.performed).toEqual([]);
  },
);

test('captures callable computer methods and their driver receiver at registration', async () => {
  const h = harness([]);
  const replacement = vi.fn();
  Reflect.set(h.driver, 'type', replacement);
  Reflect.set(h.driver, 'screenshot', replacement);
  await h.toolset.execute(call([{ type: 'type', text: 'fixture' }]));
  expect(h.performed.map(({ type }) => type)).toEqual(['type', 'screenshot']);
  expect(replacement).not.toHaveBeenCalled();
});
