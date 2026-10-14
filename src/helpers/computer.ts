import type { OpenAI } from '../client';
import { OpenAIError } from '../error';
import { toResponseInputItems } from '../lib/responses/ResponseInputItems';
import { reportDiagnostic } from '../internal/runner-diagnostics';
import {
  RunnerLifecycle,
  configuredOption,
  continuationRequestOptions,
  isObjectPrototype,
  overlayRequestOptions,
  protectRunnerJSON,
} from '../internal/runner-lifecycle';
import { isNativeResponseMessage, isNativeResponseReasoning } from '../internal/native-response-message';
import { hasOwn, isObj } from '../internal/utils/values';
import type { RunnerDiagnosticObserver } from '../internal/runner-diagnostics';

import type {
  ComputerAction,
  Response,
  ResponseComputerToolCall,
  ResponseComputerToolCallOutputScreenshot,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
} from '../resources/responses/responses';

export type { RunnerDiagnostic, RunnerDiagnosticObserver } from '../internal/runner-diagnostics';

/** A driver-supplied image URL (including data URLs) or uploaded file ID. The helper never reads local files. */
export type ComputerScreenshot = ResponseComputerToolCallOutputScreenshot;

/** A native call, or a completed modern batch whose safety checklist may be absent. */
export type ComputerCallInput =
  | ResponseComputerToolCall
  | (Omit<ResponseComputerToolCall, 'action' | 'actions' | 'pending_safety_checks'> & {
      action?: never;
      actions: NonNullable<ResponseComputerToolCall['actions']>;
      pending_safety_checks?: ResponseComputerToolCall['pending_safety_checks'] | undefined;
    });

/**
 * Implement these methods against an isolated browser or virtual computer.
 * Arguments use the existing computer action wire shape, including snake_case fields.
 * Driver methods run once, in order; the helper never retries them.
 * Approval covers action arguments, not a frozen screen. If target-specific consent
 * is required, the driver must bind the target or reject the action after a state change.
 */
export interface ComputerDriver {
  /** Click the given coordinates and button, preserving held keys. */
  click: (action: ComputerAction.Click, options: { signal: AbortSignal | undefined }) => void | Promise<void>;
  /** Double-click the given coordinates, preserving held keys. */
  double_click: (
    action: ComputerAction.DoubleClick,
    options: { signal: AbortSignal | undefined },
  ) => void | Promise<void>;
  /** Drag along the path while holding any supplied keys. */
  drag: (action: ComputerAction.Drag, options: { signal: AbortSignal | undefined }) => void | Promise<void>;
  /** Press the requested combination of keys. */
  keypress: (
    action: ComputerAction.Keypress,
    options: { signal: AbortSignal | undefined },
  ) => void | Promise<void>;
  /** Move the pointer to the requested coordinates. */
  move: (action: ComputerAction.Move, options: { signal: AbortSignal | undefined }) => void | Promise<void>;
  /** Capture the current display as an API-compatible image URL. */
  screenshot: (options: {
    signal: AbortSignal | undefined;
  }) => ComputerScreenshot | Promise<ComputerScreenshot>;
  /** Scroll at the given coordinates by scroll_x and scroll_y. */
  scroll: (
    action: ComputerAction.Scroll,
    options: { signal: AbortSignal | undefined },
  ) => void | Promise<void>;
  /** Enter the requested text in the focused control. */
  type: (action: ComputerAction.Type, options: { signal: AbortSignal | undefined }) => void | Promise<void>;
  /** Allow the environment to settle before the next action. */
  wait: (action: ComputerAction.Wait, options: { signal: AbortSignal | undefined }) => void | Promise<void>;
}

/** Policy and cancellation options shared by run() and execute(). */
export interface ComputerExecutionOptions {
  /**
   * Required when a call contains pending safety checks. Return exactly true to
   * approve all of that call's checks; omitted or declined approval stops before actions.
   * Listen to context.signal to cancel interactive approval; the helper waits for callbacks to settle.
   */
  approveSafetyChecks?: (
    call: ResponseComputerToolCall,
    context: { signal: AbortSignal | undefined },
  ) => boolean | Promise<boolean>;
  /**
   * Authorize each action immediately before execution, including the final screenshot.
   * When set, only an explicit true allows the action. Throw or return false to stop.
   * context.signal is the same effective signal passed to the driver.
   * This approves the fixed arguments; it does not freeze the screen or focus.
   */
  beforeAction?: (
    action: ComputerAction,
    call: ResponseComputerToolCall,
    context: { signal: AbortSignal | undefined },
  ) => boolean | Promise<boolean>;
  /** Abort before the next action or capture. Running driver calls are never repeated. */
  signal?: AbortSignal | undefined;
  /** Local timing and safe reason records, never screenshots, action text or driver errors. */
  onDiagnostic?: RunnerDiagnosticObserver;
}

