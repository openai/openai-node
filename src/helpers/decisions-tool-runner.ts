// Keep the public partial-effect error beside its owning helper.
// oxlint-disable max-classes-per-file
import type OpenAI from '../index';
import { OpenAIError } from '../error';
import { buildHeaders } from '../internal/headers';
import { hasOwn, isObj } from '../internal/utils/values';
import { diagnosticFailure, reportDiagnostic } from '../internal/runner-diagnostics';
import {
  configuredOption,
  continuationRequestOptions,
  isObjectPrototype,
  RunnerLifecycle,
} from '../internal/runner-lifecycle';
import type { RunnerDiagnosticObserver } from '../internal/runner-diagnostics';

import type { Decision, DecisionCreateParams, DecisionInputPart } from '../resources/decisions';

export type { RunnerDiagnostic, RunnerDiagnosticObserver } from '../internal/runner-diagnostics';

/** Current text or inline image evidence. It is sent as a fresh user message each turn. */
export type DecisionObservation = string | OwnedDecisionObservationPart[];
type OwnedDecisionObservationPart = Extract<DecisionInputPart, { type: 'input_text' | 'input_image' }>;

/** The caller supplies every argument in the executor; Decisions selects only its ID. */
export type DecisionCandidate =
  | { id: string; description: string; execute: () => void | Promise<void>; done?: false }
  | { id: string; description: string; done: true; execute?: never };

type OwnedDecisionCandidate = DecisionCandidate & { done: boolean };

export interface DecisionsRunnerRegistration {
  observe: () => DecisionObservation | Promise<DecisionObservation>;
  candidates: (observation: DecisionObservation) => DecisionCandidate[] | Promise<DecisionCandidate[]>;
  /** Read independent state. Only literal true reports a verified outcome. */
  verify?: (observation: DecisionObservation) => boolean | Promise<boolean>;
}

export interface DecisionsRunnerParams {
  model: string;
  input: string;
  safety_identifier?: DecisionCreateParams['safety_identifier'];
}

export interface DecisionsRunnerOptions {
  /** Maximum API requests (default 20). No action may run on the final request. */
  maxSteps?: number;
  signal?: AbortSignal;
  /** Local stage timings and actual usage, with no observations, descriptions or error text. */
  onDiagnostic?: RunnerDiagnosticObserver;
  /** Transport settings only. Request body, route and streaming are owned by the runner. */
  requestOptions?: Pick<OpenAI.RequestOptions, 'headers' | 'timeout' | 'maxRetries' | 'signal'>;
}

export interface DecisionsRunResult {
  /** Selection alone is not verification of the task's outcome. */
  status: 'verified' | 'unverified' | 'refused';
  /** Actual Decisions results in request order, without synthetic Responses IDs. */
  decisions: Decision[];
  attemptedCandidateIds: string[];
  completedCandidateIds: string[];
}

export type DecisionsRunnerErrorReason =
  | 'invalid_params'
  | 'invalid_candidates'
  | 'invalid_answer'
  | 'invalid_verification'
  | 'verification_failed'
  | 'step_limit'
  | 'failed'
  | 'cancelled';

/** Execution evidence contains IDs only, with no driver message, arguments, result or original cause. */
export class DecisionsToolRunnerError extends OpenAIError {
  readonly attemptedCandidateIds: string[];
  readonly completedCandidateIds: string[];
  readonly reason: DecisionsRunnerErrorReason;

  constructor(reason: DecisionsRunnerErrorReason, attempted: string[], completed: string[]) {
    super('DecisionsToolRunner stopped. Inspect candidate IDs and the environment before retrying.');
    this.name = 'DecisionsToolRunnerError';
    this.reason = reason;
    this.attemptedCandidateIds = [...attempted];
    this.completedCandidateIds = [...completed];
  }
}

type StopRun = (reason: DecisionsRunnerErrorReason) => never;

