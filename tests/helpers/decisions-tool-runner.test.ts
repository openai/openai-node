// oxlint-disable max-classes-per-file -- Regressions exercise different real class-backed registrations.
import OpenAI from 'openai';
import { DecisionsToolRunner, DecisionsToolRunnerError } from 'openai/helpers/decisions-tool-runner';
import type {
  DecisionCandidate,
  DecisionObservation,
  DecisionsRunnerParams,
  DecisionsRunnerOptions,
  RunnerDiagnostic,
} from 'openai/helpers/decisions-tool-runner';
import type { Decision } from 'openai/resources/decisions';
import { describe, expect, test, vi } from 'vitest';

const params = { model: '', input: 'Set the fixture to complete.', safety_identifier: 'fixture' };
const done: DecisionCandidate = { id: 'finish', description: 'The fixture is complete', done: true };
const answer = (choice: string | boolean): Decision.AnswerResourceChoice => ({
  type: 'choice',
  name: 'next_action',
  choice,
  confidence: 1,
  probabilities: [],
});

// Mock wire JSON includes intentionally invalid answers that the generated client will not validate.
function harness(turns: unknown[], metadata?: (decision: Record<string, unknown>) => void) {
  const bodies: unknown[] = [];
  const paths: string[] = [];
  const requestHeaders: Headers[] = [];
  const client = new OpenAI({
    apiKey: 'synthetic-test-key',
    baseURL: 'https://api.openai.com/v1',
    defaultHeaders: { 'X-Fixture-Default': 'default' },
    maxRetries: 0,
    fetch: async (url, init) => {
      const request = new Request(url, init);
      const turn = turns[bodies.length];
      paths.push(new URL(request.url).pathname);
      requestHeaders.push(request.headers);
      bodies.push(await request.json());
      if (!turn) {
        throw new Error('Unexpected request');
      }
      const decision = {
        model: '',
        answers: typeof turn === 'function' ? turn() : turn,
        usage: {
          input_tokens: 1,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
          output_tokens: 1,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 2,
        },
      };
      metadata?.(decision);
      return Response.json(decision);
    },
  });
  return { client, bodies, paths, requestHeaders };
}