/** Options for a bounded computer-only Responses loop. */
export interface ComputerRunOptions extends ComputerExecutionOptions {
  /** Maximum responses.create calls, default 20. The final call cannot execute further computer actions.
   * Client HTTP retries still apply. */
  maxSteps?: number;
  /**
   * Passed to each Responses request. Its signal is used when the top-level signal is absent.
   * Signal and continuation overrides use a view without changing the caller's object.
   */
  requestOptions?: OpenAI.RequestOptions;
}

// Modern actions calls may omit the checklist. Legacy single actions still require it.
function validateComputerSafetyChecks(call: ComputerCallInput): void {
  const checks = configuredOption(call, 'pending_safety_checks');
  if (!configuredOption(call, 'actions') || checks !== undefined) {
    if (!Array.isArray(checks)) {
      throw new OpenAIError('ComputerToolset requires valid pending safety checks before execution.');
    }
    // oxlint-disable-next-line typescript/prefer-for-of -- Validate each JSON slot, including holes that must become invalid nulls.
    for (let index = 0; index < checks.length; index += 1) {
      const check = hasOwn(checks, index) ? checks[index] : undefined;
      const code = check ? configuredOption(check, 'code') : undefined;
      const message = check ? configuredOption(check, 'message') : undefined;
      if (
        !check ||
        !hasOwn(check, 'id') ||
        typeof check.id !== 'string' ||
        (code !== undefined && code !== null && typeof code !== 'string') ||
        (message !== undefined && message !== null && typeof message !== 'string')
      ) {
        throw new OpenAIError('ComputerToolset requires valid pending safety checks before execution.');
      }
    }
  }
}

function validComputerPoint(point: { x: number; y: number }): boolean {
  return (
    isObj(point) &&
    hasOwn(point, 'x') &&
    hasOwn(point, 'y') &&
    Number.isInteger(point.x) &&
    Number.isInteger(point.y)
  );
}

function isDenseArray(values: unknown): values is unknown[] {
  if (!Array.isArray(values)) {
    return false;
  }
  // oxlint-disable-next-line typescript/prefer-for-of -- Iteration alone cannot distinguish an inherited entry from an owned slot.
  for (let index = 0; index < values.length; index += 1) {
    if (!hasOwn(values, index)) {
      return false;
    }
  }
  return true;
}

function validComputerKeys(keys: unknown): boolean {
  return isDenseArray(keys) && keys.every((key) => typeof key === 'string');
}

function validComputerAction(action: ComputerAction): boolean {
  if (!action || !hasOwn(action, 'type')) {
    return false;
  }
  const keys = 'keys' in action ? configuredOption(action, 'keys') : undefined;
  if (keys !== null && keys !== undefined && !validComputerKeys(keys)) {
    return false;
  }
  switch (action.type) {
    case 'click': {
      const button = configuredOption(action, 'button');
      return (
        validComputerPoint(action) &&
        ['left', 'right', 'wheel', 'back', 'forward'].some((value) => value === button)
      );
    }
    case 'double_click':
    case 'move': {
      return validComputerPoint(action);
    }
    case 'scroll': {
      return (
        validComputerPoint(action) &&
        Number.isInteger(configuredOption(action, 'scroll_x')) &&
        Number.isInteger(configuredOption(action, 'scroll_y'))
      );
    }
    case 'drag': {
      const path = configuredOption(action, 'path');
      return isDenseArray(path) && path.every(validComputerPoint);
    }
    case 'keypress': {
      return validComputerKeys(configuredOption(action, 'keys'));
    }
    case 'type': {
      return typeof configuredOption(action, 'text') === 'string';
    }
    case 'screenshot':
    case 'wait': {
      return true;
    }
    default: {
      return false;
    }
  }
}