/** Bounded choice selection from caller-owned operations. Executors own their driver and action policy. */
export class DecisionsToolRunner {
  private readonly registration: DecisionsRunnerRegistration;
  private readonly lifecycle = new RunnerLifecycle();

  constructor(registration: DecisionsRunnerRegistration) {
    this.registration = registration;
  }

  /** Refuse new runs. Await an active run before releasing its caller-owned environment. */
  close(): { status: 'closed' | 'draining' } {
    return this.lifecycle.close();
  }

  private static prepare(params: DecisionsRunnerParams, options: DecisionsRunnerOptions, stop: StopRun) {
    if (
      !isObj(params) ||
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(params).some((key) => !['model', 'input', 'safety_identifier'].includes(key)) ||
      Object.keys(options).some(
        (key) => !['maxSteps', 'signal', 'requestOptions', 'onDiagnostic'].includes(key),
      )
    ) {
      stop('invalid_params');
    }
    const fields = Object.getOwnPropertyDescriptors(params);
    if (
      ['model', 'input', 'safety_identifier'].some((key) => key in params && !hasOwn(params, key)) ||
      Reflect.ownKeys(fields).some((key) => {
        if (typeof key !== 'string' || !['model', 'input', 'safety_identifier'].includes(key)) {
          return true;
        }
        const field = fields[key];
        return !field || !field.enumerable || !('value' in field);
      })
    ) {
      stop('invalid_params');
    }
    const { model, input, safety_identifier } = params;
    const suppliedMaxSteps = configuredOption(options, 'maxSteps');
    const maxSteps = suppliedMaxSteps === undefined ? 20 : suppliedMaxSteps;
    if (
      typeof model !== 'string' ||
      typeof input !== 'string' ||
      (safety_identifier !== null &&
        safety_identifier !== undefined &&
        typeof safety_identifier !== 'string') ||
      !Number.isSafeInteger(maxSteps) ||
      maxSteps < 1
    ) {
      stop('invalid_params');
    }
    const requestOptions = DecisionsToolRunner.prepareRequest(options, stop);
    const signal = requestOptions.signal ?? undefined;
    return { model, input, safety_identifier, maxSteps, signal, requestOptions };
  }

  private static prepareRequest(options: DecisionsRunnerOptions, stop: StopRun): OpenAI.RequestOptions {
    const supplied = configuredOption(options, 'requestOptions');
    if (
      supplied !== undefined &&
      (!supplied ||
        typeof supplied !== 'object' ||
        Array.isArray(supplied) ||
        Object.keys(supplied).some((key) => !['headers', 'timeout', 'maxRetries', 'signal'].includes(key)))
    ) {
      stop('invalid_params');
    }
    // Copy only permitted fields; request settings cannot replace body or route, even if changed later.
    const headers = supplied && configuredOption(supplied, 'headers');
    const timeout = supplied && configuredOption(supplied, 'timeout');
    const maxRetries = supplied && configuredOption(supplied, 'maxRetries');
    const signal = supplied && configuredOption(supplied, 'signal');
    return {
      headers: buildHeaders([headers]),
      ...(timeout === undefined ? {} : { timeout }),
      ...(maxRetries === undefined ? {} : { maxRetries }),
      signal: configuredOption(options, 'signal') ?? signal,
    };
  }

  private static ownObservation(
    supplied: DecisionObservation,
    stop: StopRun,
  ): string | OwnedDecisionObservationPart[] {
    if (typeof supplied === 'string') {
      return supplied;
    }
    if (!Array.isArray(supplied)) {
      stop('failed');
    }
    const entries = Array.from({ length: supplied.length }, (_, index) => {
      const entry = Object.getOwnPropertyDescriptor(supplied, String(index));
      if (!entry) {
        stop('failed');
      }
      // SAFETY: A present typed slot is captured once; cloned native part fields are validated below.
      return ('value' in entry ? entry.value : supplied[index]) as DecisionInputPart;
    });
    const captured = structuredClone(entries);
    DecisionsToolRunner.validateObservationParts(captured, stop);
    return captured;
  }

