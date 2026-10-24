// BrowserError belongs beside the single public helper that consumes it.
// oxlint-disable max-classes-per-file
import { OpenAIError } from '../error';
import { hasOwn, isObj } from '../internal/utils/values';
import { diagnosticFailure, reportDiagnostic } from '../internal/runner-diagnostics';
import { configuredOption, protectRunnerJSON, RunnerLifecycle } from '../internal/runner-lifecycle';
import { toResponseInputItems } from '../lib/responses/ResponseInputItems';
import type { RunnerDiagnosticObserver } from '../internal/runner-diagnostics';

import type {
  FunctionTool,
  ResponseFunctionToolCall,
  ResponseInputImageContent,
  ResponseInputItem,
} from '../resources/responses/responses';

export type { RunnerDiagnostic, RunnerDiagnosticObserver } from '../internal/runner-diagnostics';

const fields = {
  text: { type: 'string' },
  optionalText: { type: ['string', 'null'] },
  strings: { type: 'array', items: { type: 'string' } },
  filter: { type: 'string', enum: ['all', 'interactive'] },
  direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
  amount: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  timeout: { type: 'integer', minimum: 1, maximum: 30_000 },
  region: {
    type: 'array',
    items: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    minItems: 4,
    maxItems: 4,
  },
  coordinate: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  checked: { type: 'boolean' },
  button: { type: 'string', enum: ['left', 'right', 'middle'] },
  clickCount: { type: 'integer', enum: [1, 2, 3] },
  modifiers: {
    type: 'array',
    items: { type: 'string', enum: ['Control', 'Alt', 'Meta', 'Shift'] },
    minItems: 0,
    maxItems: 4,
    description: 'Unique modifier keys held for this operation.',
  },
  path: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        x: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        y: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      },
      required: ['x', 'y'],
      additionalProperties: false,
    },
    minItems: 2,
    maxItems: 100,
  },
  heldKeys: {
    type: 'array',
    items: { type: 'string', description: 'Nonempty driver-supported key, at most 64 UTF-8 bytes.' },
    minItems: 1,
    maxItems: 8,
    description: 'Unique driver-supported keys held for this operation.',
  },
  holdDuration: { type: 'integer', minimum: 1, maximum: 3000 },
  scope: {
    type: ['string', 'null'],
    description: 'Null or a nonempty driver-issued scope ref, at most 256 UTF-8 bytes. Never a selector.',
  },
  depth: { type: 'integer', minimum: 1, maximum: 32 },
  diagnosticSource: { type: 'string', enum: ['console', 'network'] },
  diagnosticLimit: { type: 'integer', minimum: 1, maximum: 100 },
  script: { type: 'string', description: 'Nonempty page script containing valid Unicode.' },
  fileGrant: { type: 'string', description: 'Nonempty caller-issued file grant, at most 256 UTF-8 bytes.' },
  visibleText: {
    type: 'string',
    description: 'Nonempty visible text, at most 256 UTF-8 bytes after whitespace normalization.',
  },
} as const;
type Field = keyof typeof fields;
type FieldValue<F extends Field> = {
  text: string;
  optionalText: string | null;
  strings: string[];
  filter: 'all' | 'interactive';
  direction: 'up' | 'down' | 'left' | 'right';
  amount: number;
  timeout: number;
  region: [number, number, number, number];
  visibleText: string;
  coordinate: number;
  checked: boolean;
  button: 'left' | 'right' | 'middle';
  clickCount: 1 | 2 | 3;
  modifiers: ('Control' | 'Alt' | 'Meta' | 'Shift')[];
  path: { x: number; y: number }[];
  heldKeys: string[];
  holdDuration: number;
  scope: string | null;
  depth: number;
  diagnosticSource: 'console' | 'network';
  diagnosticLimit: number;
  script: string;
  fileGrant: string;
}[F];

const members = {
  navigate: {
    description: 'Navigate a tab to a URL.',
    changes: true,
    args: { url: 'text', tab_id: 'optionalText' },
  },
  read_page: {
    description: 'Read page structure and opaque interactive element refs.',
    changes: false,
    args: { tab_id: 'optionalText', filter: 'filter' },
  },
  read_page_scoped: {
    description:
      'Read within an observed section, or discover sections with a null root. Depth counts DOM levels.',
    changes: false,
    optIn: true,
    args: { tab_id: 'optionalText', root: 'scope', depth: 'depth', filter: 'filter' },
  },
  read_diagnostics: {
    description: 'Read a bounded, driver-filtered console or network summary. Requires approval.',
    changes: false,
    sensitive: true,
    optIn: true,
    args: { tab_id: 'optionalText', source: 'diagnosticSource', limit: 'diagnosticLimit' },
  },
  run_script: {
    description: 'Run an approved script in an explicitly allowed page. Returns text.',
    changes: true,
    optIn: true,
    args: { tab_id: 'optionalText', source: 'script', timeout_ms: 'timeout' },
  },
  upload_file: {
    description:
      'Upload a caller-approved file using its task-scoped grant. Requires separate file approval.',
    changes: true,
    optIn: true,
    args: { grant_id: 'fileGrant' },
  },
  download_file: {
    description:
      'Retrieve a caller-approved file using its task-scoped grant. Requires separate file approval.',
    changes: true,
    optIn: true,
    args: { grant_id: 'fileGrant' },
  },
  get_page_text: { description: 'Read visible page text.', changes: false, args: { tab_id: 'optionalText' } },
  find: {
    description: 'Find page elements by text or description.',
    changes: false,
    args: { query: 'text', tab_id: 'optionalText' },
  },
  click: {
    description: 'Click an element by its opaque ref.',
    changes: true,
    args: { target: 'text', tab_id: 'optionalText' },
  },
  click_at: {
    description: 'Click full-viewport CSS coordinates with a button, click count, and held modifiers.',
    changes: true,
    optIn: true,
    args: {
      tab_id: 'optionalText',
      x: 'coordinate',
      y: 'coordinate',
      button: 'button',
      click_count: 'clickCount',
      keys: 'modifiers',
    },
  },
  drag_path: {
    description: 'Drag the left button through 2 to 100 full-viewport CSS points with held modifiers.',
    changes: true,
    optIn: true,
    args: { tab_id: 'optionalText', path: 'path', keys: 'modifiers' },
  },
  hold_keys: {
    description: 'Hold driver-supported keys for at most 3000 milliseconds, then release them.',
    changes: true,
    optIn: true,
    args: { tab_id: 'optionalText', keys: 'heldKeys', duration_ms: 'holdDuration' },
  },
  type: {
    description: 'Fill a referenced control or type at the current focus.',
    changes: true,
    args: { text: 'text', target: 'optionalText', tab_id: 'optionalText' },
  },
  key: {
    description: 'Press a key combination.',
    changes: true,
    args: { keys: 'strings', tab_id: 'optionalText' },
  },
  scroll: {
    description: 'Scroll the page in the given direction.',
    changes: true,
    args: { direction: 'direction', amount: 'amount', tab_id: 'optionalText' },
  },
  scroll_to: {
    description: 'Scroll an already observed target into view. Read again before acting.',
    changes: true,
    args: { target: 'text', tab_id: 'optionalText' },
  },
  wait_for: {
    description: 'Wait for reported visible text, within a bounded timeout in milliseconds.',
    changes: false,
    args: { text: 'visibleText', timeout_ms: 'timeout', tab_id: 'optionalText' },
  },
  select_option: {
    description: 'Select values in a referenced select control.',
    changes: true,
    args: { target: 'text', values: 'strings', tab_id: 'optionalText' },
  },
  hover: {
    description: 'Hover over a referenced element.',
    changes: true,
    args: { target: 'text', tab_id: 'optionalText' },
  },
  hover_at: {
    description: 'Move the pointer to full-viewport CSS coordinates without pressing a button.',
    changes: true,
    optIn: true,
    args: { tab_id: 'optionalText', x: 'coordinate', y: 'coordinate' },
  },
  set_checked: {
    description:
      'Set an observed checkbox to the requested state. Repeating the same value does not toggle it.',
    changes: true,
    optIn: true,
    args: { tab_id: 'optionalText', target: 'text', checked: 'checked' },
  },
  screenshot: {
    description: 'Capture the visible tab as an image.',
    changes: false,
    args: { tab_id: 'optionalText' },
  },
  zoom: {
    description: 'Capture a region [x0,y0,x1,y1]. Subsequent coordinates stay in the full viewport.',
    changes: false,
    args: { tab_id: 'optionalText', region: 'region' },
  },
  new_tab: { description: 'Open a tab, optionally at a URL.', changes: true, args: { url: 'optionalText' } },
  list_tabs: { description: 'List tabs, titles, URLs and active tab.', changes: false, args: {} },
  switch_tab: { description: 'Activate a tab.', changes: true, args: { tab_id: 'text' } },
  close_tab: { description: 'Close a tab.', changes: true, args: { tab_id: 'text' } },
} as const;