function computerActions(call: ComputerCallInput): ComputerAction[] {
  const singleAction = configuredOption(call, 'action');
  const batch = configuredOption(call, 'actions');
  if (
    !hasOwn(call, 'type') ||
    !hasOwn(call, 'status') ||
    !hasOwn(call, 'id') ||
    !hasOwn(call, 'call_id') ||
    call.type !== 'computer_call' ||
    call.status !== 'completed' ||
    typeof call.id !== 'string' ||
    typeof call.call_id !== 'string' ||
    singleAction === null ||
    batch === null ||
    (singleAction !== undefined) === (batch !== undefined)
  ) {
    throw new OpenAIError('ComputerToolset requires a completed call with exactly one of action or actions.');
  }
  validateComputerSafetyChecks(call);
  // SAFETY: The guard above established exactly one of action/actions is present.
  const actions = batch ?? [singleAction as ComputerAction];
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new OpenAIError('ComputerToolset requires at least one computer action.');
  }
  if (!isDenseArray(actions)) {
    throw new OpenAIError('ComputerToolset received an invalid computer action.');
  }
  for (const action of actions) {
    if (Array.isArray(action) || !validComputerAction(action)) {
      throw new OpenAIError('ComputerToolset received an invalid computer action.');
    }
  }
  return actions;
}

function snapshotComputerPolicy(options: ComputerExecutionOptions) {
  return {
    signal: configuredOption(options, 'signal'),
    approveSafetyChecks: configuredOption(options, 'approveSafetyChecks')?.bind(options),
    beforeAction: configuredOption(options, 'beforeAction')?.bind(options),
    onDiagnostic: configuredOption(options, 'onDiagnostic')?.bind(options),
  };
}

function computerRunTools(params: ResponseCreateParamsNonStreaming, maxSteps: number) {
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) {
    throw new TypeError('ComputerToolset maxSteps must be a positive safe integer.');
  }
  const suppliedTools = configuredOption(params, 'tools');
  const tools = suppliedTools === undefined ? [{ type: 'computer' as const }] : suppliedTools;
  const conversation = configuredOption(params, 'conversation');
  const previousResponse = configuredOption(params, 'previous_response_id');
  if (
    configuredOption(params, 'stream') ||
    configuredOption(params, 'background') ||
    (conversation !== undefined && conversation !== null) ||
    (previousResponse !== undefined && previousResponse !== null) ||
    !Array.isArray(tools) ||
    tools.length !== 1 ||
    tools.some((tool) => {
      const type = tool && configuredOption(tool, 'type');
      return type !== 'computer' && type !== 'computer_use_preview';
    })
  ) {
    throw new TypeError(
      'ComputerToolset.run requires non-streaming, foreground, one computer tool and explicit input history.',
    );
  }
  return tools;
}

function releaseForcedComputerChoice(choice: NonNullable<ResponseCreateParamsNonStreaming['tool_choice']>) {
  if (
    choice === 'required' ||
    (typeof choice === 'object' &&
      hasOwn(choice, 'type') &&
      ['computer', 'computer_use_preview', 'computer_use'].includes(choice.type))
  ) {
    return 'auto' as const;
  }
  if (
    typeof choice === 'object' &&
    hasOwn(choice, 'type') &&
    choice.type === 'allowed_tools' &&
    hasOwn(choice, 'mode') &&
    choice.mode === 'required'
  ) {
    return { ...choice, mode: 'auto' as const };
  }
  return choice;
}

function validateComputerChecklistOwner(call: ComputerCallInput): void {
  // Match configured options' owner boundary without invoking a checklist getter.
  let owner: object | null = call;
  while (owner !== null && !isObjectPrototype(owner)) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, 'pending_safety_checks');
    if (descriptor) {
      if (owner !== call || !descriptor.enumerable || !('value' in descriptor)) {
        throw new OpenAIError('ComputerToolset requires own enumerable data for safety checks.');
      }
      break;
    }
    // SAFETY: Object.getPrototypeOf returns the object's prototype or null.
    owner = Object.getPrototypeOf(owner) as object | null;
  }
}

function snapshotComputerCall<T extends ComputerCallInput>(call: T): T {
  if (Array.isArray(call)) {
    throw new OpenAIError('ComputerToolset requires a call object.');
  }
  validateComputerChecklistOwner(call);
  const snapshot = structuredClone(call);
  for (const action of computerActions(snapshot)) {
    if (action.type === 'double_click' && configuredOption(action, 'keys') === undefined) {
      action.keys = null;
    }
  }
  return snapshot;
}