  private static validateObservationParts(
    captured: DecisionInputPart[],
    stop: StopRun,
  ): asserts captured is OwnedDecisionObservationPart[] {
    for (const part of captured) {
      if (!isObj(part) || !hasOwn(part, 'type')) {
        stop('failed');
      }
      if (part['type'] === 'input_text') {
        if (!hasOwn(part, 'text') || typeof part['text'] !== 'string') {
          stop('failed');
        }
      } else {
        const detail = hasOwn(part, 'detail') ? part['detail'] : undefined;
        if (
          part['type'] !== 'input_image' ||
          !hasOwn(part, 'image_url') ||
          typeof part['image_url'] !== 'string' ||
          (detail !== undefined &&
            detail !== null &&
            (typeof detail !== 'string' || !['low', 'high', 'auto', 'original'].includes(detail)))
        ) {
          stop('failed');
        }
      }
    }
  }

  // oxlint-disable-next-line complexity -- Keep field ownership and candidate admission in the same validation pass.
  private static ownCandidates(
    supplied: DecisionCandidate[],
    stop: StopRun,
  ): Map<string, OwnedDecisionCandidate> {
    if (!Array.isArray(supplied)) {
      stop('invalid_candidates');
    }
    const { length } = supplied;
    if (length < 1 || length > 255) {
      stop('invalid_candidates');
    }
    const entries = Array.from({ length }, (_, index) => {
      const entry = Object.getOwnPropertyDescriptor(supplied, String(index));
      if (!entry?.enumerable || !('value' in entry)) {
        stop('invalid_candidates');
      }
      const candidate: unknown = entry.value;
      if (!isObj(candidate)) {
        stop('invalid_candidates');
      }
      return candidate;
    });
    const owned = new Map<string, OwnedDecisionCandidate>();
    let doneCount = 0;
    for (const candidate of entries) {
      // Preserve class-owned getters and methods using the configured-option prototype boundary.
      const hasCandidateField = (name: keyof DecisionCandidate): boolean => {
        let owner: object | null = candidate;
        while (owner !== null && !isObjectPrototype(owner)) {
          if (Object.getOwnPropertyDescriptor(owner, name)) {
            return true;
          }
          // SAFETY: Object.getPrototypeOf returns an object or null for the checked candidate.
          owner = Object.getPrototypeOf(owner) as object | null;
        }
        return false;
      };
      const id = hasCandidateField('id') ? candidate['id'] : undefined;
      const description = hasCandidateField('description') ? candidate['description'] : undefined;
      const done = hasCandidateField('done') ? candidate['done'] : undefined;
      const execute = hasCandidateField('execute') ? candidate['execute'] : undefined;
      if (
        typeof id !== 'string' ||
        !id.trim() ||
        typeof description !== 'string' ||
        !description.trim() ||
        owned.has(id) ||
        (done !== undefined && done !== false && done !== true)
      ) {
        stop('invalid_candidates');
      }
      if (done === true) {
        if (execute !== undefined) {
          stop('invalid_candidates');
        }
        doneCount += 1;
        owned.set(id, { id, description, done: true });
      } else {
        if (typeof execute !== 'function') {
          stop('invalid_candidates');
        }
        owned.set(id, { id, description, done: false, execute: execute.bind(candidate) });
      }
    }
    if (doneCount !== 1) {
      stop('invalid_candidates');
    }
    return owned;
  }

