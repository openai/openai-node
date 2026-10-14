// oxlint-disable eslint/max-classes-per-file -- Separate typed fixtures exercise each configured result owner.
import { BrowserError, BrowserToolset } from 'openai/helpers/browser';
import type {
  BrowserDriver,
  BrowserReadElement,
  BrowserReadOption,
  BrowserReadV1,
  BrowserScopedReadV1,
  BrowserState,
} from 'openai/helpers/browser';
import type { ResponseFunctionToolCall, ResponseInputItem } from 'openai/resources/responses/responses';
import { describe, expect, test, vi } from 'vitest';

const state = () => ({
  tabs: [{ id: 'task', title: 'Fixture', url: 'https://fixture.invalid/', active: true }],
});
const reportedState = () => ({
  tabs: [{ id: 'task', title: 'Fixture', url: 'https://fixture.invalid', active: true }],
});

function call(name: string, args: Record<string, unknown>): ResponseFunctionToolCall {
  return {
    type: 'function_call',
    id: 'item_read',
    call_id: 'call_read',
    status: 'completed',
    name,
    arguments: JSON.stringify(args),
  };
}

function payload(result: ResponseInputItem.FunctionCallOutput) {
  if (!Array.isArray(result.output) || result.output[0]?.type !== 'input_text') {
    throw new Error('Expected browser text output');
  }
  return JSON.parse(result.output[0].text);
}

function readReport(): BrowserReadV1 {
  return {
    version: 1,
    text: 'Visible receipt 47',
    elements: [
      {
        ref: 'opaque:one',
        role: 'combobox',
        label: 'Seating',
        options: [{ label: 'Patio', value: 'patio' }],
      },
    ],
    omitted: ['unsupported_root'],
  };
}

function runtimeDriver(value: unknown, readState: BrowserDriver['state'] = state): BrowserDriver {
  // SAFETY: Tests pass untyped customer-driver values across the public runtime boundary.
  const read = () => value as string;
  return {
    state: readState,
    read_page: read,
    find: read,
    get_page_text: read,
  };
}

function largeReport(padding: number) {
  return {
    version: 1,
    text: '\u0000'.repeat(padding),
    elements: [],
    omitted: [],
    raw_large_page: 'PRIVATE_METADATA'.repeat(100_000),
  };
}

const reads = [
  ['browser_read_page', { tab_id: null, filter: 'all' }],
  ['browser_find', { tab_id: null, query: 'Seat' }],
] as const;

const validObservation = { version: 1, sequence: 0, dropped_changes: 0, title_truncated: false, changes: [] };
test.each([
  ['null', null],
  ['wrong_version', { ...validObservation, version: 2 }],
  ['bool_version', { ...validObservation, version: true }],
  ['negative_sequence', { ...validObservation, sequence: -1 }],
  ['bool_sequence', { ...validObservation, sequence: false }],
  [
    'unsafe_sequence',
    { ...validObservation, sequence: 9_007_199_254_740_992, dropped_changes: 9_007_199_254_740_992 },
  ],
  ['negative_dropped', { ...validObservation, dropped_changes: -1 }],
  ['bool_dropped', { ...validObservation, dropped_changes: false }],
  ['numeric_truncation', { ...validObservation, title_truncated: 1 }],
  ['fraction_sequence', { ...validObservation, sequence: 0.5 }],
  ['not_a_list', { ...validObservation, changes: {} }],
  [
    'late_event_gap',
    {
      ...validObservation,
      sequence: 33,
      changes: Array.from({ length: 33 }, (_, i) => ({
        type: 'navigation',
        tab_id: 'one',
        sequence: Math.min(i + 1, 32),
      })),
    },
  ],
  [
    'counter_gap',
    { ...validObservation, sequence: 2, changes: [{ type: 'navigation', tab_id: 'one', sequence: 2 }] },
  ],
  [
    'event_gap',
    { ...validObservation, sequence: 1, changes: [{ type: 'navigation', tab_id: 'one', sequence: 2 }] },
  ],
  [
    'event_bool',
    { ...validObservation, sequence: 1, changes: [{ type: 'navigation', tab_id: 'one', sequence: true }] },
  ],
  [
    'unknown_event',
    { ...validObservation, sequence: 1, changes: [{ type: 'login', tab_id: 'one', sequence: 1 }] },
  ],
  [
    'null_required_tab',
    { ...validObservation, sequence: 1, changes: [{ type: 'navigation', tab_id: null, sequence: 1 }] },
  ],
  [
    'bad_reason',
    {
      ...validObservation,
      sequence: 1,
      changes: [{ type: 'navigation_refused', tab_id: null, reason: 'SYNTHETIC_PRIVATE', sequence: 1 }],
    },
  ],
  [
    'bad_dialog',
    {
      ...validObservation,
      sequence: 1,
      changes: [{ type: 'dialog_dismissed', tab_id: 'one', kind: 'SYNTHETIC_PRIVATE', sequence: 1 }],
    },
  ],
  [
    'bad_download',
    {
      ...validObservation,
      sequence: 1,
      changes: [{ type: 'download', tab_id: null, status: 'SYNTHETIC_PRIVATE', sequence: 1 }],
    },
  ],
  [
    'blank_tab',
    { ...validObservation, sequence: 1, changes: [{ type: 'tab_closed', tab_id: '', sequence: 1 }] },
  ],
  [
    'long_event_id',
    {
      ...validObservation,
      sequence: 1,
      changes: [{ type: 'navigation', tab_id: `${'𐍈'.repeat(32)}x`, sequence: 1 }],
    },
  ],
  ...Object.keys(validObservation).map((key): [string, unknown] => [
    `missing_${key}`,
    Object.fromEntries(Object.entries(validObservation).filter(([field]) => field !== key)),
  ]),
])('refuses malformed observation metadata: %s', async (_name, observation) => {
  const read = vi.fn(() => 'not reached');
  const browser = new BrowserToolset(
    {
      // SAFETY: A customer driver can return untyped malformed state at runtime.
      state: () => ({ ...state(), observation }) as BrowserState,
      read_page: read,
    },
    { members: ['read_page'] },
  );
  await expect(browser.execute(call('browser_read_page', { tab_id: null, filter: 'all' }))).rejects.toThrow(
    'Browser state report failed.',
  );
  expect(read).not.toHaveBeenCalled();
});