function actionApprovalCall(call: ComputerCallInput): ResponseComputerToolCall {
  const checks = configuredOption(call, 'pending_safety_checks') ?? [];
  const actions = configuredOption(call, 'actions');
  if (!Array.isArray(actions)) {
    const view = structuredClone({ ...call, pending_safety_checks: checks });
    protectRunnerJSON(view);
    return view;
  }
  const sources = { actions, pending_safety_checks: checks };
  const view: ResponseComputerToolCall = structuredClone({
    ...call,
    actions: [],
    pending_safety_checks: [],
  });
  // Protect the base before installing accessors so unused batch views stay lazy.
  protectRunnerJSON(view);
  for (const key of ['actions', 'pending_safety_checks'] as const) {
    const source = sources[key];
    let materialized = false;
    let value: unknown;
    const save = (replacement: unknown) => {
      value = replacement;
      materialized = true;
      if (Object.getOwnPropertyDescriptor(view, key)?.configurable) {
        Object.defineProperty(view, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      return value;
    };
    Object.defineProperty(view, key, {
      configurable: true,
      enumerable: true,
      get() {
        if (materialized) {
          return value;
        }
        const captured = structuredClone(source);
        protectRunnerJSON(captured);
        return save(captured);
      },
      set(replacement: unknown) {
        if (Object.isFrozen(view)) {
          throw new TypeError('Cannot assign to frozen computer approval call.');
        }
        save(replacement);
      },
    });
  }
  return view;
}

// oxlint-disable-next-line complexity -- Validate every supported native output before any computer effect.
function computerCalls(response: Response, earlierIdentities: Set<string>, earlierCallIds: Set<string>) {
  if (configuredOption(response, 'status') !== 'completed') {
    throw new OpenAIError('ComputerToolset.run received a response that is not completed.');
  }
  // Preflight the entire response before any effects, even when unsupported items follow a valid call.
  const calls: ResponseComputerToolCall[] = [];
  const output: Response['output'] = [];
  const source = configuredOption(response, 'output');
  if (!Array.isArray(source)) {
    throw new OpenAIError('ComputerToolset.run received an invalid output array.');
  }
  const { length } = source;
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new OpenAIError('ComputerToolset.run received an invalid output array.');
  }
  let hasFinalMessage = false;
  const identities = new Set<string>();
  const callIds = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const raw = hasOwn(source, index) ? source[index] : undefined;
    if (!raw) {
      throw new OpenAIError('ComputerToolset.run received an absent output item.');
    }
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (descriptor.get) {
        if (name === 'type') {
          descriptors.type = {
            value: descriptor.get.call(raw),
            enumerable: Boolean(descriptor.enumerable),
            configurable: Boolean(descriptor.configurable),
          };
        } else {
          descriptor.get = descriptor.get.bind(raw);
        }
      }
    }
    // SAFETY: This shadow has exactly the provider's own descriptors and prototype, with type captured once.
    const captured = Object.create(Object.getPrototypeOf(raw), descriptors) as typeof raw;
    const item =
      hasOwn(captured, 'type') && captured.type === 'computer_call'
        ? snapshotComputerCall(captured)
        : structuredClone(captured);
    if (!hasOwn(item, 'type') || !hasOwn(item, 'id') || typeof item.id !== 'string') {
      throw new OpenAIError('ComputerToolset.run requires emitted output type and id fields.');
    }
    if (item.type === 'computer_call') {
      if (callIds.has(item.call_id) || earlierCallIds.has(item.call_id)) {
        throw new OpenAIError('ComputerToolset.run received a duplicate computer call identity.');
      }
      callIds.add(item.call_id);
      calls.push(item);
    } else if (item.type === 'message') {
      if (!isNativeResponseMessage(item)) {
        throw new OpenAIError('ComputerToolset.run requires native assistant content before replay.');
      }
      hasFinalMessage ||=
        item.status === 'completed' && (!hasOwn(item, 'phase') || item.phase !== 'commentary');
    } else if (item.type === 'reasoning') {
      if (!isNativeResponseReasoning(item)) {
        throw new OpenAIError('ComputerToolset.run requires native reasoning content before replay.');
      }
    } else if (item.type === 'compaction') {
      if (!hasOwn(item, 'encrypted_content') || typeof item.encrypted_content !== 'string') {
        throw new OpenAIError('ComputerToolset.run requires native compaction content before replay.');
      }
    } else {
      throw new OpenAIError('ComputerToolset.run cannot handle a non-computer output item.');
    }
    output.push(item);
    if (identities.has(item.id) || (item.id !== '' && earlierIdentities.has(item.id))) {
      throw new OpenAIError('ComputerToolset.run received a duplicate output item identity.');
    }
    identities.add(item.id);
  }
  if (calls.length === 0 && !hasFinalMessage) {
    throw new OpenAIError('ComputerToolset.run received no completed final message.');
  }
  for (const id of identities) {
    if (id !== '') {
      earlierIdentities.add(id);
    }
  }
  for (const id of callIds) {
    earlierCallIds.add(id);
  }
  return { calls, output };
}

