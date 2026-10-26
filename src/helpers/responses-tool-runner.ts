// Keep the runner's public partial-effect error beside its owning helper.
// oxlint-disable max-classes-per-file
import type OpenAI from '../index';
import { OpenAIError } from '../error';
import { hasOwn, isObj } from '../internal/utils/values';
import { redactURL } from '../internal/utils/log';
import { buildHeaders } from '../internal/headers';
import { toResponseInputItems } from '../lib/responses/ResponseInputItems';
import { isAutoParsableTool } from '../lib/ResponsesParser';
import type { AutoParseableResponseTool } from '../lib/ResponsesParser';
import { diagnosticFailure, reportDiagnostic } from '../internal/runner-diagnostics';
import {
  configuredOption,
  continuationRequestOptions,
  overlayRequestOptions,
  RunnerLifecycle,
} from '../internal/runner-lifecycle';
import {
  isNativeResponseMessage,
  isNativeResponseMessageInput,
  isNativeResponseReasoning,
} from '../internal/native-response-message';
import type { RunnerDiagnostic, RunnerDiagnosticObserver } from '../internal/runner-diagnostics';

import type {
  FunctionTool,
  ComputerAction,
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseFunctionToolCall,
  ResponseFunctionCallOutputItem,
  ResponseStreamEvent,
  Tool,
} from '../resources/responses/responses';
import type { BrowserToolset } from './browser';
import { ComputerToolset } from './computer';
import type { ComputerExecutionOptions } from './computer';

export type { RunnerDiagnostic, RunnerDiagnosticObserver } from '../internal/runner-diagnostics';

const serverOutputs = {
  web_search_call: [
    'web_search',
    'web_search_2025_08_26',
    'web_search_preview',
    'web_search_preview_2025_03_11',
  ],
  file_search_call: ['file_search'],
  code_interpreter_call: ['code_interpreter'],
  image_generation_call: ['image_generation'],
  mcp_call: ['mcp'],
  mcp_list_tools: ['mcp'],
  mcp_approval_request: ['mcp'],
} as const satisfies Partial<Record<ResponseOutputItem['type'], readonly Tool['type'][]>>;
const allowedServerTypes: ReadonlySet<string> = new Set(Object.values(serverOutputs).flat());

type ServerOutput = Extract<ResponseOutputItem, { type: keyof typeof serverOutputs }>;
type LocalCall = Extract<
  ResponseOutputItem,
  { type: 'function_call' | 'computer_call' | 'mcp_approval_request' }
>;
interface LocalToolSelection {
  functions: ReadonlySet<string>;
  computer: boolean;
  mcp: readonly { serverLabel: string; name: string | null }[];
  server: ReadonlySet<string>;
}

// Only fixed SDK messages belong here. Caller exceptions remain private at the run boundary.
class RunnerValidationError extends OpenAIError {
  override name = 'RunnerValidationError';
}

function isServerOutput(item: ResponseInputItem | ResponseOutputItem): item is ServerOutput {
  return (
    hasOwn(item, 'type') && item.type !== undefined && item.type !== null && hasOwn(serverOutputs, item.type)
  );
}

function serverDeclared(item: ServerOutput, tools: readonly Tool[]): boolean {
  const types: readonly Tool['type'][] = serverOutputs[item.type];
  if (types.includes('mcp')) {
    if (
      !hasOwn(item, 'server_label') ||
      !('server_label' in item) ||
      typeof item.server_label !== 'string' ||
      !item.server_label
    ) {
      return false;
    }
    return tools.some((tool) => tool.type === 'mcp' && tool.server_label === item.server_label);
  }
  return tools.some((tool) => types.includes(tool.type));
}

function validateMcpCall(
  item: ResponseInputItem.McpCall,
  approved: Map<string, ResponseInputItem.McpApprovalRequest>,
  ErrorType: typeof OpenAIError = RunnerValidationError,
): void {
  const id = hasOwn(item, 'approval_request_id') ? item.approval_request_id : undefined;
  if (id === undefined || id === null) {
    return;
  }
  const request = approved.get(id);
  if (
    !request ||
    request.server_label !== item.server_label ||
    request.name !== item.name ||
    request.arguments !== item.arguments
  ) {
    throw new ErrorType('MCP call does not match an approved request.');
  }
  approved.delete(id);
}

function collectMcpApproval(
  item: ResponseInputItem,
  requests: Map<string, ResponseInputItem.McpApprovalRequest | null>,
  approved: Map<string, ResponseInputItem.McpApprovalRequest>,
) {
  if (!hasOwn(item, 'type')) {
    return;
  }
  if (item.type === 'mcp_approval_request' && hasOwn(item, 'id') && !requests.has(item.id)) {
    requests.set(item.id, item);
  } else if (
    item.type === 'mcp_approval_response' &&
    hasOwn(item, 'approval_request_id') &&
    hasOwn(item, 'approve') &&
    typeof item.approve === 'boolean'
  ) {
    const request = requests.get(item.approval_request_id);
    if (request) {
      requests.set(item.approval_request_id, null);
      if (item.approve) {
        approved.set(item.approval_request_id, request);
      }
    }
  }
}

function approvedMcpRequests(history: readonly ResponseInputItem[]) {
  const requests = new Map<string, ResponseInputItem.McpApprovalRequest | null>();
  const approved = new Map<string, ResponseInputItem.McpApprovalRequest>();
  for (const item of history) {
    collectMcpApproval(item, requests, approved);
    if (hasOwn(item, 'type') && item.type === 'mcp_call') {
      validateMcpCall(item, approved);
    }
  }
  return approved;
}

/** Caller-owned function and its wire declaration. The executor receives decoded JSON objects. */
export interface RunnerFunction {
  /** Function schema exposed to the model. Names must be unique among all registered tools. */
  tool: FunctionTool;
  /** Permit a caller to supply this ordinary function's output at an iterator boundary. */
  allowOutputOverride?: boolean;
  /** May finish beside stream consumption. Use only for independent ordinary functions. */
  independent?: boolean;
  /** Return a native function output: text, or input text/image/file content blocks. Errors stop the run. */
  execute: (
    args: Record<string, unknown>,
    options?: { signal: AbortSignal | undefined },
  ) =>
    | ResponseInputItem.FunctionCallOutput['output']
    | Promise<ResponseInputItem.FunctionCallOutput['output']>;
}

const runnerFunctionStages = Symbol.for('openai.responses.runnerFunctionStages');
type StagedRunnerFunction = RunnerFunction['execute'] & {
  [runnerFunctionStages]?: (args: Record<string, unknown>) => () => ReturnType<RunnerFunction['execute']>;
};
interface RegisteredRunnerFunction {
  execute: RunnerFunction['execute'];
  prepare: StagedRunnerFunction[typeof runnerFunctionStages];
}
interface RunnerTurn {
  plainOutputs: boolean;
  browserFailed: boolean;
  outputs: ResponseInputItem[];
  functions: Map<string, () => ReturnType<RunnerFunction['execute']>>;
}

/** Local permission to start tools on completed stream items, before full-response inspection. */
export interface ResponsesEarlyExecution {
  /** Registered ordinary function or exposed browser member wire names. Unlisted names wait. */
  functions?: readonly string[];
  /** Permit the native computer dispatcher. Individual actions and safety checks still require approval. */
  computer?: boolean;
}

/** Tools that share a single Responses conversation. */
export interface ResponsesRunnerTools {
  /** Structured browser function tools. */
  browser?: BrowserToolset;
  /** Existing native computer dispatcher. Defaults to the computer tool declaration. */
  computer?: ComputerToolset;
  /** Other functions to run in output order alongside browser and computer calls. */
  functions?: RunnerFunction[];
  /**
   * Requires stream + eager. Omitted/null keeps the existing blanket eager opt-in;
   * {} permits no early tools. The first deferred call holds the rest in output order.
   */
  earlyExecution?: ResponsesEarlyExecution | null | undefined;
}

/** Per-run bounds, request, stream and execution options. */
export interface ResponsesRunnerOptions {
  /** Maximum number of API requests (default 20). No effects run on the final allowed request. */
  maxSteps?: number;
  /** Stream API events through onEvent; actions normally wait for a completed response. */
  stream?: boolean;
  /** Opt in to early execution on output_item.done, before the stream completes. Requires stream. */
  eager?: boolean;
  /** Maximum independent eager calls admitted before settling. Positive safe integer; default 2. */
  maxConcurrentCalls?: number;
  /** Invoked in event order; receives a detached event so mutations cannot change dispatch. */
  onEvent?: (event: ResponseStreamEvent) => void | Promise<void>;
  /** Stop before the next effect or request. Cancellation after partial execution reports call IDs. */
  signal?: AbortSignal;
  /**
   * Passed to each ordinary request; used as the signal when top-level signal is omitted.
   * Signal and retry overrides use a view without changing the caller's object.
   * Supply trusted configuration: native overrides can change the request body or destination.
   * Ledger mode accepts only its restricted transport options.
   */
  requestOptions?: OpenAI.RequestOptions;
  /** Forwarded to ComputerToolset.execute for native safety checks and beforeAction. */
  computerOptions?: ComputerExecutionOptions;
  /** Answer an actual MCP approval request after response inspection. Only true or false is accepted. */
  approveMcp?: (request: Readonly<ResponseOutputItem.McpApprovalRequest>) => boolean | Promise<boolean>;
  /** Local execution stages and actual request usage, without raw tool or page values. */
  onDiagnostic?: RunnerDiagnosticObserver;
  /** Defer one otherwise permitted eager call until completed turn inspection. */
  beforeEarlyCall?: (
    call: Readonly<Extract<ResponseOutputItem, { type: 'function_call' | 'computer_call' }>>,
  ) => 'execute' | 'defer' | Promise<'execute' | 'defer'>;
  /** Durable opt-in. save must commit before returning; the caller owns storage and exclusion. */
  ledger?: ResponsesRunnerLedger;
  /** Bounds on each native request input; omitted/null preserves full replay. */
  contextBudget?: ResponsesContextBudget | null | undefined;
}

/** A local input representation budget, not a token, cost, or ledger-storage limit. */
export interface ResponsesContextBudget {
  maxInputBytes: number;
  maxInputImages: number;
  /** Minimum newest screenshot pairs retained (default 1). */
  keepRecentScreenshots?: number;
  /** Called only when the validated next input exceeds a bound, before request admission. */
  compact?: (snapshot: {
    history: ResponseInputItem[];
    eligibleCallIds: string[];
    inputBytes: number;
    inputImages: number;
  }) => { dropCallIds: string[]; summary?: string } | Promise<{ dropCallIds: string[]; summary?: string }>;
}

/** Private replay evidence, never proof of an externally committed effect. */
export interface ResponsesRunnerCheckpoint {
  version: 1;
  run_id: string;
  revision: number;
  phase: 'boundary' | 'pending' | 'final';
  max_steps: number;
  consumed_requests: number;
  /** Registry identity. Saved MCP declarations omit authorization and headers and fingerprint server URLs.
   * Resume uses current credentials; applications must verify they still address the intended remote tenant.
   */
  tools: Tool[];
  output_override_names: string[];
  history: ResponseInputItem[];
  attempted_call_ids: string[];
  returned_call_ids: string[];
  pending_items: ResponseOutputItem[];
  returned_outputs: ResponseInputItem[];
  final_response: Response | null;
}

/**
 * Save must durably commit this detached value, rejecting stale revisions. Load only the latest
 * record under exclusive environment ownership. Pending and final records cannot resume.
 * On resume, params.input is a nonempty fresh observation; old approvals never transfer.
 *
 * Every save receives a detached, complete checkpoint, including saves before and after
 * local effects. Copying and serializing snapshots can take quadratic total work as a batch grows.
 * Size storage for the complete batch and history; contextBudget does not limit it.
 * After interruption, the saved prefix may omit later observations or unattempted proposals.
 * Effect and completed inspection checkpoints include the full prefix.
 */
export interface ResponsesRunnerLedger {
  runId: string;
  save: (checkpoint: ResponsesRunnerCheckpoint) => void | Promise<void>;
  resumeFrom?: ResponsesRunnerCheckpoint;
}

type LedgerValue = string | number | boolean | null | LedgerValue[] | { [key: string]: LedgerValue };

function isInertJSONGuard(guard: PropertyDescriptor | undefined): boolean {
  return guard !== undefined && !guard.enumerable && hasOwn(guard, 'value') && guard.value === undefined;
}

// Validate plain JSON snapshots without invoking serialization hooks.
function ledgerValue(value: unknown, scalar = false, omitUndefinedProperties = false): LedgerValue {
  if (scalar && typeof value === 'string' && /[\uD800-\uDFFF]/u.test(value)) {
    throw new TypeError('Context budget requires scalar Unicode.');
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    // Public helper outputs shadow inherited serializers with this inert data property.
    const ignoreJSONGuard = isInertJSONGuard(Object.getOwnPropertyDescriptor(value, 'toJSON'));
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + (ignoreJSONGuard ? 2 : 1)
    ) {
      throw new TypeError('Ledger needs plain JSON arrays.');
    }
    return Array.from({ length: value.length }, (_, index) => {
      const entry = Object.getOwnPropertyDescriptor(value, String(index));
      if (!entry || !hasOwn(entry, 'value')) {
        throw new TypeError('Ledger needs dense JSON arrays.');
      }
      return ledgerValue(entry.value, scalar, omitUndefinedProperties);
    });
  }
  if (!isObj(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError('Ledger data must be plain finite JSON values.');
  }
  const entries = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(entries).length !== Object.keys(entries).length) {
    throw new TypeError('Ledger data needs string keys.');
  }
  const keys = Object.keys(entries);
  // oxlint-disable-next-line unicorn/no-array-sort -- Sort a fresh array; ES2020 lacks toSorted.
  keys.sort();
  return Object.fromEntries(
    keys.flatMap((key): [string, LedgerValue][] => {
      const entry = entries[key];
      if (key === 'toJSON' && isInertJSONGuard(entry)) {
        return [];
      }
      if (!entry || !entry.enumerable || !hasOwn(entry, 'value')) {
        throw new TypeError('Ledger needs enumerable JSON data properties.');
      }
      if (omitUndefinedProperties && entry.value === undefined) {
        return [];
      }
      if (scalar && /[\uD800-\uDFFF]/u.test(key)) {
        throw new TypeError('Context budget requires scalar Unicode keys.');
      }
      return [[key, ledgerValue(entry.value, scalar, omitUndefinedProperties)]];
    }),
  );
}

function ledgerJSON(value: unknown, scalar = false): string {
  return JSON.stringify(ledgerValue(value, scalar));
}