describe('DecisionsToolRunner', () => {
  test.each(['name', 'type'] as const)('rejects a refusal whose cloned %s changes', async (field) => {
    const env = harness([[{ type: 'refusal', name: 'next_action', refusal: 'Stop' }]]);
    const create = env.client.decisions.create.bind(env.client.decisions);
    vi.spyOn(env.client.decisions, 'create').mockImplementation((body, options) =>
      create(body, options)._thenUnwrap((decision) => {
        const refusal = {
          get extension() {
            Reflect.set(refusal, field, field === 'type' ? 'choice' : 'changed');
            return 'synthetic extension';
          },
          name: 'next_action',
          type: 'refusal' as const,
          refusal: 'Stop',
        };
        decision.answers = [refusal];
        return decision;
      }),
    );
    const execute = vi.fn();
    const runner = new DecisionsToolRunner({
      observe: () => 'state',
      candidates: () => [done, { id: 'set', description: 'Set fixture', execute }],
    });
    await expect(runner.run(env.client, params)).rejects.toMatchObject({ reason: 'invalid_answer' });
    expect(execute).not.toHaveBeenCalled();
  });

  test('reports cancellation raised by a refusal diagnostic before returning', async () => {
    const env = harness([[{ type: 'refusal', name: 'next_action', refusal: 'Stop' }]]);
    const controller = new AbortController();
    const execute = vi.fn();
    const runner = new DecisionsToolRunner({
      observe: () => 'state',
      candidates: () => [done, { id: 'set', description: 'Set fixture', execute }],
    });
    await expect(
      runner.run(env.client, params, {
        signal: controller.signal,
        onDiagnostic(event) {
          if (event.stage === 'selection' && event.reason === 'refused') {
            controller.abort();
          }
        },
      }),
    ).rejects.toMatchObject({ reason: 'cancelled', attemptedCandidateIds: [], completedCandidateIds: [] });
    expect(env.bodies).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
  });

  test.each([true, false] as const)(
    'AM Stop after terminal verification diagnostic, verify=%s',
    async (withVerify) => {
      const h = harness([]);
      const controller = new AbortController();
      const runner = new DecisionsToolRunner({
        observe: () => 'complete',
        candidates: () => [done],
        ...(withVerify ? { verify: () => true } : {}),
      });
      await expect(
        runner.run(h.client, params, {
          signal: controller.signal,
          onDiagnostic(event) {
            if (event.stage === 'verification') {
              controller.abort();
            }
          },
        }),
      ).rejects.toMatchObject({ reason: 'cancelled', attemptedCandidateIds: [], completedCandidateIds: [] });
      expect(h.bodies).toHaveLength(0);
    },
  );

  test.each([
    { field: 'model', missing: true },
    { field: 'model', value: null },
    { field: 'usage', missing: true },
    { field: 'usage', value: null },
    { field: 'input_tokens', missing: true },
    { field: 'total_tokens', value: 'invalid' },
    { field: 'input_tokens_details', value: null },
    { field: 'cached_tokens', missing: true },
    { field: 'output_tokens_details', missing: true },
    { field: 'reasoning_tokens', value: null },
  ])('requires complete Decision metadata before dispatch: %o', async ({ field, missing, value }) => {
    const execute = vi.fn();
    const h = harness([[answer('act')], [answer('finish')]], (decision) => {
      let owner = decision;
      if (!['model', 'usage'].includes(field)) {
        // SAFETY: The harness just constructed the generated usage object, before any fixture edits.
        owner = decision['usage'] as Record<string, unknown>;
        if (field === 'cached_tokens') {
          // SAFETY: This is the harness-owned, as-yet unedited input details object.
          owner = owner['input_tokens_details'] as Record<string, unknown>;
        } else if (field === 'reasoning_tokens') {
          // SAFETY: This is the harness-owned, as-yet unedited output details object.
          owner = owner['output_tokens_details'] as Record<string, unknown>;
        }
      }
      if (missing) {
        Reflect.deleteProperty(owner, field);
      } else {
        owner[field] = value;
      }
    });
    const runner = new DecisionsToolRunner({
      observe: () => 'fixture',
      candidates: () => [done, { id: 'act', description: 'set', execute }],
    });
    await expect(runner.run(h.client, params)).rejects.toMatchObject({ reason: 'invalid_answer' });
    expect(execute).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(1);
  });

  test('keeps Decision model and native metadata extensions without imposing counter ranges', async () => {
    const h = harness([[answer('finish')]], (decision) => {
      decision['model'] = 'fixture-model-not-from-a-list';
      decision['extra'] = null;
      // SAFETY: The harness supplied this complete generated usage fixture.
      const usage = decision['usage'] as Record<string, unknown>;
      usage['input_tokens'] = -4;
      usage['output_tokens'] = 9;
      usage['total_tokens'] = 0;
      usage['future'] = { note: 'keep' };
      // SAFETY: The harness-owned input details have not been replaced.
      (usage['input_tokens_details'] as Record<string, unknown>)['future'] = null;
    });
    const execute = vi.fn();
    const result = await new DecisionsToolRunner({
      observe: () => 'fixture',
      candidates: () => [done, { id: 'act', description: 'unused', execute }],
    }).run(h.client, params);
    expect(result).toMatchObject({
      status: 'unverified',
      decisions: [
        {
          model: 'fixture-model-not-from-a-list',
          extra: null,
          usage: {
            input_tokens: -4,
            output_tokens: 9,
            total_tokens: 0,
            future: { note: 'keep' },
            input_tokens_details: { future: null },
          },
        },
      ],
    });
    expect(execute).not.toHaveBeenCalled();
  });
  test.each([
    { omit: 'confidence' },
    { omit: 'probabilities' },
    { confidence: null },
    { confidence: 'not a number' },
    { probabilities: null },
    { probabilities: [null] },
    { probabilities: [{ value: 'act' }] },
    { probabilities: [{ probability: 0.5 }] },
    { probabilities: [{ value: 3, probability: 0.5 }] },
    { probabilities: [{ value: true, probability: 'not a number' }] },
  ])('validates complete native choice before any local dispatch: %o', async (fields) => {
    const item = { ...answer('act'), ...fields };
    if ('omit' in fields) {
      Reflect.deleteProperty(item, fields.omit);
    }
    const execute = vi.fn();
    const h = harness([[item], [answer('finish')]]);
    const runner = new DecisionsToolRunner({
      observe: () => 'fixture',
      candidates: () => [done, { id: 'act', description: 'set fixture', execute }],
    });
    await expect(runner.run(h.client, params)).rejects.toMatchObject({ reason: 'invalid_answer' });
    expect(execute).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(1);
  });
  test('preserves complete native choice probabilities and forward fields', async () => {
    const native = {
      ...answer('finish'),
      confidence: 1,
      probabilities: [
        { value: true, probability: -2, extra: 'keep' },
        { value: 'true', probability: 3 },
      ],
    };
    const h = harness([[native]]);
    const execute = vi.fn();
    const result = await new DecisionsToolRunner({
      observe: () => 'fixture',
      candidates: () => [done, { id: 'act', description: 'set', execute }],
    }).run(h.client, params);
    expect(result.decisions[0]?.answers).toEqual([native]);
    expect(execute).not.toHaveBeenCalled();
  });
  test.each(['usage', 'diagnostic'] as const)(
    'owns selected answer and history before %s metadata',
    async (trigger) => {
      const env = harness([[answer('finish')], [answer('finish')]]);
      const execute = vi.fn();
      let mutate: (() => void) | undefined;
      const create = env.client.decisions.create.bind(env.client.decisions);
      vi.spyOn(env.client.decisions, 'create').mockImplementation((body, options) =>
        create(body, options)._thenUnwrap((decision) => {
          mutate = () => {
            decision.answers.splice(0, 1, answer('act'));
          };
          if (trigger === 'usage') {
            const { usage } = decision;
            Object.defineProperty(decision, 'usage', {
              enumerable: true,
              get() {
                mutate?.();
                return usage;
              },
            });
          }
          return decision;
        }),
      );
      const runner = new DecisionsToolRunner({
        observe: () => 'fixture',
        candidates: () => [done, { id: 'act', description: 'unselected', execute }],
      });
      const result = await runner.run(env.client, params, {
        onDiagnostic(event) {
          if (trigger === 'diagnostic' && event.stage === 'request') {
            mutate?.();
          }
        },
      });
      expect(result).toMatchObject({ status: 'unverified', decisions: [{ answers: [answer('finish')] }] });
      expect(execute).not.toHaveBeenCalled();
      expect(env.bodies).toHaveLength(1);
    },
  );
  test('selection history retains an owned answer slot read once', async () => {
    const env = harness([[answer('finish')]]);
    const execute = vi.fn();
    const read = vi.fn().mockReturnValueOnce(answer('finish')).mockReturnValue(answer('act'));
    const create = env.client.decisions.create.bind(env.client.decisions);
    vi.spyOn(env.client.decisions, 'create').mockImplementation((body, options) =>
      create(body, options)._thenUnwrap((decision) => {
        Object.defineProperty(decision.answers, 0, { enumerable: true, configurable: true, get: read });
        return decision;
      }),
    );
    const result = await new DecisionsToolRunner({
      observe: () => 'fixture',
      candidates: () => [done, { id: 'act', description: 'unselected', execute }],
    }).run(env.client, params);
    expect(result).toMatchObject({ status: 'unverified', decisions: [{ answers: [answer('finish')] }] });
    expect(read).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });
  test('admission ignores ambient verification, observers and restricted transport fields', async () => {
    const h = harness([[answer('finish')]]);
    const verify = vi.fn(() => true);
    const onDiagnostic = vi.fn();
    const propertyNames = ['verify', 'onDiagnostic', 'headers', 'timeout', 'maxRetries'] as const;
    const originals = propertyNames.map(
      (key) => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)] as const,
    );
    try {
      // oxlint-disable-next-line no-extend-native -- Local omitted-option regression; every descriptor is restored.
      Object.defineProperties(Object.prototype, {
        verify: { configurable: true, writable: true, value: verify },
        onDiagnostic: { configurable: true, writable: true, value: onDiagnostic },
        headers: { configurable: true, writable: true, value: { 'x-ambient-fixture': 'do-not-send' } },
        timeout: { configurable: true, writable: true, value: 30_000 },
        maxRetries: { configurable: true, writable: true, value: 0 },
      });
      const runner = new DecisionsToolRunner({
        observe: () => 'fixture',
        candidates: () => [done, { id: 'set', description: 'Set fixture', execute: vi.fn() }],
      });
      const result = await runner.run(h.client, params, { requestOptions: {} });
      expect(result.status).toBe('unverified');
      expect(h.requestHeaders[0]?.has('x-ambient-fixture')).toBe(false);
      expect(verify).not.toHaveBeenCalled();
      expect(onDiagnostic).not.toHaveBeenCalled();
    } finally {
      for (const [key, descriptor] of originals) {
        if (descriptor) {
          // oxlint-disable-next-line no-extend-native -- Restore pre-test descriptor.
          Object.defineProperty(Object.prototype, key, descriptor);
        } else {
          Reflect.deleteProperty(Object.prototype, key);
        }
      }
    }
  });

  test('a configured diagnostic getter receives an invalid-parameters admission failure once', async () => {
    const read = vi.fn();
    const diagnostic = vi.fn();
    class Options {
      #observer = diagnostic;
      get onDiagnostic() {
        read();
        return this.#observer;
      }
    }
    const h = harness([]);
    const runner = new DecisionsToolRunner({ observe: () => 'fixture', candidates: () => [done] });
    const invalid = { ...params };
    Reflect.set(invalid, 'model', 7);
    await expect(runner.run(h.client, invalid, new Options())).rejects.toMatchObject({
      reason: 'invalid_params',
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(h.bodies).toHaveLength(0);
  });

  test.each(['omitted', 'class getter'] as const)(
    'request options reject ambient authorization with %s config',
    async (kind) => {
      const h = harness([[answer('finish')]]);
      const reads = vi.fn();
      class Config {
        #tenant = 'chosen';
        get requestOptions() {
          reads();
          return { headers: { 'x-fixture-tenant': this.#tenant } };
        }
      }
      const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'requestOptions');
      try {
        // oxlint-disable-next-line no-extend-native -- Local regression for ambient defaults; restored below.
        Object.defineProperty(Object.prototype, 'requestOptions', {
          configurable: true,
          value: { headers: { authorization: 'Bearer synthetic-ambient', 'x-fixture-tenant': 'ambient' } },
        });
        await new DecisionsToolRunner({
          observe: () => 'fixture',
          candidates: () => [done, { id: 'set', description: 'Set fixture', execute: vi.fn() }],
        }).run(h.client, params, kind === 'omitted' ? {} : new Config());
      } finally {
        if (previous) {
          // oxlint-disable-next-line no-extend-native -- Restore the original descriptor.
          Object.defineProperty(Object.prototype, 'requestOptions', previous);
        } else {
          Reflect.deleteProperty(Object.prototype, 'requestOptions');
        }
      }
      expect(h.requestHeaders[0]?.get('authorization')).toBe('Bearer synthetic-test-key');
      expect(h.requestHeaders[0]?.get('x-fixture-tenant')).toBe(kind === 'omitted' ? null : 'chosen');
      expect(reads).toHaveBeenCalledTimes(kind === 'omitted' ? 0 : 1);
    },
  );
  test.each(['inherited', 'accessor', 'nonenumerable'] as const)(
    'refuses a response with %s answers before selecting any registered work',
    async (kind) => {
      const h = harness([[answer('set')]]);
      const create = h.client.decisions.create.bind(h.client.decisions);
      const read = vi.fn(() => [answer('set')]);
      vi.spyOn(h.client.decisions, 'create').mockImplementation((body, options) =>
        create(body, options)._thenUnwrap((response) => {
          Reflect.deleteProperty(response, 'answers');
          if (kind === 'inherited') {
            Object.setPrototypeOf(response, { answers: [answer('set')] });
          } else if (kind === 'accessor') {
            Object.defineProperty(response, 'answers', { enumerable: true, get: read });
          } else {
            Object.defineProperty(response, 'answers', { enumerable: false, value: [answer('set')] });
          }
          return response;
        }),
      );
      const execute = vi.fn();
      const runner = new DecisionsToolRunner({
        observe: () => 'state',
        candidates: () => [done, { id: 'set', description: 'Set fixture', execute }],
      });
      await expect(runner.run(h.client, params)).rejects.toMatchObject({ reason: 'invalid_answer' });
      expect(execute).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(h.bodies).toHaveLength(1);
    },
  );

  test('candidate admission never takes an executor from Object.prototype', async () => {
    const env = harness([]);
    const execute = vi.fn();
    const runner = new DecisionsToolRunner({
      observe: () => 'state',
      // SAFETY: Intentionally missing a required executor to test admission of malformed registrations.
      candidates: () => [done, { id: 'act', description: 'missing executor' } as DecisionCandidate],
    });
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'execute');
    try {
      // oxlint-disable-next-line no-extend-native -- Bound regression for inherited ambient properties; restored below.
      Object.defineProperty(Object.prototype, 'execute', { value: execute, configurable: true });
      await expect(runner.run(env.client, params)).rejects.toMatchObject({ reason: 'invalid_candidates' });
    } finally {
      if (previous) {
        // oxlint-disable-next-line no-extend-native -- Restore the exact prior descriptor after the regression.
        Object.defineProperty(Object.prototype, 'execute', previous);
      } else {
        Reflect.deleteProperty(Object.prototype, 'execute');
      }
    }
    expect(execute).not.toHaveBeenCalled();
    expect(env.bodies).toEqual([]);
  });

  test('class-owned candidate getters and methods preserve their original receiver', async () => {
    class Action {
      id = 'set';
      readonly done = false;
      count = 0;
      get description() {
        return `Run ${this.id} for the fixture`;
      }
      execute() {
        this.count += 1;
      }
    }
    const action = new Action();
    const env = harness([[answer('set')], [answer('finish')]]);
    const runner = new DecisionsToolRunner({ observe: () => 'state', candidates: () => [action, done] });
    await expect(runner.run(env.client, params)).resolves.toMatchObject({ completedCandidateIds: ['set'] });
    expect(action.count).toBe(1);
  });

  test('uses the bounded indexed candidates without invoking a custom iterator', async () => {
    const execute = vi.fn();
    const candidates: DecisionCandidate[] = [done, { id: 'set', description: 'Set fixture', execute }];
    candidates[Symbol.iterator] = () => {
      throw new Error('Custom iterator must not run');
    };
    const env = harness([[answer('finish')]]);
    const runner = new DecisionsToolRunner({ observe: () => 'state', candidates: () => candidates });
    await expect(runner.run(env.client, params)).resolves.toMatchObject({ status: 'unverified' });
    expect(env.bodies).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
  });
  test.each(
    (['model', 'input', 'safety_identifier'] as const).flatMap((field) =>
      (['inherited', 'accessor', 'nonenumerable'] as const).map((kind) => ({ field, kind })),
    ),
  )('rejects $kind request field $field before a request', async ({ field, kind }) => {
    const supplied = { ...params };
    const value = supplied[field];
    Reflect.deleteProperty(supplied, field);
    if (kind === 'inherited') {
      Object.setPrototypeOf(supplied, { [field]: value });
    } else if (kind === 'accessor') {
      Object.defineProperty(supplied, field, {
        enumerable: true,
        get: () => {
          throw new Error('Getter must not run');
        },
      });
    } else {
      Object.defineProperty(supplied, field, { value, enumerable: false });
    }
    const env = harness([[answer('finish')]]);
    const runner = new DecisionsToolRunner({ observe: () => 'state', candidates: () => [done] });
    await expect(runner.run(env.client, supplied)).rejects.toMatchObject({ reason: 'invalid_params' });
    expect(env.bodies).toEqual([]);
  });
  test.each(
    (['name', 'type', 'choice'] as const).flatMap((field) =>
      (['inherited', 'accessor'] as const).map((kind) => ({ field, kind })),
    ),
  )('rejects an answer with $kind $field before invoking its executor', async ({ field, kind }) => {
    const env = harness([[answer('set')]]);
    const create = env.client.decisions.create.bind(env.client.decisions);
    vi.spyOn(env.client.decisions, 'create').mockImplementation((body, options) =>
      create(body, options)._thenUnwrap((value) => {
        const raw = answer('set');
        const inherited: unknown = raw[field];
        Reflect.deleteProperty(raw, field);
        if (kind === 'inherited') {
          Object.setPrototypeOf(raw, { [field]: inherited });
        } else {
          Object.defineProperty(raw, field, { enumerable: true, get: () => inherited });
        }
        value.answers = [raw];
        return value;
      }),
    );
    const execute = vi.fn();
    const runner = new DecisionsToolRunner({
      observe: () => 'state',
      candidates: () => [done, { id: 'set', description: 'Set fixture', execute }],
    });
    await expect(runner.run(env.client, params)).rejects.toMatchObject({ reason: 'invalid_answer' });
    expect(execute).not.toHaveBeenCalled();
  });

  test('selects the indexed answer even if its array iterator offers another choice', async () => {
    const env = harness([[{ type: 'refusal', name: 'next_action', refusal: 'Stop' }]]);
    const create = env.client.decisions.create.bind(env.client.decisions);
    vi.spyOn(env.client.decisions, 'create').mockImplementation((body, options) =>
      create(body, options)._thenUnwrap((value) => {
        value.answers[Symbol.iterator] = () => [answer('set')].values();
        return value;
      }),
    );
    const execute = vi.fn();
    const runner = new DecisionsToolRunner({
      observe: () => 'state',
      candidates: () => [done, { id: 'set', description: 'Set fixture', execute }],
    });
    await expect(runner.run(env.client, params)).resolves.toMatchObject({
      status: 'refused',
      attemptedCandidateIds: [],
    });
    expect(execute).not.toHaveBeenCalled();
    expect(env.bodies).toHaveLength(1);
  });

  test('keeps registration and candidate method receivers while capturing methods', async () => {
    const env = harness([[answer('set')], [answer('finish')]]);
    class Registration {
      action = {
        id: 'set',
        description: 'Set the fixture',
        calls: 0,
        execute() {
          this.calls += 1;
        },
      };
      observe() {
        return String(this.action.calls);
      }
      candidates() {
        return [done, this.action];
      }
      verify(observation: DecisionObservation) {
        return observation === '1' && this.action.calls === 1;
      }
    }
    const registration = new Registration();
    await expect(new DecisionsToolRunner(registration).run(env.client, params)).resolves.toMatchObject({
      status: 'verified',
      attemptedCandidateIds: ['set'],
      completedCandidateIds: ['set'],
    });
    expect(registration.action.calls).toBe(1);
  });

  test('diagnostics retain the actual choice and usage before failure without raw data', async () => {
    const env = harness([[answer('wrong')]]);
    const events: RunnerDiagnostic[] = [];
    const runner = new DecisionsToolRunner({
      observe: () => 'private-page-value',
      candidates: () => [
        done,
        {
          id: 'wrong',
          description: 'private-choice-description',
          execute: () => {
            throw new Error('secret-driver-error');
          },
        },
      ],
    });
    await expect(
      runner.run(env.client, params, {
        onDiagnostic(event) {
          events.push(structuredClone(event));
          return Promise.reject(new Error('observer failure'));
        },
      }),
    ).rejects.toMatchObject({ attemptedCandidateIds: ['wrong'], completedCandidateIds: [] });
    expect(events.filter((event) => event.stage === 'request')).toMatchObject([
      { reason: 'completed', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({ stage: 'selection', call_id: 'wrong', reason: 'completed' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ stage: 'action', call_id: 'wrong', reason: 'driver_failed' }),
    );
    expect(JSON.stringify(events)).not.toMatch(
      /private-page|private-choice|secret-driver|observer failure|synthetic-test-key/u,
    );
  });

  test.each(['missing', 'deleted', 'undefined', 'null'] as const)(
    'refuses %s observation slots before candidates or a Decisions request',
    async (kind) => {
      const observation: unknown[] = [{ type: 'input_text', text: 'supplied' }];
      if (kind === 'missing') {
        observation.length = 2;
      } else if (kind === 'deleted') {
        observation.push({ type: 'input_text', text: 'removed' });
        Reflect.deleteProperty(observation, '1');
      } else {
        observation.push(kind === 'null' ? null : undefined);
      }
      const h = harness([[answer('finish')]]);
      const execute = vi.fn();
      const candidates = vi.fn(() => [done, { id: 'act', description: 'set', execute }]);
      const runner = new DecisionsToolRunner({
        // SAFETY: This deliberately incomplete callback exercises runtime input admission.
        observe: () => observation as DecisionObservation,
        candidates,
      });
      await expect(runner.run(h.client, params)).rejects.toMatchObject({
        reason: 'failed',
        attemptedCandidateIds: [],
        completedCandidateIds: [],
      });
      expect(h.bodies).toHaveLength(0);
      expect(candidates).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    },
  );

  test.each(['data', 'accessor'] as const)(
    'preserves a present nonenumerable %s observation slot once and native optional fields',
    async (kind) => {
      const content: DecisionObservation = [];
      let reads = 0;
      const part = { type: 'input_text', text: 'provided', extra: { note: 'preserved' } };
      Object.defineProperty(content, '0', {
        enumerable: false,
        ...(kind === 'data'
          ? { value: part }
          : {
              get() {
                reads += 1;
                return part;
              },
            }),
      });
      content.push(
        { type: 'input_image', image_url: 'data:image/png;base64,ZmFrZQ==', detail: null },
        { type: 'input_image', image_url: 'data:image/png;base64,ZmFrZQ==', detail: 'original' },
      );
      const h = harness([[answer('finish')]]);
      const execute = vi.fn();
      const result = await new DecisionsToolRunner({
        observe: () => content,
        candidates: () => [done, { id: 'act', description: 'set', execute }],
      }).run(h.client, params);
      expect(result.status).toBe('unverified');
      expect(reads).toBe(kind === 'data' ? 0 : 1);
      expect(h.bodies).toMatchObject([
        {
          input: [
            { content: params.input },
            {
              content: [
                part,
                { type: 'input_image', detail: null },
                { type: 'input_image', detail: 'original' },
              ],
            },
          ],
        },
      ]);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  test('fresh done verification rejects missing observation parts without verification', async () => {
    const h = harness([]);
    let calls = 0;
    const verify = vi.fn(() => true);
    const runner = new DecisionsToolRunner({
      observe: () => {
        calls += 1;
        if (calls === 1) {
          return 'done';
        }
        const missing: DecisionObservation = [{ type: 'input_text', text: 'present' }];
        missing.length = 2;
        return missing;
      },
      candidates: () => [done],
      verify,
    });
    await expect(runner.run(h.client, params)).rejects.toMatchObject({ reason: 'failed' });
    expect(verify).not.toHaveBeenCalled();
    expect(h.bodies).toHaveLength(0);
  });

  test('uses real Decisions wire input and verifies independent state on action/done', async () => {
    const { client, bodies, paths } = harness([[answer('set')], [answer('finish')]]);
    let state = 'empty';
    const observe = vi.fn((): DecisionObservation => [
      { type: 'input_text', text: state },
      { type: 'input_image', image_url: 'data:image/png;base64,ZmFrZQ==' },
    ]);
    const execute = vi.fn(() => {
      state = 'complete';
    });
    const runner = new DecisionsToolRunner({
      observe,
      candidates: () => [done, { id: 'set', description: 'Set the fixture', execute }],
      verify: (observed) =>
        Array.isArray(observed) && observed[0]?.type === 'input_text' && observed[0].text === 'complete',
    });
    const result = await runner.run(client, params);
    expect(result).toMatchObject({
      status: 'verified',
      attemptedCandidateIds: ['set'],
      completedCandidateIds: ['set'],
    });
    expect(result.decisions).toHaveLength(2);
    expect(execute).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledTimes(3);
    expect(paths).toEqual(['/v1/decisions', '/v1/decisions']);
    expect(bodies).toMatchObject([
      {
        model: '',
        safety_identifier: 'fixture',
        input: [
          { role: 'user', content: params.input },
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'empty' },
              { type: 'input_image', image_url: 'data:image/png;base64,ZmFrZQ==' },
            ],
          },
        ],
        questions: [
          {
            type: 'choice',
            name: 'next_action',
            choices: [
              { value: 'finish', description: 'The fixture is complete' },
              { value: 'set', description: 'Set the fixture' },
            ],
          },
        ],
      },
      { input: [{ role: 'user' }, { role: 'user', content: [{ text: 'complete' }, {}] }] },
    ]);
  });

  test.each([
    { name: 'verified', verify: () => true, expected: 'verified' },
    { name: 'unverified', verify: undefined, expected: 'unverified' },
  ])('done-only $name never sends an invalid one-choice request', async ({ verify, expected }) => {
    const { client, bodies } = harness([]);
    const result = await new DecisionsToolRunner({
      observe: () => 'state',
      candidates: () => [done],
      ...(verify ? { verify } : {}),
    }).run(client, params, { maxSteps: 1 });
    expect(result).toEqual({
      status: expected,
      decisions: [],
      attemptedCandidateIds: [],
      completedCandidateIds: [],
    });
    expect(bodies).toEqual([]);
  });

  test.each([
    { withVerify: false, afterAction: false },
    { withVerify: true, afterAction: false },
    { withVerify: false, afterAction: true },
    { withVerify: true, afterAction: true },
  ])(
    'finish-selection Stop precedes terminal observation or return: %o',
    async ({ withVerify, afterAction }) => {
      const { client, bodies } = harness(afterAction ? [[answer('set')]] : []);
      const controller = new AbortController();
      let completed = !afterAction;
      const observe = vi.fn(() => String(completed));
      const verify = vi.fn(() => true);
      const runner = new DecisionsToolRunner({
        observe,
        candidates: () =>
          completed
            ? [done]
            : [
                done,
                {
                  id: 'set',
                  description: 'Set the local state',
                  execute: () => {
                    completed = true;
                  },
                },
              ],
        ...(withVerify ? { verify } : {}),
      });
      await expect(
        runner.run(client, params, {
          signal: controller.signal,
          onDiagnostic(event) {
            if (event.stage === 'selection' && event.call_id === 'finish') {
              controller.abort();
            }
          },
        }),
      ).rejects.toMatchObject({
        reason: 'cancelled',
        attemptedCandidateIds: afterAction ? ['set'] : [],
        completedCandidateIds: afterAction ? ['set'] : [],
      });
      expect(observe).toHaveBeenCalledTimes(afterAction ? 2 : 1);
      expect(verify).not.toHaveBeenCalled();
      expect(bodies).toHaveLength(afterAction ? 1 : 0);
    },
  );

  test('done-only failed verification stops immediately, preserving earlier evidence', async () => {
    const { client, bodies } = harness([[answer('set')]]);
    let state = false;
    const runner = new DecisionsToolRunner({
      observe: () => String(state),
      candidates: () =>
        state
          ? [done]
          : [
              done,
              {
                id: 'set',
                description: 'Change fixture',
                execute: () => {
                  state = true;
                },
              },
            ],
      verify: () => false,
    });
    await expect(runner.run(client, params)).rejects.toMatchObject({
      reason: 'verification_failed',
      attemptedCandidateIds: ['set'],
      completedCandidateIds: ['set'],
    });
    expect(bodies).toHaveLength(1);
  });

  test('refusal after an action stops with exact evidence and does not guess completion', async () => {
    const { client } = harness([[answer('set')], [{ name: 'next_action', type: 'refusal' }]]);
    const execute = vi.fn();
    const verify = vi.fn();
    const result = await new DecisionsToolRunner({
      observe: () => 'state',
      candidates: () => [done, { id: 'set', description: 'Set fixture', execute }],
      verify,
    }).run(client, params);
    expect(result).toMatchObject({
      status: 'refused',
      attemptedCandidateIds: ['set'],
      completedCandidateIds: ['set'],
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(verify).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', []],
    ['unknown', [answer('absent')]],
    ['boolean', [answer(true)]],
    ['mismatched name', [{ ...answer('set'), name: 'another' }]],
    ['extra', [answer('set'), answer('finish')]],
    ['wrong kind', [{ name: 'next_action', type: 'predicate' as const, probability: 1 }]],
  ])('invalid answer $0 after effect stops before further actions', async (_name, answers) => {
    const { client } = harness([[answer('set')], answers]);
    const execute = vi.fn();
    await expect(
      new DecisionsToolRunner({
        observe: () => 'state',
        candidates: () => [done, { id: 'set', description: 'Set fixture', execute }],
      }).run(client, params),
    ).rejects.toMatchObject({
      reason: 'invalid_answer',
      attemptedCandidateIds: ['set'],
      completedCandidateIds: ['set'],
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  test('owns task, observation, candidates and callbacks before later awaits', async () => {
    const execute = vi.fn();
    const replaced = vi.fn();
    const observation: DecisionObservation = [{ type: 'input_text', text: 'observed' }];
    const operation: DecisionCandidate = { id: 'set', description: 'Allowed fixture operation', execute };
    const terminal = { ...done };
    const supplied: DecisionCandidate[] = [terminal, operation];
    const requestParams = { ...params };
    const registration = {
      observe: () => observation,
      candidates: (copy: DecisionObservation) => {
        if (Array.isArray(copy)) {
          copy.splice(0);
        }
        observation.splice(0);
        return supplied;
      },
      verify: () => true,
    };
    const { client, bodies } = harness([
      () => {
        Object.assign(operation, { id: 'other', description: 'forbidden', done: true, execute: replaced });
        Object.assign(terminal, { done: false, execute: replaced });
        supplied.splice(0);
        Object.assign(requestParams, { input: 'forbidden' });
        Object.assign(registration, { observe: () => 'new', candidates: () => [], verify: () => false });
        return [answer('set')];
      },
      [answer('finish')],
    ]);
    // The saved provider returns its mutable array: restore it for the second turn.
    execute.mockImplementation(() => {
      supplied.push({ ...done }, { id: 'set', description: 'Allowed again', execute });
    });
    const result = await new DecisionsToolRunner(registration).run(client, requestParams);
    expect(result.status).toBe('verified');
    expect(execute).toHaveBeenCalledOnce();
    expect(replaced).not.toHaveBeenCalled();
    expect(bodies).toMatchObject([
      { input: [{ content: params.input }, { content: [{ text: 'observed' }] }] },
      { input: [{ content: params.input }, { content: [] }] },
    ]);
  });

  test.each([
    [],
    [{ id: 'run', description: 'no terminal', execute: () => {} }],
    [done, { ...done }],
    [done, { id: '', description: 'missing id', execute: () => {} }],
    [done, { id: 'run', description: '', execute: () => {} }],
    [done, { id: 'run', description: 'no executor' }],
    [done, { id: 'run', description: 'ambiguous', execute: () => {}, done: 'yes' }],
    [{ ...done, execute: () => {} }],
    [
      done,
      ...Array.from({ length: 255 }, (_, i) => ({ id: String(i), description: 'Extra', execute: () => {} })),
    ],
  ])('rejects invalid candidates before requests %#', async (...supplied) => {
    const { client, bodies } = harness([]);
    const runner = new DecisionsToolRunner({
      observe: () => 'state',
      // SAFETY: Exercise untyped callers with invalid candidate records.
      candidates: () => supplied as DecisionCandidate[],
    });
    await expect(runner.run(client, params)).rejects.toMatchObject({ reason: 'invalid_candidates' });
    expect(bodies).toEqual([]);
  });

  test('allows repeated IDs across choices but no effects on the final request', async () => {
    const { client, bodies } = harness([[answer('set')], [answer('set')], [answer('set')]]);
    const execute = vi.fn();
    let terminalReason: RunnerDiagnostic['reason'] | undefined;
    await expect(
      new DecisionsToolRunner({
        observe: () => 'state',
        candidates: () => [done, { id: 'set', description: 'Set fixture', execute }],
      }).run(client, params, {
        maxSteps: 3,
        onDiagnostic: (event) => {
          terminalReason = event.reason;
        },
      }),
    ).rejects.toMatchObject({
      reason: 'step_limit',
      attemptedCandidateIds: ['set', 'set'],
      completedCandidateIds: ['set', 'set'],
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(bodies).toHaveLength(3);
    expect(terminalReason).toBe('step_limit');
  });

  test('failed multi-choice verification tries again up to the budget, never claiming success', async () => {
    const { client, bodies } = harness([[answer('finish')], [answer('finish')]]);
    const execute = vi.fn();
    let terminalReason: RunnerDiagnostic['reason'] | undefined;
    await expect(
      new DecisionsToolRunner({
        observe: () => 'state',
        candidates: () => [done, { id: 'set', description: 'Set fixture', execute }],
        verify: () => false,
      }).run(client, params, {
        maxSteps: 2,
        onDiagnostic: (event) => {
          terminalReason = event.reason;
        },
      }),
    ).rejects.toMatchObject({
      reason: 'step_limit',
      attemptedCandidateIds: [],
      completedCandidateIds: [],
    });
    expect(execute).not.toHaveBeenCalled();
    expect(bodies).toHaveLength(2);
    expect(terminalReason).toBe('step_limit');
  });

  test('nonboolean verification cannot approve completion', async () => {
    const { client } = harness([]);
    await expect(
      new DecisionsToolRunner({
        observe: () => 'state',
        candidates: () => [done],
        // SAFETY: Exercise non-TypeScript caller returning a truthy object.
        verify: () => ({}) as boolean,
      }).run(client, params),
    ).rejects.toMatchObject({ reason: 'invalid_verification' });
  });

  test.each([
    [{ ...params, tools: [] }, {}],
    [{ ...params, questions: [] }, {}],
    [params, { stream: false }],
    [params, { maxSteps: 0 }],
    [params, { maxSteps: null }],
    [params, { maxSteps: 1.5 }],
  ])('rejects unsupported input before observe or request %#', async (input, options) => {
    const { client, bodies } = harness([]);
    const observe = vi.fn(() => 'state');
    await expect(
      new DecisionsToolRunner({ observe, candidates: () => [done] }).run(
        client,
        // SAFETY: Intentionally pass an extra unsupported field from an untyped caller.
        input as DecisionsRunnerParams,
        // SAFETY: Invalid/untyped stream and bound options exercise run's input boundary.
        options as DecisionsRunnerOptions,
      ),
    ).rejects.toMatchObject({ reason: 'invalid_params' });
    expect(observe).not.toHaveBeenCalled();
    expect(bodies).toEqual([]);
  });

  test('cancellation through request options before first observation has no effects', async () => {
    const { client, bodies } = harness([]);
    const observe = vi.fn(() => 'state');
    const controller = new AbortController();
    controller.abort('synthetic sensitive reason');
    const runner = new DecisionsToolRunner({ observe, candidates: () => [done] });
    await expect(
      runner.run(client, params, { requestOptions: { signal: controller.signal } }),
    ).rejects.toMatchObject({ reason: 'cancelled', attemptedCandidateIds: [], completedCandidateIds: [] });
    expect(observe).not.toHaveBeenCalled();
    expect(bodies).toEqual([]);
  });

  test.each([
    {
      body: {
        model: '',
        input: 'another task',
        questions: [
          {
            type: 'choice',
            name: 'next_action',
            choices: [
              { value: 'set', description: 'Opposite meaning' },
              { value: 'finish', description: 'Cancel' },
            ],
          },
        ],
      },
    },
    { stream: true },
    { fetchOptions: { body: '{"input":"opposite meaning"}' } },
    { path: '/other' },
  ])('rejects route, body and stream request overrides before any callback %#', async (override) => {
    const { client, bodies } = harness([[answer('set')]]);
    const observe = vi.fn(() => 'state');
    const execute = vi.fn();
    const runner = new DecisionsToolRunner({
      observe,
      candidates: () => [done, { id: 'set', description: 'Allowed fixture action', execute }],
    });
    // A wider untyped settings object bypasses TypeScript's excess-property check.
    const requestOptions = { timeout: 1000, ...override };
    await expect(runner.run(client, params, { requestOptions })).rejects.toMatchObject({
      reason: 'invalid_params',
      attemptedCandidateIds: [],
      completedCandidateIds: [],
    });
    expect(observe).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(bodies).toEqual([]);
  });

  test('copies approved request settings before callbacks, including header null-unsets and signal', async () => {
    const { client, bodies, paths, requestHeaders } = harness([[answer('set')], [answer('finish')]]);
    const controller = new AbortController();
    const other = new AbortController();
    other.abort('not the registered signal');
    const headers = { 'X-Fixture': 'owned', 'X-Fixture-Default': null };
    const requestOptions = { timeout: 2000, maxRetries: 0, headers, signal: controller.signal };
    const execute = vi.fn();
    const runner = new DecisionsToolRunner({
      observe: () => {
        Object.assign(requestOptions, {
          body: { model: '', input: 'altered evidence' },
          stream: true,
          path: '/other',
          maxRetries: 10,
          timeout: 0,
          signal: other.signal,
        });
        Object.assign(headers, { 'X-Fixture': 'changed', 'X-Fixture-Default': 'restored' });
        return 'actual observation';
      },
      candidates: () => [done, { id: 'set', description: 'Allowed fixture action', execute }],
      verify: () => true,
    });
    const result = await runner.run(client, params, { requestOptions });
    expect(result).toMatchObject({
      status: 'verified',
      attemptedCandidateIds: ['set'],
      completedCandidateIds: ['set'],
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(paths).toEqual(['/v1/decisions', '/v1/decisions']);
    expect(bodies).toMatchObject([
      {
        input: [{ content: params.input }, { content: 'actual observation' }],
        questions: [
          { choices: [{ value: 'finish' }, { value: 'set', description: 'Allowed fixture action' }] },
        ],
      },
      { input: [{ content: params.input }, { content: 'actual observation' }] },
    ]);
    expect(requestHeaders.map((value) => [value.get('X-Fixture'), value.get('X-Fixture-Default')])).toEqual([
      ['owned', null],
      ['owned', null],
    ]);
  });

  test('an array-like wire answers object cannot authorize a callback', async () => {
    const answers = { 0: answer('set'), length: 1 };
    const { client } = harness([answers]);
    const execute = vi.fn();
    await expect(
      new DecisionsToolRunner({
        observe: () => 'state',
        candidates: () => [done, { id: 'set', description: 'Set fixture', execute }],
      }).run(client, params),
    ).rejects.toMatchObject({
      reason: 'invalid_answer',
      attemptedCandidateIds: [],
      completedCandidateIds: [],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  test('cancellation just after execute and mutate-then-throw preserve different evidence safely', async () => {
    const controller = new AbortController();
    const { client } = harness([[answer('set')]]);
    const cancelled = new DecisionsToolRunner({
      observe: () => 'state',
      candidates: () => [done, { id: 'set', description: 'Set fixture', execute: () => controller.abort() }],
    });
    await expect(cancelled.run(client, params, { signal: controller.signal })).rejects.toMatchObject({
      reason: 'cancelled',
      attemptedCandidateIds: ['set'],
      completedCandidateIds: ['set'],
    });
    const second = harness([[answer('set')]]);
    let changed = false;
    const failing = new DecisionsToolRunner({
      observe: () => 'state',
      candidates: () => [
        done,
        {
          id: 'set',
          description: 'Set fixture',
          execute: () => {
            changed = true;
            throw new Error('sensitive fixture token');
          },
        },
      ],
    });
    const failure = await failing.run(second.client, params).catch((error: unknown) => error);
    expect(changed).toBe(true);
    expect(failure).toBeInstanceOf(DecisionsToolRunnerError);
    expect(failure).toMatchObject({
      reason: 'failed',
      attemptedCandidateIds: ['set'],
      completedCandidateIds: [],
    });
    expect(String(failure)).not.toContain('sensitive fixture token');
    expect(failure).not.toHaveProperty('cause');
  });
});