function computerDriverMethod<K extends keyof ComputerDriver>(
  driver: ComputerDriver,
  name: K,
): ComputerDriver[K] {
  const method = configuredOption(driver, name);
  if (typeof method !== 'function') {
    throw new OpenAIError('ComputerToolset requires callable computer driver methods.');
  }
  return method;
}

/**
 * Dispatches existing computer actions for a caller-owned browser or computer.
 * run() handles computer-only conversations; execute() supports caller-managed loops.
 */
export class ComputerToolset {
  private readonly driver: ComputerDriver;
  private readonly lifecycle = new RunnerLifecycle();

  /** The environment remains owned by the caller and is never opened or closed by the helper. */
  constructor(driver: ComputerDriver) {
    const methods = {
      click: computerDriverMethod(driver, 'click'),
      double_click: computerDriverMethod(driver, 'double_click'),
      drag: computerDriverMethod(driver, 'drag'),
      keypress: computerDriverMethod(driver, 'keypress'),
      move: computerDriverMethod(driver, 'move'),
      screenshot: computerDriverMethod(driver, 'screenshot'),
      scroll: computerDriverMethod(driver, 'scroll'),
      type: computerDriverMethod(driver, 'type'),
      wait: computerDriverMethod(driver, 'wait'),
    };
    this.driver = {
      click: methods.click.bind(driver),
      double_click: methods.double_click.bind(driver),
      drag: methods.drag.bind(driver),
      keypress: methods.keypress.bind(driver),
      move: methods.move.bind(driver),
      screenshot: methods.screenshot.bind(driver),
      scroll: methods.scroll.bind(driver),
      type: methods.type.bind(driver),
      wait: methods.wait.bind(driver),
    };
  }

  /** Stop new work. If draining, await the current operation before closing your driver. */
  close(): { status: 'closed' | 'draining' } {
    return this.lifecycle.close();
  }

  /** Snapshot and check a complete call before a runner dispatches any effects from its response.
   * @internal
   */
  static validate<T extends ComputerCallInput>(call: T): T {
    return snapshotComputerCall(call);
  }

  /**
   * Run until a completed response contains no computer calls.
   * Defaults to the computer tool when tools is omitted. Other tools, streams,
   * background work, conversation, and previous_response_id are rejected.
   * Replays history (including encrypted reasoning for store:false).
   *
   * @throws {OpenAIError} If a response is incomplete, unsupported, declined, or exceeds maxSteps.
   */
  async run(
    client: OpenAI,
    params: ResponseCreateParamsNonStreaming,
    options: ComputerRunOptions = {},
  ): Promise<Response> {
    this.lifecycle.enter();
    try {
      return await this.runOwned(client, params, options);
    } finally {
      this.lifecycle.leave();
    }
  }