  // oxlint-disable-next-line complexity -- Validate the native answer and resolve its registered candidate together.
  private static select(decision: Decision, owned: Map<string, OwnedDecisionCandidate>, stop: StopRun) {
    const supplied = Object.getOwnPropertyDescriptor(decision, 'answers');
    if (!supplied?.enumerable || !('value' in supplied)) {
      stop('invalid_answer');
    }
    const answers: unknown = supplied.value;
    if (!Array.isArray(answers) || answers.length !== 1 || !hasOwn(answers, 0)) {
      stop('invalid_answer');
    }
    // SAFETY: The native array slot is present; its selection fields are checked below before use.
    const { 0: answer } = answers as Decision['answers'];
    if (!isObj(answer)) {
      stop('invalid_answer');
    }
    const name = Object.getOwnPropertyDescriptor(answer, 'name');
    const type = Object.getOwnPropertyDescriptor(answer, 'type');
    if (
      !name?.enumerable ||
      !('value' in name) ||
      name.value !== 'next_action' ||
      !type?.enumerable ||
      !('value' in type)
    ) {
      stop('invalid_answer');
    }
    if (type.value === 'refusal') {
      const snapshot = structuredClone(answer);
      if (snapshot.name !== name.value || snapshot.type !== type.value) {
        stop('invalid_answer');
      }
      return { selected: 'refused' as const, answers: [snapshot] };
    }
    if (type.value !== 'choice') {
      stop('invalid_answer');
    }
    const choice = Object.getOwnPropertyDescriptor(answer, 'choice');
    const confidence = Object.getOwnPropertyDescriptor(answer, 'confidence');
    const probabilities = Object.getOwnPropertyDescriptor(answer, 'probabilities');
    if (
      !choice?.enumerable ||
      !('value' in choice) ||
      typeof choice.value !== 'string' ||
      !confidence?.enumerable ||
      !('value' in confidence) ||
      !Number.isFinite(confidence.value) ||
      !probabilities?.enumerable ||
      !('value' in probabilities) ||
      !Array.isArray(probabilities.value)
    ) {
      stop('invalid_answer');
    }
    const snapshot = structuredClone(answer);
    if (snapshot.type !== 'choice') {
      stop('invalid_answer');
    }
    snapshot.name = name.value;
    snapshot.choice = choice.value;
    snapshot.confidence = confidence.value;
    const chances = snapshot.probabilities;
    if (!Array.isArray(chances)) {
      stop('invalid_answer');
    }
    for (let index = 0; index < chances.length; index += 1) {
      if (!hasOwn(chances, index)) {
        stop('invalid_answer');
      }
      const chance = chances[index];
      if (
        !isObj(chance) ||
        !hasOwn(chance, 'value') ||
        !hasOwn(chance, 'probability') ||
        (typeof chance['value'] !== 'string' && typeof chance['value'] !== 'boolean') ||
        !Number.isFinite(chance['probability'])
      ) {
        stop('invalid_answer');
      }
    }
    const selected = owned.get(snapshot.choice);
    if (!selected) {
      stop('invalid_answer');
    }
    return { selected, answers: [snapshot] };
  }

  private static async verifyFinal(
    observe: DecisionsRunnerRegistration['observe'],
    verify: DecisionsRunnerRegistration['verify'],
    signal: AbortSignal | undefined,
    stop: StopRun,
  ): Promise<'verified' | 'unverified' | false> {
    signal?.throwIfAborted();
    if (!verify) {
      return 'unverified';
    }
    // Re-read actual state for verification, not the evidence the model chose from.
    const finalObservation = DecisionsToolRunner.ownObservation(await observe(), stop);
    signal?.throwIfAborted();
    const verified = await verify(finalObservation);
    signal?.throwIfAborted();
    if (verified === true) {
      return 'verified';
    }
    if (verified !== false) {
      stop('invalid_verification');
    }
    return false;
  }