test.each(['sequence', 'dropped_changes'])(
  'refuses decreasing %s in an otherwise valid final observation',
  async (field) => {
    let calls = 0;

    const before =
      field === 'sequence'
        ? {
            ...validObservation,
            sequence: 2,
            changes: [
              { type: 'navigation', tab_id: 'task', sequence: 1 },
              { type: 'navigation', tab_id: 'task', sequence: 2 },
            ],
          }
        : { ...validObservation, sequence: 2, dropped_changes: 2 };
    const after =
      field === 'sequence'
        ? { ...validObservation, sequence: 1, changes: [{ type: 'navigation', tab_id: 'task', sequence: 1 }] }
        : {
            ...validObservation,
            sequence: 3,
            dropped_changes: 1,
            changes: [
              { type: 'navigation', tab_id: 'task', sequence: 2 },
              { type: 'navigation', tab_id: 'task', sequence: 3 },
            ],
          };
    const browser = new BrowserToolset(
      runtimeDriver('read', () => {
        calls += 1;
        // SAFETY: Exercise the public state boundary before and after a real read.
        return { ...state(), observation: calls === 1 ? before : after } as BrowserState;
      }),
      { members: ['read_page'] },
    );
    await expect(browser.execute(call('browser_read_page', { tab_id: null, filter: 'all' }))).rejects.toThrow(
      'Browser state',
    );
    expect(calls).toBe(2);
  },
);

test.each([
  ['a'.repeat(1025), 'a'.repeat(1024), true, false],
  ['é'.repeat(513), 'é'.repeat(512), true, false],
  ['😀'.repeat(257), '😀'.repeat(256), true, false],
  ['é'.repeat(512), 'é'.repeat(512), false, false],
  ['Short', 'Short', true, true],
] as const)(
  'projects long observed titles without rejecting the page',
  async (title, expected, truncated, alreadyTruncated) => {
    const observation = {
      version: 1 as const,
      sequence: 0,
      dropped_changes: 0,
      title_truncated: alreadyTruncated,
      changes: [],
    };
    const browser = new BrowserToolset(
      runtimeDriver('Visible text', () => ({
        tabs: [{ id: 'task', title, url: 'https://fixture.invalid/', active: true }],
        observation,
      })),
    );
    const result = payload(await browser.execute(call('browser_read_page', { tab_id: null, filter: 'all' })));
    expect(result.state.tabs[0].title).toBe(expected);
    expect(result.state.observation.title_truncated).toBe(truncated);
    expect(observation.title_truncated).toBe(alreadyTruncated);
  },
);

test('rejects invalid Unicode beyond the projected title', async () => {
  const browser = new BrowserToolset(
    runtimeDriver('Visible text', () => ({
      tabs: [
        { id: 'task', title: `${'a'.repeat(2048)}\uD800`, url: 'https://fixture.invalid/', active: true },
      ],
      observation: { version: 1, sequence: 0, dropped_changes: 0, title_truncated: false, changes: [] },
    })),
  );
  await expect(browser.execute(call('browser_read_page', { tab_id: null, filter: 'all' }))).rejects.toThrow(
    'Browser state report failed.',
  );
});

