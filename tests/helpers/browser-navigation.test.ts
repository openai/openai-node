import { BrowserToolset, BrowserError } from 'openai/helpers/browser';
import OpenAI from 'openai';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';
import type { BrowserDriver, BrowserOptions } from 'openai/helpers/browser';
import type {
  ResponseFunctionToolCall,
  ResponseInputImageContent,
} from 'openai/resources/responses/responses';
import { setImmediate as tick } from 'node:timers/promises';
import { describe, expect, test, vi } from 'vitest';

const state = () => ({
  tabs: [{ id: 'a', title: 'Fixture', url: 'https://fixture.invalid/', active: true }],
});
function call(member: string, args: Record<string, unknown>): ResponseFunctionToolCall {
  return {
    name: `browser_${member}`,
    arguments: JSON.stringify(args),
    call_id: 'navigation_case',
    type: 'function_call',
    status: 'completed',
  };
}

describe('BrowserToolset optional navigation members', () => {
  test.each([
    { stream: false, maxSteps: 1 },
    { stream: false, maxSteps: 2 },
    { stream: true, maxSteps: 1 },
    { stream: true, maxSteps: 2 },
  ])(
    'request cap controls the observed wait and its positive control: $stream/$maxSteps',
    async ({ stream, maxSteps }) => {
      const wait = vi.fn(() => 'Visible condition met.');
      let sent = false;
      const fetch = vi.fn(async () => {
        const item = sent
          ? {
              id: 'message_one',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'Done.', annotations: [] }],
            }
          : {
              ...call('wait_for', { tab_id: null, text: 'ready', timeout_ms: 30_000 }),
              id: 'fc_wait',
            };
        sent = true;
        const response = { id: 'resp_1', object: 'response', status: 'completed', output: [item], model: '' };
        if (!stream) {
          return Response.json(response);
        }
        const events = [
          {
            type: 'response.created',
            sequence_number: 0,
            response: { ...response, status: 'in_progress', output: [] },
          },
          {
            type: 'response.output_item.added',
            sequence_number: 1,
            output_index: 0,
            item: { ...item, status: 'in_progress' },
          },
          { type: 'response.output_item.done', sequence_number: 2, output_index: 0, item },
          { type: 'response.completed', sequence_number: 3, response },
        ];
        return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      });
      const client = new OpenAI({ apiKey: 'synthetic-fixture', fetch });
      const runner = new ResponsesToolRunner({
        browser: new BrowserToolset({ state, wait_for: wait }),
        ...(stream ? { earlyExecution: { functions: ['browser_wait_for'] } } : {}),
      });
      const run = runner.run(
        client,
        { model: '', input: 'fixture task' },
        { maxSteps, stream, eager: stream },
      );
      if (maxSteps === 1) {
        await expect(run).rejects.toThrow();
        expect(wait).not.toHaveBeenCalled();
      } else {
        await expect(run).resolves.toMatchObject({ status: 'completed' });
        expect(wait).toHaveBeenCalledTimes(1);
      }
      expect(fetch).toHaveBeenCalledTimes(maxSteps);
    },
  );

  test.each([
    { text: '', timeout_ms: 1 },
    { text: ' \n  ', timeout_ms: 1 },
    { text: '\uD800', timeout_ms: 100 },
    { text: 'é'.repeat(129), timeout_ms: 100 },
    { text: 'ready', timeout_ms: 0 },
    { text: 'ready', timeout_ms: 30_001 },
    { text: 'ready', timeout_ms: 1.2 },
    { text: 'ready', timeout_ms: true },
    { text: 'ready', timeout_ms: Number.MAX_SAFE_INTEGER },
  ])('validates a complete wait before dispatch: %j', async (args) => {
    const wait = vi.fn(() => 'unexpected');
    const browser = new BrowserToolset({ state, wait_for: wait });
    const result = await browser.executeWithStatus(call('wait_for', { ...args, tab_id: null }));
    expect(result.ok).toBe(false);
    expect(wait).not.toHaveBeenCalled();
    expect(result.output).toMatchObject({ type: 'function_call_output', call_id: 'navigation_case' });
  });

  test('excluded capabilities and harmless waits never inspect irrelevant getters', async () => {
    const driver: BrowserDriver = {
      state,
      get scroll_to(): NonNullable<BrowserDriver['scroll_to']> {
        throw new Error('excluded scroll getter');
      },
      wait_for(args, options) {
        expect(args).toEqual({ text: ' \nVisible text  ', timeout_ms: 30_000, tab_id: null });
        expect(options).toEqual({ signal: undefined });
        return 'Visible condition met.';
      },
    };
    const options: BrowserOptions = {
      members: ['wait_for'],
      get confirm(): NonNullable<BrowserOptions['confirm']> {
        throw new Error('irrelevant confirmation');
      },
      get urlPolicy(): NonNullable<BrowserOptions['urlPolicy']> {
        throw new Error('irrelevant URL policy');
      },
    };
    const browser = new BrowserToolset(driver, options);
    const result = await browser.executeWithStatus(
      call('wait_for', { text: ' \nVisible text  ', timeout_ms: 30_000, tab_id: null }),
    );
    expect(result.ok).toBe(true);
    expect(browser.tools().map(({ name }) => name)).toEqual(['browser_wait_for']);
    await expect(browser.execute(call('scroll_to', { target: 'ref_a', tab_id: null }))).rejects.toThrow();
  });

  test('history passes the raw operation through policy then consent and keeps the old one-arg ABI', async () => {
    const order: string[] = [];
    const navigate = vi.fn(({ url }: { url: string }) => {
      order.push(url);
      return 'History navigation checked.';
    });
    const options = {
      confirm: () => {
        order.push('confirm');
        return true;
      },
      urlPolicy: (_context: unknown, url: string) => {
        order.push(`policy:${url}`);
        return url !== 'forward';
      },
    };
    const browser = new BrowserToolset({ state, navigate }, options);
    const back = await browser.executeWithStatus(call('navigate', { url: 'back', tab_id: null }));
    expect(back.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith({ url: 'back', tab_id: null }, { signal: undefined });
    const forward = await browser.executeWithStatus(call('navigate', { url: 'forward', tab_id: null }));
    expect(forward.ok).toBe(false);
    expect(order).toEqual(['policy:back', 'confirm', 'back', 'policy:forward']);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  test('target scroll needs fresh confirmation, fixes its handler and revokes on removed consent', async () => {
    const effects: string[] = [];
    const driver: BrowserDriver = {
      state,
      scroll_to: () => {
        effects.push('selected');
      },
    };
    expect(() => new BrowserToolset(driver)).toThrow();
    const options: BrowserOptions = {
      confirm: () => {
        driver.scroll_to = () => {
          effects.push('retargeted');
        };
        return true;
      },
    };
    const browser = new BrowserToolset(driver, options);
    const request = call('scroll_to', { tab_id: 'a', target: 'observed' });
    const approved = await browser.executeWithStatus(request);
    expect(approved.ok).toBe(true);
    delete options.confirm;
    const refused = await browser.executeWithStatus(request);
    expect(refused.ok).toBe(false);
    expect(effects).toEqual(['selected']);
  });

  test('abort waits for the actual noncooperative callback; it cannot return late success', async () => {
    let release!: () => void;
    // A real pending driver callback proves abort does not falsely report it drained.
    // oxlint-disable-next-line promise/avoid-new
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new AbortController();
    let admitted = false;
    const stateRead = vi.fn(state);
    const browser = new BrowserToolset({
      state: stateRead,
      async wait_for(_args, { signal }) {
        expect(signal).toBe(controller.signal);
        admitted = true;
        await held;
        return 'Visible condition met.';
      },
    });
    let settled = false;
    const operation = browser.execute(call('wait_for', { tab_id: null, text: 'ready', timeout_ms: 500 }), {
      signal: controller.signal,
    });
    const rejection = (async () => {
      try {
        return await operation;
      } catch (error) {
        settled = true;
        return error;
      }
    })();
    await tick();
    expect(admitted).toBe(true);
    controller.abort(new Error('caller stopped'));
    await tick();
    expect(settled).toBe(false);
    expect(stateRead).toHaveBeenCalledTimes(1);
    release();
    await expect(rejection).resolves.toMatchObject({ message: 'caller stopped' });
    expect(stateRead).toHaveBeenCalledTimes(1);
  });

  test('controlled wait timeouts validate final state and keep their native pairing', async () => {
    const stateRead = vi.fn(state);
    const browser = new BrowserToolset({
      state: stateRead,
      wait_for() {
        throw new BrowserError('Visible condition timed out.');
      },
    });
    const result = await browser.executeWithStatus(
      call('wait_for', { tab_id: null, text: 'ready', timeout_ms: 1 }),
    );
    expect(result).toMatchObject({
      ok: false,
      output: { type: 'function_call_output', call_id: 'navigation_case' },
    });
    expect(stateRead).toHaveBeenCalledTimes(2);
    expect(result.output.output).toEqual([
      expect.objectContaining({
        type: 'input_text',
        text: expect.stringContaining('Visible condition timed out.'),
      }),
    ]);
  });
});

describe('BrowserToolset optional zoom', () => {
  test.each(['auto', 'low', 'high', 'original'] as const)(
    'accepts native image detail %s and publishes it before later driver mutation',
    async (detail) => {
      const toolset = new BrowserToolset({
        state,
        zoom: () => ({ type: 'input_image', detail, file_id: 'fixture_image' }),
      });
      const output = await toolset.execute(call('zoom', { tab_id: null, region: [0, 0, 2, 3] }));
      expect(output.output).toContainEqual({ type: 'input_image', detail, file_id: 'fixture_image' });
    },
  );
  test.each([
    [],
    [0, 0, 1],
    [0, 0, 1, 1, 2],
    [-1, 0, 1, 1],
    [0, 1, 1, 1],
    [0, 0, true, 3],
    [0, 0, 1.5, 3],
    [0, 0, Number.MAX_SAFE_INTEGER + 1, 3],
  ])('rejects malformed region before handler or irrelevant consent reads: %j', async (...region) => {
    const zoom = vi.fn(() => ({ type: 'input_image' as const, detail: 'auto' as const, file_id: 'image' }));
    const options: BrowserOptions = {
      get confirm(): NonNullable<BrowserOptions['confirm']> {
        throw new Error('PRIVATE_POLICY');
      },
      get urlPolicy(): NonNullable<BrowserOptions['urlPolicy']> {
        throw new Error('PRIVATE_POLICY');
      },
    };
    const toolset = new BrowserToolset({ state, zoom }, options);
    const result = await toolset.execute(call('zoom', { tab_id: null, region }));
    expect(result.output).toEqual([expect.objectContaining({ text: expect.stringContaining('"ok":false') })]);
    expect(zoom).not.toHaveBeenCalled();
  });

  test('copies image before final state and never serializes later driver changes', async () => {
    const shared: ResponseInputImageContent & { private?: string } = {
      type: 'input_image',
      detail: 'auto',
      file_id: 'safe',
    };
    let reports = 0;
    const toolset = new BrowserToolset({
      state() {
        reports += 1;
        if (reports === 2) {
          shared.file_id = 'PRIVATE';
          shared.private = 'PRIVATE';
        }
        return state();
      },
      zoom: () => shared,
    });
    const output = await toolset.execute(call('zoom', { tab_id: null, region: [1, 2, 100, 200] }));
    expect(output.output).toEqual([
      expect.objectContaining({ type: 'input_text', text: expect.stringContaining('"ok":true') }),
      { type: 'input_image', detail: 'auto', file_id: 'safe' },
    ]);
    expect(JSON.stringify(output)).not.toContain('PRIVATE');
  });

  test.each([
    { type: 'input_image', image_url: 'data:image/png;base64,cG5n' },
    { type: 'input_image', file_id: 'fixture_image' },
    { type: 'input_image', image_url: 'data:image/png;base64,cG5n', detail: null },
    {
      type: 'input_image',
      image_url: 'data:image/png;base64,cG5n',
      file_id: 'fixture_image',
      detail: 'auto',
    },
  ] satisfies ResponseInputImageContent[])(
    'accepts zoom function-output defaults without a required detail: %j',
    async (image) => {
      const toolset = new BrowserToolset({ state, zoom: () => image });
      const output = await toolset.execute(call('zoom', { tab_id: null, region: [0, 0, 2, 3] }));
      expect(output.output).toContainEqual(image);
    },
  );

  test.each([
    { type: 'input_image', image_url: 'data:image/png;base64,cG5n', file_id: ' ', detail: 'auto' },
    { type: 'input_image', file_id: 'fixture', detail: 'auto', private_metadata: 'SYNTHETIC_PRIVATE' },
  ] as const)(
    'refuses invalid supplied sources and undeclared zoom fields before final state',
    async (image) => {
      const report = vi.fn(state);
      const toolset = new BrowserToolset({ state: report, zoom: () => image });
      await expect(toolset.execute(call('zoom', { tab_id: null, region: [0, 0, 2, 3] }))).rejects.toThrow(
        'Browser zoom must return an input_image with at least one valid image_url or file_id.',
      );
      expect(report).toHaveBeenCalledTimes(1);
    },
  );

  test('screenshot requires one image source and declared browser fields', async () => {
    const image = {
      type: 'input_image' as const,
      detail: 'auto' as const,
      image_url: 'data:image/png;base64,cG5n',
      file_id: 'fixture',
      legacy: 'value',
    };
    const toolset = new BrowserToolset({ state, screenshot: () => image });
    await expect(toolset.execute(call('screenshot', { tab_id: null }))).rejects.toThrow(
      'Browser screenshot must return an input_image with at least one valid image_url or file_id.',
    );
  });

  test('invalid image fails before final state, skipped/disabled zoom never reads policies or handler', async () => {
    const report = vi.fn(state);
    const broken = vi.fn(() => ({ type: 'input_image' as const, detail: 'auto' as const, file_id: '' }));
    const toolset = new BrowserToolset({ state: report, zoom: broken });
    const zoomCall = call('zoom', { tab_id: null, region: [0, 0, 2, 3] });
    await expect(toolset.execute(zoomCall)).rejects.toThrow('Browser zoom must return');
    expect(report).toHaveBeenCalledTimes(1);
    broken.mockClear();
    await expect(toolset.executeWithStatus(zoomCall, undefined, true)).resolves.toMatchObject({ ok: false });
    expect(broken).not.toHaveBeenCalled();
    const disabled = new BrowserToolset({ state, zoom: broken }, { members: [] });
    expect(disabled.tools().some((tool) => tool.name === 'browser_zoom')).toBe(false);
    await expect(disabled.execute(zoomCall)).rejects.toThrow('registered call');
    expect(broken).not.toHaveBeenCalled();
  });
});