/** Fixed browser method names. Only methods implemented by the driver are advertised. */
export type BrowserMember = keyof typeof members;
/** Fixed member names, including opt-ins. This list never reads a driver. */
export const BROWSER_MEMBERS: readonly BrowserMember[] = Object.freeze(
  // SAFETY: Keys come from the fixed schema table rather than driver or model data.
  Object.keys(members) as BrowserMember[],
);
/** Standard members. A partial driver advertises only the members it implements. */
export const DEFAULT_BROWSER_MEMBERS: readonly BrowserMember[] = Object.freeze(
  BROWSER_MEMBERS.filter((member) => !hasOwn(members[member], 'optIn')),
);
/** Validated wire arguments for a browser member. Optional IDs use explicit null. */
export type BrowserArguments<M extends BrowserMember> = {
  [K in keyof (typeof members)[M]['args']]: FieldValue<Extract<(typeof members)[M]['args'][K], Field>>;
};

/** Current tabs as observed by the driver after each operation. */
export interface BrowserState {
  /** Stable driver-owned IDs and an accurate indication of the active tab. */
  tabs: {
    /** Opaque ID accepted by tab operations. */
    id: string;
    /** Page title, with browser-owned credentials excluded. */
    title: string;
    /** Current page URL, with browser-owned credentials excluded. */
    url: string;
    /** True only for the active tab. */
    active: boolean;
  }[];
  /** Optional bounded observation. Drivers own event history and title filtering. */
  observation?: BrowserObservationV1 | undefined;
}

/** Driver-owned, non-consuming bounded observation. URL displays contain origins only. */
export interface BrowserObservationV1 {
  version: 1;
  sequence: number;
  dropped_changes: number;
  title_truncated: boolean;
  changes: BrowserStateChange[];
}

/** Notices never contain raw URLs, dialog text, download names, or private metadata. */
export type BrowserStateChange =
  | { type: 'tab_opened' | 'tab_closed' | 'tab_switched' | 'navigation'; sequence: number; tab_id: string }
  | { type: 'navigation_refused'; sequence: number; tab_id: string | null; reason: 'policy' | 'unsupported' }
  | {
      type: 'dialog_dismissed';
      sequence: number;
      tab_id: string;
      kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload' | 'other';
    }
  | {
      type: 'download';
      sequence: number;
      tab_id: string | null;
      status: 'blocked' | 'started' | 'completed' | 'failed';
    };

const readOmissions = [
  'report_limit',
  'text_limit',
  'target_limit',
  'work_limit',
  'frame_limit',
  'unsupported_root',
  'unsupported_control',
  'remote_action',
  'private',
  'value',
  'name_limit',
] as const;

/** Public, driver-approved option text and value, never raw element metadata. */
export interface BrowserReadOption {
  label: string;
  value: string;
  /** Only published for listbox choices when the driver authorizes reading the current selection. */
  selected?: boolean | undefined;
}

/** A driver-owned actionable reference to a bounded, privacy-filtered control. */
export interface BrowserReadElement {
  ref: string;
  role: 'button' | 'textbox' | 'combobox' | 'checkbox' | 'radio' | 'slider' | 'listbox';
  label: string;
  value?: string | undefined;
  options?: BrowserReadOption[] | undefined;
  /** Only published for checkbox/radio controls when the driver authorizes reading their state. */
  checked?: boolean | undefined;
}

/** Optional bounded result for read_page, find, and get_page_text.
 * Drivers own DOM visibility, field privacy, and reference validity.
 * get_page_text must return no elements.
 */
export interface BrowserReadV1 {
  version: 1;
  text: string;
  elements: BrowserReadElement[];
  omitted: (typeof readOmissions)[number][];
}

/** A diagnostic report contains text and omissions, without actionable elements. */
export interface BrowserTextReadV1 extends BrowserReadV1 {
  elements: never[];
}

/** A bounded section read. Scope refs select subsequent reads and cannot authorize element actions. */
export interface BrowserScopedReadV1 extends BrowserReadV1 {
  scopes: { ref: string; label: string }[];
}

/** A terminal file result for this call. It does not confirm a later business action. */
export type BrowserFileOutcome = {
  version: 1;
  cleanup: 'not_started' | 'pending' | 'completed';
} & (
  | { status: 'completed'; effect: 'completed' }
  | { status: 'refused'; effect: 'none' }
  | { status: 'unknown'; effect: 'unknown' }
  | { status: 'interrupted'; effect: 'none' | 'unknown' }
);

// Side-effect-only drivers may omit a return, including async methods returning Promise<void>.
// oxlint-disable no-invalid-void-type
/** A run_script result must be a string containing valid Unicode. */
export type BrowserResult<M extends BrowserMember> = M extends 'screenshot' | 'zoom'
  ? ResponseInputImageContent
  : M extends 'list_tabs'
    ? BrowserState
    : M extends 'read_page_scoped'
      ? BrowserScopedReadV1
      : M extends 'read_diagnostics'
        ? BrowserTextReadV1
        : M extends 'run_script'
          ? string
          : M extends 'upload_file' | 'download_file'
            ? BrowserFileOutcome
            : M extends 'read_page' | 'get_page_text' | 'find'
              ? string | BrowserReadV1 | null | void
              : string | void;