function ledgerCopy<T>(value: T, omitUndefinedProperties = false): T {
  // SAFETY: Only plain native JSON values survive; the copier preserves their field and array types.
  return ledgerValue(value, false, omitUndefinedProperties) as T;
}

function ledgerTools(tools: Tool[]): Promise<Tool[]> {
  return Promise.all(
    tools.map(async (tool) => {
      if (tool.type === 'code_interpreter' && typeof tool.container !== 'string') {
        const policy = tool.container.network_policy;
        if (policy?.type === 'allowlist' && policy.domain_secrets) {
          return {
            ...tool,
            container: {
              ...tool.container,
              network_policy: {
                ...policy,
                domain_secrets: policy.domain_secrets.map((secret) => ({ ...secret, value: '' })),
              },
            },
          };
        }
      }
      if (tool.type !== 'mcp') {
        return tool;
      }
      const { authorization: _authorization, headers: _headers, ...registry } = tool;
      if (typeof registry.server_url === 'string') {
        if (typeof crypto === 'undefined' || typeof crypto.subtle?.digest !== 'function') {
          throw new TypeError('MCP checkpoint storage requires Web Crypto SHA-256 support.');
        }
        const digest = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(redactURL(registry.server_url)),
        );
        registry.server_url = `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
      }
      return registry;
    }),
  );
}

function sameStreamOutput(observed: ResponseOutputItem[], completed: ResponseOutputItem[]): boolean {
  const before = toResponseInputItems(observed);
  const after = toResponseInputItems(completed);
  return (
    before.length === after.length &&
    before.every((item, index) => {
      const current = after[index];
      if (
        item.type === 'function_call' &&
        current?.type === 'function_call' &&
        (!hasOwn(item, 'id') || item.id === undefined) &&
        hasOwn(current, 'id') &&
        typeof current.id === 'string'
      ) {
        return ledgerJSON({ ...item, id: current.id }) === ledgerJSON(current);
      }
      if (
        item.type === 'reasoning' &&
        current?.type === 'reasoning' &&
        typeof item.encrypted_content === 'string' &&
        item.encrypted_content.length > 0 &&
        typeof current.encrypted_content === 'string' &&
        current.encrypted_content.length > 0
      ) {
        // Opaque reasoning ciphertext can change between done and completed events.
        return ledgerJSON({ ...item, encrypted_content: current.encrypted_content }) === ledgerJSON(current);
      }
      return ledgerJSON(item) === ledgerJSON(current);
    })
  );
}

/** A completed model turn. In normal mode its tools run only when the iterator advances. */
export interface ResponsesRunnerTurn {
  /** Original API response. Editing it cannot change pending dispatch or replay history. */
  readonly response: Response;
  readonly step: number;
  readonly final: boolean;
  /** Eager mode may already have executed tools before this turn becomes visible. */
  readonly toolsExecuted: boolean;
  /** Detached receipts: completed means an output returned, not a verified external effect. */
  readonly attemptedCallIds: readonly string[];
  readonly completedCallIds: readonly string[];
  /** Replace this turn's supplied-result set for opted-in functions. An empty list clears it. */
  supplyOutputs: (outputs: ResponseInputItem.FunctionCallOutput[]) => void;
  /** Append human text after this turn's pending outputs, before the next request. */
  appendUserText: (text: string) => void;
}

function outputRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isObj(value)) {
    throw new TypeError('Supplied outputs require declared data fields.');
  }
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(fields).some((key) => {
      if (typeof key !== 'string' || !keys.includes(key)) {
        return true;
      }
      const field = fields[key];
      return !field || !field.enumerable || !('value' in field);
    })
  ) {
    throw new TypeError('Supplied outputs contain unknown fields or accessors.');
  }
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
}

function suppliedBreakpoint(cache: unknown) {
  const breakpoint = outputRecord(cache, ['mode', 'ttl']);
  const { ttl } = breakpoint;
  if (breakpoint['mode'] !== 'explicit' || (ttl !== undefined && ttl !== '30m' && ttl !== '12h')) {
    throw new TypeError('Supplied output has an invalid cache breakpoint.');
  }
  return { mode: 'explicit', ...(ttl === undefined ? {} : { ttl }) };
}

function suppliedBlock(value: unknown): ResponseFunctionCallOutputItem {
  const block = outputRecord(value, [
    'type',
    'text',
    'detail',
    'file_id',
    'image_url',
    'file_data',
    'file_url',
    'filename',
    'prompt_cache_breakpoint',
  ]);
  const { type } = block;
  let keys: string[];
  switch (type) {
    case 'input_text': {
      keys = ['type', 'text', 'prompt_cache_breakpoint'];
      break;
    }
    case 'input_image': {
      keys = ['type', 'detail', 'file_id', 'image_url', 'prompt_cache_breakpoint'];
      break;
    }
    case 'input_file': {
      keys = ['type', 'detail', 'file_data', 'file_id', 'file_url', 'filename', 'prompt_cache_breakpoint'];
      break;
    }
    default: {
      throw new TypeError('Supplied output has an invalid content block.');
    }
  }
  if (Object.keys(block).some((key) => !keys.includes(key))) {
    throw new TypeError('Supplied output has an invalid content block.');
  }
  for (const key of ['file_id', 'image_url', 'file_data', 'file_url', 'filename']) {
    const field = block[key];
    if (field !== undefined && field !== null && typeof field !== 'string') {
      throw new TypeError('Supplied output has an invalid file or image field.');
    }
  }
  const sources = type === 'input_image' ? ['image_url', 'file_id'] : ['file_data', 'file_id', 'file_url'];
  if (
    type !== 'input_text' &&
    !sources.some((key) => {
      const source = block[key];
      return typeof source === 'string' && source.trim().length > 0;
    })
  ) {
    throw new TypeError('Supplied file or image output requires a nonempty source.');
  }
  const { detail } = block;
  const details: readonly unknown[] =
    type === 'input_image' ? [null, 'auto', 'low', 'high', 'original'] : ['auto', 'low', 'high'];
  if (detail !== undefined && !details.includes(detail)) {
    throw new TypeError('Supplied output has an invalid detail.');
  }
  const cache = block['prompt_cache_breakpoint'];
  if (cache !== undefined && cache !== null) {
    block['prompt_cache_breakpoint'] = suppliedBreakpoint(cache);
  }
  if (type === 'input_text') {
    const { text } = block;
    if (typeof text !== 'string') {
      throw new TypeError('Supplied text output requires text.');
    }
    return { ...block, type, text };
  }
  return { ...block, type };
}

function outputEntries(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Supplied output must be text or native content blocks.');
  }
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(fields).some(
      (key) =>
        typeof key !== 'string' ||
        (key !== 'length' && (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length)),
    )
  ) {
    throw new TypeError('Supplied content blocks contain unknown array fields.');
  }
  return Array.from({ length: value.length }, (_, index) => {
    const field = fields[String(index)];
    if (!field || !('value' in field)) {
      throw new TypeError('Supplied content blocks must contain data entries.');
    }
    return field.value;
  });
}

function suppliedResult(value: unknown): ResponseInputItem.FunctionCallOutput['output'] {
  return typeof value === 'string' ? value : outputEntries(value).map(suppliedBlock);
}

/** Terminal runner failure. Call IDs report partial effects without arguments or results. */
/** Adapt a typed Responses function for the runner. The callback must return native text or content blocks. */
export function runnerFunction<Arguments>(
  tool: AutoParseableResponseTool<{ name: string; arguments: Arguments }>,
): RunnerFunction {
  if (
    !isAutoParsableTool(tool) ||
    typeof tool.$parseRaw !== 'function' ||
    typeof tool.$callback !== 'function'
  ) {
    throw new TypeError('runnerFunction requires a typed Responses tool with a parser and callback.');
  }
  const parse = tool.$parseRaw.bind(tool);
  const executeTyped = tool.$callback.bind(tool);
  const prepare = (args: Record<string, unknown>) => {
    const parsed = parse(JSON.stringify(args));
    return () => executeTyped(parsed);
  };
  const execute: StagedRunnerFunction = async (args) => suppliedResult(await prepare(args)());
  Object.defineProperty(execute, runnerFunctionStages, { value: prepare });
  return {
    // Parser metadata belongs to local execution, not request or durable history.
    tool: { ...tool },
    execute,
  };
}

export class ResponsesToolRunnerError extends OpenAIError {
  /** All calls that entered dispatch, including failed or refused calls. */
  readonly attemptedCallIds: string[];
  /** All calls whose dispatch returned an output, including browser refusals. */
  readonly completedCallIds: string[];
  /** No original driver exception is retained because it may contain credentials or page content. */
  constructor(message: string, attempted: string[], completed: string[]) {
    super(message);
    this.name = 'ResponsesToolRunnerError';
    this.attemptedCallIds = [...attempted];
    this.completedCallIds = [...completed];
  }
}

/** Bounded Responses loop supporting structured browser tools, native computer actions and functions. */
export class ResponsesToolRunner {
  private readonly lifecycle = new RunnerLifecycle();
  private readonly functions = new Map<string, RegisteredRunnerFunction>();
  private readonly declarations: FunctionTool[] = [];
  private readonly browserNames = new Set<string>();
  private readonly outputOverrides = new Set<string>();
  private readonly independent = new Set<string>();
  private readonly earlyExecution: { functions: ReadonlySet<string>; computer: boolean } | null;

  private readonly browser: ResponsesRunnerTools['browser'];
  private readonly computer: ResponsesRunnerTools['computer'];

  /** Refuse new runs. Await any active iterator/run before releasing its caller-owned environment. */
  close(): { status: 'closed' | 'draining' } {
    return this.lifecycle.close();
  }

  private allowedOutputIds(calls: LocalCall[], attempted: ReadonlySet<string>): Set<string> {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const call of calls) {
      const id = call.type === 'mcp_approval_request' ? call.id : call.call_id;
      if (seen.has(id)) {
        duplicates.add(id);
      }
      seen.add(id);
    }
    return new Set(
      calls
        .filter(
          (item): item is ResponseFunctionToolCall =>
            item.type === 'function_call' &&
            this.outputOverrides.has(item.name) &&
            !attempted.has(item.call_id) &&
            !duplicates.has(item.call_id),
        )
        .map((item) => item.call_id),
    );
  }

  /** Register tools once; rejects conflicting names before any requests or effects. */
  // oxlint-disable-next-line complexity -- Capture and validate the bounded registration fields before admitting any callable.
  constructor(registered: ResponsesRunnerTools) {
    this.browser = configuredOption(registered, 'browser');
    this.computer = configuredOption(registered, 'computer');
    for (const tool of this.browser?.tools() ?? []) {
      this.browserNames.add(tool.name);
      this.declarations.push(tool);
    }
    const functions = configuredOption(registered, 'functions') ?? [];
    const { length } = functions;
    if (!Array.isArray(functions) || !Number.isSafeInteger(length) || length < 0) {
      throw new TypeError('Registered functions must be an array.');
    }
    for (let index = 0; index < length; index += 1) {
      if (!hasOwn(functions, index)) {
        throw new TypeError('Registered functions must contain an entry at every index.');
      }
      const fn = functions[index];
      if (!fn) {
        throw new TypeError('Registered functions require a function declaration.');
      }
      const declaration = structuredClone(configuredOption(fn, 'tool'));
      if (typeof declaration !== 'object' || declaration === null || Array.isArray(declaration)) {
        throw new TypeError('Registered functions require a function declaration.');
      }
      const name: unknown = Object.getOwnPropertyDescriptor(declaration, 'name')?.value;
      const type: unknown = Object.getOwnPropertyDescriptor(declaration, 'type')?.value;
      if (type !== 'function' || typeof name !== 'string' || !name) {
        throw new TypeError('Registered functions require a function declaration with a nonempty name.');
      }
      const allow = configuredOption(fn, 'allowOutputOverride');
      const independent = configuredOption(fn, 'independent');
      if (allow !== undefined && typeof allow !== 'boolean') {
        throw new TypeError('allowOutputOverride must be a boolean.');
      }
      if (independent !== undefined && typeof independent !== 'boolean') {
        throw new TypeError('independent must be a boolean.');
      }
      if (this.functions.has(name) || this.browserNames.has(name)) {
        throw new TypeError('ResponsesToolRunner requires unique function names.');
      }
      const execute: StagedRunnerFunction | undefined = configuredOption(fn, 'execute');
      if (typeof execute !== 'function') {
        throw new TypeError('Registered functions require a callable executor.');
      }
      this.functions.set(name, { execute: execute.bind(fn), prepare: execute[runnerFunctionStages] });
      if (allow === true) {
        this.outputOverrides.add(name);
      }
      if (independent === true) {
        this.independent.add(name);
      }
      this.declarations.push(declaration);
    }
    this.earlyExecution = this.prepareEarlyExecution(configuredOption(registered, 'earlyExecution'));
  }

  private prepareEarlyExecution(
    policy: unknown,
  ): { functions: ReadonlySet<string>; computer: boolean } | null {
    if (policy === undefined || policy === null) {
      return null;
    }
    const fields = outputRecord(policy, ['functions', 'computer']);
    const computer = hasOwn(fields, 'computer') ? fields['computer'] : undefined;
    const names =
      hasOwn(fields, 'functions') && fields['functions'] !== undefined
        ? outputEntries(fields['functions'])
        : [];
    if ((computer !== undefined && typeof computer !== 'boolean') || (computer === true && !this.computer)) {
      throw new TypeError('earlyExecution requires registered function names and a native computer boolean.');
    }
    const selected = new Set<string>();
    const nameCount = names.length;
    for (let index = 0; index < nameCount; index += 1) {
      const name = names[index];
      if (
        typeof name !== 'string' ||
        selected.has(name) ||
        (!this.functions.has(name) && !this.browserNames.has(name))
      ) {
        throw new TypeError('Early function names must be unique and registered.');
      }
      selected.add(name);
    }
    return { functions: selected, computer: computer === true };
  }

  private static prepareRequestTools(tools: Tool[]) {
    const requestTools = tools.map((tool): Tool => {
      const { type } = tool;
      // Copy server declarations with their captured type, retaining ordinary parser identities.
      switch (type) {
        case 'web_search': {
          return { ...tool, type: 'web_search' };
        }
        case 'web_search_2025_08_26': {
          return { ...tool, type: 'web_search_2025_08_26' };
        }
        case 'file_search': {
          return { ...tool, type: 'file_search' };
        }
        case 'web_search_preview':
        case 'web_search_preview_2025_03_11': {
          return { ...tool, type };
        }
        case 'code_interpreter': {
          return { ...tool, type: 'code_interpreter' };
        }
        case 'image_generation': {
          return { ...tool, type: 'image_generation' };
        }
        case 'mcp': {
          return { ...tool, type: 'mcp' };
        }
        default: {
          return tool;
        }
      }
    });
    return { requestTools };
  }

  // oxlint-disable-next-line complexity -- Seven native server output variants share this one replay boundary.
  private static validateServer(
    item: Extract<ResponseOutputItem, { type: keyof typeof serverOutputs }>,
    tools?: readonly Tool[],
  ): void {
    if (tools && !serverDeclared(item, tools)) {
      throw new RunnerValidationError('Server output requires its declared tool and MCP server label.');
    }
    if (
      hasOwn(item, 'status') &&
      'status' in item &&
      item.status !== undefined &&
      item.status !== 'completed'
    ) {
      throw new RunnerValidationError(
        'Server tool did not complete. Inspect the environment before continuing.',
      );
    }
    if (!hasOwn(item, 'id') || typeof item.id !== 'string') {
      throw new RunnerValidationError('Server output requires its native ID before replay.');
    }
    let valid: boolean;
    switch (item.type) {
      case 'web_search_call': {
        const action = hasOwn(item, 'action') ? item.action : undefined;
        valid =
          hasOwn(item, 'status') &&
          item.status === 'completed' &&
          hasOwn(item, 'action') &&
          isObj(action) &&
          hasOwn(action, 'type');
        if (!valid || !action) {
          break;
        }
        switch (action.type) {
          case 'search': {
            const query = hasOwn(action, 'query') ? action.query : undefined;
            const queries = hasOwn(action, 'queries') ? action.queries : undefined;
            const sources = hasOwn(action, 'sources') ? action.sources : undefined;
            valid =
              (query === undefined || typeof query === 'string') &&
              (queries === undefined || Array.isArray(queries)) &&
              (sources === undefined || Array.isArray(sources));
            if (Array.isArray(queries)) {
              for (let index = 0; valid && index < queries.length; index += 1) {
                valid = hasOwn(queries, index) && typeof queries[index] === 'string';
              }
            }
            if (Array.isArray(sources)) {
              for (let index = 0; valid && index < sources.length; index += 1) {
                const source = hasOwn(sources, index) ? sources[index] : undefined;
                valid =
                  isObj(source) &&
                  hasOwn(source, 'type') &&
                  source['type'] === 'url' &&
                  hasOwn(source, 'url') &&
                  typeof source['url'] === 'string';
              }
            }
            break;
          }
          case 'open_page': {
            const url = hasOwn(action, 'url') ? action.url : undefined;
            valid = url === undefined || url === null || typeof url === 'string';
            break;
          }
          case 'find_in_page': {
            valid =
              hasOwn(action, 'pattern') &&
              typeof action.pattern === 'string' &&
              hasOwn(action, 'url') &&
              typeof action.url === 'string';
            break;
          }
          default: {
            valid = false;
          }
        }
        break;
      }
      case 'file_search_call': {
        const queries = hasOwn(item, 'queries') ? item.queries : undefined;
        const results = hasOwn(item, 'results') ? item.results : undefined;
        valid =
          hasOwn(item, 'status') &&
          item.status === 'completed' &&
          hasOwn(item, 'queries') &&
          Array.isArray(queries) &&
          (results === undefined || results === null || Array.isArray(results));
        if (valid && queries) {
          for (let index = 0; valid && index < queries.length; index += 1) {
            valid = hasOwn(queries, index) && typeof queries[index] === 'string';
          }
        }
        if (Array.isArray(results)) {
          for (let index = 0; valid && index < results.length; index += 1) {
            const result = hasOwn(results, index) ? results[index] : undefined;
            if (!isObj(result)) {
              valid = false;
              break;
            }
            for (const key of ['file_id', 'filename', 'text']) {
              valid &&= !hasOwn(result, key) || result[key] === undefined || typeof result[key] === 'string';
            }
            const score = hasOwn(result, 'score') ? result['score'] : undefined;
            const attributes = hasOwn(result, 'attributes') ? result['attributes'] : undefined;
            valid &&=
              (score === undefined || (typeof score === 'number' && Number.isFinite(score))) &&
              (attributes === undefined ||
                attributes === null ||
                (isObj(attributes) &&
                  Object.values(attributes).every(
                    (value) =>
                      typeof value === 'string' ||
                      typeof value === 'boolean' ||
                      (typeof value === 'number' && Number.isFinite(value)),
                  )));
          }
        }
        break;
      }
      case 'code_interpreter_call': {
        const outputs = hasOwn(item, 'outputs') ? item.outputs : undefined;
        valid =
          hasOwn(item, 'status') &&
          item.status === 'completed' &&
          hasOwn(item, 'container_id') &&
          typeof item.container_id === 'string' &&
          (tools === undefined ||
            tools.some(
              (tool) =>
                tool.type === 'code_interpreter' &&
                (tool.container === item.container_id ||
                  (isObj(tool.container) && tool.container.type === 'auto')),
            )) &&
          hasOwn(item, 'code') &&
          (typeof item.code === 'string' || item.code === null) &&
          hasOwn(item, 'outputs') &&
          (Array.isArray(outputs) || outputs === null);
        if (Array.isArray(outputs)) {
          for (let index = 0; valid && index < outputs.length; index += 1) {
            if (!hasOwn(outputs, index)) {
              valid = false;
              break;
            }
            const output = outputs[index];
            valid =
              isObj(output) &&
              hasOwn(output, 'type') &&
              ((output.type === 'logs' && hasOwn(output, 'logs') && typeof output.logs === 'string') ||
                (output.type === 'image' && hasOwn(output, 'url') && typeof output.url === 'string'));
          }
        }
        break;
      }
      case 'image_generation_call': {
        const action = hasOwn(item, 'action') ? item.action : undefined;
        const background = hasOwn(item, 'background') ? item.background : undefined;
        const format = hasOwn(item, 'output_format') ? item.output_format : undefined;
        const quality = hasOwn(item, 'quality') ? item.quality : undefined;
        const prompt = hasOwn(item, 'revised_prompt') ? item.revised_prompt : undefined;
        const size = hasOwn(item, 'size') ? item.size : undefined;
        valid =
          hasOwn(item, 'status') &&
          item.status === 'completed' &&
          hasOwn(item, 'result') &&
          (typeof item.result === 'string' || item.result === null) &&
          [undefined, null, 'generate', 'edit', 'auto'].includes(action) &&
          [undefined, null, 'transparent', 'opaque', 'auto'].includes(background) &&
          [undefined, null, 'png', 'webp', 'jpeg'].includes(format) &&
          [undefined, null, 'low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(quality) &&
          (prompt === undefined || prompt === null || typeof prompt === 'string') &&
          (size === undefined || size === null || typeof size === 'string');
        break;
      }
      case 'mcp_list_tools': {
        valid =
          hasOwn(item, 'server_label') &&
          typeof item.server_label === 'string' &&
          hasOwn(item, 'tools') &&
          Array.isArray(item.tools);
        for (let index = 0; valid && index < item.tools.length; index += 1) {
          if (!hasOwn(item.tools, index)) {
            valid = false;
            break;
          }
          const tool = item.tools[index];
          valid =
            isObj(tool) &&
            hasOwn(tool, 'name') &&
            typeof tool.name === 'string' &&
            hasOwn(tool, 'input_schema') &&
            (!hasOwn(tool, 'description') ||
              tool.description === undefined ||
              tool.description === null ||
              typeof tool.description === 'string');
        }
        break;
      }
      case 'mcp_call':
      case 'mcp_approval_request': {
        valid =
          hasOwn(item, 'server_label') &&
          typeof item.server_label === 'string' &&
          hasOwn(item, 'name') &&
          typeof item.name === 'string' &&
          hasOwn(item, 'arguments') &&
          typeof item.arguments === 'string' &&
          (item.type !== 'mcp_call' ||
            !hasOwn(item, 'output') ||
            item.output === undefined ||
            item.output === null ||
            typeof item.output === 'string');
        break;
      }
      default: {
        valid = false;
      }
    }
    if (!valid) {
      throw new RunnerValidationError('Server output requires its native fields before replay.');
    }
    if (
      (item.type === 'mcp_list_tools' || item.type === 'mcp_call') &&
      hasOwn(item, 'error') &&
      item.error !== undefined &&
      item.error !== null
    ) {
      throw new RunnerValidationError(
        'Server tool did not complete. Inspect the environment before continuing.',
      );
    }
    if (
      item.type === 'mcp_approval_request' &&
      (!item.id ||
        typeof item.id !== 'string' ||
        typeof item.name !== 'string' ||
        typeof item.arguments !== 'string')
    ) {
      throw new RunnerValidationError('MCP approval request requires its ID, name and arguments.');
    }
    ledgerCopy(toResponseInputItems([item]), true);
  }

  // oxlint-disable-next-line complexity -- Preflight the supported native output variants before sibling effects.
  private validateItem(item: ResponseOutputItem, tools?: readonly Tool[]): void {
    if (!hasOwn(item, 'type')) {
      throw new RunnerValidationError('Response output requires a native type before replay.');
    }
    if (isServerOutput(item)) {
      ResponsesToolRunner.validateServer(item, tools);
      return;
    }
    switch (item.type) {
      case 'message': {
        if (item.status !== 'completed') {
          throw new RunnerValidationError('Response message did not complete.');
        }
        if (!isNativeResponseMessage(item)) {
          throw new RunnerValidationError(
            'Response message requires native assistant content before replay.',
          );
        }
        break;
      }
      case 'reasoning': {
        if (!isNativeResponseReasoning(item)) {
          throw new RunnerValidationError('Response requires native reasoning content before replay.');
        }
        break;
      }
      case 'compaction': {
        if (
          !(['id', 'encrypted_content'] as const).every(
            (field) => hasOwn(item, field) && typeof item[field] === 'string',
          )
        ) {
          throw new RunnerValidationError('Response requires native compaction content before replay.');
        }
        break;
      }
      case 'computer_call': {
        if (!this.computer || typeof item.call_id !== 'string' || item.status !== 'completed') {
          throw new RunnerValidationError('Incomplete or unregistered computer call.');
        }
        ComputerToolset.validate(item);
        break;
      }
      case 'function_call': {
        if (
          !(['type', 'call_id', 'name', 'arguments'] as const).every(
            (field) => hasOwn(item, field) && typeof item[field] === 'string',
          ) ||
          ![undefined, null, 'completed'].includes(item.status) ||
          !ResponsesToolRunner.validFunctionMetadata(item) ||
          (!this.browserNames.has(item.name) && !this.functions.has(item.name))
        ) {
          throw new RunnerValidationError('Incomplete or unregistered function call.');
        }
        break;
      }
      default: {
        throw new RunnerValidationError('Unsupported response output item.');
      }
    }
    ledgerCopy(toResponseInputItems([item]), true);
  }

  private static validFunctionMetadata(item: Extract<ResponseInputItem, { type: 'function_call' }>): boolean {
    const id = hasOwn(item, 'id') ? item.id : undefined;
    const asynchronous = hasOwn(item, 'async') ? item.async : undefined;
    const namespace = hasOwn(item, 'namespace') ? item.namespace : undefined;
    const caller = hasOwn(item, 'caller') ? item.caller : undefined;
    return (
      (id === undefined || typeof id === 'string') &&
      (asynchronous === undefined || typeof asynchronous === 'boolean') &&
      (namespace === undefined || typeof namespace === 'string') &&
      ResponsesToolRunner.validFunctionCaller(caller)
    );
  }

  private static validFunctionCaller(caller: unknown): boolean {
    return (
      caller === undefined ||
      caller === null ||
      (isObj(caller) &&
        hasOwn(caller, 'type') &&
        (caller['type'] === 'direct' ||
          (caller['type'] === 'program' &&
            hasOwn(caller, 'caller_id') &&
            typeof caller['caller_id'] === 'string')))
    );
  }

  private static async dispatchMcp(
    item: ResponseOutputItem.McpApprovalRequest,
    step: number,
    maxSteps: number,
    turn: RunnerTurn,
    attempted: string[],
    attemptedIds: Set<string>,
    completed: string[],
    options: ResponsesRunnerOptions,
    signal?: AbortSignal,
    record?: () => Promise<void>,
  ): Promise<void> {
    if (step >= maxSteps - 1) {
      throw new RunnerValidationError('ResponsesToolRunner reached maxSteps.');
    }
    if (attemptedIds.has(item.id)) {
      throw new RunnerValidationError('Invalid or duplicate MCP approval request.');
    }
    attemptedIds.add(item.id);
    attempted.push(item.id);
    await record?.();
    const approve = await ResponsesToolRunner.decideMcpApproval(item, options, signal);
    turn.outputs.push({ type: 'mcp_approval_response', approval_request_id: item.id, approve });
    completed.push(item.id);
    await record?.();
  }

  private static async decideMcpApproval(
    item: ResponseInputItem.McpApprovalRequest,
    options: ResponsesRunnerOptions,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const started = performance.now();
    let approve: boolean;
    try {
      signal?.throwIfAborted();
      const answer = await options.approveMcp?.(structuredClone(item));
      signal?.throwIfAborted();
      if (typeof answer !== 'boolean') {
        throw new RunnerValidationError('MCP approval requires a literal true or false from approveMcp.');
      }
      approve = answer;
      reportDiagnostic(
        options.onDiagnostic,
        {
          api: 'responses',
          stage: 'approval',
          reason: approve ? 'completed' : 'refused',
          call_id: item.id,
          member: item.name,
        },
        started,
      );
      signal?.throwIfAborted();
    } catch (error) {
      reportDiagnostic(
        options.onDiagnostic,
        {
          api: 'responses',
          stage: 'approval',
          reason: diagnosticFailure('approval', signal),
          call_id: item.id,
          member: item.name,
        },
        started,
      );
      throw error;
    }
    return approve;
  }

  private async dispatch(
    raw: ResponseOutputItem,
    step: number,
    maxSteps: number,
    turn: RunnerTurn,
    attempted: string[],
    attemptedIds: Set<string>,
    completed: string[],
    options: ResponsesRunnerOptions,
    signal?: AbortSignal,
    supplied?: ReadonlyMap<string, ResponseInputItem.FunctionCallOutput>,
    record?: () => Promise<void>,
  ): Promise<void> {
    signal?.throwIfAborted();
    this.validateItem(raw);
    const item = structuredClone(raw);
    if (item.type === 'mcp_approval_request') {
      await ResponsesToolRunner.dispatchMcp(
        item,
        step,
        maxSteps,
        turn,
        attempted,
        attemptedIds,
        completed,
        options,
        signal,
        record,
      );
      return;
    }
    if (
      item.type === 'message' ||
      item.type === 'reasoning' ||
      item.type === 'compaction' ||
      isServerOutput(item)
    ) {
      return;
    }
    if (item.type !== 'computer_call' && item.type !== 'function_call') {
      throw new RunnerValidationError('Unsupported response output item.');
    }
    const complete =
      item.type === 'function_call'
        ? [undefined, null, 'completed'].includes(item.status)
        : item.status === 'completed';
    if (!complete || attemptedIds.has(item.call_id)) {
      throw new RunnerValidationError('Invalid or duplicate completed call.');
    }
    if (step >= maxSteps - 1) {
      throw new RunnerValidationError('ResponsesToolRunner reached maxSteps.');
    }
    attemptedIds.add(item.call_id);
    attempted.push(item.call_id);
    await record?.();
    signal?.throwIfAborted();
    await this.dispatchTool(item, turn, options, signal, supplied);
    completed.push(item.call_id);
    await record?.();
    if (record && turn.browserFailed) {
      // Existing browser errors include mutate-then-throw. Returned does not mean no effect.
      throw new RunnerValidationError('Ledger run needs external reconciliation.');
    }
    signal?.throwIfAborted();
  }

  private async dispatchTool(
    item: Extract<ResponseOutputItem, { type: 'computer_call' | 'function_call' }>,
    turn: RunnerTurn,
    options: ResponsesRunnerOptions,
    signal?: AbortSignal,
    supplied?: ReadonlyMap<string, ResponseInputItem.FunctionCallOutput>,
  ): Promise<void> {
    if (item.type === 'computer_call') {
      if (!this.computer) {
        throw new RunnerValidationError('Computer call has no registered tool.');
      }
      const policy = options.computerOptions;
      const approveSafetyChecks = policy?.approveSafetyChecks;
      const beforeAction = policy?.beforeAction;
      const onDiagnostic = options.onDiagnostic ?? policy?.onDiagnostic;
      const output = await this.computer.execute(item, {
        signal,
        ...(approveSafetyChecks === undefined
          ? {}
          : { approveSafetyChecks: approveSafetyChecks.bind(policy) }),
        ...(beforeAction === undefined ? {} : { beforeAction: beforeAction.bind(policy) }),
        ...(onDiagnostic === undefined ? {} : { onDiagnostic }),
      });
      turn.outputs.push(turn.plainOutputs ? structuredClone(output) : output);
    } else if (this.browserNames.has(item.name) && this.browser) {
      const result = await this.browser.executeWithStatus(
        item,
        signal,
        turn.browserFailed,
        options.onDiagnostic,
      );
      turn.outputs.push(turn.plainOutputs ? structuredClone(result.output) : result.output);
      turn.browserFailed ||= !result.ok;
    } else {
      turn.outputs.push(
        await ResponsesToolRunner.executeFunction(
          item,
          turn.functions,
          supplied,
          options.onDiagnostic,
          signal,
        ),
      );
    }
  }

  private prepareFunction(
    item: ResponseOutputItem,
    turn: RunnerTurn,
    onDiagnostic?: RunnerDiagnosticObserver,
    signal?: AbortSignal,
  ): void {
    if (item.type !== 'function_call' || turn.functions.has(item.call_id)) {
      return;
    }
    const fn = this.functions.get(item.name);
    if (!fn) {
      return;
    }
    const started = performance.now();
    try {
      const args: unknown = JSON.parse(item.arguments);
      if (!isObj(args)) {
        throw new RunnerValidationError('Function arguments must be an object.');
      }
      const { execute, prepare } = fn;
      turn.functions.set(
        item.call_id,
        prepare ? prepare(args) : () => (signal ? execute(args, { signal }) : execute(args)),
      );
    } catch (error) {
      reportDiagnostic(
        onDiagnostic,
        {
          api: 'responses',
          stage: 'arguments',
          reason: 'invalid_input',
          call_id: item.call_id,
          member: item.name,
        },
        started,
      );
      throw error;
    }
  }

  private static async executeFunction(
    item: ResponseFunctionToolCall,
    functions: RunnerTurn['functions'],
    supplied?: ReadonlyMap<string, ResponseInputItem.FunctionCallOutput>,
    onDiagnostic?: RunnerDiagnosticObserver,
    signal?: AbortSignal,
  ): Promise<ResponseInputItem.FunctionCallOutput> {
    const output = supplied?.get(item.call_id);
    if (output) {
      return output;
    }
    const execute = functions.get(item.call_id);
    if (!execute) {
      throw new RunnerValidationError('Function call was not prepared.');
    }
    let started = performance.now();
    const diagnostic: Pick<RunnerDiagnostic, 'stage'> = { stage: 'action' };
    try {
      const result = await execute();
      const actionStarted = started;
      diagnostic.stage = 'output';
      started = performance.now();
      try {
        return { type: 'function_call_output', call_id: item.call_id, output: suppliedResult(result) };
      } finally {
        reportDiagnostic(
          onDiagnostic,
          {
            api: 'responses',
            stage: 'action',
            reason: 'completed',
            call_id: item.call_id,
            member: item.name,
          },
          actionStarted,
        );
      }
    } catch (error) {
      reportDiagnostic(
        onDiagnostic,
        {
          api: 'responses',
          stage: diagnostic.stage,
          call_id: item.call_id,
          member: item.name,
          reason: diagnosticFailure(diagnostic.stage, signal),
        },
        started,
      );
      throw error;
    }
  }

  private static async streamResponse(
    client: OpenAI,
    body: ResponseCreateParamsNonStreaming,
    options: ResponsesRunnerOptions,
    onDone: (index: number, item: ResponseOutputItem) => Promise<void>,
    signal: AbortSignal | undefined,
    requestOptions: OpenAI.RequestOptions | undefined,
  ): Promise<Response> {
    const stream = client.responses.stream({ ...body, stream: true }, requestOptions);
    try {
      for await (const event of stream) {
        // Ordered callbacks and effects must finish before processing another item.
        // oxlint-disable-next-line no-await-in-loop
        await options.onEvent?.(structuredClone(event));
        signal?.throwIfAborted();
        if (options.eager === true && event.type === 'response.output_item.done') {
          // Record completed observations before validating or starting any side effects.
          // oxlint-disable-next-line no-await-in-loop
          await onDone(event.output_index, event.item);
        }
      }
      // oxlint-disable-next-line no-await-in-loop
      return await stream.finalResponse();
    } finally {
      stream.abort();
    }
  }

  private prepareTools(params: ResponseCreateParamsNonStreaming): Tool[] {
    const source = hasOwn(params, 'tools') ? (params.tools ?? []) : [];
    const { length } = source;
    if (!Array.isArray(source) || !Number.isSafeInteger(length) || length < 0) {
      throw new TypeError('Tools must contain valid entries.');
    }
    const supplied = Array.from({ length }, (_, index) => {
      if (!hasOwn(source, index)) {
        throw new TypeError('Tools must contain valid entries.');
      }
      const tool = source[index];
      if (!tool) {
        throw new TypeError('Tools must contain valid entries.');
      }
      const declaration = { ...tool };
      if (!hasOwn(declaration, 'type')) {
        throw new TypeError('Tools must contain valid entries.');
      }
      return declaration;
    });
    if (
      params.stream ||
      params.background ||
      (params.conversation !== undefined && params.conversation !== null) ||
      (params.previous_response_id !== undefined && params.previous_response_id !== null) ||
      supplied.filter((tool) => tool.type === 'computer' || tool.type === 'computer_use_preview').length >
        1 ||
      supplied.some(
        (tool) =>
          !allowedServerTypes.has(tool.type) &&
          (!this.computer || (tool.type !== 'computer' && tool.type !== 'computer_use_preview')),
      )
    ) {
      throw new TypeError(
        'ResponsesToolRunner requires foreground explicit input history and registered tools.',
      );
    }
    const labels = supplied
      .filter((tool): tool is Tool.Mcp => tool.type === 'mcp')
      .map((tool) => (hasOwn(tool, 'server_label') ? tool.server_label : undefined));
    if (
      labels.some((label) => typeof label !== 'string' || !label) ||
      new Set(labels).size !== labels.length
    ) {
      throw new TypeError('MCP server labels must be nonempty and unique.');
    }
    const tools: Tool[] = [...this.declarations, ...supplied];
    if (
      this.computer &&
      !supplied.some((tool) => tool.type === 'computer' || tool.type === 'computer_use_preview')
    ) {
      tools.push({ type: 'computer' });
    }
    return tools;
  }

  private overrideNames(): string[] {
    const names = [...this.outputOverrides];
    // oxlint-disable-next-line unicorn/no-array-sort -- Sort a fresh array; ES2020 lacks toSorted.
    names.sort();
    return names;
  }

  private static requestOptions(
    options: ResponsesRunnerOptions,
    signal: AbortSignal | undefined,
    hasMcp: boolean,
  ): OpenAI.RequestOptions | undefined {
    if (!options.ledger) {
      const supplied =
        signal && signal !== options.requestOptions?.signal
          ? overlayRequestOptions(options.requestOptions, { signal })
          : options.requestOptions;
      return hasMcp ? overlayRequestOptions(supplied, { maxRetries: 0 }) : supplied;
    }
    const supplied = options.requestOptions;
    const headers = supplied && configuredOption(supplied, 'headers');
    const timeout = supplied && configuredOption(supplied, 'timeout');
    const maxRetries = supplied && configuredOption(supplied, 'maxRetries');
    if (
      supplied &&
      (Object.keys(supplied).some((key) => !['headers', 'timeout', 'signal', 'maxRetries'].includes(key)) ||
        (maxRetries !== undefined && maxRetries !== 0))
    ) {
      throw new TypeError('Ledger requests require normal Responses transport without automatic retries.');
    }
    return {
      signal,
      headers: buildHeaders([headers]),
      ...(timeout === undefined ? {} : { timeout }),
      maxRetries: 0,
    };
  }

  // oxlint-disable-next-line complexity -- Ledger-only transport admission must preserve native non-ledger options.
  private prepareRun(params: ResponseCreateParamsNonStreaming, options: ResponsesRunnerOptions) {
    const { contextBudget, preparedParams } = ResponsesToolRunner.prepareBudget(params, options);
    const source = options.ledger?.resumeFrom;
    const maxSteps = options.maxSteps === undefined ? (source?.max_steps ?? 20) : options.maxSteps;
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || (options.eager && !options.stream)) {
      throw new TypeError('maxSteps must be positive; eager requires stream.');
    }
    const tools = this.prepareTools(preparedParams);
    ResponsesToolRunner.validateToolChoice(
      hasOwn(preparedParams, 'tool_choice') ? preparedParams.tool_choice : undefined,
      tools,
    );
    if (preparedParams.store === false && tools.some((tool) => tool.type === 'image_generation')) {
      throw new TypeError(
        'This runner requires stored responses to continue after image generation. Set store to true or use responses.create for a single request.',
      );
    }
    const suppliedInput = hasOwn(preparedParams, 'input') ? preparedParams.input : undefined;
    const input: ResponseInputItem[] =
      typeof suppliedInput === 'string'
        ? [{ role: 'user', content: suppliedInput }]
        : [...(suppliedInput === undefined ? [] : suppliedInput)];
    const include = [...(hasOwn(preparedParams, 'include') ? (preparedParams.include ?? []) : [])];
    if (!include.includes('reasoning.encrypted_content')) {
      include.push('reasoning.encrypted_content');
    }
    const signal =
      options.signal ??
      (options.ledger && options.requestOptions
        ? configuredOption(options.requestOptions, 'signal')
        : options.requestOptions?.signal) ??
      options.computerOptions?.signal ??
      undefined;
    const requestOptions = ResponsesToolRunner.requestOptions(
      options,
      signal,
      tools.some((tool) => tool.type === 'mcp'),
    );
    return { maxSteps, tools, input, include, signal, requestOptions, contextBudget, preparedParams };
  }

  private static prepareBudget(params: ResponseCreateParamsNonStreaming, options: ResponsesRunnerOptions) {
    const supplied = options.contextBudget;
    if (supplied === null || supplied === undefined) {
      if (!options.ledger) {
        let body: unknown;
        let input: unknown[] | undefined;
        let requestTools: unknown[] | undefined;
        let toolChoice: Record<string, unknown> | undefined;
        const items = new WeakSet<object>();
        const mcpTools = new WeakSet<object>();
        const approvalFilters = new WeakSet<object>();
        const toolFilters = new WeakSet<object>();
        // oxlint-disable-next-line complexity -- Capture arrays only on declared input, tool-choice and MCP permission paths.
        const encoded = JSON.stringify(params, function encoded(this: unknown, key: string, value: unknown) {
          if (key === '' && body === undefined) {
            body = value;
          }
          // Register the value after its normal JSON conversion, so a message
          // with toJSON still receives native content admission.
          if (this === input && isObj(value)) {
            items.add(value);
          }
          if (this === body && key === 'tool_choice' && isObj(value)) {
            toolChoice = { ...value };
            return toolChoice;
          }
          if (this === requestTools && isObj(value)) {
            const tool = { ...value };
            if (hasOwn(tool, 'type') && tool['type'] === 'mcp') {
              mcpTools.add(tool);
            }
            return tool;
          }
          if (isObj(this) && isObj(value)) {
            if (mcpTools.has(this) && key === 'require_approval') {
              const approvals = { ...value };
              approvalFilters.add(approvals);
              return approvals;
            }
            if (
              (mcpTools.has(this) && key === 'allowed_tools') ||
              (approvalFilters.has(this) && (key === 'always' || key === 'never'))
            ) {
              const filter = { ...value };
              toolFilters.add(filter);
              return filter;
            }
          }
          const isInput = this === body && key === 'input';
          const isInclude = this === body && key === 'include';
          const isTools = this === body && key === 'tools';
          const isChoiceTools =
            this === toolChoice && toolChoice?.['type'] === 'allowed_tools' && key === 'tools';
          const isMcpPermissions =
            isObj(this) &&
            ((mcpTools.has(this) && key === 'allowed_tools') ||
              (toolFilters.has(this) && key === 'tool_names'));
          if (
            Array.isArray(value) &&
            (isInput ||
              isInclude ||
              isTools ||
              isChoiceTools ||
              isMcpPermissions ||
              (key === 'content' && isObj(this) && items.has(this)))
          ) {
            let error = 'Native input and content require dense arrays.';
            if (isInclude) {
              error = 'Native include fields require dense arrays.';
            } else if (isTools || isChoiceTools || isMcpPermissions) {
              error = 'Native request tools require dense arrays.';
            }
            const { length } = value;
            if (!Number.isSafeInteger(length) || length < 0) {
              throw new TypeError(error);
            }
            const captured: unknown[] = [];
            for (let index = 0; index < length; index += 1) {
              if (!hasOwn(value, index)) {
                throw new TypeError(error);
              }
              captured.push(value[index]);
            }
            if (isInput) {
              input = captured;
            }
            if (isTools) {
              requestTools = captured;
            }
            return captured;
          }
          return value;
        });
        // SAFETY: prepareTools validates the serialized admission fields before the request can reach the API.
        const preparedParams = JSON.parse(encoded) as ResponseCreateParamsNonStreaming;
        return { contextBudget: null, preparedParams };
      }
      const preparedParams = { ...params };
      if (hasOwn(preparedParams, 'tool_choice') && preparedParams.tool_choice !== undefined) {
        preparedParams.tool_choice = structuredClone(preparedParams.tool_choice);
      }
      return { contextBudget: null, preparedParams };
    }
    // SAFETY: Only declared data descriptors survive. Validate their types before exposing them.
    const contextBudget = outputRecord(supplied, [
      'maxInputBytes',
      'maxInputImages',
      'keepRecentScreenshots',
      'compact',
    ]) as Partial<ResponsesContextBudget>;
    // Capture native request data before iterators run, omitting optional undefined fields as JSON does.
    const preparedParams = ledgerCopy(params, true);
    if (
      typeof contextBudget.maxInputBytes !== 'number' ||
      !Number.isSafeInteger(contextBudget.maxInputBytes) ||
      contextBudget.maxInputBytes < 1 ||
      typeof contextBudget.maxInputImages !== 'number' ||
      !Number.isSafeInteger(contextBudget.maxInputImages) ||
      contextBudget.maxInputImages < 0 ||
      (contextBudget.keepRecentScreenshots !== undefined &&
        (!Number.isSafeInteger(contextBudget.keepRecentScreenshots) ||
          contextBudget.keepRecentScreenshots < 1)) ||
      (contextBudget.compact !== undefined && typeof contextBudget.compact !== 'function') ||
      preparedParams.truncation === 'auto' ||
      Boolean(preparedParams.context_management?.length)
    ) {
      throw new TypeError('Context budget requires valid local bounds and no automatic compaction.');
    }
    return {
      preparedParams,
      contextBudget: {
        ...contextBudget,
        maxInputBytes: contextBudget.maxInputBytes,
        maxInputImages: contextBudget.maxInputImages,
      },
    };
  }

  private static validateToolChoice(
    choice: ResponseCreateParamsNonStreaming['tool_choice'],
    tools: Tool[],
  ): void {
    const forcedLocal =
      choice === 'required'
        ? tools.length > 0 && tools.every(ResponsesToolRunner.isLocalChoice)
        : typeof choice === 'object' &&
          choice !== null &&
          (choice.type === 'allowed_tools'
            ? choice.mode === 'required' &&
              choice.tools.length > 0 &&
              choice.tools.every(ResponsesToolRunner.isLocalChoice)
            : ResponsesToolRunner.isLocalChoice(choice));
    if (forcedLocal) {
      throw new TypeError(
        'ResponsesToolRunner cannot finish when tool_choice always requires a local tool. Use auto or responses.create for a single forced request.',
      );
    }
  }

  private static isLocalChoice(tool: { type?: unknown }): boolean {
    return (
      tool.type === 'function' ||
      tool.type === 'computer' ||
      tool.type === 'computer_use' ||
      tool.type === 'computer_use_preview'
    );
  }

  // oxlint-disable-next-line complexity -- Capture registered and supported server choices at the request boundary.
  private static localSelection(
    choice: ResponseCreateParamsNonStreaming['tool_choice'],
  ): LocalToolSelection | undefined {
    if (choice === undefined || choice === null || choice === 'auto' || choice === 'required') {
      return undefined;
    }
    const choices =
      typeof choice === 'object' && hasOwn(choice, 'type') && choice.type === 'allowed_tools'
        ? choice.tools
        : [choice];
    const functions = new Set<string>();
    const mcp: { serverLabel: string; name: string | null }[] = [];
    const server = new Set<string>();
    let computer = false;
    for (const tool of choices) {
      if (!isObj(tool) || !hasOwn(tool, 'type')) {
        continue;
      }
      if (tool['type'] === 'function' && hasOwn(tool, 'name') && typeof tool['name'] === 'string') {
        functions.add(tool['name']);
      } else if (tool['type'] !== 'function' && ResponsesToolRunner.isLocalChoice(tool)) {
        computer = true;
      } else if (tool['type'] === 'mcp') {
        const serverLabel = hasOwn(tool, 'server_label') ? tool['server_label'] : undefined;
        const name = hasOwn(tool, 'name') ? tool['name'] : undefined;
        if (
          typeof serverLabel === 'string' &&
          (name === null || name === undefined || typeof name === 'string')
        ) {
          mcp.push({ serverLabel, name: name ?? null });
        }
      } else if (typeof tool['type'] === 'string' && allowedServerTypes.has(tool['type'])) {
        server.add(tool['type']);
      }
    }
    return { functions, computer, mcp, server };
  }

  private static mcpApprovalPolicy(declaration: Tool.Mcp, name: string): 'always' | 'never' | undefined {
    const policy = hasOwn(declaration, 'require_approval') ? declaration.require_approval : undefined;
    if (policy === undefined || policy === null) {
      return 'always';
    }
    if (policy === 'always' || policy === 'never') {
      return policy;
    }
    let matched: 'always' | 'never' | undefined;
    for (const rule of ['always', 'never'] as const) {
      if (!hasOwn(policy, rule)) {
        continue;
      }
      const filter = policy[rule];
      if (
        !filter ||
        hasOwn(filter, 'read_only') ||
        (hasOwn(filter, 'tool_names') && !Array.isArray(filter.tool_names))
      ) {
        return undefined;
      }
      if (
        !hasOwn(filter, 'tool_names') ||
        (Array.isArray(filter.tool_names) && filter.tool_names.includes(name))
      ) {
        if (matched !== undefined) {
          return undefined;
        }
        matched = rule;
      }
    }
    if (matched !== undefined || hasOwn(policy, 'always') === hasOwn(policy, 'never')) {
      return matched;
    }
    return hasOwn(policy, 'always') ? 'never' : 'always';
  }

  // oxlint-disable-next-line complexity -- Check captured MCP declarations and request-specific choices at one admission boundary.
  private static validateSelection(
    item: ResponseOutputItem,
    selection: LocalToolSelection | undefined,
    tools: readonly Tool[],
  ): void {
    if (item.type === 'function_call') {
      const declaration = tools.find(
        (tool): tool is FunctionTool => tool.type === 'function' && tool.name === item.name,
      );
      const allowed =
        declaration && hasOwn(declaration, 'allowed_callers') ? declaration.allowed_callers : undefined;
      if (allowed !== undefined && allowed !== null) {
        const caller = hasOwn(item, 'caller') ? item.caller : undefined;
        const kind =
          isObj(caller) && hasOwn(caller, 'type') && caller.type === 'program' ? 'programmatic' : 'direct';
        if (!Array.isArray(allowed) || !allowed.includes(kind)) {
          throw new RunnerValidationError('Function call uses a caller excluded by allowed_callers.');
        }
      }
    }
    if (item.type === 'mcp_approval_request' || item.type === 'mcp_call') {
      const declaration = tools.find(
        (tool): tool is Tool.Mcp => tool.type === 'mcp' && tool.server_label === item.server_label,
      );
      const policy = declaration && ResponsesToolRunner.mcpApprovalPolicy(declaration, item.name);
      if (item.type === 'mcp_approval_request' && policy === 'never') {
        throw new RunnerValidationError('MCP approval request contradicts require_approval.');
      }
      if (
        item.type === 'mcp_call' &&
        policy === 'always' &&
        (!hasOwn(item, 'approval_request_id') ||
          item.approval_request_id === undefined ||
          item.approval_request_id === null)
      ) {
        throw new RunnerValidationError('MCP call requires a matching approval request.');
      }
      const allowed =
        declaration && hasOwn(declaration, 'allowed_tools') ? declaration.allowed_tools : undefined;
      let names: unknown;
      if (Array.isArray(allowed)) {
        names = allowed;
      } else if (isObj(allowed) && hasOwn(allowed, 'tool_names')) {
        names = allowed['tool_names'];
      }
      if (names !== undefined && (!Array.isArray(names) || !names.includes(item.name))) {
        throw new RunnerValidationError('MCP response names a tool excluded by allowed_tools.');
      }
    }
    if (
      selection &&
      ((item.type === 'function_call' && !selection.functions.has(item.name)) ||
        (item.type === 'computer_call' && !selection.computer) ||
        ((item.type === 'mcp_approval_request' || item.type === 'mcp_call') &&
          !selection.mcp.some(
            (tool) =>
              tool.serverLabel === item.server_label && (tool.name === null || tool.name === item.name),
          )))
    ) {
      throw new RunnerValidationError('Response contains a local tool excluded by tool_choice.');
    }
    if (selection && isServerOutput(item)) {
      const types: readonly Tool['type'][] = serverOutputs[item.type];
      if (!types.includes('mcp') && !types.some((kind) => selection.server.has(kind))) {
        throw new RunnerValidationError('Response contains a server tool excluded by tool_choice.');
      }
    }
  }

  private validateBoundary(value: ResponsesRunnerCheckpoint, tools: Tool[]): void {
    if (
      Object.keys(value).length !== 14 ||
      value.version !== 1 ||
      typeof value.run_id !== 'string' ||
      !value.run_id ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      value.revision >= Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(value.max_steps) ||
      value.max_steps < 1 ||
      !Number.isSafeInteger(value.consumed_requests) ||
      value.consumed_requests < 0 ||
      value.consumed_requests > value.max_steps ||
      value.phase !== 'boundary'
    ) {
      throw new TypeError('Invalid or unresolved ledger boundary.');
    }
    this.validateLedgerArrays(value);
    const returned = this.validateHistory(value.history, tools);
    if (
      new Set(value.attempted_call_ids).size !== value.attempted_call_ids.length ||
      value.attempted_call_ids.some((id) => typeof id !== 'string' || !returned.has(id))
    ) {
      throw new TypeError('Ledger receipts have unresolved calls.');
    }
  }

  private validateLedgerArrays(value: ResponsesRunnerCheckpoint): void {
    if (
      !Array.isArray(value.history) ||
      !Array.isArray(value.attempted_call_ids) ||
      !Array.isArray(value.returned_call_ids) ||
      !Array.isArray(value.pending_items) ||
      !Array.isArray(value.returned_outputs) ||
      value.pending_items.length !== 0 ||
      value.returned_outputs.length !== 0 ||
      value.final_response !== null ||
      ledgerJSON(value.output_override_names) !== ledgerJSON(this.overrideNames()) ||
      ledgerJSON(value.attempted_call_ids) !== ledgerJSON(value.returned_call_ids)
    ) {
      throw new TypeError('Ledger registry or receipts have changed.');
    }
  }

  // oxlint-disable-next-line complexity -- Validate the complete replay sequence before storage or transport.
  private validateHistory(history: ResponseInputItem[], tools: Tool[], budgetOnly = false): Set<string> {
    ResponsesToolRunner.seenOutputIds(history);
    const calls = new Map<string, string>();
    const returned = new Set<string>();
    const requests = new Map<string, ResponseInputItem.McpApprovalRequest | null>();
    const approved = new Map<string, ResponseInputItem.McpApprovalRequest>();
    for (const [index, item] of history.entries()) {
      if (!isObj(item)) {
        throw new TypeError('Ledger history must contain native input items.');
      }
      if (budgetOnly) {
        if (item.type === 'compaction_trigger') {
          if (index !== history.length - 1) {
            throw new TypeError('A compaction trigger must be the final input item.');
          }
          continue;
        }
        if (
          item.type === 'item_reference' ||
          ((item.type === undefined || item.type === null) &&
            !hasOwn(item, 'role') &&
            !hasOwn(item, 'content') &&
            hasOwn(item, 'id'))
        ) {
          if (!('id' in item) || typeof item.id !== 'string') {
            throw new TypeError('Item references require a native string ID.');
          }
          continue;
        }
      }
      if (!hasOwn(item, 'type')) {
        if (!isNativeResponseMessageInput(item)) {
          throw new TypeError('Ledger message needs a role and content.');
        }
        continue;
      }
      collectMcpApproval(item, requests, approved);
      if (item.type === 'function_call' || item.type === 'computer_call') {
        this.validateHistoricalCall(item, calls);
      } else if (item.type === 'mcp_approval_request') {
        ResponsesToolRunner.validateHistoricalObservation(item, tools, approved);
        if (!item.id || calls.has(item.id) || !serverDeclared(item, tools)) {
          throw new TypeError('Ledger MCP approval request needs a unique ID and declared server.');
        }
        calls.set(item.id, 'mcp_approval_request');
      } else if (item.type === 'mcp_approval_response') {
        const id = hasOwn(item, 'id') ? item.id : undefined;
        const reason = hasOwn(item, 'reason') ? item.reason : undefined;
        if (
          !hasOwn(item, 'approval_request_id') ||
          !hasOwn(item, 'approve') ||
          calls.get(item.approval_request_id) !== 'mcp_approval_request' ||
          returned.has(item.approval_request_id) ||
          typeof item.approve !== 'boolean' ||
          (id !== undefined && id !== null && typeof id !== 'string') ||
          (reason !== undefined && reason !== null && typeof reason !== 'string')
        ) {
          throw new TypeError('Ledger MCP approval response has no matching request.');
        }
        returned.add(item.approval_request_id);
      } else if (item.type === 'function_call_output' || item.type === 'computer_call_output') {
        const id = hasOwn(item, 'call_id') ? item.call_id : undefined;
        if (
          typeof id !== 'string' ||
          calls.get(id) !== item.type.replace('_output', '') ||
          returned.has(id)
        ) {
          throw new TypeError('Ledger history contains orphan or repeated outputs.');
        }
        ResponsesToolRunner.validateHistoricalOutput(item);
        returned.add(id);
      } else {
        ResponsesToolRunner.validateHistoricalObservation(item, tools, approved);
      }
    }
    if (calls.size !== returned.size) {
      throw new TypeError('Ledger history has unresolved calls.');
    }
    return returned;
  }

  // oxlint-disable-next-line complexity -- Keep call identity, registration and native action checks together.
  private validateHistoricalCall(
    item: Extract<ResponseInputItem, { type: 'function_call' | 'computer_call' }>,
    calls: Map<string, string>,
  ): void {
    const status = hasOwn(item, 'status') ? item.status : undefined;
    if (
      !hasOwn(item, 'call_id') ||
      typeof item.call_id !== 'string' ||
      calls.has(item.call_id) ||
      (status !== undefined && status !== null && status !== 'completed')
    ) {
      throw new TypeError('Ledger history has duplicate, missing or incomplete call IDs.');
    }
    if (item.type === 'function_call') {
      if (
        !hasOwn(item, 'name') ||
        !hasOwn(item, 'arguments') ||
        (!this.browserNames.has(item.name) && !this.functions.has(item.name)) ||
        !ResponsesToolRunner.validFunctionMetadata(item) ||
        typeof item.arguments !== 'string' ||
        !isObj(JSON.parse(item.arguments))
      ) {
        throw new TypeError('Ledger history contains an unregistered function.');
      }
    } else {
      if (!this.computer || !hasOwn(item, 'id') || typeof item.id !== 'string') {
        throw new TypeError('Ledger history contains an unregistered computer or missing item ID.');
      }
      const captured = ComputerToolset.validate(item);
      for (const action of captured.actions ?? (captured.action ? [captured.action] : [])) {
        ResponsesToolRunner.validateHistoricalAction(action);
      }
    }
    calls.set(item.call_id, item.type);
  }

  // oxlint-disable-next-line complexity -- Keep native action checks together; own-key validation also needs union narrowing.
  private static validateHistoricalAction(action: ComputerAction): void {
    if (
      ['click', 'double_click', 'move', 'scroll'].includes(action.type) &&
      !ResponsesToolRunner.validCoordinate(action)
    ) {
      throw new TypeError('Ledger computer coordinates must be integers.');
    }
    if (
      action.type === 'scroll' &&
      (!Number.isSafeInteger(action.scroll_x) || !Number.isSafeInteger(action.scroll_y))
    ) {
      throw new TypeError('Ledger computer scroll distances must be integers.');
    }
    if (action.type === 'click' && !['left', 'right', 'wheel', 'back', 'forward'].includes(action.button)) {
      throw new TypeError('Ledger computer click has an invalid button.');
    }
    if (
      action.type === 'drag' &&
      (!Array.isArray(action.path) || !action.path.every(ResponsesToolRunner.validCoordinate))
    ) {
      throw new TypeError('Ledger computer drag needs a coordinate path.');
    }
    if (action.type === 'type' && typeof action.text !== 'string') {
      throw new TypeError('Ledger computer typing needs text.');
    }
    if (
      hasOwn(action, 'keys') &&
      'keys' in action &&
      (action.type === 'keypress' || action.keys !== null) &&
      (!Array.isArray(action.keys) || action.keys.some((key) => typeof key !== 'string'))
    ) {
      throw new TypeError('Ledger computer keys must be strings.');
    }
    if (['keypress', 'double_click'].includes(action.type) && !hasOwn(action, 'keys')) {
      throw new TypeError('Ledger computer key fields are missing.');
    }
  }

  private static validCoordinate(value: unknown): boolean {
    return isObj(value) && Number.isSafeInteger(value['x']) && Number.isSafeInteger(value['y']);
  }

  // oxlint-disable-next-line complexity -- Check nullable input metadata and the matching native result before replay.
  private static validateHistoricalOutput(
    item: Extract<ResponseInputItem, { type: 'function_call_output' | 'computer_call_output' }>,
  ): void {
    const output = hasOwn(item, 'output') ? item.output : undefined;
    const id = hasOwn(item, 'id') ? item.id : undefined;
    const status = hasOwn(item, 'status') ? item.status : undefined;
    if (
      (id !== undefined && id !== null && typeof id !== 'string') ||
      (status !== undefined &&
        status !== null &&
        !['in_progress', 'completed', 'incomplete'].includes(status))
    ) {
      throw new TypeError('Ledger tool output has invalid native fields.');
    }
    if (item.type === 'function_call_output') {
      const name = hasOwn(item, 'name') ? item.name : undefined;
      const namespace = hasOwn(item, 'namespace') ? item.namespace : undefined;
      const caller = hasOwn(item, 'caller') ? item.caller : undefined;
      if (
        (name !== undefined && name !== null && typeof name !== 'string') ||
        (namespace !== undefined && namespace !== null && typeof namespace !== 'string') ||
        !ResponsesToolRunner.validFunctionCaller(caller)
      ) {
        throw new TypeError('Ledger function output has invalid native fields.');
      }
      suppliedResult(output);
      return;
    }
    const checks = hasOwn(item, 'acknowledged_safety_checks') ? item.acknowledged_safety_checks : undefined;
    if (
      checks !== undefined &&
      checks !== null &&
      (!Array.isArray(checks) ||
        checks.some(
          (check) =>
            !isObj(check) ||
            !hasOwn(check, 'id') ||
            typeof check.id !== 'string' ||
            (check.code !== undefined && check.code !== null && typeof check.code !== 'string') ||
            (check.message !== undefined && check.message !== null && typeof check.message !== 'string'),
        ))
    ) {
      throw new TypeError('Ledger computer output has invalid native fields.');
    }
    if (!isObj(output) || !hasOwn(output, 'type') || output['type'] !== 'computer_screenshot') {
      throw new TypeError('Ledger computer history needs a screenshot with image_url or file_id.');
    }
    const imageURL = hasOwn(output, 'image_url') ? output['image_url'] : undefined;
    const fileID = hasOwn(output, 'file_id') ? output['file_id'] : undefined;
    if (
      (imageURL !== undefined && imageURL !== null && typeof imageURL !== 'string') ||
      (fileID !== undefined && fileID !== null && typeof fileID !== 'string') ||
      (!(typeof imageURL === 'string' && imageURL.trim()) && !(typeof fileID === 'string' && fileID.trim()))
    ) {
      throw new TypeError('Ledger computer history needs a screenshot with image_url or file_id.');
    }
  }

  private static validateHistoricalObservation(
    item: ResponseInputItem,
    tools: Tool[],
    approved: Map<string, ResponseInputItem.McpApprovalRequest>,
  ): void {
    if (isServerOutput(item)) {
      try {
        ResponsesToolRunner.validateServer(item, tools);
      } catch {
        throw new TypeError('Ledger history contains an undeclared or unresolved server tool.');
      }
      if (item.type === 'mcp_call') {
        validateMcpCall(item, approved, OpenAIError);
      }
      return;
    }
    switch (item.type) {
      case 'message':
      case undefined: {
        if (!isNativeResponseMessageInput(item)) {
          throw new TypeError('Ledger message needs a role and content.');
        }
        break;
      }
      case 'reasoning': {
        if (!isNativeResponseReasoning(item)) {
          throw new TypeError('Ledger history requires native reasoning fields.');
        }
        break;
      }
      case 'compaction': {
        const encrypted = hasOwn(item, 'encrypted_content') ? item.encrypted_content : undefined;
        const id = hasOwn(item, 'id') ? item.id : undefined;
        if (typeof encrypted !== 'string' || (id !== undefined && id !== null && typeof id !== 'string')) {
          throw new TypeError('Ledger compaction needs native encrypted content.');
        }
        break;
      }
      default: {
        throw new TypeError('Ledger history contains unsupported items.');
      }
    }
  }

  // oxlint-disable-next-line complexity -- Compare a resumed checkpoint to the new checkpoint before any recorder or transport call.
  private async prepareLedger(
    params: ResponseCreateParamsNonStreaming,
    options: ResponsesRunnerOptions,
    maxSteps: number,
    tools: Tool[],
    input: ResponseInputItem[],
  ) {
    const config = options.ledger;
    if (!config) {
      const attempted: string[] = [];
      const completed: string[] = [];
      return {
        parameters: params,
        declarations: tools,
        attempted,
        completed,
        ledger: undefined,
        record: undefined,
      };
    }
    if (typeof config.runId !== 'string' || !config.runId || typeof config.save !== 'function') {
      throw new TypeError('A ledger requires a nonempty run ID and recorder.');
    }
    const resume = ledgerCopy(config.resumeFrom ?? null);
    const attempted = [...(resume?.attempted_call_ids ?? [])];
    const completed = [...(resume?.returned_call_ids ?? [])];
    // Snapshot all body data before save callbacks can change caller-owned params.
    const parameters = ledgerCopy({ ...params, tools }, true);
    const declarations = ledgerCopy(tools, true);
    const freshInput = ledgerCopy(input, true);
    const { runId } = config;
    const save = config.save.bind(config);
    const savedTools = await ledgerTools(declarations);
    const ledger: ResponsesRunnerCheckpoint = {
      version: 1,
      run_id: runId,
      revision: resume?.revision ?? 0,
      phase: 'boundary',
      max_steps: maxSteps,
      consumed_requests: resume?.consumed_requests ?? 0,
      tools: savedTools,
      output_override_names: this.overrideNames(),
      history: freshInput,
      attempted_call_ids: attempted,
      returned_call_ids: completed,
      pending_items: [],
      returned_outputs: [],
      final_response: null,
    };
    const record = async () => {
      const revision = ledger.revision + 1;
      if (!Number.isSafeInteger(revision) || revision <= ledger.revision) {
        throw new TypeError('Ledger revision is exhausted.');
      }
      ledger.revision = revision;
      await save(ledgerCopy(ledger));
    };
    if (resume !== null) {
      const keys = Object.keys(ledger);
      if (Object.keys(resume).length !== keys.length || keys.some((key) => !hasOwn(resume, key))) {
        throw new TypeError('Resume requires the exact current checkpoint fields.');
      }
      this.validateBoundary(resume, declarations);
      if (
        ledgerJSON(resume.tools) !== ledgerJSON(savedTools) ||
        resume.run_id !== ledger.run_id ||
        resume.revision < 1 ||
        maxSteps !== resume.max_steps ||
        !ResponsesToolRunner.hasCurrentObservation(freshInput)
      ) {
        throw new TypeError('A resume needs matching identity/budget and a fresh input.');
      }
    }
    ledger.history = resume ? [...resume.history, ...freshInput] : freshInput;
    this.validateBoundary(ledger, declarations);
    return { ledger, record, parameters, declarations, attempted, completed };
  }

  private static hasCurrentObservation(input: ResponseInputItem[]): boolean {
    return input.some((item) => {
      if (
        !isObj(item) ||
        (hasOwn(item, 'type') && item.type !== undefined && item.type !== 'message') ||
        !hasOwn(item, 'role') ||
        !('role' in item) ||
        item.role !== 'user' ||
        !hasOwn(item, 'content') ||
        !('content' in item)
      ) {
        return false;
      }
      const { content } = item;
      if (typeof content === 'string') {
        return content.trim().length > 0;
      }
      if (!Array.isArray(content)) {
        return false;
      }
      try {
        const blocks = content.map(suppliedBlock);
        return blocks.some((block) => block.type !== 'input_text' || block.text.trim().length > 0);
      } catch {
        return false;
      }
    });
  }

  private async beginRequest(
    step: number,
    maxSteps: number,
    input: ResponseInputItem[],
    outputs: ResponseInputItem[],
    parameters: ResponseCreateParamsNonStreaming,
    tools: Tool[],
    ledger?: ResponsesRunnerCheckpoint,
    record?: () => Promise<void>,
    signal?: AbortSignal,
    contextBudget?: ResponsesContextBudget | null,
  ): Promise<ResponseInputItem[]> {
    if (!ledger) {
      if (!contextBudget) {
        return input;
      }
      this.validateHistory(input, tools, true);
      return this.budgetedInput(input, tools, contextBudget, parameters, true, signal);
    }
    if (step >= maxSteps) {
      throw new RunnerValidationError('ResponsesToolRunner reached maxSteps.');
    }
    ledger.phase = 'boundary';
    this.validateBoundary(ledger, tools);
    const history = contextBudget
      ? await this.budgetedInput(ledger.history, tools, contextBudget, parameters, false, signal)
      : ledger.history;
    ledger.consumed_requests = step + 1;
    if (tools.some((tool) => allowedServerTypes.has(tool.type))) {
      ledger.phase = 'pending';
    }
    // Save admission before transport, even if the process dies before receiving any item.
    await record?.();
    signal?.throwIfAborted();
    ledger.phase = 'pending';
    ledger.returned_outputs = outputs;
    return history;
  }

  private static measureInput(history: ResponseInputItem[]) {
    const serialized = ledgerJSON(history, true);
    const encoder = new TextEncoder();
    const buffer = new Uint8Array(65_536);
    let inputBytes = 0;
    for (let offset = 0; offset < serialized.length;) {
      let end = Math.min(offset + buffer.length, serialized.length);
      // Keep an astral code point intact if the bounded string window ends mid-pair.
      if (end < serialized.length && (serialized.codePointAt(end - 1) ?? 0) > 0xff_ff) {
        end -= 1;
      }
      // SAFETY: Native TextEncoder returns both counts; older DOM declarations mark them optional.
      const { read, written } = encoder.encodeInto(serialized.slice(offset, end), buffer) as {
        read: number;
        written: number;
      };
      offset += read;
      inputBytes += written;
    }
    let inputImages = 0;
    for (const item of history) {
      if (hasOwn(item, 'type') && item.type === 'computer_call_output') {
        inputImages += 1;
      } else {
        let content: unknown;
        if (hasOwn(item, 'type') && item.type === 'function_call_output') {
          content = item.output;
        } else if ('content' in item && hasOwn(item, 'content')) {
          ({ content } = item);
        }
        if (Array.isArray(content)) {
          inputImages += content.filter(
            (block) => isObj(block) && hasOwn(block, 'type') && block['type'] === 'input_image',
          ).length;
        }
      }
    }
    return { inputBytes, inputImages };
  }

  private async budgetedInput(
    history: ResponseInputItem[],
    tools: Tool[],
    budget: ResponsesContextBudget,
    parameters: ResponseCreateParamsNonStreaming,
    budgetOnly: boolean,
    signal?: AbortSignal,
  ): Promise<ResponseInputItem[]> {
    parameters.truncation = 'disabled';
    const size = ResponsesToolRunner.measureInput(history);
    if (size.inputBytes <= budget.maxInputBytes && size.inputImages <= budget.maxInputImages) {
      return history;
    }
    if (!budget.compact) {
      throw new RunnerValidationError('Responses input exceeds the context budget.');
    }
    const eligibleCallIds = this.budgetEligible(history, budget.keepRecentScreenshots ?? 1);
    signal?.throwIfAborted();
    const supplied = await budget.compact({
      history: ledgerCopy(history),
      eligibleCallIds: [...eligibleCallIds],
      ...size,
    });
    signal?.throwIfAborted();
    const projected = ResponsesToolRunner.compactHistory(history, eligibleCallIds, supplied);
    this.validateHistory(projected, tools, budgetOnly);
    const measured = ResponsesToolRunner.measureInput(projected);
    if (measured.inputBytes > budget.maxInputBytes || measured.inputImages > budget.maxInputImages) {
      throw new RunnerValidationError('Responses input still exceeds the context budget.');
    }
    return projected;
  }

  private budgetEligible(history: ResponseInputItem[], keepScreenshots: number): string[] {
    const pinned = new Set<string>();
    const screenshots: string[] = [];
    const imageOutputs = new Set(
      history
        .filter(
          (item): item is ResponseInputItem.FunctionCallOutput =>
            hasOwn(item, 'type') &&
            item.type === 'function_call_output' &&
            Array.isArray(item.output) &&
            item.output.some((block) => block.type === 'input_image'),
        )
        .map((item) => item.call_id),
    );
    const calls: Extract<ResponseInputItem, { type: 'function_call' | 'computer_call' }>[] = [];
    let latestBrowser: string | undefined;
    let latestComputer: string | undefined;
    for (const item of history) {
      if (!hasOwn(item, 'type')) {
        continue;
      }
      if (item.type === 'function_call') {
        calls.push(item);
        if (this.browserNames.has(item.name)) {
          latestBrowser = item.call_id;
          if (
            (item.name === 'browser_screenshot' || item.name === 'browser_zoom') &&
            imageOutputs.has(item.call_id)
          ) {
            screenshots.push(item.call_id);
          }
        }
      } else if (item.type === 'computer_call') {
        calls.push(item);
        latestComputer = item.call_id;
        screenshots.push(item.call_id);
        if (item.pending_safety_checks?.length) {
          pinned.add(item.call_id);
        }
      } else if (item.type === 'computer_call_output' && item.acknowledged_safety_checks?.length) {
        pinned.add(item.call_id);
      }
    }
    for (const id of screenshots.slice(-keepScreenshots)) {
      pinned.add(id);
    }
    if (latestBrowser !== undefined) {
      pinned.add(latestBrowser);
    }
    if (latestComputer !== undefined) {
      pinned.add(latestComputer);
    }
    return calls.filter((item) => !pinned.has(item.call_id)).map((item) => item.call_id);
  }

  private static compactableCallId(item: ResponseInputItem): string | undefined {
    if (!hasOwn(item, 'type') || !hasOwn(item, 'call_id')) {
      return undefined;
    }
    switch (item.type) {
      case 'function_call':
      case 'function_call_output':
      case 'computer_call':
      case 'computer_call_output': {
        return typeof item.call_id === 'string' ? item.call_id : undefined;
      }
      default: {
        return undefined;
      }
    }
  }

  private static compactHistory(history: ResponseInputItem[], eligibleCallIds: string[], supplied: unknown) {
    // The decision cannot run accessors or toJSON, change dispatch history, or add native outputs.
    const decision = ledgerValue(supplied, true);
    if (
      !isObj(decision) ||
      Array.isArray(decision) ||
      Object.keys(decision).some((key) => !['dropCallIds', 'summary'].includes(key)) ||
      !Array.isArray(decision['dropCallIds']) ||
      (decision['summary'] !== undefined && typeof decision['summary'] !== 'string')
    ) {
      throw new TypeError('Invalid context compaction decision.');
    }
    const dropped = new Set(decision['dropCallIds']);
    const eligible = new Set(eligibleCallIds);
    if (
      dropped.size !== decision['dropCallIds'].length ||
      [...dropped].some((id) => typeof id !== 'string' || !eligible.has(id))
    ) {
      throw new TypeError('Only eligible complete calls can be omitted.');
    }
    const projected: ResponseInputItem[] = [];
    if (typeof decision['summary'] === 'string') {
      projected.push({
        role: 'user',
        content: `Caller summary of omitted completed tool results: ${decision['summary']}`,
      });
    }
    for (const item of history) {
      const callId = ResponsesToolRunner.compactableCallId(item);
      if (callId !== undefined && dropped.has(callId)) {
        if (item.type === 'computer_call' || item.type === 'function_call') {
          const identity = {
            call_id: item.call_id,
            kind: item.type,
            ...(item.type === 'function_call' ? { name: item.name } : {}),
          };
          projected.push({
            role: 'user',
            content: `Runner receipt: ${JSON.stringify(identity)}. Output is present in the runner's full history; external success is unverified.`,
          });
        }
      } else {
        projected.push(item);
      }
    }
    return projected;
  }

  private async validateResponseCalls(
    output: ResponseOutputItem[],
    eager: boolean,
    attempted: readonly string[],
    history: readonly ResponseInputItem[],
    ledger: ResponsesRunnerCheckpoint | undefined,
    record: (() => Promise<void>) | undefined,
    tools: readonly Tool[] | undefined,
  ): Promise<void> {
    // Non-eager calls must all be admissible before any effect, including IDs
    // retained in ledger history from caller-provided input.
    const seen = eager ? new Set<string>() : ResponsesToolRunner.seenCallIds(history, attempted);
    const nativeIds = ResponsesToolRunner.seenOutputIds(history);
    const approved = approvedMcpRequests(history);
    for (const item of output) {
      try {
        this.validateItem(item, tools);
        ResponsesToolRunner.checkOutputId(item, nativeIds);
        if (item.type === 'mcp_call') {
          validateMcpCall(item, approved);
        }
      } catch (error) {
        if (ledger && isServerOutput(item)) {
          ledger.pending_items = ledgerCopy(output);
          // Preserve returned server observations on failure without making them resumable.
          // oxlint-disable-next-line no-await-in-loop
          await record?.();
        }
        throw error;
      }
      if (
        item.type === 'function_call' ||
        item.type === 'computer_call' ||
        item.type === 'mcp_approval_request'
      ) {
        const id = item.type === 'mcp_approval_request' ? item.id : item.call_id;
        if (seen.has(id)) {
          throw new RunnerValidationError('Invalid or duplicate completed call.');
        }
        seen.add(id);
      }
    }
  }

  private static seenOutputIds(history: readonly ResponseInputItem[]): Set<string> {
    const ids = new Set<string>();
    const defined = new Set<string>();
    for (const item of history) {
      if (
        isObj(item) &&
        'id' in item &&
        hasOwn(item, 'id') &&
        typeof item.id === 'string' &&
        item.id !== ''
      ) {
        ids.add(item.id);
        // Repeated references reserve an ID without defining a second native item.
        if (
          item.type === 'item_reference' ||
          ((item.type === undefined || item.type === null) &&
            !hasOwn(item, 'role') &&
            !hasOwn(item, 'content'))
        ) {
          continue;
        }
        if (defined.has(item.id)) {
          throw new TypeError('Runner history contains repeated native item IDs.');
        }
        defined.add(item.id);
      }
    }
    return ids;
  }

  private static checkOutputId(item: ResponseOutputItem, seen: Set<string>): void {
    if (hasOwn(item, 'id') && typeof item.id === 'string') {
      if (seen.has(item.id)) {
        throw new RunnerValidationError('Response output item IDs must be unique across the run.');
      }
      seen.add(item.id);
    }
  }

  private static seenCallIds(
    history: readonly ResponseInputItem[],
    attempted: readonly string[],
  ): Set<string> {
    const seen = new Set(attempted);
    for (const item of history) {
      if ('call_id' in item && hasOwn(item, 'call_id') && typeof item.call_id === 'string') {
        seen.add(item.call_id);
      } else if (
        hasOwn(item, 'type') &&
        item.type === 'mcp_approval_request' &&
        hasOwn(item, 'id') &&
        typeof item.id === 'string'
      ) {
        seen.add(item.id);
      }
    }
    return seen;
  }

  private async inspectResponse(
    response: Response,
    eager: boolean,
    attempted: readonly string[],
    history: readonly ResponseInputItem[],
    tools: readonly Tool[],
    ledger?: ResponsesRunnerCheckpoint,
    record?: () => Promise<void>,
    observed?: ReadonlyMap<number, ResponseOutputItem>,
    selection?: LocalToolSelection,
  ) {
    const status = configuredOption(response, 'status');
    if (status !== 'completed') {
      throw new RunnerValidationError('Response was not completed.');
    }
    const source = configuredOption(response, 'output');
    if (!Array.isArray(source)) {
      throw new RunnerValidationError('Response output requires a native array.');
    }
    let invalidComputer = false;
    let pending: ResponseOutputItem[];
    try {
      pending = Array.from({ length: source.length }, (_, index) => {
        const entry = Object.getOwnPropertyDescriptor(source, String(index));
        if (!entry?.enumerable || !('value' in entry)) {
          throw new RunnerValidationError('Response output contains an absent or invalid item.');
        }
        // SAFETY: Native output items have already passed the own-data descriptor check.
        const item = entry.value as ResponseOutputItem;
        if (!item) {
          throw new RunnerValidationError('Response output contains an absent item.');
        }
        // Preserve native checks that would be lost by cloning an SDK subclass result.
        if (item.type === 'computer_call') {
          try {
            return ComputerToolset.validate(item);
          } catch (error) {
            invalidComputer = true;
            throw error;
          }
        }
        return structuredClone(item);
      });
    } catch (error) {
      if (invalidComputer) {
        // Preserve any server-side uncertainty without serializing an invalid raw item.
        await record?.();
      }
      throw error;
    }
    for (const item of pending) {
      ResponsesToolRunner.validateSelection(item, selection, tools);
    }
    await this.validateResponseCalls(pending, eager, attempted, history, ledger, record, tools);
    if (observed !== undefined) {
      // Sort a fresh list of original wire indices; the native final output omits absent items.
      // oxlint-disable-next-line unicorn/no-array-sort
      const ordered = [...observed].sort(([left], [right]) => left - right).map(([, item]) => item);
      if (!sameStreamOutput(ordered, pending)) {
        throw new RunnerValidationError('Completed response differs from observed stream items.');
      }
    }
    if (ledger) {
      ledger.pending_items = ledgerCopy(pending);
    }
    const calls = pending.filter(
      (item): item is LocalCall =>
        item.type === 'function_call' ||
        item.type === 'computer_call' ||
        item.type === 'mcp_approval_request',
    );
    const final = calls.length === 0;
    const hasFinalOutput = pending.some(
      (item) =>
        (item.type === 'message' &&
          item.status === 'completed' &&
          (!hasOwn(item, 'phase') || item.phase !== 'commentary')) ||
        (isServerOutput(item) && item.type !== 'mcp_approval_request'),
    );
    if (final && !hasFinalOutput) {
      throw new RunnerValidationError('Response has no completed final message.');
    }
    if (ledger) {
      if (final) {
        ledger.phase = 'final';
        // Drop only top-level SDK metadata (notably non-enumerable _request_id) from the native response.
        // Capture other enumerable metadata once without rereading inspected fields.
        const metadata = isObj(response)
          ? Object.fromEntries<unknown>(
              Object.keys(response)
                .filter((key) => key !== 'status' && key !== 'output')
                .map((key) => [key, response[key]]),
            )
          : {};
        // SAFETY: Preserve enumerable native fields, replacing only the status and output inspected above.
        ledger.final_response = ledgerCopy({ ...metadata, status, output: pending }) as Response;
        if (ledger.final_response.tools !== undefined) {
          ledger.final_response.tools = await ledgerTools(ledger.final_response.tools);
        }
      }
      // Closing at inspection leaves a proposal pending, never a replay point.
      await record?.();
    }
    return { pending, calls, final };
  }

  /**
   * Inspect turns before advancing their tools. Breaking for-await closes the iterator.
   * Streams close before yielding; eager tools may already have effects and cannot be replaced.
   * With a selective early policy, permitted ordinary outputs in the pending suffix may be supplied.
   * @yields {ResponsesRunnerTurn} A response with control over permitted pending function results.
   */
  private static ledgerContains(item: ResponseOutputItem, ledger?: ResponsesRunnerCheckpoint): boolean {
    if (!ledger) {
      return false;
    }
    if (hasOwn(item, 'type') && item.type === 'mcp_approval_request') {
      return (
        hasOwn(item, 'id') &&
        typeof item.id === 'string' &&
        ledger.history.some(
          (prior) =>
            hasOwn(prior, 'type') &&
            prior.type === 'mcp_approval_request' &&
            hasOwn(prior, 'id') &&
            typeof prior.id === 'string' &&
            prior.id === item.id,
        )
      );
    }
    return (
      'call_id' in item &&
      hasOwn(item, 'call_id') &&
      typeof item.call_id === 'string' &&
      ledger.history.some(
        (prior) =>
          'call_id' in prior &&
          hasOwn(prior, 'call_id') &&
          typeof prior.call_id === 'string' &&
          prior.call_id === item.call_id,
      )
    );
  }

  private validateEarlyCall(
    item: ResponseOutputItem,
    tools: readonly Tool[],
    seen: Set<string>,
    step: number,
    maxSteps: number,
    ledger?: ResponsesRunnerCheckpoint,
  ): void {
    this.validateItem(item, tools);
    if (item.type === 'mcp_approval_request') {
      if (seen.has(item.id) || ResponsesToolRunner.ledgerContains(item, ledger)) {
        throw new RunnerValidationError('Invalid or duplicate MCP approval request.');
      }
      seen.add(item.id);
    }
    if (item.type === 'function_call' || item.type === 'computer_call') {
      if (seen.has(item.call_id) || ResponsesToolRunner.ledgerContains(item, ledger)) {
        throw new RunnerValidationError('Invalid or duplicate completed call.');
      }
      if (step >= maxSteps - 1) {
        throw new RunnerValidationError('ResponsesToolRunner reached maxSteps.');
      }
      seen.add(item.call_id);
    }
  }

  private static async collectStreamItem(
    index: number,
    raw: ResponseOutputItem,
    observed: Map<number, ResponseOutputItem> | undefined,
    ledger: ResponsesRunnerCheckpoint | undefined,
    record: (() => Promise<void>) | undefined,
  ): Promise<{ item: ResponseOutputItem; consecutive: boolean }> {
    let item: ResponseOutputItem;
    if (raw.type === 'computer_call') {
      try {
        item = ComputerToolset.validate(raw);
      } catch (error) {
        // Persist uncertainty without putting an invalid computer item into the ledger.
        await record?.();
        throw error;
      }
    } else {
      item = structuredClone(raw);
    }
    if (ledger) {
      ledger.pending_items.push(ledgerCopy(item));
      if (ledger.pending_items.length === 1 || isServerOutput(item)) {
        await record?.();
      }
    }
    if (!Number.isSafeInteger(index) || index < 0 || observed?.has(index)) {
      throw new RunnerValidationError('Stream item index is invalid or duplicated.');
    }
    const consecutive = index === observed?.size;
    observed?.set(index, item);
    return { item, consecutive };
  }

  // oxlint-disable-next-line complexity -- One iterator owns admission, request, yielded turn and durable commit.
  async *iterate(
    client: OpenAI,
    params: ResponseCreateParamsNonStreaming,
    originalOptions: ResponsesRunnerOptions = {},
  ): AsyncGenerator<ResponsesRunnerTurn, void, unknown> {
    this.lifecycle.enter();
    try {
      // SAFETY: The runner copies only caller-owned fields and installs supported inherited policies below.
      const options = Object.assign(Object.create(null), originalOptions) as ResponsesRunnerOptions;
      for (const key of [
        'maxSteps',
        'stream',
        'eager',
        'maxConcurrentCalls',
        'onEvent',
        'signal',
        'requestOptions',
        'computerOptions',
        'approveMcp',
        'onDiagnostic',
        'beforeEarlyCall',
        'ledger',
        'contextBudget',
      ] as const) {
        Object.defineProperty(options, key, {
          value: configuredOption(originalOptions, key, options),
          enumerable: true,
          configurable: true,
        });
      }
      const { computerOptions } = options;
      const originalLedger = options.ledger;
      if (originalLedger) {
        const runId = configuredOption(originalLedger, 'runId');
        const save = configuredOption(originalLedger, 'save');
        const resumeFrom = configuredOption(originalLedger, 'resumeFrom');
        if (typeof runId !== 'string' || !runId || typeof save !== 'function') {
          throw new TypeError('A ledger requires a nonempty run ID and recorder.');
        }
        Object.defineProperty(options, 'ledger', {
          value: {
            runId,
            save: save.bind(originalLedger),
            resumeFrom,
          },
          enumerable: true,
        });
      }
      // SAFETY: This is runner policy, not native transport. Keep absent policy hooks absent after copying.
      const computerPolicy = computerOptions
        ? (Object.assign(Object.create(null), computerOptions) as ComputerExecutionOptions)
        : undefined;
      if (computerOptions && computerPolicy) {
        const approveSafetyChecks = configuredOption(computerOptions, 'approveSafetyChecks', computerPolicy);
        const beforeAction = configuredOption(computerOptions, 'beforeAction', computerPolicy);
        Object.defineProperties(computerPolicy, {
          approveSafetyChecks: { value: approveSafetyChecks?.bind(computerOptions), enumerable: true },
          beforeAction: { value: beforeAction?.bind(computerOptions), enumerable: true },
          signal: { value: configuredOption(computerOptions, 'signal', computerPolicy), enumerable: true },
          onDiagnostic: {
            value: configuredOption(computerOptions, 'onDiagnostic', computerPolicy)?.bind(computerOptions),
            enumerable: true,
          },
        });
      }
      Object.defineProperties(options, {
        beforeEarlyCall: { value: options.beforeEarlyCall?.bind(originalOptions), enumerable: true },
        approveMcp: { value: options.approveMcp?.bind(originalOptions), enumerable: true },
        onEvent: { value: options.onEvent?.bind(originalOptions), enumerable: true },
        onDiagnostic: { value: options.onDiagnostic?.bind(originalOptions), enumerable: true },
        computerOptions: { value: computerPolicy, enumerable: true },
      });
      const { beforeEarlyCall } = options;
      const { maxSteps, tools, input, include, signal, requestOptions, contextBudget, preparedParams } =
        this.prepareRun(params, options);
      const maxConcurrentCalls = options.maxConcurrentCalls === undefined ? 2 : options.maxConcurrentCalls;
      if (!Number.isSafeInteger(maxConcurrentCalls) || maxConcurrentCalls < 1) {
        throw new TypeError('maxConcurrentCalls must be a positive safe integer.');
      }
      const eager = options.eager === true;
      const streaming = options.stream === true;
      const early = eager ? this.earlyExecution : null;
      const { ledger, record, parameters, declarations, attempted, completed } = await this.prepareLedger(
        preparedParams,
        options,
        maxSteps,
        tools,
        input,
      );
      const attemptedIds = new Set(attempted);
      const hasServerTools = declarations.some((tool) => allowedServerTypes.has(tool.type));
      try {
        const initialHistory = ledger?.history ?? input;
        const importedMcp = initialHistory.filter(
          (item) =>
            hasOwn(item, 'type') &&
            (item.type === 'mcp_approval_request' ||
              item.type === 'mcp_approval_response' ||
              item.type === 'mcp_call'),
        );
        if ((ledger?.consumed_requests ?? 0) < maxSteps && importedMcp.length > 0) {
          if (!ledger) {
            this.validateHistory(
              contextBudget ? initialHistory : importedMcp,
              declarations,
              Boolean(contextBudget),
            );
          }
          const selection = ResponsesToolRunner.localSelection(
            hasOwn(parameters, 'tool_choice') ? parameters.tool_choice : undefined,
          );
          // A completed local approval is not evidence that the remote call ran.
          // Imported MCP history was validated above: keep consumed grants and all receipts,
          // but ask the current owner again before recording or sending the rest.
          const unresolved = approvedMcpRequests(importedMcp);
          for (const item of importedMcp) {
            if (
              hasOwn(item, 'type') &&
              item.type === 'mcp_approval_response' &&
              hasOwn(item, 'approval_request_id') &&
              typeof item.approval_request_id === 'string' &&
              hasOwn(item, 'approve') &&
              item.approve === true
            ) {
              const request = unresolved.get(item.approval_request_id);
              if (request) {
                ResponsesToolRunner.validateSelection(request, selection, declarations);
                // oxlint-disable-next-line no-await-in-loop -- Approvals are ordered and cannot share grants.
                item.approve = await ResponsesToolRunner.decideMcpApproval(request, options, signal);
              }
            }
          }
        }
        for (let step = ledger?.consumed_requests ?? 0; ; step += 1) {
          signal?.throwIfAborted();
          const outputs: ResponseInputItem[] = [];
          const turn: RunnerTurn = {
            plainOutputs: Boolean(ledger || contextBudget),
            browserFailed: false,
            outputs,
            functions: new Map(),
          };
          const supplied = new Map<string, ResponseInputItem.FunctionCallOutput>();
          const userText: ResponseInputItem[] = [];
          const observed = eager ? new Map<number, ResponseOutputItem>() : undefined;
          let prefixLength = 0;
          let deferred = hasServerTools;
          // Keep this request's allowed server types fixed before save, transport or stream callbacks.
          const { requestTools } = ResponsesToolRunner.prepareRequestTools(declarations);
          const selection = ResponsesToolRunner.localSelection(
            hasOwn(parameters, 'tool_choice') ? parameters.tool_choice : undefined,
          );
          // oxlint-disable-next-line no-await-in-loop -- Persist admission before each ordered API request.
          const history = await this.beginRequest(
            step,
            maxSteps,
            input,
            outputs,
            parameters,
            declarations,
            ledger,
            record,
            signal,
            contextBudget,
          );
          const seen = eager
            ? ResponsesToolRunner.seenCallIds(ledger?.history ?? input, attempted)
            : new Set<string>();
          const streamNativeIds = ResponsesToolRunner.seenOutputIds(ledger?.history ?? input);
          const dispatch = async (item: ResponseOutputItem, target = turn) => {
            ResponsesToolRunner.validateSelection(item, selection, requestTools);
            if (ResponsesToolRunner.ledgerContains(item, ledger)) {
              throw new RunnerValidationError('Call ID was already present in ledger history.');
            }
            await this.dispatch(
              item,
              step,
              maxSteps,
              target,
              attempted,
              attemptedIds,
              completed,
              options,
              signal,
              supplied,
              record,
            );
          };
          const running: Promise<{ outputs: ResponseInputItem[]; error?: unknown }>[] = [];
          const settle = async () => {
            const admitted = running.splice(0);
            const results = await Promise.all(admitted);
            for (const result of results) {
              for (const output of result.outputs) {
                outputs.push(output);
              }
            }
            const failed = results.find((result) => 'error' in result);
            if (failed) {
              throw failed.error;
            }
          };
          const onDone = async (index: number, raw: ResponseOutputItem) => {
            const { item, consecutive } = await ResponsesToolRunner.collectStreamItem(
              index,
              raw,
              observed,
              ledger,
              record,
            );
            // After a gap, only the canonical completed response can establish the remaining order.
            if (!consecutive) {
              deferred = true;
            }
            ResponsesToolRunner.validateSelection(item, selection, requestTools);
            ResponsesToolRunner.checkOutputId(item, streamNativeIds);
            this.validateEarlyCall(item, requestTools, seen, step, maxSteps, ledger);
            this.prepareFunction(item, turn, options.onDiagnostic, signal);
            if (item.type === 'mcp_approval_request') {
              deferred = true;
            }
            if (item.type === 'function_call' || item.type === 'computer_call') {
              if (
                early !== null &&
                (item.type === 'computer_call' ? !early.computer : !early.functions.has(item.name))
              ) {
                deferred = true;
              }
              if (!deferred && beforeEarlyCall) {
                const decision = await beforeEarlyCall(structuredClone(item));
                if (decision !== 'execute' && decision !== 'defer') {
                  throw new TypeError('beforeEarlyCall must return execute or defer.');
                }
                deferred = decision === 'defer';
              }
            }
            if (!deferred) {
              prefixLength += 1;
              if (!ledger && item.type === 'function_call' && this.independent.has(item.name)) {
                const runIndependent = async () => {
                  const independentOutputs: ResponseInputItem[] = [];
                  const independentTurn = { ...turn, browserFailed: false, outputs: independentOutputs };
                  try {
                    await dispatch(item, independentTurn);
                    return { outputs: independentOutputs };
                  } catch (error) {
                    return { outputs: independentOutputs, error };
                  }
                };
                running.push(runIndependent());
                if (running.length === maxConcurrentCalls) {
                  await settle();
                }
              } else {
                // A dependent operation may only start once preceding independent work is known.
                await settle();
                await dispatch(item);
              }
            }
          };
          const body = { ...parameters, input: history, include, tools: requestTools };
          const initialOptions = ledger ? { timeout: client.timeout, ...requestOptions } : requestOptions;
          const transportOptions =
            step === 0 ? initialOptions : continuationRequestOptions(client, initialOptions, signal);
          let response: Response;
          const requestStarted = performance.now();
          try {
            // oxlint-disable-next-line prefer-ternary -- Keep each ordered request await visible.
            if (streaming) {
              // Requests depend on all observations in the preceding turn.
              // oxlint-disable-next-line no-await-in-loop
              response = await ResponsesToolRunner.streamResponse(
                client,
                body,
                options,
                onDone,
                signal,
                transportOptions,
              );
            } else {
              // oxlint-disable-next-line no-await-in-loop
              response = await client.responses.create(body, transportOptions);
            }
          } catch (error) {
            // Started ordinary functions retain their receipts even if the stream fails.
            // oxlint-disable-next-line no-await-in-loop -- Settle admitted work before leaving this request.
            await settle();
            reportDiagnostic(
              options.onDiagnostic,
              { api: 'responses', stage: 'request', reason: diagnosticFailure('request', signal) },
              requestStarted,
            );
            throw error;
          }
          // oxlint-disable-next-line no-await-in-loop -- Keep ownership of admitted effects through metadata failures.
          await settle();
          signal?.throwIfAborted();
          // oxlint-disable-next-line no-await-in-loop -- Own execution fields before metadata or observers can change them.
          const { pending, calls, final } = await this.inspectResponse(
            response,
            eager,
            attempted,
            ledger?.history ?? input,
            requestTools,
            ledger,
            record,
            observed,
            selection,
          );
          reportDiagnostic(
            options.onDiagnostic,
            { api: 'responses', stage: 'request', reason: 'completed' },
            requestStarted,
            response.usage,
          );
          signal?.throwIfAborted();
          for (const item of pending) {
            this.prepareFunction(item, turn, options.onDiagnostic, signal);
          }
          const allowed = this.allowedOutputIds(calls, attemptedIds);
          let active = true;
          try {
            yield {
              response,
              step: step + 1,
              final,
              toolsExecuted: eager && outputs.length > 0,
              attemptedCallIds: [...attempted],
              completedCallIds: [...completed],
              supplyOutputs(values) {
                if (
                  !active ||
                  (eager &&
                    !hasServerTools &&
                    early === null &&
                    beforeEarlyCall === undefined &&
                    allowed.size === 0)
                ) {
                  throw new TypeError('This turn does not accept supplied outputs.');
                }
                const next = new Map<string, ResponseInputItem.FunctionCallOutput>();
                for (const value of outputEntries(values)) {
                  const output = outputRecord(value, ['type', 'call_id', 'output']);
                  const id = output['call_id'];
                  if (
                    output['type'] !== 'function_call_output' ||
                    typeof id !== 'string' ||
                    !allowed.has(id) ||
                    next.has(id)
                  ) {
                    throw new TypeError('Supplied output call ID is not unique and permitted for this turn.');
                  }
                  next.set(id, {
                    type: 'function_call_output',
                    call_id: id,
                    output: suppliedResult(output['output']),
                  });
                }
                supplied.clear();
                for (const [id, output] of next) {
                  supplied.set(id, output);
                }
              },
              appendUserText(text) {
                if (!active || final || typeof text !== 'string' || !text.trim()) {
                  throw new TypeError('User text requires a non-final active turn and a nonempty string.');
                }
                userText.push({ role: 'user', content: text });
              },
            };
          } finally {
            active = false;
          }
          signal?.throwIfAborted();
          if (final) {
            return;
          }
          for (const item of pending.slice(prefixLength)) {
            // Calls share one environment and must execute in output order.
            // oxlint-disable-next-line no-await-in-loop
            await dispatch(item);
          }
          if (ledger) {
            ledger.history = ledgerCopy([
              ...ledger.history,
              ...toResponseInputItems(pending),
              ...outputs,
              ...userText,
            ]);
            ledger.phase = 'boundary';
            ledger.pending_items = [];
            ledger.returned_outputs = [];
            this.validateBoundary(ledger, declarations);
            // oxlint-disable-next-line no-await-in-loop
            await record?.();
          } else {
            // The supported ES2020 library does not provide Array.prototype.at.
            // oxlint-disable-next-line unicorn/prefer-at
            if (contextBudget && input[input.length - 1]?.type === 'compaction_trigger') {
              input.pop();
            }
            for (const item of [...toResponseInputItems(pending), ...outputs, ...userText]) {
              input.push(item);
            }
          }
        }
      } catch (error) {
        const message =
          error instanceof RunnerValidationError
            ? error.message
            : 'ResponsesToolRunner stopped. Inspect attemptedCallIds and completedCallIds before retrying.';
        throw new ResponsesToolRunnerError(message, attempted, completed);
      }
    } finally {
      this.lifecycle.leave();
    }
  }

  /** Consume the bounded iterator and return the original final API response. */
  async run(
    client: OpenAI,
    params: ResponseCreateParamsNonStreaming,
    options: ResponsesRunnerOptions = {},
  ): Promise<Response> {
    for await (const turn of this.iterate(client, params, options)) {
      if (turn.final) {
        return turn.response;
      }
    }
    throw new OpenAIError('Response has no completed final message.');
  }
}