  // oxlint-disable-next-line complexity -- Admit the generated usage object and its two required detail records together.
  private static ownDecision(decision: Decision, answers: Decision['answers'], stop: StopRun): Decision {
    // Selection owns its answer first, so reading caller-backed metadata cannot change the choice.
    const snapshot = { ...decision, answers };
    if (
      !hasOwn(snapshot, 'model') ||
      typeof snapshot.model !== 'string' ||
      !hasOwn(snapshot, 'usage') ||
      !isObj(snapshot.usage)
    ) {
      stop('invalid_answer');
    }
    const usage = { ...snapshot.usage };
    if (
      !hasOwn(usage, 'input_tokens_details') ||
      !isObj(usage.input_tokens_details) ||
      !hasOwn(usage, 'output_tokens_details') ||
      !isObj(usage.output_tokens_details)
    ) {
      stop('invalid_answer');
    }
    const input = { ...usage.input_tokens_details };
    const output = { ...usage.output_tokens_details };
    if (
      !hasOwn(usage, 'input_tokens') ||
      !Number.isInteger(usage.input_tokens) ||
      !hasOwn(usage, 'output_tokens') ||
      !Number.isInteger(usage.output_tokens) ||
      !hasOwn(usage, 'total_tokens') ||
      !Number.isInteger(usage.total_tokens) ||
      !hasOwn(input, 'cache_write_tokens') ||
      !Number.isInteger(input.cache_write_tokens) ||
      !hasOwn(input, 'cached_tokens') ||
      !Number.isInteger(input.cached_tokens) ||
      !hasOwn(output, 'reasoning_tokens') ||
      !Number.isInteger(output.reasoning_tokens)
    ) {
      stop('invalid_answer');
    }
    snapshot.usage = { ...usage, input_tokens_details: input, output_tokens_details: output };
    return snapshot;
  }