// oxlint-enable no-invalid-void-type

/** An isolated, caller-owned browser. Implement only the capabilities you want exposed. */
export type BrowserDriver = {
  /** Report current browser state, including after a refused or failed call. Failure stops the runner. */
  state: (options?: { signal: AbortSignal | undefined }) => BrowserState | Promise<BrowserState>;
} & {
  /** Cancellation-aware methods must release held input before returning or throwing. */
  [M in Exclude<BrowserMember, 'list_tabs'>]?: (
    args: BrowserArguments<M>,
    options: { signal: AbortSignal | undefined },
  ) => BrowserResult<M> | Promise<BrowserResult<M>>;
};

/** State and validated action passed to consent callbacks, detached from execution. */
export type BrowserConfirmContext = {
  [M in BrowserMember]: {
    /** Selected fixed browser member. */
    readonly member: M;
    /** Fields validated against the advertised function schema. */
    readonly arguments: Readonly<BrowserArguments<M>> & Readonly<Record<string, unknown>>;
    /**
     * Prior observation, not a lock on the document or focused control.
     * Document-specific consent requires the driver to bind and check the original target at execution.
     * Contains no caller-owned browser credentials.
     */
    readonly state: BrowserState;
    /** Identity of this proposed call, for local consent records. */
    readonly call_id: string;
  };
}[BrowserMember];

/** Read members that an application can require consent for before any driver state is observed. */
export type BrowserReadMember = {
  [M in BrowserMember]: (typeof members)[M]['changes'] extends false ? M : never;
}[BrowserMember];

/** No state has been read yet. An application can consult its own policy using the call and tab IDs. */
export type BrowserReadConfirmContext = {
  [M in BrowserReadMember]: {
    readonly phase: 'before_read';
    readonly member: M;
    readonly arguments: Readonly<BrowserArguments<M>> & Readonly<Record<string, unknown>>;
    readonly call_id: string;
    readonly state: null;
  };
}[BrowserReadMember];

/** Browser consent and navigation policy. Callbacks receive detached validated arguments. */
export interface BrowserOptions {
  /** Fixed member allowlist. Omit to expose implemented standard members and list_tabs, without opt-ins. */
  members?: readonly BrowserMember[];
  /** Enable additional members without reconstructing defaults. Cannot be combined with members. */
  additionalMembers?: readonly BrowserMember[];
  /** Required for state changes and selected sensitive reads. Only exactly true authorizes a call. */
  confirm?: (
    context: BrowserConfirmContext,
    execution: { signal: AbortSignal | undefined },
  ) => boolean | Promise<boolean>;
  /** Required for navigation and new tabs. This does not replace browser-level request interception. */
  urlPolicy?: (
    context: BrowserConfirmContext,
    url: string,
    execution: { signal: AbortSignal | undefined },
  ) => boolean | Promise<boolean>;
  /** Local timings and reason codes. No page content or error messages are included. */
  onDiagnostic?: RunnerDiagnosticObserver;
}

/** Explicitly gated reads use the existing confirm callback before the first driver state read. */
export interface BrowserReadOptions extends Omit<BrowserOptions, 'confirm'> {
  confirmReads: readonly BrowserReadMember[];
  confirm: (
    context: BrowserConfirmContext | BrowserReadConfirmContext,
    execution: { signal: AbortSignal | undefined },
  ) => boolean | Promise<boolean>;
}

/** An intentional, user-safe driver error. Only this message may be sent back to the model. */
export class BrowserError extends OpenAIError {
  /** Stable error type for controlled driver failures. */
  override name = 'BrowserError';
}

function boundedStateText(value: string, limit: number, allowEmpty: boolean): boolean {
  return (
    (allowEmpty || value.length > 0) &&
    !/[\uD800-\uDFFF]/u.test(value) &&
    (limit === Number.POSITIVE_INFINITY || new TextEncoder().encode(value).length <= limit)
  );
}

function stateCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

const valid: Record<Field, (value: unknown) => boolean> = {
  text: (value) => typeof value === 'string',
  optionalText: (value) => value === null || typeof value === 'string',
  strings: (value) => Array.isArray(value) && value.every((part) => typeof part === 'string'),
  filter: (value) => value === 'all' || value === 'interactive',
  direction: (value) => typeof value === 'string' && ['up', 'down', 'left', 'right'].includes(value),
  amount: (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
  timeout: (value) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 30_000,
  region: (value) =>
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((point) => typeof point === 'number' && Number.isSafeInteger(point) && point >= 0) &&
    value[0] < value[2] &&
    value[1] < value[3],
  visibleText: (value) =>
    // oxlint-disable-next-line unicorn/prefer-string-replace-all -- Public SDK source targets ES2020.
    typeof value === 'string' && boundedStateText(value.replace(/\s+/gu, ' ').trim(), 256, false),
  coordinate: stateCounter,
  checked: (value) => typeof value === 'boolean',
  button: (value) => value === 'left' || value === 'right' || value === 'middle',
  clickCount: (value) => value === 1 || value === 2 || value === 3,
  modifiers: (value) =>
    Array.isArray(value) &&
    value.length <= 4 &&
    new Set(value).size === value.length &&
    value.every((key) => ['Control', 'Alt', 'Meta', 'Shift'].includes(key)),
  path: (value) =>
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 100 &&
    value.every(
      (point: unknown) =>
        isObj(point) &&
        Object.keys(point).length === 2 &&
        hasOwn(point, 'x') &&
        hasOwn(point, 'y') &&
        stateCounter(point['x']) &&
        stateCounter(point['y']),
    ),
  heldKeys: (value) =>
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 8 &&
    new Set(value).size === value.length &&
    value.every((key) => typeof key === 'string' && boundedStateText(key, 64, false)),
  holdDuration: (value) => stateCounter(value) && value >= 1 && value <= 3000,
  scope: (value) => value === null || (typeof value === 'string' && boundedStateText(value, 256, false)),
  depth: (value) => stateCounter(value) && value >= 1 && value <= 32,
  diagnosticSource: (value) => value === 'console' || value === 'network',
  diagnosticLimit: (value) => stateCounter(value) && value >= 1 && value <= 100,
  script: (value) => typeof value === 'string' && boundedStateText(value, Number.POSITIVE_INFINITY, false),
  fileGrant: (value) => typeof value === 'string' && boundedStateText(value, 256, false),
};

function validateArguments(member: BrowserMember, value: unknown): asserts value is Record<string, unknown> {
  const spec: Record<string, Field> = members[member].args;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BrowserError('Browser arguments must be an object.');
  }
  const supplied = Object.entries(value);
  const expected = Object.keys(spec);
  if (supplied.length !== expected.length || supplied.some(([key]) => !expected.includes(key))) {
    throw new BrowserError('Browser arguments contain missing or unknown fields.');
  }
  for (const [key, val] of supplied) {
    const field = spec[key];
    if (!field || !valid[field](val)) {
      throw new BrowserError('Invalid browser argument value.');
    }
  }
}