  // oxlint-disable-next-line complexity -- Ordered requests share cancellation and continuation policy.
  private async runOwned(
    client: OpenAI,
    params: ResponseCreateParamsNonStreaming,
    options: ComputerRunOptions,
  ): Promise<Response> {
    const suppliedMaxSteps = configuredOption(options, 'maxSteps');
    const maxSteps = suppliedMaxSteps === undefined ? 20 : suppliedMaxSteps;
    // Match the ordinary SDK JSON encoder once, then validate and reuse the resulting body.
    const encoded = JSON.stringify(params);
    const decoded: unknown = JSON.parse(encoded);
    if (!isObj(decoded)) {
      throw new TypeError('ComputerToolset request must be an object.');
    }
    // SAFETY: computerRunTools validates the serialized modes/tools before the request can reach the API.
    const request = decoded as ResponseCreateParamsNonStreaming;
    const tools = computerRunTools(request, maxSteps);
    const suppliedInput = configuredOption(request, 'input');
    const input: ResponseInputItem[] =
      typeof suppliedInput === 'string'
        ? [{ role: 'user', content: suppliedInput }]
        : [...(suppliedInput === undefined ? [] : suppliedInput)];
    const include = [...(configuredOption(request, 'include') ?? [])];
    if (!include.includes('reasoning.encrypted_content')) {
      include.push('reasoning.encrypted_content');
    }
    const body = { ...request, tools, include, input };
    protectRunnerJSON(body);
    const policy = snapshotComputerPolicy(options);
    let supplied = configuredOption(options, 'requestOptions');
    const ownSignal = supplied && Object.getOwnPropertyDescriptor(supplied, 'signal');
    const signal = policy.signal ?? (supplied && configuredOption(supplied, 'signal')) ?? undefined;
    if (policy.signal || (ownSignal && !('value' in ownSignal)) || (signal && !ownSignal?.enumerable)) {
      // Capture accessors once and expose hidden signals to the native request spread.
      supplied = overlayRequestOptions(supplied, { signal });
    }
    const executionOptions = { ...policy, signal };
    const earlierIdentities = new Set<string>();
    const earlierCallIds = new Set<string>();
    for (const item of input) {
      if (!isObj(item)) {
        continue;
      }
      const id = hasOwn(item, 'id') ? item['id'] : undefined;
      const callId = hasOwn(item, 'call_id') ? item['call_id'] : undefined;
      if (typeof id === 'string' && id !== '') {
        earlierIdentities.add(id);
      }
      if (typeof callId === 'string') {
        earlierCallIds.add(callId);
      }
    }
    for (let step = 0; ; step += 1) {
      signal?.throwIfAborted();
      const nextOptions = step === 0 ? supplied : continuationRequestOptions(client, supplied, signal);
      if (nextOptions && Object.getOwnPropertyDescriptor(nextOptions, 'body')?.enumerable) {
        throw new TypeError('ComputerToolset.run requestOptions.body is not supported.');
      }
      let response: Response;
      try {
        // Each response depends on observations from the preceding one.
        // oxlint-disable-next-line no-await-in-loop
        response = await client.responses.create(body, nextOptions);
      } catch (error) {
        signal?.throwIfAborted();
        throw error;
      }
      signal?.throwIfAborted();
      const { calls, output } = computerCalls(response, earlierIdentities, earlierCallIds);
      if (calls.length === 0) {
        return response;
      }
      if (step >= maxSteps - 1) {
        throw new OpenAIError('ComputerToolset.run reached maxSteps before executing another computer call.');
      }
      // Capture the native replay as it will be sent, before an action can change the environment.
      const projected = toResponseInputItems(output);
      protectRunnerJSON(projected);
      // SAFETY: computerCalls validated every supported item; toResponseInputItems strips output-only fields.
      // oxlint-disable-next-line unicorn/prefer-structured-clone -- Replay must satisfy the native JSON encoder, not just be cloneable.
      const replay = JSON.parse(JSON.stringify(projected)) as ResponseInputItem[];
      protectRunnerJSON(replay);
      for (const item of replay) {
        body.input.push(item);
      }
      for (const call of calls) {
        // Calls share one environment and must run in server order.
        // oxlint-disable-next-line no-await-in-loop
        const observation = await this.executeOwned(call, executionOptions);
        body.input.push(observation);
      }
      const choice = configuredOption(body, 'tool_choice');
      if (choice !== undefined && choice !== null) {
        body.tool_choice = releaseForcedComputerChoice(choice);
        if (typeof body.tool_choice === 'object') {
          protectRunnerJSON(body.tool_choice);
        }
      }
    }
  }

  /**
   * Execute one completed call for a caller-managed Responses loop.
   * Returns exactly one observation captured after all actions in the call.
   * Screenshot actions still pass through beforeAction; intermediate captures
   * are omitted because Responses accepts only the final observation.
   * Approval, policy rejection, abort, and driver failures stop immediately.
   */
  async execute(
    call: ComputerCallInput,
    options: ComputerExecutionOptions = {},
  ): Promise<ResponseInputItem.ComputerCallOutput> {
    this.lifecycle.enter();
    try {
      return await this.executeOwned(call, snapshotComputerPolicy(options));
    } finally {
      this.lifecycle.leave();
    }
  }