describe('Browser bounded reads', () => {
  test.each([101, 1000])(
    'driver-selected collection sizes %i retain elements, options and scopes',
    async (count) => {
      const report: BrowserScopedReadV1 = {
        version: 1,
        text: 'Visible',
        elements: Array.from({ length: count }, (_, n) =>
          n === count - 1
            ? {
                ref: 'choices',
                role: 'listbox',
                label: 'Choices',
                options: Array.from({ length: 33 }, (_entry, option) => ({
                  label: String(option),
                  value: String(option),
                  selected: option === 32,
                })),
              }
            : { ref: String(n), role: 'button', label: 'Select' },
        ),
        omitted: [],
        scopes: Array.from({ length: count }, (_, n) => ({ ref: `scope:${n}`, label: 'Section' })),
      };
      const browser = new BrowserToolset(
        { state, read_page_scoped: () => report },
        { members: ['read_page_scoped'] },
      );
      expect(
        payload(
          await browser.execute(
            call('browser_read_page_scoped', {
              tab_id: null,
              root: null,
              depth: 2,
              filter: 'all',
            }),
          ),
        ).result,
      ).toEqual(report);
    },
  );

  test.each([false, true])('observation overlap drop and append (rewrite=%s)', async (rewrite) => {
    let stateReads = 0;
    const report = (): BrowserState => {
      stateReads += 1;
      const changes: NonNullable<BrowserState['observation']>['changes'] = Array.from(
        { length: 3 },
        (_, n) => ({ type: 'navigation', tab_id: 'task', sequence: n + 1 }),
      );
      let dropped = 0;
      if (stateReads > 1) {
        dropped = 1;
        changes.shift();
        changes.push({ type: 'navigation', tab_id: 'task', sequence: 4 });
        if (rewrite) {
          changes[0] = { type: 'download', tab_id: 'task', sequence: 2, status: 'blocked' };
        }
      }
      return {
        ...state(),
        observation: {
          version: 1,
          sequence: dropped + changes.length,
          dropped_changes: dropped,
          title_truncated: false,
          changes,
        },
      };
    };
    const browser = new BrowserToolset(runtimeDriver('ordinary read', report));
    if (rewrite) {
      await expect(browser.execute(call(...reads[0]))).rejects.toThrow('Browser state');
    } else {
      expect(
        payload(await browser.execute(call(...reads[0]))).state.observation.changes.map(
          (event: { sequence: number }) => event.sequence,
        ),
      ).toEqual([2, 3, 4]);
    }
  });
  // oxlint-disable eslint/class-methods-use-this -- These fixtures intentionally mix constant and private-backed prototype getters.
  test('captures configured read, element, option and scope fields once from the original receivers', async () => {
    const visited = vi.fn();
    class Option implements BrowserReadOption {
      #value = 'patio';
      get label() {
        visited('option.label');
        return 'Patio';
      }
      get value() {
        visited('option.value');
        return this.#value;
      }
      get selected() {
        visited('option.selected');
        return true;
      }
    }
    class Element implements BrowserReadElement {
      #ref = 'seating';
      get ref() {
        visited('element.ref');
        return this.#ref;
      }
      get label() {
        visited('element.label');
        return 'Seating';
      }
      get role() {
        visited('element.role');
        return 'listbox' as const;
      }
      get value() {
        visited('element.value');
        return 'patio';
      }
      get options() {
        visited('element.options');
        return [new Option()];
      }
    }
    class Scope {
      #ref = 'patio-section';
      get ref() {
        visited('scope.ref');
        return this.#ref;
      }
      get label() {
        visited('scope.label');
        return 'Patio';
      }
    }
    class Report implements BrowserScopedReadV1 {
      #text = 'Visible';
      get version() {
        visited('report.version');
        return 1 as const;
      }
      get text() {
        visited('report.text');
        return this.#text;
      }
      get elements() {
        visited('report.elements');
        return [new Element()];
      }
      get omitted(): BrowserReadV1['omitted'] {
        visited('report.omitted');
        return [];
      }
      get scopes() {
        visited('report.scopes');
        return [new Scope()];
      }
    }
    const supplied = new Report();
    const driver: BrowserDriver = { state, read_page_scoped: () => supplied };
    const browser = new BrowserToolset(driver, { members: ['read_page_scoped'] });
    const response = payload(
      await browser.execute(
        call('browser_read_page_scoped', {
          tab_id: null,
          root: null,
          depth: 2,
          filter: 'all',
        }),
      ),
    );
    expect(response).toEqual({
      ok: true,
      state: reportedState(),
      result: {
        version: 1,
        text: 'Visible',
        omitted: [],
        elements: [
          {
            ref: 'seating',
            label: 'Seating',
            role: 'listbox',
            value: 'patio',
            options: [{ label: 'Patio', value: 'patio', selected: true }],
          },
        ],
        scopes: [{ ref: 'patio-section', label: 'Patio' }],
      },
    });
    expect(visited.mock.calls.flat()).toEqual(
      expect.arrayContaining([
        'element.label',
        'element.options',
        'element.ref',
        'element.role',
        'element.value',
        'option.label',
        'option.selected',
        'option.value',
        'report.elements',
        'report.omitted',
        'report.scopes',
        'report.text',
        'report.version',
        'scope.label',
        'scope.ref',
      ]),
    );
    expect(visited).toHaveBeenCalledTimes(15);
  });
  // oxlint-enable eslint/class-methods-use-this

  test.each([
    ['report', 'version'],
    ['report', 'text'],
    ['report', 'elements'],
    ['report', 'omitted'],
    ['element', 'ref'],
    ['element', 'role'],
    ['element', 'label'],
    ['option', 'label'],
    ['option', 'value'],
    ['scope', 'ref'],
    ['scope', 'label'],
    ['report', 'scopes'],
  ] as const)('missing required %s.%s stops before final state', async (kind, field) => {
    const option = { label: 'Patio', value: 'patio' };
    const element = {
      ref: 'one',
      role: 'combobox' as const,
      label: 'Seating',
      options: [option],
    };
    const scope = { ref: 'section', label: 'Patio' };
    const report: BrowserScopedReadV1 = {
      version: 1,
      text: '',
      elements: [element],
      omitted: [],
      scopes: [scope],
    };
    const items = { report, element, option, scope };
    Reflect.deleteProperty(items[kind], field);
    const observe = vi.fn(state);
    const browser = new BrowserToolset(
      {
        state: observe,
        read_page_scoped: () => report,
      },
      { members: ['read_page_scoped'] },
    );
    await expect(
      browser.execute(
        call('browser_read_page_scoped', {
          tab_id: null,
          root: null,
          depth: 2,
          filter: 'all',
        }),
      ),
    ).rejects.toThrow('Browser scoped read report failed.');
    expect(observe).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['state', 'tabs'],
    ['tab', 'id'],
    ['tab', 'title'],
    ['tab', 'url'],
    ['tab', 'active'],
    ['observation', 'sequence'],
    ['change', 'reason'],
  ] as const)('refuses missing reported %s.%s before reading a page', async (location, key) => {
    const tab = { id: 'task', title: 'Fixture', url: 'https://fixture.invalid/path', active: true };
    const change = { type: 'navigation_refused', tab_id: 'task', sequence: 1, reason: 'policy' };
    const observation = {
      version: 1,
      sequence: 1,
      dropped_changes: 0,
      title_truncated: false,
      changes: [change],
    };
    const value = { tabs: [tab], observation };
    Reflect.deleteProperty({ state: value, tab, observation, change }[location], key);
    const read = vi.fn(() => 'Visible text');
    const toolset = new BrowserToolset({
      // SAFETY: This fixture deliberately omits one reported field to check the public driver boundary.
      state: () => value as BrowserState,
      get_page_text: read,
    });
    await expect(toolset.execute(call('browser_get_page_text', { tab_id: null }))).rejects.toThrow(
      'Browser state report failed.',
    );
    expect(read).not.toHaveBeenCalled();
  });

  test('captures configured private-backed tab getters once per report and retains V1 projection', async () => {
    const counts = { tabs: 0, observation: 0, id: 0, title: 0, url: 0, active: 0 };
    class Tab {
      #value = { id: 'task', title: 'Fixture', url: 'https://fixture.invalid/path', active: true };
      get id() {
        counts.id += 1;
        return this.#value.id;
      }
      get title() {
        counts.title += 1;
        return this.#value.title;
      }
      get url() {
        counts.url += 1;
        return this.#value.url;
      }
      get active() {
        counts.active += 1;
        return this.#value.active;
      }
    }
    const tabs = [new Tab()];
    const report = {
      get tabs() {
        counts.tabs += 1;
        return tabs;
      },
      get observation() {
        counts.observation += 1;
        return { version: 1 as const, sequence: 0, dropped_changes: 0, title_truncated: false, changes: [] };
      },
    };
    const browser = new BrowserToolset({ state: () => report });
    const result = payload(await browser.execute(call('browser_list_tabs', {})));
    expect(result.state).toEqual({
      tabs: [{ id: 'task', title: 'Fixture', url: 'https://fixture.invalid', active: true }],
      observation: { version: 1, sequence: 0, dropped_changes: 0, title_truncated: false, changes: [] },
    });
    expect(counts).toEqual({ tabs: 2, observation: 2, id: 2, title: 2, url: 2, active: 2 });
  });

  test.each([
    ['data:text/plain,SYNTHETIC_PRIVATE', 'data:'],
    ['file:///sandbox/SYNTHETIC_PRIVATE.txt', 'file:'],
    ['blob:https://fixture.invalid/SYNTHETIC_PRIVATE', 'blob:'],
    ['mailto:SYNTHETIC_PRIVATE@fixture.invalid', 'mailto:'],
    ['about:blank', 'about:blank'],
  ])('legacy tab state removes payloads from %s', async (url, expected) => {
    const browser = new BrowserToolset(
      runtimeDriver('Fixture', () => ({
        tabs: [{ id: 'tab', title: 'Fixture', url, active: true }],
      })),
    );
    const result = payload(await browser.execute(call('browser_list_tabs', {})));
    expect(result.state.tabs[0].url).toBe(expected);
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE');
  });

  test.each([false, true])('101 reported tabs work with observation=%s', async (observed) => {
    const tabs = Array.from({ length: 101 }, (_, index) => ({
      id: String(index),
      title: 'Fixture',
      url: 'https://fixture.invalid/',
      active: index === 0,
    }));
    const browser = new BrowserToolset(
      runtimeDriver('Fixture', () => ({
        tabs,
        ...(observed
          ? {
              observation: {
                version: 1 as const,
                sequence: 0,
                dropped_changes: 0,
                title_truncated: false,
                changes: [],
              },
            }
          : {}),
      })),
    );
    const result = payload(await browser.execute(call('browser_list_tabs', {})));
    expect(result.state.tabs.map((tab: { id: string }) => tab.id)).toEqual(tabs.map((tab) => tab.id));
  });

  test.each([33, 1024])('projects all %s driver-retained observation events', async (count) => {
    const changes = Array.from({ length: count }, (_, index) => ({
      type: 'navigation' as const,
      tab_id: 'task',
      sequence: index + 8,
      private: 'SYNTHETIC_PRIVATE',
    }));
    const browser = new BrowserToolset(
      runtimeDriver('Fixture', () => ({
        ...state(),
        observation: { version: 1, sequence: count + 7, dropped_changes: 7, title_truncated: false, changes },
      })),
    );
    const result = payload(await browser.execute(call('browser_list_tabs', {})));
    expect(result.state.observation).toEqual({
      version: 1,
      sequence: count + 7,
      dropped_changes: 7,
      title_truncated: false,
      changes: Array.from({ length: count }, (_, index) => ({
        type: 'navigation',
        tab_id: 'task',
        sequence: index + 8,
      })),
    });
  });

  test.each([...reads, ['browser_get_page_text', { tab_id: null }]] as const)(
    '%s keeps state-only results and empty text',
    async (name, args) => {
      await Promise.all(
        [null, undefined].map(async (missing) => {
          const driver: BrowserDriver = {
            state,
            read_page: () => missing,
            find: () => missing,
            get_page_text: async () => missing,
          };
          const browser = new BrowserToolset(driver);
          expect(payload(await browser.execute(call(name, args)))).toEqual({
            ok: true,
            ...(missing === null ? { result: null } : {}),
            state: reportedState(),
          });
        }),
      );
      const browser = new BrowserToolset(runtimeDriver(''));
      expect(payload(await browser.execute(call(name, args))).result).toBe('');
    },
  );

  test('undefined optional read fields are omitted after a single read', async () => {
    const counts = { value: 0, checked: 0, options: 0, selected: 0 };
    const report: BrowserReadV1 = {
      version: 1,
      text: '',
      elements: [
        {
          ref: 'check',
          role: 'checkbox',
          label: 'Include',
          get value(): undefined {
            counts.value += 1;
            return undefined;
          },
          get checked(): undefined {
            counts.checked += 1;
            return undefined;
          },
          get options(): undefined {
            counts.options += 1;
            return undefined;
          },
        },
        {
          ref: 'list',
          role: 'listbox',
          label: 'Choices',
          options: [
            {
              label: 'One',
              value: 'one',
              get selected(): undefined {
                counts.selected += 1;
                return undefined;
              },
            },
          ],
        },
      ],
      omitted: [],
    };
    const browser = new BrowserToolset(runtimeDriver(report));
    expect(payload(await browser.execute(call(...reads[0]))).result).toEqual({
      version: 1,
      text: '',
      elements: [
        { ref: 'check', role: 'checkbox', label: 'Include' },
        { ref: 'list', role: 'listbox', label: 'Choices', options: [{ label: 'One', value: 'one' }] },
      ],
      omitted: [],
    });
    expect(counts).toEqual({ value: 1, checked: 1, options: 1, selected: 1 });
  });

  test.each(['value', 'checked', 'options', 'selected'])('null %s remains invalid', async (field) => {
    const element =
      field === 'selected'
        ? {
            ref: 'list',
            role: 'listbox',
            label: 'Choices',
            options: [{ label: 'One', value: 'one', selected: null }],
          }
        : { ref: 'check', role: 'checkbox', label: 'Include', [field]: null };
    const browser = new BrowserToolset(
      runtimeDriver({ version: 1, text: '', elements: [element], omitted: [] }),
    );
    await expect(browser.execute(call(...reads[0]))).rejects.toThrow('Browser read report failed.');
  });

  test.each(['elements', 'options', 'omitted'] as const)('rejects missing %s entries', async (field) => {
    const report = readReport();
    const [first] = report.elements;
    if (!first?.options) {
      throw new Error('Expected a seating option');
    }
    const array = { elements: report.elements, options: first.options, omitted: report.omitted }[field];
    delete array[0];
    const browser = new BrowserToolset(runtimeDriver(report));
    await expect(browser.execute(call(...reads[0]))).rejects.toThrow('Browser read report failed.');
  });

  test('retains own non-enumerable read entries and reads each accessor once', async () => {
    const report = readReport();
    const expected = structuredClone(report);
    const [first] = report.elements;
    if (!first?.options) {
      throw new Error('Expected a seating option');
    }
    const accessors = [report.elements, first.options, report.omitted].map((array) => {
      const [firstValue] = array;
      const get = vi.fn(() => firstValue);
      Object.defineProperty(array, 0, { enumerable: false, get });
      return get;
    });
    const browser = new BrowserToolset(runtimeDriver(report));
    expect(
      payload(await browser.execute(call('browser_read_page', { tab_id: null, filter: 'all' }))).result,
    ).toEqual(expected);
    expect(accessors.map((get) => get.mock.calls.length)).toEqual([1, 1, 1]);
  });

  test.each(['scopes', 'changes', 'tabs'] as const)(
    'snapshots own %s entries and rejects missing slots',
    async (field) => {
      const report = { ...readReport(), scopes: [{ ref: 'section', label: 'Orders' }] };
      const observed = {
        ...state(),
        observation: {
          version: 1 as const,
          sequence: 1,
          dropped_changes: 0,
          title_truncated: false,
          changes: [{ type: 'navigation' as const, sequence: 1, tab_id: 'task' }],
        },
      };
      const entries = { scopes: report.scopes, changes: observed.observation.changes, tabs: observed.tabs }[
        field
      ];
      const [first] = entries;
      let entryReads = 0;
      Object.defineProperty(entries, 0, {
        configurable: true,
        enumerable: false,
        get() {
          entryReads += 1;
          return first;
        },
      });
      const driver: BrowserDriver = { state: () => observed, read_page_scoped: () => report };
      const request = call('browser_read_page_scoped', { tab_id: null, root: null, depth: 3, filter: 'all' });
      const browser = new BrowserToolset(driver, { members: ['read_page_scoped'] });
      expect(payload(await browser.execute(request)).ok).toBe(true);
      expect(entryReads).toBe(field === 'scopes' ? 1 : 2);
      delete entries[0];
      await expect(
        new BrowserToolset(driver, { members: ['read_page_scoped'] }).execute(request),
      ).rejects.toThrow();
    },
  );

  test('accepts native-typed completed calls and refuses absent status before a read', async () => {
    const driver = runtimeDriver('Fixture');
    const read = vi.fn(driver.read_page);
    driver.read_page = read;
    const browser = new BrowserToolset(driver);
    const native: ResponseFunctionToolCall = call('browser_read_page', { tab_id: null, filter: 'all' });
    const result = await browser.execute(native);
    expect(result.call_id).toBe(native.call_id);
    expect(read).toHaveBeenCalledTimes(1);

    const incomplete: ResponseFunctionToolCall = { ...native };
    delete incomplete.status;
    await expect(browser.execute(incomplete)).rejects.toThrow('completed registered call');
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('undefined observation is omitted but cannot erase an already established observation', async () => {
    let observationReads = 0;
    const browser = new BrowserToolset(
      runtimeDriver('Fixture', () => ({
        ...state(),
        get observation(): undefined {
          observationReads += 1;
          return undefined;
        },
      })),
    );
    const result = await browser.execute(call('browser_read_page', { tab_id: null, filter: 'all' }));
    expect(payload(result)).toMatchObject({ state: reportedState() });
    expect(observationReads).toBe(2);

    let reports = 0;
    const losing = new BrowserToolset(
      runtimeDriver('Fixture', () => {
        reports += 1;
        return {
          ...state(),
          observation:
            reports === 1
              ? { version: 1, sequence: 0, dropped_changes: 0, title_truncated: false, changes: [] }
              : undefined,
        };
      }),
    );
    await expect(losing.execute(call('browser_read_page', { tab_id: null, filter: 'all' }))).rejects.toThrow(
      'Browser state report failed.',
    );
  });

  test('explicit null observation remains invalid', async () => {
    const browser = new BrowserToolset(
      // @ts-expect-error Public JavaScript driver may supply invalid null.
      runtimeDriver('Fixture', () => ({ ...state(), observation: null })),
    );
    await expect(browser.execute(call('browser_read_page', { tab_id: null, filter: 'all' }))).rejects.toThrow(
      'Browser state report failed.',
    );
  });

  test.each(reads)('snapshots known fields before the final state read for %s', async (name, args) => {
    const report = readReport();
    const expected = structuredClone(report);
    let resume = false;
    let count = 0;
    const browser = new BrowserToolset(
      runtimeDriver(report, async () => {
        count += 1;
        if (count === 2) {
          await vi.waitUntil(() => resume);
        }
        return state();
      }),
    );
    const pending = browser.execute(call(name, args));
    await vi.waitUntil(() => count === 2);
    report.text = 'AFTER_STATE_PRIVATE';
    const [element] = report.elements;
    const option = element?.options?.[0];
    if (!element || !option) {
      throw new Error('Expected a seating option');
    }
    element.ref = 'forged_after_return';
    option.value = 'AFTER_STATE_PRIVATE';
    report.omitted.push('private');
    resume = true;
    expect(payload(await pending)).toEqual({ ok: true, result: expected, state: reportedState() });
  });

  test('does not read or serialize unknown metadata at any depth', async () => {
    const report = readReport();
    const unknown = {
      get() {
        throw new Error('PRIVATE_METADATA');
      },
      enumerable: true,
    };
    const [element] = report.elements;
    const option = element?.options?.[0];
    if (!element || !option) {
      throw new Error('Expected a seating option');
    }
    Object.defineProperty(report, 'raw_page', unknown);
    Object.defineProperty(element, 'record_id', unknown);
    Object.defineProperty(option, 'raw_option', unknown);
    Object.defineProperty(element, 'checked', unknown);
    Object.defineProperty(option, 'selected', unknown);
    const browser = new BrowserToolset(runtimeDriver(report));
    expect(payload(await browser.execute(call(...reads[0]))).result).toEqual(readReport());
  });

  test.each(reads)(
    'new form roles snapshot checked and selected before final state for %s',
    async (name, args) => {
      const report: BrowserReadV1 = {
        version: 1,
        text: '',
        elements: [
          { ref: 'check', role: 'checkbox', label: 'Add receipt', checked: false },
          { ref: 'radio', role: 'radio', label: 'Later', checked: true },
          { ref: 'slider', role: 'slider', label: 'Count', value: '42' },
          {
            ref: 'list',
            role: 'listbox',
            label: 'Teams',
            options: [
              { label: 'One', value: 'one', selected: false },
              { label: 'Two', value: 'two', selected: true },
            ],
          },
        ],
        omitted: [],
      };
      const expected = structuredClone(report);
      let count = 0;
      const browser = new BrowserToolset(
        runtimeDriver(report, () => {
          count += 1;
          if (count === 2) {
            for (const element of report.elements) {
              element.checked = true;
              for (const option of element.options ?? []) {
                option.selected = false;
              }
            }
          }
          return state();
        }),
      );
      expect(payload(await browser.execute(call(name, args))).result).toEqual(expected);
    },
  );

  test.each([
    { ref: 'c', role: 'checkbox', label: 'Check', checked: 'true' },
    { ref: 'r', role: 'radio', label: 'Radio', checked: 0 },
    { ref: 'l', role: 'listbox', label: 'List', options: [{ label: 'One', value: 'one', selected: null }] },
  ])('invalid public form state is fatal before the final state read', async (element) => {
    const current = vi.fn(state);
    const browser = new BrowserToolset(runtimeDriver({ ...readReport(), elements: [element] }, current));
    await expect(browser.execute(call(...reads[0]))).rejects.toThrow('Browser read report failed.');
    expect(current).toHaveBeenCalledTimes(1);
  });

  test('preserves form booleans in reports beyond 64 KiB', async () => {
    const report: BrowserReadV1 = {
      version: 1,
      text: '',
      omitted: [],
      elements: [
        { ref: 'r', role: 'radio', label: 'Choice', checked: true },
        {
          ref: 'l',
          role: 'listbox',
          label: 'List',
          options: [{ label: 'One', value: 'one', selected: false }],
        },
      ],
    };
    const remaining = 65_536 - new TextEncoder().encode(JSON.stringify(report)).length;
    report.text = '\u0000'.repeat(Math.floor(remaining / 6)) + 'x'.repeat(remaining % 6);
    const browser = new BrowserToolset(runtimeDriver(report));
    expect(payload(await browser.execute(call(...reads[0]))).result).toEqual(report);
    report.text += 'x';
    expect(payload(await browser.execute(call(...reads[0]))).result).toEqual(report);
  });

  test.each([
    ['version', () => ({ ...readReport(), version: 2 })],
    ['missing text', () => ({ version: 1, elements: [], omitted: [] })],
    ['unpaired surrogate', () => ({ ...readReport(), text: 'private\uD800' })],
    ['role', () => ({ ...readReport(), elements: [{ ref: 'one', role: 'row', label: 'Seat' }] })],
    ['blank ref', () => ({ ...readReport(), elements: [{ ref: '', role: 'button', label: 'Seat' }] })],
    ['blank label', () => ({ ...readReport(), elements: [{ ref: 'one', role: 'button', label: '' }] })],
    [
      'duplicate ref',
      () => ({
        ...readReport(),
        elements: [
          { ref: 'one', role: 'button', label: 'First' },
          { ref: 'one', role: 'button', label: 'Second' },
        ],
      }),
    ],
    ['repeated omitted code', () => ({ ...readReport(), omitted: ['report_limit', 'report_limit'] })],
    ['unknown omitted code', () => ({ ...readReport(), omitted: ['PRIVATE_METADATA'] })],
  ])(
    'invalid V1 %s stops, without calling final state or returning a normal failure',
    async (_name, make) => {
      const report = vi.fn(state);
      const browser = new BrowserToolset(runtimeDriver(make(), report));
      await expect(browser.execute(call(...reads[0]))).rejects.toThrow('Browser read report failed.');
      expect(report).toHaveBeenCalledTimes(1);
    },
  );

  test('text-only V1 cannot smuggle an actionable target', async () => {
    const browser = new BrowserToolset(runtimeDriver(readReport()));
    await expect(browser.execute(call('browser_get_page_text', { tab_id: null }))).rejects.toThrow(
      'Browser read report failed.',
    );
  });

  test('V1 ignores replacement iterators for elements, options, and omissions', async () => {
    const report = readReport();
    const [element] = report.elements;
    if (!element?.options) {
      throw new Error('Expected seating options');
    }
    const replacement = vi.fn(function* replacedIterator() {
      yield { ref: 'forged', role: 'button', label: 'Private' };
    });
    Object.defineProperty(report.elements, Symbol.iterator, { get: replacement });
    Object.defineProperty(element.options, Symbol.iterator, { get: replacement });
    Object.defineProperty(report.omitted, Symbol.iterator, { get: replacement });
    const browser = new BrowserToolset(runtimeDriver(report));
    const result = payload(await browser.execute(call(...reads[0])));
    expect(result.result).toEqual(readReport());
    expect(replacement).not.toHaveBeenCalled();
  });

  test('an empty text-only elements array cannot issue refs via an iterator', async () => {
    const report = { version: 1, text: 'Read only', elements: [], omitted: [] };
    const readIterator = vi.fn(
      () =>
        function* forgedTargets() {
          yield { ref: 'forged', role: 'button', label: report.text };
        },
    );
    Object.defineProperty(report.elements, Symbol.iterator, { get: readIterator });
    const browser = new BrowserToolset(runtimeDriver(report));
    const result = payload(await browser.execute(call('browser_get_page_text', { tab_id: null })));
    expect(result.result.elements).toEqual([]);
    expect(readIterator).not.toHaveBeenCalled();
  });

  test('element getters cannot extend an admitted array beyond its captured length', async () => {
    const report = readReport();
    const [first] = report.elements;
    Object.defineProperty(report.elements, 0, {
      configurable: true,
      get() {
        for (let index = 1; index < 101; index += 1) {
          report.elements[index] = { ref: String(index), role: 'button', label: 'Extra' };
        }
        return first;
      },
    });
    const browser = new BrowserToolset(runtimeDriver(report));
    const result = payload(await browser.execute(call(...reads[0])));
    expect(result.result.elements).toHaveLength(1);
  });

  test('accepts text-only scalar UTF-8 exactly at the text limit', async () => {
    const report = { version: 1, text: '😀'.repeat(4096), elements: [], omitted: ['text_limit'] };
    const browser = new BrowserToolset(runtimeDriver(report));
    expect(payload(await browser.execute(call('browser_get_page_text', { tab_id: null }))).result).toEqual(
      report,
    );
  });

  test('large escaped text is kept without serializing private fields', async () => {
    const count = 100_000;
    const browser = new BrowserToolset(runtimeDriver(largeReport(count)));
    const good = payload(await browser.execute(call('browser_get_page_text', { tab_id: null })));
    expect(good.result.text).toBe('\u0000'.repeat(count));
    expect('raw_large_page' in good.result).toBe(false);
  });

  test('final state still fails after an otherwise valid report', async () => {
    let count = 0;
    const browser = new BrowserToolset(
      runtimeDriver(readReport(), () => {
        count += 1;
        if (count === 2) {
          throw new BrowserError('PRIVATE_STATE');
        }
        return state();
      }),
    );
    await expect(browser.execute(call(...reads[0]))).rejects.toThrow('Browser state report failed.');
  });

  test('legacy strings and list_tabs remain valid while action objects stop the call', async () => {
    const raw = '{"version":1,"text":"unbounded legacy text","private":"owner responsibility"}';
    const driver: BrowserDriver = {
      ...runtimeDriver(raw),
      screenshot: () => ({ type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'auto' }),
    };
    // Install the untyped object return a legacy JavaScript driver may supply.
    Reflect.set(driver, 'click', () => ({ legacy_result: raw }));
    const browser = new BrowserToolset(driver, { confirm: () => true });
    expect(payload(await browser.execute(call(...reads[0]))).result).toBe(raw);
    expect(payload(await browser.execute(call('browser_list_tabs', {}))).result).toEqual(reportedState());
    await expect(browser.execute(call('browser_click', { tab_id: null, target: 'one' }))).rejects.toThrow(
      'Browser actions must return a string, null, or undefined.',
    );
    const screenshot = await browser.execute(call('browser_screenshot', { tab_id: null }));
    expect(screenshot.output).toContainEqual({
      type: 'input_image',
      image_url: 'data:image/png;base64,AA==',
      detail: 'auto',
    });
  });
});

test.each([false, true])(
  'post-handler abort precedes browser output validation (partial %s)',
  async (partial) => {
    const controller = new AbortController();
    const reason = new Error('synthetic cancellation');
    const stages: { stage: string; reason: string }[] = [];
    const driver = runtimeDriver(readReport());
    driver.read_page = () => {
      controller.abort(reason);
      const result: unknown = partial ? null : readReport();
      // SAFETY: simulate an untyped driver's invalid partial result at its runtime boundary.
      return result as BrowserReadV1;
    };
    const browser = new BrowserToolset(driver, {
      additionalMembers: ['read_page'],
      onDiagnostic: (event) => stages.push(event),
    });
    await expect(
      browser.execute(call('browser_read_page', { tab_id: null, filter: 'all' }), {
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    // oxlint-disable-next-line prefer-at -- Array.at is not in the SDK target library.
    expect(stages[stages.length - 1]).toMatchObject({ stage: 'action', reason: 'cancelled' });
    expect(stages.some((event) => event.reason === 'completed' || event.reason === 'invalid_output')).toBe(
      false,
    );
  },
);

test.each(['access_token', 'sig', 'Signature', 'X-Goog-Signature', 'X-Goog-Credential'])(
  'legacy tab URL removes %s and userinfo in both approval and model output',
  async (key) => {
    const seen: string[] = [];
    const browser = new BrowserToolset(
      {
        state: () => ({
          tabs: [
            {
              id: 'task',
              title: 'Fixture',
              url: `https://user:synthetic-password@fixture.invalid/path?q=1&${key}=synthetic-query#id_token=synthetic-fragment`,
              active: true,
            },
          ],
        }),
        click: () => {},
      },
      {
        confirm: (context) => {
          seen.push(context.state.tabs[0]?.url ?? '');
          return true;
        },
      },
    );
    const output = await browser.execute(call('browser_click', { tab_id: 'task', target: 'button' }));
    const projected = payload(output);
    expect(seen).toEqual(['https://fixture.invalid']);
    expect(projected.state.tabs[0].url).toBe(seen[0]);
    expect(JSON.stringify({ seen, projected })).not.toMatch(/synthetic-(?:password|query|fragment)/u);
  },
);

test.each([
  ['https://fixture.invalid/orders/42?view=details', 'https://fixture.invalid'],
  ['https://fixture.invalid:8443/orders/42', 'https://fixture.invalid:8443'],
  [`https://fixture.invalid/${'a'.repeat(20_000)}`, 'https://fixture.invalid'],
  ['about:blank', 'about:blank'],
  ['data:text/plain,local-fixture', 'data:'],
])('legacy URL projection preserves context without paths: %s', async (url, expected) => {
  const browser = new BrowserToolset({
    state: () => ({ tabs: [{ id: 'task', title: 'Fixture', url, active: true }] }),
  });
  const output = await browser.execute(call('browser_list_tabs', {}));
  expect(payload(output).state.tabs).toEqual([{ id: 'task', title: 'Fixture', url: expected, active: true }]);
  const repeated = new BrowserToolset({
    state: () => ({ tabs: [{ id: 'task', title: 'Fixture', url: expected, active: true }] }),
  });
  expect(payload(await repeated.execute(call('browser_list_tabs', {}))).state).toEqual(payload(output).state);
});

test.each([2047, 2048])('legacy URL limits apply to the projected value: %s', async (length) => {
  const browser = new BrowserToolset({
    state: () => ({
      tabs: [{ id: 'task', title: 'Fixture', url: `${'x'.repeat(length)}:private`, active: true }],
    }),
  });
  const result = browser.execute(call('browser_list_tabs', {}));
  if (length === 2047) {
    expect(payload(await result).state.tabs[0].url).toHaveLength(2048);
  } else {
    await expect(result).rejects.toThrow('Browser state report failed.');
  }
});

test.each(['path', 'query', 'fragment', 'userinfo', 'origin'] as const)(
  'observed URL bounds apply after removing a long %s',
  async (part) => {
    const privateValue = 'x'.repeat(100_000);
    const url = {
      path: `https://fixture.invalid/${privateValue}`,
      query: `https://fixture.invalid/?token=${privateValue}`,
      fragment: `https://fixture.invalid/#${privateValue}`,
      userinfo: `https://user:${privateValue}@fixture.invalid/`,
      origin: `https://${'a.'.repeat(1024)}example/`,
    }[part];
    const seen: string[] = [];
    const browser = new BrowserToolset(
      {
        state: () => ({
          tabs: [{ id: 'task', title: 'Fixture', url, active: true }],
          observation: { version: 1, sequence: 0, dropped_changes: 0, title_truncated: false, changes: [] },
        }),
        click: () => {},
      },
      {
        confirm: (context) => {
          seen.push(context.state.tabs[0]?.url ?? '');
          return true;
        },
      },
    );
    const execution = browser.execute(call('browser_click', { tab_id: 'task', target: 'button' }));
    if (part === 'origin') {
      await expect(execution).rejects.toThrow('Browser state report failed.');
      expect(seen).toEqual([]);
      return;
    }
    const result = payload(await execution);
    expect(seen).toEqual(['https://fixture.invalid']);
    expect(result.state.tabs[0].url).toBe('https://fixture.invalid');
  },
);

test('advertised scroll and zoom integer bounds match their valid runtime range', async () => {
  const scroll = vi.fn();
  const zoom = vi.fn(() => ({ type: 'input_image' as const, file_id: 'fixture' }));
  const browser = new BrowserToolset({ state, scroll, zoom }, { confirm: () => true });
  const tools = browser.tools();
  expect(tools.find((v) => v.name === 'browser_scroll')?.parameters).toMatchObject({
    properties: { amount: { minimum: 0, maximum: Number.MAX_SAFE_INTEGER } },
  });
  expect(tools.find((v) => v.name === 'browser_zoom')?.parameters).toMatchObject({
    properties: { region: { items: { minimum: 0, maximum: Number.MAX_SAFE_INTEGER } } },
  });
  await browser.execute(
    call('browser_scroll', { tab_id: null, direction: 'down', amount: Number.MAX_SAFE_INTEGER }),
  );
  await browser.execute(
    call('browser_scroll', { tab_id: null, direction: 'down', amount: Number.MAX_SAFE_INTEGER + 1 }),
  );
  await browser.execute(call('browser_zoom', { tab_id: null, region: [0, 0, Number.MAX_SAFE_INTEGER, 1] }));
  await browser.execute(
    call('browser_zoom', { tab_id: null, region: [0, 0, Number.MAX_SAFE_INTEGER + 1, 1] }),
  );
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(zoom).toHaveBeenCalledTimes(1);
});

test('browser observation length is captured before projection', async () => {
  const browser = new BrowserToolset(
    runtimeDriver('Fixture', () => {
      let lengthReads = 0;
      const changes = new Proxy([], {
        get(target, key, receiver) {
          if (key === 'length') {
            lengthReads += 1;
            return lengthReads < 3 ? 0 : 40;
          }
          if (typeof key === 'string' && /^\d+$/u.test(key)) {
            return { type: 'navigation', tab_id: 'task', sequence: Number(key) + 1 };
          }
          // oxlint-disable-next-line anti-slop/no-reflect-get -- Delegate unrelated proxy fields to the real native array.
          return Reflect.get(target, key, receiver);
        },
      });
      return {
        ...state(),
        observation: { version: 1, sequence: 0, dropped_changes: 0, title_truncated: false, changes },
      };
    }),
  );
  const result = await browser.execute(call('browser_read_page', { tab_id: null, filter: 'all' }));
  expect(payload(result).state.observation).toMatchObject({ sequence: 0, changes: [] });
});

test('a negative observation length cannot cancel a dropped change', async () => {
  const changes = new Proxy([], {
    get(target, key) {
      if (key === 'length') {
        return -1;
      }
      // oxlint-disable-next-line anti-slop/no-reflect-get -- Delegate unrelated fields to the native array.
      return Reflect.get(target, key);
    },
  });
  const browser = new BrowserToolset(
    runtimeDriver('Fixture', () => ({
      ...state(),
      observation: { version: 1, sequence: 0, dropped_changes: 1, title_truncated: false, changes },
    })),
  );
  await expect(browser.execute(call('browser_read_page', { tab_id: null, filter: 'all' }))).rejects.toThrow(
    'Browser state report failed.',
  );
});