// A selected name fixes its validated argument/result relationship before dispatch.
type BrowserHandler = (
  args: Record<string, unknown>,
  options?: { signal: AbortSignal | undefined },
) => BrowserResult<BrowserMember> | Promise<BrowserResult<BrowserMember>>;

function readText(value: unknown, limit: number, allowEmpty: boolean): string {
  if (typeof value !== 'string' || value.length > limit || !boundedStateText(value, limit, allowEmpty)) {
    throw new TypeError('Invalid browser read text.');
  }
  return value;
}

function snapshotImageBreakpoint(value: unknown): ResponseInputImageContent['prompt_cache_breakpoint'] {
  if (value === undefined || value === null) {
    return value;
  }
  if (!isObj(value) || Object.keys(value).some((key) => key !== 'mode' && key !== 'ttl')) {
    throw new TypeError('Invalid browser image breakpoint.');
  }
  const mode = configuredOption(value, 'mode');
  const ttl = configuredOption(value, 'ttl');
  if (mode !== 'explicit' || (ttl !== undefined && ttl !== '30m' && ttl !== '12h')) {
    throw new TypeError('Invalid browser image breakpoint.');
  }
  return { mode, ...(ttl === undefined ? {} : { ttl }) };
}

function validImageSource(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || (typeof value === 'string' && !!value.trim());
}

function validImageDetail(value: unknown): value is ResponseInputImageContent['detail'] {
  return (
    value === undefined ||
    value === null ||
    value === 'auto' ||
    value === 'low' ||
    value === 'high' ||
    value === 'original'
  );
}

function snapshotImage(value: unknown, member: 'screenshot' | 'zoom'): ResponseInputImageContent {
  try {
    if (!isObj(value)) {
      throw new TypeError('Invalid browser image.');
    }
    const keys = Object.keys(value);
    if (
      keys.some((key) => !['type', 'detail', 'image_url', 'file_id', 'prompt_cache_breakpoint'].includes(key))
    ) {
      throw new TypeError('Invalid browser image.');
    }
    const type = configuredOption(value, 'type');
    const detail = configuredOption(value, 'detail');
    const image_url = configuredOption(value, 'image_url');
    const file_id = configuredOption(value, 'file_id');
    const prompt_cache_breakpoint = snapshotImageBreakpoint(
      configuredOption(value, 'prompt_cache_breakpoint'),
    );
    if (
      type !== 'input_image' ||
      !validImageDetail(detail) ||
      !validImageSource(image_url) ||
      !validImageSource(file_id) ||
      (typeof image_url !== 'string' && typeof file_id !== 'string')
    ) {
      throw new TypeError('Invalid browser image.');
    }
    return {
      type,
      ...(detail === undefined ? {} : { detail }),
      ...(image_url === undefined ? {} : { image_url }),
      ...(file_id === undefined ? {} : { file_id }),
      ...(prompt_cache_breakpoint === undefined ? {} : { prompt_cache_breakpoint }),
    };
  } catch {
    throw new OpenAIError(
      `Browser ${member} must return an input_image with at least one valid image_url or file_id.`,
    );
  }
}

function requireOwnArrayEntry(array: readonly unknown[], index: number): void {
  if (!hasOwn(array, index)) {
    throw new TypeError('Invalid browser array entry.');
  }
}

function optionalReadBoolean(
  source: Record<string, unknown>,
  key: 'checked' | 'selected',
): boolean | undefined {
  const value = configuredOption(source, key);
  if (value === undefined || typeof value === 'boolean') {
    return value;
  }
  throw new TypeError('Invalid browser read boolean.');
}

function browserRead(value: unknown, textOnly: boolean): BrowserReadV1 {
  try {
    if (!isObj(value)) {
      throw new TypeError('Invalid browser read.');
    }
    const version = configuredOption(value, 'version');
    const text = configuredOption(value, 'text');
    const elements = configuredOption(value, 'elements');
    const omitted = configuredOption(value, 'omitted');
    if (version !== 1 || !Array.isArray(elements) || !Array.isArray(omitted)) {
      throw new TypeError('Invalid browser read.');
    }
    // Fix each V1 array's bounds once. Driver iterators and getters must not
    // add targets or private metadata after their declared limits were checked.
    const elementCount = elements.length;
    const omittedCount = omitted.length;
    if (
      !stateCounter(elementCount) ||
      (textOnly && elementCount !== 0) ||
      !stateCounter(omittedCount) ||
      omittedCount > readOmissions.length
    ) {
      throw new TypeError('Invalid browser read.');
    }
    const projected: BrowserReadV1 = {
      version: 1,
      text: readText(text, Number.POSITIVE_INFINITY, true),
      elements: Array.from({ length: elementCount }, (_, index): BrowserReadElement => {
        requireOwnArrayEntry(elements, index);
        const item: unknown = elements[index];
        if (!isObj(item)) {
          throw new TypeError('Invalid browser read element.');
        }
        const role = configuredOption(item, 'role');
        if (
          role !== 'button' &&
          role !== 'textbox' &&
          role !== 'combobox' &&
          role !== 'checkbox' &&
          role !== 'radio' &&
          role !== 'slider' &&
          role !== 'listbox'
        ) {
          throw new TypeError('Invalid browser read role.');
        }
        const entry: BrowserReadElement = {
          ref: readText(configuredOption(item, 'ref'), 256, false),
          role,
          label: readText(configuredOption(item, 'label'), 256, false),
        };
        const fieldValue = configuredOption(item, 'value');
        if (fieldValue !== undefined) {
          entry.value = readText(fieldValue, 512, true);
        }
        if (role === 'checkbox' || role === 'radio') {
          const checked = optionalReadBoolean(item, 'checked');
          if (checked !== undefined) {
            entry.checked = checked;
          }
        }
        const options = configuredOption(item, 'options');
        if (options !== undefined) {
          if (!Array.isArray(options)) {
            throw new TypeError('Invalid browser read options.');
          }
          const optionCount = options.length;
          if (!stateCounter(optionCount)) {
            throw new TypeError('Invalid browser read options.');
          }
          entry.options = Array.from({ length: optionCount }, (_option, optionIndex): BrowserReadOption => {
            requireOwnArrayEntry(options, optionIndex);
            const option: unknown = options[optionIndex];
            if (!isObj(option)) {
              throw new TypeError('Invalid browser read option.');
            }
            const choice: BrowserReadOption = {
              label: readText(configuredOption(option, 'label'), 256, false),
              value: readText(configuredOption(option, 'value'), 512, true),
            };
            if (role === 'listbox') {
              const selected = optionalReadBoolean(option, 'selected');
              if (selected !== undefined) {
                choice.selected = selected;
              }
            }
            return choice;
          });
        }
        return entry;
      }),
      omitted: Array.from({ length: omittedCount }, (_, index): BrowserReadV1['omitted'][number] => {
        requireOwnArrayEntry(omitted, index);
        const code: unknown = omitted[index];
        const matched = readOmissions.find((known) => known === code);
        if (matched === undefined) {
          throw new TypeError('Invalid browser read omission.');
        }
        return matched;
      }),
    };
    if (
      new Set(projected.elements.map((entry) => entry.ref)).size !== projected.elements.length ||
      new Set(projected.omitted).size !== projected.omitted.length
    ) {
      throw new TypeError('Invalid browser read.');
    }
    return projected;
  } catch {
    throw new OpenAIError('Browser read report failed.');
  }
}

