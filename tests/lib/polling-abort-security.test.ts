import { getEventListeners } from 'node:events';
import { vi } from 'vitest';

import OpenAI, { APIUserAbortError } from 'openai';
import type { Fetch } from 'openai/internal/builtin-types';
import type { RequestOptions } from 'openai/internal/request-options';
import { pollWithResponse } from 'openai/lib/polling';

type Options = RequestOptions & { pollIntervalMs?: number };
type FetchMock = ReturnType<typeof vi.fn<Fetch>>;
type Method = [string, number, (client: OpenAI, options: Options) => Promise<unknown>];
type AbortListener = Parameters<AbortSignal['addEventListener']>[1];
type AbortListenerOptions = Parameters<AbortSignal['addEventListener']>[2];
type AbortListenerRemovalOptions = Parameters<AbortSignal['removeEventListener']>[2];

const runs = (client: OpenAI) => client.beta.threads.runs;
const files = (client: OpenAI) => client.vectorStores.files;
const batches = (client: OpenAI) => client.vectorStores.fileBatches;
const sampleFile = () => new File(['contents'], 'example.txt');
const uploads = () => ({ files: [sampleFile()] });
const runID = 'run_123';
const thread = { thread_id: 'thread_123' };
const assistant = { assistant_id: 'assistant_123' };
const fileData = { file_id: 'uploaded_123' };
const batchData = { file_ids: ['uploaded_123'] };
const tool = { ...thread, tool_outputs: [{ tool_call_id: 'tool_123', output: 'done' }] };

const directMethods: Method[] = [
  ['runs.poll', 1, (client, options) => runs(client).poll(runID, thread, options)],
  ['files.poll', 1, (client, options) => files(client).poll('vs_123', 'file_123', options)],
  ['fileBatches.poll', 1, (client, options) => batches(client).poll('vs_123', 'batch_123', options)],
];

const transitiveMethods: Method[] = [
  ['runs.createAndPoll', 2, (c, o) => runs(c).createAndPoll('thread_123', assistant, o)],
  ['runs.submitToolOutputsAndPoll', 2, (c, o) => runs(c).submitToolOutputsAndPoll(runID, tool, o)],
  ['threads.createAndRunPoll', 2, (c, o) => c.beta.threads.createAndRunPoll(assistant, o)],
  ['files.createAndPoll', 2, (c, o) => files(c).createAndPoll('vs_123', fileData, o)],
  ['files.uploadAndPoll', 3, (c, o) => files(c).uploadAndPoll('vs_123', sampleFile(), o)],
  ['fileBatches.createAndPoll', 2, (c, o) => batches(c).createAndPoll('vs_123', batchData, o)],
  ['fileBatches.uploadAndPoll', 3, (c, o) => batches(c).uploadAndPoll('vs_123', uploads(), o)],
];