  // oxlint-disable-next-line eslint/complexity -- Keep the execution snapshot shared by safety approval, action approval and dispatch.
  private async executeOwned(
    call: ComputerCallInput,
    policy: ReturnType<typeof snapshotComputerPolicy>,
  ): Promise<ResponseInputItem.ComputerCallOutput> {
    const snapshot = ComputerToolset.validate(call);
    // Use the same native projection as run(), before any callback or effect.
    // SAFETY: Validation permits modern calls to omit only the legacy checklist required by the output type.
    const projected = toResponseInputItems([snapshot as ResponseComputerToolCall]);
    protectRunnerJSON(projected);
    // SAFETY: The validated single computer call retains its native fields after projection.
    // oxlint-disable-next-line unicorn/prefer-structured-clone -- Direct replay must satisfy the native JSON encoder too.
    const replay = JSON.parse(JSON.stringify(projected)) as ResponseComputerToolCall[];
    const actions = computerActions(snapshot);
    for (const action of actions) {
      if (
        (action.type === 'click' ||
          action.type === 'drag' ||
          action.type === 'move' ||
          action.type === 'scroll') &&
        configuredOption(action, 'keys') === undefined
      ) {
        // Shadow omitted modifiers only in execution copies; wire snapshots must remain JSON values.
        Object.defineProperty(action, 'keys', {
          value: undefined,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }
    // The final capture still requires approval when a driver mutates its action.
    // The SDK compiles against ES2020, which does not include Array.at.
    // oxlint-disable-next-line prefer-at
    const needsScreenshot = actions[actions.length - 1]?.type !== 'screenshot';
    policy.signal?.throwIfAborted();
    const checks = configuredOption(snapshot, 'pending_safety_checks') ?? [];
    const nativeChecks = checks.map((check) => ({
      id: check.id,
      code: hasOwn(check, 'code') ? check.code : undefined,
      message: hasOwn(check, 'message') ? check.message : undefined,
    }));
    // Native fields in the captured replay must still describe the same checks.
    const captured: unknown = replay[0]?.pending_safety_checks ?? [];
    if (
      !Array.isArray(captured) ||
      captured.length !== nativeChecks.length ||
      !captured.every(
        (value, index) =>
          isObj(value) &&
          hasOwn(value, 'id') &&
          value['id'] === nativeChecks[index]?.id &&
          (hasOwn(value, 'code') ? value['code'] : undefined) === nativeChecks[index]?.code &&
          (hasOwn(value, 'message') ? value['message'] : undefined) === nativeChecks[index]?.message,
      )
    ) {
      throw new OpenAIError('ComputerToolset serialization changed the pending safety checks.');
    }
    // SAFETY: Every captured native field matches its already validated check; optional extensions are JSON values.
    const acknowledged = captured as ResponseComputerToolCall['pending_safety_checks'];
    if (checks.length > 0) {
      // Preserve omissions in replay/acknowledgement; callbacks own absent fields in execution copies.
      for (const check of checks) {
        for (const key of ['code', 'message'] as const) {
          if (!hasOwn(check, key)) {
            Object.defineProperty(check, key, {
              value: undefined,
              enumerable: true,
              writable: true,
              configurable: true,
            });
          }
        }
      }
      const started = performance.now();
      try {
        const view = structuredClone({ ...snapshot, pending_safety_checks: checks });
        protectRunnerJSON(view);
        const approved = await policy.approveSafetyChecks?.(view, { signal: policy.signal });
        policy.signal?.throwIfAborted();
        if (approved !== true) {
          throw new OpenAIError('ComputerToolset requires explicit approval of pending safety checks.');
        }
        reportDiagnostic(
          policy.onDiagnostic,
          { api: 'computer', stage: 'approval', reason: 'completed', call_id: snapshot.call_id },
          started,
        );
      } catch (error) {
        reportDiagnostic(
          policy.onDiagnostic,
          {
            api: 'computer',
            stage: 'approval',
            reason: policy.signal?.aborted ? 'cancelled' : 'policy_failed',
            call_id: snapshot.call_id,
          },
          started,
        );
        policy.signal?.throwIfAborted();
        throw error;
      }
    }
    for (const action of actions) {
      // Computer effects are ordered and must never execute concurrently.
      // oxlint-disable-next-line no-await-in-loop
      await this.perform(action, snapshot, policy);
    }
    if (needsScreenshot) {
      await this.perform({ type: 'screenshot' }, snapshot, policy);
    }
    policy.signal?.throwIfAborted();
    const output = await this.captureScreenshot(snapshot, policy);
    const observation: ResponseInputItem.ComputerCallOutput = {
      type: 'computer_call_output',
      call_id: snapshot.call_id,
      output,
      ...(checks.length > 0 ? { acknowledged_safety_checks: acknowledged } : {}),
    };
    protectRunnerJSON(observation);
    return observation;
  }

  private async captureScreenshot(
    snapshot: ComputerCallInput,
    policy: ReturnType<typeof snapshotComputerPolicy>,
  ): Promise<ComputerScreenshot> {
    const started = performance.now();
    let output: ComputerScreenshot;
    try {
      const supplied = await this.driver.screenshot({ signal: policy.signal });
      policy.signal?.throwIfAborted();
      if (!isObj(supplied)) {
        throw new OpenAIError(
          'ComputerToolset screenshot must return a computer_screenshot with image_url or file_id.',
        );
      }
      const type = configuredOption(supplied, 'type');
      const image_url = configuredOption(supplied, 'image_url');
      const file_id = configuredOption(supplied, 'file_id');
      if (
        type !== 'computer_screenshot' ||
        (image_url !== undefined && (typeof image_url !== 'string' || !image_url.trim())) ||
        (file_id !== undefined && (typeof file_id !== 'string' || !file_id.trim())) ||
        (image_url === undefined && file_id === undefined)
      ) {
        throw new OpenAIError(
          'ComputerToolset screenshot must return a computer_screenshot with image_url or file_id.',
        );
      }
      output = {
        type,
        ...(image_url === undefined ? {} : { image_url }),
        ...(file_id === undefined ? {} : { file_id }),
      };
      reportDiagnostic(
        policy.onDiagnostic,
        {
          api: 'computer',
          stage: 'action',
          reason: 'completed',
          call_id: snapshot.call_id,
          member: 'screenshot',
        },
        started,
      );
    } catch (error) {
      reportDiagnostic(
        policy.onDiagnostic,
        {
          api: 'computer',
          stage: 'action',
          reason: policy.signal?.aborted ? 'cancelled' : 'driver_failed',
          call_id: snapshot.call_id,
          member: 'screenshot',
        },
        started,
      );
      policy.signal?.throwIfAborted();
      throw error;
    }
    policy.signal?.throwIfAborted();
    return output;
  }

  private async perform(
    action: ComputerAction,
    call: ComputerCallInput,
    options: {
      signal: ComputerExecutionOptions['signal'];
      beforeAction: ComputerExecutionOptions['beforeAction'];
      onDiagnostic: ComputerExecutionOptions['onDiagnostic'];
    },
  ): Promise<void> {
    options.signal?.throwIfAborted();
    if (options.beforeAction) {
      await ComputerToolset.approveAction(action, call, options.beforeAction, options);
    }
    options.signal?.throwIfAborted();
    const started = performance.now();
    try {
      const dispatched = structuredClone(action);
      switch (dispatched.type) {
        case 'click': {
          await this.driver.click(dispatched, { signal: options.signal });
          break;
        }
        case 'double_click': {
          await this.driver.double_click(dispatched, { signal: options.signal });
          break;
        }
        case 'drag': {
          await this.driver.drag(dispatched, { signal: options.signal });
          break;
        }
        case 'keypress': {
          await this.driver.keypress(dispatched, { signal: options.signal });
          break;
        }
        case 'move': {
          await this.driver.move(dispatched, { signal: options.signal });
          break;
        }
        case 'screenshot': {
          break;
        }
        case 'scroll': {
          await this.driver.scroll(dispatched, { signal: options.signal });
          break;
        }
        case 'type': {
          await this.driver.type(dispatched, { signal: options.signal });
          break;
        }
        case 'wait': {
          await this.driver.wait(dispatched, { signal: options.signal });
          break;
        }
        default: {
          throw new OpenAIError('ComputerToolset received an unsupported computer action.');
        }
      }
      options.signal?.throwIfAborted();
      if (action.type !== 'screenshot') {
        reportDiagnostic(
          options.onDiagnostic,
          {
            api: 'computer',
            stage: 'action',
            reason: 'completed',
            call_id: call.call_id,
            member: action.type,
          },
          started,
        );
      }
    } catch (error) {
      reportDiagnostic(
        options.onDiagnostic,
        {
          api: 'computer',
          stage: 'action',
          reason: options.signal?.aborted ? 'cancelled' : 'driver_failed',
          call_id: call.call_id,
          member: action.type,
        },
        started,
      );
      options.signal?.throwIfAborted();
      throw error;
    }
    options.signal?.throwIfAborted();
  }

  private static async approveAction(
    action: ComputerAction,
    call: ComputerCallInput,
    beforeAction: NonNullable<ComputerExecutionOptions['beforeAction']>,
    options: Pick<ReturnType<typeof snapshotComputerPolicy>, 'signal' | 'onDiagnostic'>,
  ): Promise<void> {
    const started = performance.now();
    try {
      const view = structuredClone(action);
      protectRunnerJSON(view);
      const approved = await beforeAction(view, actionApprovalCall(call), {
        signal: options.signal,
      });
      options.signal?.throwIfAborted();
      if (approved !== true) {
        throw new OpenAIError('ComputerToolset action declined by beforeAction.');
      }
      reportDiagnostic(
        options.onDiagnostic,
        {
          api: 'computer',
          stage: 'approval',
          reason: 'completed',
          call_id: call.call_id,
          member: action.type,
        },
        started,
      );
    } catch (error) {
      reportDiagnostic(
        options.onDiagnostic,
        {
          api: 'computer',
          stage: 'approval',
          reason: options.signal?.aborted ? 'cancelled' : 'policy_failed',
          call_id: call.call_id,
          member: action.type,
        },
        started,
      );
      options.signal?.throwIfAborted();
      throw error;
    }
  }
}