function scopedRead(value: unknown): BrowserScopedReadV1 {
  try {
    if (!isObj(value)) {
      throw new TypeError('Invalid browser scopes.');
    }
    const source = configuredOption(value, 'scopes');
    if (!Array.isArray(source)) {
      throw new TypeError('Invalid browser scopes.');
    }
    const count = source.length;
    if (!stateCounter(count)) {
      throw new TypeError('Invalid browser scopes.');
    }
    const report = browserRead(value, false);
    const scopes = Array.from({ length: count }, (_, index) => {
      requireOwnArrayEntry(source, index);
      const scope: unknown = source[index];
      if (!isObj(scope)) {
        throw new TypeError('Invalid browser scope.');
      }
      return {
        ref: readText(configuredOption(scope, 'ref'), 256, false),
        label: readText(configuredOption(scope, 'label'), 256, false),
      };
    });
    const refs = [...report.elements.map((element) => element.ref), ...scopes.map((scope) => scope.ref)];
    const projected = { ...report, scopes };
    if (new Set(refs).size !== refs.length) {
      throw new TypeError('Invalid browser scopes.');
    }
    return projected;
  } catch {
    throw new OpenAIError('Browser scoped read report failed.');
  }
}

function fileOutcome(value: unknown): BrowserFileOutcome {
  try {
    if (
      !isObj(value) ||
      Object.keys(value).some((key) => !['version', 'status', 'effect', 'cleanup'].includes(key))
    ) {
      throw new TypeError('Invalid browser file outcome.');
    }
    const version = configuredOption(value, 'version');
    const status = configuredOption(value, 'status');
    const effect = configuredOption(value, 'effect');
    const cleanup = configuredOption(value, 'cleanup');
    if (version !== 1 || (cleanup !== 'not_started' && cleanup !== 'pending' && cleanup !== 'completed')) {
      throw new TypeError('Invalid browser file outcome.');
    }
    if (status === 'completed' && effect === 'completed') {
      return { version, status, effect, cleanup };
    }
    if (status === 'refused' && effect === 'none') {
      return { version, status, effect, cleanup };
    }
    if (status === 'unknown' && effect === 'unknown') {
      return { version, status, effect, cleanup };
    }
    if (status === 'interrupted' && (effect === 'none' || effect === 'unknown')) {
      return { version, status, effect, cleanup };
    }
    throw new TypeError('Invalid browser file outcome.');
  } catch {
    throw new OpenAIError('Browser file result failed.');
  }
}

function snapshotResult(
  member: BrowserMember,
  result: BrowserResult<BrowserMember>,
): BrowserResult<BrowserMember> {
  if (member === 'zoom' || member === 'screenshot') {
    return snapshotImage(result, member);
  }
  if (member === 'read_page_scoped') {
    return scopedRead(result);
  }
  if (member === 'read_diagnostics') {
    return browserRead(result, true);
  }
  if (member === 'upload_file' || member === 'download_file') {
    return fileOutcome(result);
  }
  if (member === 'run_script') {
    try {
      return readText(result, Number.POSITIVE_INFINITY, true);
    } catch {
      throw new OpenAIError('Browser script result failed.');
    }
  }
  if (member === 'list_tabs' || result === null || result === undefined || typeof result === 'string') {
    return result;
  }
  if (member === 'read_page' || member === 'find' || member === 'get_page_text') {
    return browserRead(result, member === 'get_page_text');
  }
  throw new OpenAIError('Browser actions must return a string, null, or undefined.');
}

function resultCompleted(member: BrowserMember, result: BrowserResult<BrowserMember>): boolean {
  if (member === 'upload_file' || member === 'download_file') {
    return isObj(result) && result['status'] === 'completed';
  }
  return true;
}

function nullableStateNotice(
  change: Record<string, unknown>,
  type: 'navigation_refused' | 'download',
  sequence: number,
  tab_id: string | null,
): BrowserStateChange {
  if (type === 'navigation_refused') {
    const reason = configuredOption(change, 'reason');
    if (reason !== 'policy' && reason !== 'unsupported') {
      throw new TypeError('Invalid browser change.');
    }
    return { type, sequence, tab_id, reason };
  }
  const status = configuredOption(change, 'status');
  if (status !== 'blocked' && status !== 'started' && status !== 'completed' && status !== 'failed') {
    throw new TypeError('Invalid browser change.');
  }
  return { type, sequence, tab_id, status };
}

function observedState(value: unknown): BrowserObservationV1 {
  if (!isObj(value)) {
    throw new TypeError('Invalid browser observation.');
  }
  const version = configuredOption(value, 'version');
  const sequence = configuredOption(value, 'sequence');
  const dropped_changes = configuredOption(value, 'dropped_changes');
  const title_truncated = configuredOption(value, 'title_truncated');
  const changes = configuredOption(value, 'changes');
  if (
    version !== 1 ||
    !stateCounter(sequence) ||
    !stateCounter(dropped_changes) ||
    typeof title_truncated !== 'boolean' ||
    !Array.isArray(changes)
  ) {
    throw new TypeError('Invalid browser observation.');
  }
  const { length } = changes;
  if (!stateCounter(length) || sequence !== dropped_changes + length) {
    throw new TypeError('Invalid browser observation.');
  }
  const projected = Array.from({ length }, (_, index): BrowserStateChange => {
    requireOwnArrayEntry(changes, index);
    const change: unknown = changes[index];
    if (!isObj(change)) {
      throw new TypeError('Invalid browser change.');
    }
    const type = configuredOption(change, 'type');
    const tab_id = configuredOption(change, 'tab_id');
    const position = dropped_changes + index + 1;
    if (configuredOption(change, 'sequence') !== position) {
      throw new TypeError('Invalid browser change.');
    }
    if (type === 'navigation_refused' || type === 'download') {
      if (tab_id !== null && (typeof tab_id !== 'string' || !boundedStateText(tab_id, 128, false))) {
        throw new TypeError('Invalid browser change.');
      }
      return nullableStateNotice(change, type, position, tab_id);
    }
    if (typeof tab_id !== 'string' || !boundedStateText(tab_id, 128, false)) {
      throw new TypeError('Invalid browser change.');
    }
    if (type === 'dialog_dismissed') {
      const kind = configuredOption(change, 'kind');
      if (
        kind !== 'alert' &&
        kind !== 'confirm' &&
        kind !== 'prompt' &&
        kind !== 'beforeunload' &&
        kind !== 'other'
      ) {
        throw new TypeError('Invalid browser change.');
      }
      return { type, sequence: position, tab_id, kind };
    }
    if (type !== 'tab_opened' && type !== 'tab_closed' && type !== 'tab_switched' && type !== 'navigation') {
      throw new TypeError('Invalid browser change.');
    }
    return { type, sequence: position, tab_id };
  });
  return { version: 1, sequence, dropped_changes, title_truncated, changes: projected };
}