function createClient(header?: string): { client: OpenAI; fetch: FetchMock } {
  let polls = 0;
  const fetch = vi.fn<Fetch>(async (url, init) => {
    if (String(url).startsWith('data:')) {
      return new Response('');
    }

    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const run = path.includes('/runs');
    let id = run ? runID : 'file_123';
    if (path.includes('/file_batches')) {
      id = 'batch_123';
    }

    const intermediate = run ? 'queued' : 'in_progress';
    if (path === '/v1/files' && method === 'POST') {
      return Response.json({ id: 'uploaded_123' });
    }
    if (method !== 'GET') {
      return Response.json({ id, thread_id: 'thread_123', status: intermediate });
    }

    polls += 1;
    return Response.json(
      { id, thread_id: 'thread_123', status: polls === 1 ? intermediate : 'completed' },
      { headers: header === undefined ? {} : { 'openai-poll-after-ms': header } },
    );
  });

  return {
    client: new OpenAI({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', maxRetries: 0, fetch }),
    fetch,
  };
}

function requestCount(fetch: FetchMock): number {
  return fetch.mock.calls.filter(([url]) => String(url).startsWith('https:')).length;
}

async function waitForDelay(fetch: FetchMock, requests: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  expect(requestCount(fetch)).toBe(requests);
  expect(vi.getTimerCount()).toBe(1);
}

async function observe(promise: Promise<unknown>): Promise<unknown> {
  try {
    return { completed: await promise };
  } catch (error) {
    return error;
  }
}

async function expectAbort(
  observed: Promise<unknown>,
  signal: AbortSignal,
  fetch: FetchMock,
  requests: number,
  retainedListeners: unknown[] = [],
): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  const pending = Symbol('poll is still waiting');
  const error = await Promise.race([observed, Promise.resolve(pending)]);

  expect(error).not.toBe(pending);
  expect(error).toBeInstanceOf(APIUserAbortError);
  expect(Object.getOwnPropertyDescriptor(error, 'cause')).toEqual({
    value: signal.reason,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  expect(requestCount(fetch)).toBe(requests);
  expect(getEventListeners(signal, 'abort')).toEqual(retainedListeners);
  expect(vi.getTimerCount()).toBe(0);
}

function pollInternal(
  options: Options,
  statuses = ['in_progress'],
  header?: string,
): Promise<{ id: string; status: string }> {
  let index = 0;
  const client = new OpenAI({
    apiKey: 'test-key',
    fetch: async () => {
      const status = statuses[index] ?? 'completed';
      index += 1;
      return Response.json(
        { id: 'file_123', status },
        { headers: header === undefined ? {} : { 'openai-poll-after-ms': header } },
      );
    },
  });

  return pollWithResponse(
    () => client.get<{ id: string; status: string }>('/poll'),
    ['in_progress'],
    ['completed'],
    options,
  );
}

function hiddenSignal(signal: AbortSignal, inherited: boolean): Options {
  const options: Options = { pollIntervalMs: 20 };
  return inherited
    ? Object.assign(Object.create({ signal }), options)
    : Object.defineProperty(options, 'signal', { value: signal });
}

function throwingStructuralSignal(controller: AbortController): {
  signal: AbortSignal;
  removeEventListener: ReturnType<typeof vi.fn<AbortSignal['removeEventListener']>>;
  callbackErrors: unknown[];
  failNextRemovals: (count?: number) => void;
} {
  const callbackErrors: unknown[] = [];
  const listeners = new Map<NonNullable<AbortListener>, NonNullable<AbortListener>>();
  let failuresRemaining = 0;
  const removeEventListener = vi.fn<AbortSignal['removeEventListener']>(
    (type: string, listener: AbortListener, options?: AbortListenerRemovalOptions) => {
      const registered = listener ? (listeners.get(listener) ?? listener) : listener;
      controller.signal.removeEventListener(type, registered, options);
      if (listener) {
        listeners.delete(listener);
      }
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error('structural signal listener removal failed');
      }
    },
  );

  const signal: AbortSignal = {
    get aborted() {
      return controller.signal.aborted;
    },
    get reason() {
      return controller.signal.reason;
    },
    onabort: null,
    throwIfAborted: controller.signal.throwIfAborted.bind(controller.signal),
    addEventListener(type: string, listener: AbortListener, options?: AbortListenerOptions) {
      if (!listener) {
        controller.signal.addEventListener(type, listener, options);
        return;
      }

      const guarded = (event: Event) => {
        try {
          if (typeof listener === 'function') {
            listener.call(controller.signal, event);
          } else {
            listener.handleEvent(event);
          }
        } catch (error) {
          callbackErrors.push(error);
        }
      };
      listeners.set(listener, guarded);
      controller.signal.addEventListener(type, guarded, options);
    },
    removeEventListener,
    dispatchEvent: controller.signal.dispatchEvent.bind(controller.signal),
  };

  return {
    signal,
    removeEventListener,
    callbackErrors,
    failNextRemovals(count = 1) {
      failuresRemaining = count;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(directMethods)('%s public cancellation', (_name, requests, invoke) => {
  test.each([
    { name: 'default interval', header: undefined },
    { name: 'server interval', header: '9000' },
  ])('honors a zero interval over the $name and releases its abort listener', async ({ header }) => {
    const controller = new AbortController();
    const { client, fetch } = createClient(header);
    const pending = observe(invoke(client, { signal: controller.signal, pollIntervalMs: 0 }));

    await vi.advanceTimersByTimeAsync(1);

    expect(requestCount(fetch)).toBe(requests + 1);
    await expect(Promise.race([pending, Promise.resolve('still polling')])).resolves.toMatchObject({
      completed: { status: 'completed' },
    });
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('promptly cancels the documented caller signal without another request', async () => {
    const controller = new AbortController();
    const { client, fetch } = createClient();
    const pending = observe(invoke(client, { signal: controller.signal, pollIntervalMs: 6000 }));

    await waitForDelay(fetch, requests);
    controller.abort(new Error('documented caller cancellation'));

    await expectAbort(pending, controller.signal, fetch, requests);
  });
});

describe.each(transitiveMethods)('%s transitive cancellation', (_name, requests, invoke) => {
  test('cancels the real delegated public poll without another request', async () => {
    const controller = new AbortController();
    const { client, fetch } = createClient();
    const pending = observe(invoke(client, { signal: controller.signal, pollIntervalMs: 6000 }));

    await waitForDelay(fetch, requests);
    controller.abort(new Error('transitive caller cancellation'));

    await expectAbort(pending, controller.signal, fetch, requests);
  });
});

describe.each([...directMethods, ...transitiveMethods])(
  '%s structural listener-removal failures',
  (_name, requests, invoke) => {
    test('still rejects cancellation exactly once and cleans up its listener', async () => {
      const controller = new AbortController();
      const { signal, removeEventListener, callbackErrors, failNextRemovals } =
        throwingStructuralSignal(controller);
      const { client, fetch } = createClient();
      const pending = observe(invoke(client, { signal, pollIntervalMs: 6000 }));

      await waitForDelay(fetch, requests);
      removeEventListener.mockClear();
      failNextRemovals();
      controller.abort(new Error('structural signal cancellation during throwing removal'));

      await expectAbort(pending, controller.signal, fetch, requests);
      expect(removeEventListener).toHaveBeenCalledTimes(1);
      expect(callbackErrors).toEqual([]);
    });

    test('still completes its timer without leaking a callback exception', async () => {
      const controller = new AbortController();
      const { signal, removeEventListener, callbackErrors, failNextRemovals } =
        throwingStructuralSignal(controller);
      const { client, fetch } = createClient();
      const pending = observe(invoke(client, { signal, pollIntervalMs: 25 }));

      await waitForDelay(fetch, requests);
      const retainedListeners = getEventListeners(controller.signal, 'abort').slice(0, -1);
      removeEventListener.mockClear();
      failNextRemovals();
      await vi.advanceTimersByTimeAsync(25);

      await expect(pending).resolves.toMatchObject({ completed: { status: 'completed' } });
      expect(requestCount(fetch)).toBe(requests + 1);
      expect(getEventListeners(controller.signal, 'abort')).toEqual([
        ...retainedListeners,
        expect.any(Function),
      ]);
      expect(vi.getTimerCount()).toBe(0);
      expect(removeEventListener).toHaveBeenCalledTimes(2);
      expect(callbackErrors).toEqual([]);
    });
  },
);

describe('poll interval, caller-signal ownership, and listener lifecycle', () => {
  test.each([
    { name: 'default interval', header: undefined, interval: undefined },
    { name: 'server interval', header: '9000', interval: undefined },
    { name: 'explicit interval', header: '9000', interval: 7000 },
  ])('cancels the $name instead of waiting for it', async ({ header, interval }) => {
    const controller = new AbortController();
    const { client, fetch } = createClient(header);
    const options: Options = { signal: controller.signal };
    if (interval !== undefined) {
      options.pollIntervalMs = interval;
    }

    const pending = observe(runs(client).poll(runID, thread, options));
    await waitForDelay(fetch, 1);
    controller.abort(new Error('interval cancellation'));

    await expectAbort(pending, controller.signal, fetch, 1);
  });

  test('removes only its own listener and preserves unrelated caller listeners', async () => {
    const controller = new AbortController();
    const unrelated = vi.fn();
    controller.signal.addEventListener('abort', unrelated);
    const { client, fetch } = createClient();
    const pending = observe(
      files(client).poll('vs_123', 'file_123', { signal: controller.signal, pollIntervalMs: 6000 }),
    );

    await waitForDelay(fetch, 1);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(2);
    controller.abort(new Error('caller cancellation'));

    await expectAbort(pending, controller.signal, fetch, 1, [unrelated]);
    expect(unrelated).toHaveBeenCalledTimes(1);
  });

  test('removes its listener after a normal interval elapses', async () => {
    const controller = new AbortController();
    const { client, fetch } = createClient();
    const pending = files(client).poll('vs_123', 'file_123', {
      signal: controller.signal,
      pollIntervalMs: 25,
    });

    await waitForDelay(fetch, 1);
    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toMatchObject({ status: 'completed' });
    expect(requestCount(fetch)).toBe(2);
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([
    ['inherited signal', (signal: AbortSignal) => hiddenSignal(signal, true)],
    ['non-enumerable signal', (signal: AbortSignal) => hiddenSignal(signal, false)],
    ['null signal', () => ({ signal: null, pollIntervalMs: 20 })],
    ['undefined signal', () => ({ signal: undefined, pollIntervalMs: 20 })],
  ] satisfies [string, (signal: AbortSignal) => Options][])(
    'ignores %s like the request object spread',
    async (_name, makeOptions) => {
      const controller = new AbortController();
      const { client, fetch } = createClient();
      const pending = files(client).poll('vs_123', 'file_123', makeOptions(controller.signal));

      await waitForDelay(fetch, 1);
      controller.abort(new Error('not an effective request signal'));
      await vi.advanceTimersByTimeAsync(20);

      await expect(pending).resolves.toMatchObject({ status: 'completed' });
      expect(requestCount(fetch)).toBe(2);
      expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
    },
  );

  test.each([null, false, 0, '', 'private reason'])('preserves an exact abort cause: %j', async (reason) => {
    const controller = new AbortController();
    const { client, fetch } = createClient();
    const pending = observe(
      files(client).poll('vs_123', 'file_123', { signal: controller.signal, pollIntervalMs: 5000 }),
    );

    await waitForDelay(fetch, 1);
    controller.abort(reason);

    await expectAbort(pending, controller.signal, fetch, 1);
  });
});

describe('caller-signal reentrancy and polling compatibility', () => {
  test('rejects an already-aborted caller signal before creating a timer', async () => {
    const controller = new AbortController();
    controller.abort(new Error('caller already aborted'));

    await expect(pollInternal({ signal: controller.signal })).rejects.toMatchObject({
      cause: controller.signal.reason,
    });
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('preserves terminal and unknown statuses without reading the signal getter', async () => {
    const getter = vi.fn(() => {
      throw new Error('signal getter must not be inspected');
    });
    const options: Options = Object.defineProperty({}, 'signal', { enumerable: true, get: getter });

    await expect(pollInternal(options, ['future_status', 'completed'])).resolves.toMatchObject({
      status: 'completed',
    });
    expect(getter).not.toHaveBeenCalled();
  });

  test('reads the server interval before evaluating the signal getter exactly once', async () => {
    const order: string[] = [];
    const controller = new AbortController();
    const original = Headers.prototype.get;
    vi.spyOn(Headers.prototype, 'get').mockImplementation(function capturePollingHeader(
      this: Headers,
      name: string,
    ) {
      if (name === 'openai-poll-after-ms') {
        order.push('header');
      }
      return original.call(this, name);
    });
    const options: Options = Object.defineProperty({}, 'signal', {
      enumerable: true,
      get() {
        order.push('signal');
        return controller.signal;
      },
    });

    const pending = pollInternal(options, ['in_progress', 'completed'], '15');
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['header', 'signal']);
    await vi.advanceTimersByTimeAsync(15);

    await expect(pending).resolves.toMatchObject({ status: 'completed' });
    expect(order).toEqual(['header', 'signal']);
  });

  test('supports a structural or polyfilled AbortSignal through the actual public API', async () => {
    const controller = new AbortController();
    const signal: AbortSignal = {
      get aborted() {
        return controller.signal.aborted;
      },
      get reason() {
        return controller.signal.reason;
      },
      onabort: null,
      throwIfAborted: controller.signal.throwIfAborted.bind(controller.signal),
      addEventListener: controller.signal.addEventListener.bind(controller.signal),
      removeEventListener: controller.signal.removeEventListener.bind(controller.signal),
      dispatchEvent: controller.signal.dispatchEvent.bind(controller.signal),
    };
    const { client, fetch } = createClient();
    const pending = observe(files(client).poll('vs_123', 'file_123', { signal, pollIntervalMs: 4000 }));

    await waitForDelay(fetch, 1);
    controller.abort(new Error('structural signal cancellation'));

    await expectAbort(pending, controller.signal, fetch, 1);
  });

  test.each([false, true])(
    'preserves public cancellation when registration races and removal throws (late throw: %s)',
    async (throwAfterInstall) => {
      const controller = new AbortController();
      const reason = new Error('structural abort raced with listener installation');
      const { signal, removeEventListener, callbackErrors, failNextRemovals } =
        throwingStructuralSignal(controller);
      const original = signal.addEventListener.bind(signal);

      vi.spyOn(signal, 'addEventListener').mockImplementation(((
        type: string,
        listener: AbortListener,
        options?: AbortListenerOptions,
      ) => {
        if (removeEventListener.mock.calls.length === 0) {
          original(type, listener, options);
          return;
        }

        removeEventListener.mockClear();
        failNextRemovals(2);
        controller.abort(reason);
        if (typeof listener === 'function') {
          listener.call(signal, new Event('abort'));
          listener.call(signal, new Event('abort'));
        }
        original(type, listener, options);
        if (throwAfterInstall) {
          throw new Error('structural registration threw after cancellation and installation');
        }
      }) as typeof signal.addEventListener);

      const { client, fetch } = createClient();
      const pending = observe(files(client).poll('vs_123', 'file_123', { signal, pollIntervalMs: 4000 }));

      await expectAbort(pending, controller.signal, fetch, 1);
      expect(removeEventListener).toHaveBeenCalledTimes(2);
      expect(callbackErrors).toEqual([]);
    },
  );

  test('preserves a public registration failure when listener removal also throws', async () => {
    const controller = new AbortController();
    const failure = new Error('structural registration failed after installation');
    const { signal, removeEventListener, callbackErrors, failNextRemovals } =
      throwingStructuralSignal(controller);
    const original = signal.addEventListener.bind(signal);
    let retainedListeners: unknown[] = [];

    vi.spyOn(signal, 'addEventListener').mockImplementation(((
      type: string,
      listener: AbortListener,
      options?: AbortListenerOptions,
    ) => {
      if (removeEventListener.mock.calls.length === 0) {
        original(type, listener, options);
        return;
      }

      retainedListeners = getEventListeners(controller.signal, 'abort');
      removeEventListener.mockClear();
      failNextRemovals();
      original(type, listener, options);
      throw failure;
    }) as typeof signal.addEventListener);

    const { client, fetch } = createClient();
    const pending = observe(files(client).poll('vs_123', 'file_123', { signal, pollIntervalMs: 4000 }));
    await vi.advanceTimersByTimeAsync(0);

    await expect(pending).resolves.toBe(failure);
    expect(requestCount(fetch)).toBe(1);
    expect(getEventListeners(controller.signal, 'abort')).toEqual(retainedListeners);
    expect(vi.getTimerCount()).toBe(0);
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(callbackErrors).toEqual([]);
  });

  test.each([
    { deliver: false, throwAfterInstall: false },
    { deliver: true, throwAfterInstall: false },
    { deliver: true, throwAfterInstall: true },
  ])(
    'closes registration races (callback: $deliver; late throw: $throwAfterInstall)',
    async ({ deliver, throwAfterInstall }) => {
      const controller = new AbortController();
      const reason = new Error('abort raced with listener installation');
      const original = controller.signal.addEventListener.bind(controller.signal);

      vi.spyOn(controller.signal, 'addEventListener').mockImplementation(((
        type: string,
        listener: AbortListener,
        options?: AbortListenerOptions,
      ) => {
        controller.abort(reason);
        if (deliver && typeof listener === 'function') {
          listener.call(controller.signal, new Event('abort'));
        }
        original(type, listener, options);
        if (throwAfterInstall) {
          throw new Error('registration threw after cancellation and installation');
        }
      }) as typeof controller.signal.addEventListener);

      await expect(pollInternal({ signal: controller.signal, pollIntervalMs: 4000 })).rejects.toMatchObject({
        cause: reason,
      });

      expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test('removes a listener when registration installs it and then throws', async () => {
    const controller = new AbortController();
    const failure = new Error('registration failed after installation');
    const original = controller.signal.addEventListener.bind(controller.signal);

    vi.spyOn(controller.signal, 'addEventListener').mockImplementation(((
      type: string,
      listener: AbortListener,
      options?: AbortListenerOptions,
    ) => {
      original(type, listener, options);
      throw failure;
    }) as typeof controller.signal.addEventListener);

    await expect(pollInternal({ signal: controller.signal, pollIntervalMs: 4000 })).rejects.toBe(failure);
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('preserves a timer-creation failure without attaching listeners', async () => {
    const controller = new AbortController();
    const failure = new TypeError('host rejected the interval');
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => {
      throw failure;
    });

    await expect(pollInternal({ signal: controller.signal, pollIntervalMs: 4321 })).rejects.toBe(failure);
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