  // oxlint-disable-next-line complexity -- Keep selection, verification and the resulting receipt in one bounded run.
  async run(
    client: OpenAI,
    params: DecisionsRunnerParams,
    options: DecisionsRunnerOptions = {},
  ): Promise<DecisionsRunResult> {
    const attempted: string[] = [];
    const completed: string[] = [];
    const decisions: Decision[] = [];
    let reason: DecisionsRunnerErrorReason = 'failed';
    // Only our own checks can set a reason. Never forward even a same-class error from a caller callback.
    const stop: StopRun = (value) => {
      reason = value;
      throw new OpenAIError('Decision selection stopped.');
    };
    let signal: AbortSignal | undefined;
    let onDiagnostic: RunnerDiagnosticObserver | undefined;
    let stage: 'run' | 'request' | 'selection' | 'action' | 'verification' = 'run';
    let started = performance.now();
    let selectedId: string | null = null;
    this.lifecycle.enter();
    try {
      if (options && typeof options === 'object' && !Array.isArray(options)) {
        onDiagnostic = configuredOption(options, 'onDiagnostic')?.bind(options);
      }
      const prepared = DecisionsToolRunner.prepare(params, options, stop);
      const { model, input, safety_identifier, maxSteps, requestOptions } = prepared;
      ({ signal } = prepared);
      // A callback must not replace another callback during an awaited operation in this run.
      const { registration } = this;
      const observe = configuredOption(registration, 'observe')?.bind(registration);
      const candidates = configuredOption(registration, 'candidates')?.bind(registration);
      const verify = configuredOption(registration, 'verify')?.bind(registration);
      if (!observe || !candidates) {
        stop('failed');
      }
      for (let step = 0; step < maxSteps; step += 1) {
        selectedId = null;
        stage = 'run';
        started = performance.now();
        signal?.throwIfAborted();
        // Every iteration observes the result of the preceding execution.
        // oxlint-disable-next-line no-await-in-loop
        const observation = DecisionsToolRunner.ownObservation(await observe(), stop);
        signal?.throwIfAborted();
        // oxlint-disable-next-line no-await-in-loop
        const supplied = await candidates(structuredClone(observation));
        signal?.throwIfAborted();
        const owned = DecisionsToolRunner.ownCandidates(supplied, stop);

        let selected: DecisionCandidate | 'refused' | undefined;
        if (owned.size === 1) {
          // A sole terminal candidate does not need an invalid one-choice API request.
          selected = owned.values().next().value;
        } else {
          stage = 'request';
          started = performance.now();
          const initialOptions = {
            timeout: client.timeout,
            maxRetries: client.maxRetries,
            ...requestOptions,
          };
          // oxlint-disable-next-line no-await-in-loop
          const decision = await client.decisions.create(
            {
              model,
              ...(safety_identifier === undefined ? {} : { safety_identifier }),
              input: [
                { role: 'user', content: input },
                { role: 'user', content: observation },
              ],
              questions: [
                {
                  type: 'choice',
                  name: 'next_action',
                  instructions:
                    'Choose the supplied action that makes progress on the task, or the done choice if it is finished.',
                  choices: [...owned.values()].map(({ id, description }) => ({ value: id, description })),
                },
              ],
            },
            step === 0 ? initialOptions : continuationRequestOptions(client, initialOptions, signal),
          );
          stage = 'selection';
          const admission = DecisionsToolRunner.select(decision, owned, stop);
          ({ selected } = admission);
          const snapshot = DecisionsToolRunner.ownDecision(decision, admission.answers, stop);
          stage = 'request';
          reportDiagnostic(
            onDiagnostic,
            { api: 'decisions', stage, reason: 'completed' },
            started,
            snapshot.usage,
          );
          stage = 'run';
          started = performance.now();
          signal?.throwIfAborted();
          decisions.push(snapshot);
          stage = 'selection';
          started = performance.now();
        }
        if (!selected) {
          stop('invalid_answer');
        }
        if (selected === 'refused') {
          reportDiagnostic(
            onDiagnostic,
            { api: 'decisions', stage: 'selection', reason: 'refused' },
            started,
          );
          signal?.throwIfAborted();
          return {
            status: 'refused',
            decisions,
            attemptedCandidateIds: [...attempted],
            completedCandidateIds: [...completed],
          };
        }
        selectedId = selected.id;
        reportDiagnostic(
          onDiagnostic,
          { api: 'decisions', stage: 'selection', reason: 'completed', call_id: selectedId },
          started,
        );
        if (selected.done) {
          stage = 'verification';
          started = performance.now();
          // oxlint-disable-next-line no-await-in-loop
          const status = await DecisionsToolRunner.verifyFinal(observe, verify, signal, stop);
          reportDiagnostic(
            onDiagnostic,
            {
              api: 'decisions',
              stage,
              reason: status === false ? 'refused' : 'completed',
              call_id: selectedId,
            },
            started,
          );
          signal?.throwIfAborted();
          stage = 'run';
          started = performance.now();
          if (status !== false) {
            return {
              status,
              decisions,
              attemptedCandidateIds: [...attempted],
              completedCandidateIds: [...completed],
            };
          }
          if (owned.size === 1) {
            stop('verification_failed');
          }
        } else {
          if (step === maxSteps - 1) {
            stop('step_limit');
          }
          signal?.throwIfAborted();
          attempted.push(selected.id);
          stage = 'action';
          started = performance.now();
          // SDK retries can repeat requests; they never repeat the selected executor.
          // oxlint-disable-next-line no-await-in-loop
          await selected.execute();
          completed.push(selected.id);
          reportDiagnostic(
            onDiagnostic,
            { api: 'decisions', stage, reason: 'completed', call_id: selectedId },
            started,
          );
          stage = 'run';
          started = performance.now();
          signal?.throwIfAborted();
        }
      }
      stop('step_limit');
    } catch {
      const failure = new DecisionsToolRunnerError(
        signal?.aborted ? 'cancelled' : reason,
        attempted,
        completed,
      );
      reportDiagnostic(
        onDiagnostic,
        {
          api: 'decisions',
          stage,
          call_id: selectedId,
          reason:
            failure.reason === 'step_limit' || failure.reason === 'cancelled'
              ? failure.reason
              : diagnosticFailure(stage, signal),
        },
        started,
      );
      throw failure;
    } finally {
      this.lifecycle.leave();
    }
  }
}