function stateOrigin(url: string): string {
  if (!boundedStateText(url, Number.POSITIVE_INFINITY, false)) {
    throw new TypeError('Invalid browser URL.');
  }
  if (url === 'about:blank') {
    return url;
  }
  const scheme = /^https?:\/\//iu.exec(url)?.[0];
  const authority = scheme ? url.slice(scheme.length).split(/[/?#]/u, 1)[0] : undefined;
  if (
    !scheme ||
    !authority ||
    [...authority].some((char) => char <= ' ' || char === '\u007F' || char === '\\')
  ) {
    throw new TypeError('Invalid browser URL.');
  }
  // V1 accepts no escaped host/port bytes or scoped IP addresses. Userinfo
  // may still be escaped; it is never included in the projected origin.
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostPort.includes('%')) {
    throw new TypeError('Invalid browser URL.');
  }
  const value = new URL(scheme + hostPort);
  const host = value.hostname;
  if (!host.startsWith('[')) {
    const labels = host.replace(/\.$/u, '').split('.');
    if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) {
      throw new TypeError('Invalid browser URL.');
    }
    // WHATWG expands abbreviated, octal, hex and integer IPv4. The shared
    // observation subset allows only the explicit canonical four-octet form.
    if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u.test(host) && hostPort.split(':')[0] !== host) {
      throw new TypeError('Invalid browser URL.');
    }
  }
  if (!boundedStateText(value.origin, 2048, false)) {
    throw new TypeError('Invalid browser URL.');
  }
  return value.origin;
}

function legacyStateURL(url: string): string {
  const parsed = new URL(url);
  let projected = parsed.protocol;
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    projected = parsed.origin;
  } else if (url === 'about:blank') {
    projected = url;
  }
  if (!boundedStateText(projected, 2048, false)) {
    throw new TypeError('Invalid browser URL.');
  }
  return projected;
}

async function readState(
  report: BrowserDriver['state'],
  signal: AbortSignal | undefined,
  previous?: BrowserObservationV1,
): Promise<BrowserState> {
  try {
    const value: unknown = await report({ signal });
    signal?.throwIfAborted();
    if (!isObj(value)) {
      throw new TypeError('Invalid browser state.');
    }
    const rawTabs = configuredOption(value, 'tabs');
    if (!Array.isArray(rawTabs)) {
      throw new TypeError('Invalid browser state.');
    }
    const { length } = rawTabs;
    const suppliedObservation = configuredOption(value, 'observation');
    const observation = suppliedObservation === undefined ? undefined : observedState(suppliedObservation);
    if (
      previous &&
      (!observation ||
        observation.sequence < previous.sequence ||
        observation.dropped_changes < previous.dropped_changes)
    ) {
      throw new TypeError('Invalid browser state.');
    }
    if (previous && observation) {
      const offset = observation.dropped_changes - previous.dropped_changes;
      for (let index = 0; index < previous.sequence - observation.dropped_changes; index += 1) {
        if (JSON.stringify(observation.changes[index]) !== JSON.stringify(previous.changes[offset + index])) {
          throw new TypeError('Invalid browser state.');
        }
      }
    }
    const tabs = Array.from({ length }, (_, index) => {
      requireOwnArrayEntry(rawTabs, index);
      const tab: unknown = rawTabs[index];
      if (!isObj(tab)) {
        throw new TypeError('Invalid browser state.');
      }
      const id = configuredOption(tab, 'id');
      const title = configuredOption(tab, 'title');
      const url = configuredOption(tab, 'url');
      const active = configuredOption(tab, 'active');
      if (
        typeof id !== 'string' ||
        typeof title !== 'string' ||
        typeof url !== 'string' ||
        typeof active !== 'boolean'
      ) {
        throw new TypeError('Invalid browser state.');
      }
      if (
        observation &&
        (!boundedStateText(id, 128, false) || !boundedStateText(title, Number.POSITIVE_INFINITY, true))
      ) {
        throw new TypeError('Invalid browser state.');
      }
      let projectedTitle = title;
      if (observation) {
        // SAFETY: The native encoder reports how many complete UTF-16 units it read.
        const { read } = new TextEncoder().encodeInto(title, new Uint8Array(1024)) as { read: number };
        if (read < title.length) {
          projectedTitle = title.slice(0, read);
          observation.title_truncated = true;
        }
      }
      return { id, title: projectedTitle, url: observation ? stateOrigin(url) : legacyStateURL(url), active };
    });
    if (
      new Set(tabs.map((tab) => tab.id)).size !== tabs.length ||
      (tabs.length > 0 && tabs.filter((tab) => tab.active).length !== 1)
    ) {
      throw new TypeError('Invalid browser state.');
    }
    return observation ? { tabs, observation } : { tabs };
  } catch {
    signal?.throwIfAborted();
    throw new OpenAIError('Browser state report failed.');
  }
}

function selectedBrowserMembers(selection: BrowserOptions['members']): Set<BrowserMember> | undefined {
  if (selection === undefined) {
    return undefined;
  }
  if (!Array.isArray(selection)) {
    throw new TypeError('Browser members must be an array of unique fixed member names.');
  }
  const requested = new Set<BrowserMember>();
  const { length } = selection;
  for (let index = 0; index < length; index += 1) {
    const name = hasOwn(selection, index) ? selection[index] : undefined;
    if (typeof name !== 'string' || !hasOwn(members, name) || requested.has(name)) {
      throw new TypeError('Browser members must be an array of unique fixed member names.');
    }
    requested.add(name);
  }
  return requested;
}

function requiresConsent(member: BrowserMember): boolean {
  const spec = members[member];
  return spec.changes || ('sensitive' in spec && hasOwn(spec, 'sensitive') && spec.sensitive);
}

// Only fresh helper-owned declarations, consent snapshots, state, and result projections reach this walk.
// oxlint-disable-next-line anti-slop/no-object-parameters -- The private walk handles heterogeneous projected records and arrays, never caller-owned objects.
function protectBrowserOutput<T extends object>(value: T): T {
  const pending: object[] = [value];
  for (const record of pending) {
    Object.defineProperty(record, 'toJSON', { value: undefined, writable: true, configurable: true });
    const entries: unknown[] = Object.values(record);
    for (const entry of entries) {
      if (entry !== null && typeof entry === 'object') {
        pending.push(entry);
      }
    }
  }
  return value;
}

// oxlint-disable-next-line anti-slop/no-object-parameters -- Serialize the same helper-owned projections protected by the private walk.
function serializeBrowserOutput(value: object): string {
  protectBrowserOutput(value);
  return JSON.stringify(value);
}

/** Dispatches a fixed set of structured browser functions against a caller-owned driver. */
export class BrowserToolset {
  private readonly lifecycle = new RunnerLifecycle();
  private readonly enabled = new Map<
    string,
    { member: BrowserMember; handler: BrowserHandler | undefined }
  >();

  private readonly driver: BrowserDriver;
  private readonly options: BrowserOptions | BrowserReadOptions;
  private readonly confirmReads: ReadonlySet<BrowserMember>;

  /** A mutating driver requires confirm. A navigable driver also requires urlPolicy. */
  constructor(driver: BrowserDriver, options?: BrowserOptions);
  constructor(driver: BrowserDriver, options: BrowserReadOptions);
  constructor(driver: BrowserDriver, options: BrowserOptions | BrowserReadOptions = {}) {
    this.driver = driver;
    this.options = options;
    const reads =
      'confirmReads' in options
        ? selectedBrowserMembers(configuredOption(options, 'confirmReads'))
        : undefined;
    if (
      reads &&
      ([...reads].some((name) => members[name].changes) ||
        typeof configuredOption(options, 'confirm') !== 'function')
    ) {
      throw new TypeError('confirmReads requires read-only members and a confirm callback.');
    }
    this.confirmReads = reads ?? new Set();
    this.registerDriver(driver, options);
    for (const member of this.confirmReads) {
      if (!this.enabled.has(`browser_${member}`)) {
        throw new TypeError('confirmReads must name an enabled browser read.');
      }
    }
  }

  private registerDriver(driver: BrowserDriver, options: BrowserOptions | BrowserReadOptions): void {
    const selected = selectedBrowserMembers(configuredOption(options, 'members'));
    const additional = selectedBrowserMembers(configuredOption(options, 'additionalMembers'));
    if (selected !== undefined && additional !== undefined) {
      throw new TypeError('Use either members or additionalMembers, not both.');
    }
    for (const name of BROWSER_MEMBERS) {
      const spec = members[name];
      if (selected ? !selected.has(name) : hasOwn(spec, 'optIn') && !additional?.has(name)) {
        continue;
      }
      const handler = name === 'list_tabs' ? undefined : configuredOption(driver, name);
      if (name === 'list_tabs' || typeof handler === 'function') {
        BrowserToolset.requirePolicy(name, options);
        // SAFETY: Fixed inventory name selects the handler; execution validates its matching argument schema.
        const bound = handler?.bind(driver) as BrowserHandler | undefined;
        this.enabled.set(`browser_${name}`, { member: name, handler: bound });
      } else if (selected || additional?.has(name)) {
        throw new TypeError('A selected browser member is not implemented by the driver.');
      }
    }
  }

  private static requirePolicy(name: BrowserMember, options: BrowserOptions | BrowserReadOptions): void {
    if (requiresConsent(name) && !configuredOption(options, 'confirm')) {
      throw new TypeError('BrowserToolset requires confirm for state-changing members or sensitive reads.');
    }
    if ((name === 'navigate' || name === 'new_tab') && !configuredOption(options, 'urlPolicy')) {
      throw new TypeError('BrowserToolset requires urlPolicy for navigation.');
    }
  }

  /** Function declarations for the enabled members. A partial driver omits unsupported capabilities. */
  tools(): FunctionTool[] {
    const tools: FunctionTool[] = Array.from(this.enabled, ([name, { member }]) => {
      const spec = members[member];
      const properties = Object.fromEntries(
        Object.entries(spec.args).map(([key, field]) => [key, structuredClone(fields[field])]),
      );
      return {
        type: 'function',
        name,
        description: spec.description,
        strict: true,
        parameters: {
          type: 'object',
          properties,
          required: Object.keys(properties),
          additionalProperties: false,
        },
      };
    });
    protectBrowserOutput(tools);
    return tools;
  }

  /** Stop new work. If draining, await the current execute before closing your driver. */
  close(): { status: 'closed' | 'draining' } {
    return this.lifecycle.close();
  }

  /** Execute one completed browser function for a caller-managed loop.
   * Accepts generated API call types and checks status before any driver work.
   */
  async execute(
    call: ResponseFunctionToolCall,
    options: { signal?: AbortSignal } = {},
  ): Promise<ResponseInputItem.FunctionCallOutput> {
    const result = await this.executeWithStatus(call, configuredOption(options, 'signal'));
    return result.output;
  }

  /** Executes or skips a registered call and reports failure without parsing its public output.
   * @internal
   */
  async executeWithStatus(
    call: ResponseFunctionToolCall,
    signal?: AbortSignal,
    skip = false,
    onDiagnostic?: RunnerDiagnosticObserver,
  ): Promise<{ output: ResponseInputItem.FunctionCallOutput; ok: boolean }> {
    this.lifecycle.enter();
    try {
      const result = await this.executeOwned(call, signal, skip, onDiagnostic);
      protectBrowserOutput(result.output);
      return result;
    } finally {
      this.lifecycle.leave();
    }
  }

  private async approveRead(
    snapshot: ResponseFunctionToolCall,
    member: BrowserMember,
    skip: boolean,
    observer: RunnerDiagnosticObserver | undefined,
    signal?: AbortSignal,
  ): Promise<ResponseInputItem.FunctionCallOutput | undefined> {
    let stage: 'arguments' | 'approval' = 'arguments';
    let started = performance.now();
    try {
      if (skip || !('confirmReads' in this.options)) {
        throw new BrowserError('Read declined.');
      }
      const args: unknown = JSON.parse(snapshot.arguments);
      validateArguments(member, args);
      // SAFETY: confirmReads contains only fixed read members and the arguments were validated above.
      const context = {
        phase: 'before_read',
        member,
        arguments: args,
        call_id: snapshot.call_id,
        state: null,
      } as BrowserReadConfirmContext;
      stage = 'approval';
      started = performance.now();
      const approved = await configuredOption(this.options, 'confirm')?.call(
        this.options,
        protectBrowserOutput(structuredClone(context)),
        { signal },
      );
      signal?.throwIfAborted();
      if (approved !== true) {
        throw new BrowserError('Read declined.');
      }
      reportDiagnostic(
        observer,
        { api: 'browser', stage, reason: 'completed', call_id: snapshot.call_id, member },
        started,
      );
    } catch {
      reportDiagnostic(
        observer,
        {
          api: 'browser',
          stage,
          reason: diagnosticFailure(stage, signal),
          call_id: snapshot.call_id,
          member,
        },
        started,
      );
      signal?.throwIfAborted();
      return {
        type: 'function_call_output',
        call_id: snapshot.call_id,
        output: [
          { type: 'input_text', text: serializeBrowserOutput({ ok: false, error: 'Read declined.' }) },
        ],
      };
    }
    return undefined;
  }

  // oxlint-disable-next-line eslint/complexity -- TS4.9 needs explicit record checks here to retain the native call type.
  private async executeOwned(
    call: ResponseFunctionToolCall,
    signal?: AbortSignal,
    skip = false,
    onDiagnostic?: RunnerDiagnosticObserver,
  ): Promise<{ output: ResponseInputItem.FunctionCallOutput; ok: boolean }> {
    const snapshot = structuredClone(call);
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      !(['name', 'type', 'call_id', 'status', 'arguments'] as const).every((field) => hasOwn(snapshot, field))
    ) {
      throw new OpenAIError('BrowserToolset requires a completed registered call.');
    }
    const selected = this.enabled.get(snapshot.name);
    if (
      !selected ||
      snapshot.type !== 'function_call' ||
      typeof snapshot.call_id !== 'string' ||
      snapshot.status !== 'completed'
    ) {
      throw new OpenAIError('BrowserToolset requires a completed registered call.');
    }
    const replay = toResponseInputItems([snapshot]);
    protectRunnerJSON(replay);
    JSON.stringify(replay);
    signal?.throwIfAborted();
    const { member, handler } = selected;
    // These may change between executions; an active call keeps its selected consent and state callbacks.
    const policy = this.policyFor(member, skip);
    const observer = onDiagnostic ?? configuredOption(this.options, 'onDiagnostic')?.bind(this.options);
    const privateRead = this.confirmReads.has(member);
    if (privateRead) {
      const declined = await this.approveRead(snapshot, member, skip, observer, signal);
      if (declined) {
        return { ok: false, output: declined };
      }
    }
    let report: BrowserDriver['state'];
    try {
      const reporter = configuredOption(this.driver, 'state');
      if (typeof reporter !== 'function') {
        throw new TypeError('Browser state requires a reporter.');
      }
      report = reporter.bind(this.driver);
    } catch {
      throw new OpenAIError('Browser state report failed.');
    }
    const before = await readState(report, signal);
    signal?.throwIfAborted();
    const { ok, result, failure } = await BrowserToolset.perform(
      snapshot,
      member,
      handler,
      before,
      policy,
      privateRead,
      skip,
      observer,
      signal,
    );
    signal?.throwIfAborted();
    // State failures stop; an uncertain state must never be presented as success or retried.
    const state = await readState(
      report,
      signal,
      hasOwn(before, 'observation') ? before.observation : undefined,
    );
    signal?.throwIfAborted();
    return BrowserToolset.output(snapshot.call_id, member, state, ok, result, failure);
  }

  private static async perform(
    snapshot: ResponseFunctionToolCall,
    member: BrowserMember,
    handler: BrowserHandler | undefined,
    before: BrowserState,
    policy: ReturnType<BrowserToolset['policyFor']>,
    privateRead: boolean,
    skip: boolean,
    observer: RunnerDiagnosticObserver | undefined,
    signal?: AbortSignal,
  ) {
    let stage: 'arguments' | 'approval' | 'action' | 'output' = 'arguments';
    let started = performance.now();
    let ok = false;
    let result;
    let failure: string | undefined;
    try {
      if (skip) {
        throw new BrowserError(
          'Skipped because an earlier browser call failed. Observe current state and replan.',
        );
      }
      const args: unknown = JSON.parse(snapshot.arguments);
      validateArguments(member, args);
      if (member === 'list_tabs') {
        result = before;
      } else if (handler) {
        stage = 'approval';
        started = performance.now();
        await BrowserToolset.authorize(member, args, before, snapshot.call_id, policy, signal, privateRead);
        if (!privateRead && (requiresConsent(member) || member === 'navigate' || member === 'new_tab')) {
          reportDiagnostic(
            observer,
            { api: 'browser', stage, reason: 'completed', call_id: snapshot.call_id, member },
            started,
          );
        }
        signal?.throwIfAborted();
        stage = 'action';
        started = performance.now();
        result = await handler(args, { signal });
        signal?.throwIfAborted();
      }
      ok = true;
    } catch (error) {
      reportDiagnostic(
        observer,
        {
          api: 'browser',
          stage,
          call_id: snapshot.call_id,
          member,
          reason: diagnosticFailure(stage, signal),
        },
        started,
      );
      signal?.throwIfAborted();
      const message = error instanceof BrowserError ? error.message : undefined;
      failure = typeof message === 'string' ? message : 'Browser operation failed.';
    }
    // Snapshot successful opt-ins before any later callback or await. Contract
    // errors stop the run rather than becoming ordinary driver refusals.
    if (ok) {
      try {
        result = snapshotResult(member, result);
      } catch (error) {
        reportDiagnostic(
          observer,
          { api: 'browser', stage: 'output', reason: 'invalid_output', call_id: snapshot.call_id, member },
          started,
        );
        throw error;
      }
      if (handler && member !== 'list_tabs') {
        reportDiagnostic(
          observer,
          { api: 'browser', stage: 'action', reason: 'completed', call_id: snapshot.call_id, member },
          started,
        );
      }
      ok = resultCompleted(member, result);
    }
    signal?.throwIfAborted();
    return { ok, result, failure };
  }

  private policyFor(member: BrowserMember, skip: boolean) {
    try {
      return {
        confirm:
          !skip && requiresConsent(member)
            ? configuredOption(this.options, 'confirm')?.bind(this.options)
            : undefined,
        urlPolicy:
          !skip && (member === 'navigate' || member === 'new_tab')
            ? configuredOption(this.options, 'urlPolicy')?.bind(this.options)
            : undefined,
      };
    } catch {
      throw new OpenAIError('Browser operation failed.');
    }
  }

  private static output(
    callId: string,
    member: BrowserMember,
    state: BrowserState,
    ok: boolean,
    result: BrowserResult<BrowserMember>,
    failure: string | undefined,
  ) {
    const content: ResponseInputItem.FunctionCallOutput['output'] = [
      {
        type: 'input_text',
        text: serializeBrowserOutput({
          ok,
          result: member === 'screenshot' || member === 'zoom' ? undefined : result,
          error: failure,
          state,
        }),
      },
    ];
    if (ok && (member === 'screenshot' || member === 'zoom')) {
      // SAFETY: snapshotResult validated and detached the selected image before the final state callback.
      const image = result as ResponseInputImageContent;
      content.push(image);
    }
    return {
      ok,
      output: { type: 'function_call_output', call_id: callId, output: content },
    } satisfies { output: ResponseInputItem.FunctionCallOutput; ok: boolean };
  }

  private static async authorize(
    member: BrowserMember,
    args: Record<string, unknown>,
    state: BrowserState,
    callId: string,
    policy: { confirm: BrowserOptions['confirm']; urlPolicy: BrowserOptions['urlPolicy'] },
    signal?: AbortSignal,
    readApproved = false,
  ): Promise<void> {
    // SAFETY: validateArguments matched the captured member against its fixed schema before authorization.
    const context = {
      member,
      arguments: args,
      // Keep absent observations captured for consent without adding them to driver or wire state.
      state: { ...state, observation: hasOwn(state, 'observation') ? state.observation : undefined },
      call_id: callId,
    } as BrowserConfirmContext;
    if (member === 'navigate' || member === 'new_tab') {
      const { url } = args;
      if (
        url !== null &&
        typeof url === 'string' &&
        (await policy.urlPolicy?.(protectBrowserOutput(structuredClone(context)), url, { signal })) !== true
      ) {
        throw new BrowserError('URL policy declined navigation.');
      }
    }
    signal?.throwIfAborted();
    if (
      !readApproved &&
      requiresConsent(member) &&
      (await policy.confirm?.(protectBrowserOutput(structuredClone(context)), { signal })) !== true
    ) {
      throw new BrowserError('Action declined.');
    }
    signal?.throwIfAborted();
  }
}
