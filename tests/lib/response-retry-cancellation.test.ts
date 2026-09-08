/* oxlint-disable max-classes-per-file -- Fixtures separate unrelated custom clones from retained native tee branches. */
import OpenAI from 'openai';
import { test, vi } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

function deferred() {
  let release!: () => void;
  // oxlint-disable-next-line promise/avoid-new -- The gate models asynchronous transport cleanup.
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function settle(request: PromiseLike<unknown>) {
  try {
    return { value: await request };
  } catch (error) {
    return { error };
  }
}

test.each([
  ...[408, 409, 429, 500].map((status) => ({ workload: false, status, customClone: false })),
  { workload: true, status: 500, customClone: false },
  { workload: true, status: 401, customClone: false },
  { workload: false, status: 500, customClone: true },
])(
  'awaits cancellation before retrying an unshared response: %j',
  async ({ workload, status, customClone }) => {
    vi.useFakeTimers();
    const cancelled = deferred();
    const cleanup = deferred();
    let released = false;
    let calls = 0;
    const first = new Response(
      new ReadableStream({
        async cancel() {
          cancelled.release();
          await cleanup.promise;
          released = true;
        },
      }),
      { status, headers: { 'retry-after-ms': '1' } },
    );
    class RetryClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const response = await super.fetchWithTimeout(...args);
        if (!customClone || response.ok) {
          return response;
        }
        const copy = this.cloneResponse(response);
        await response.body?.cancel();
        return copy;
      }
    }
    const transport = createWorkloadIdentityTransport(() => {
      calls += 1;
      if (calls === 1) {
        if (!customClone) {
          return first;
        }
        const original = new Response('unrelated source', { status });
        Object.defineProperty(original, 'clone', { value: () => first });
        return original;
      }
      if (!released) {
        throw new Error('The previous response still owns the transport');
      }
      return Response.json({ ok: true });
    });
    const client = new RetryClient({
      ...(workload ? createTestClientOptions() : {}),
      apiKey: workload ? null : 'synthetic-api-key',
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: status === 401 ? 0 : 1,
    });
    const result = settle(client.get('/synthetic'));
    try {
      await cancelled.promise;
      await vi.advanceTimersByTimeAsync(5);
      expect(calls).toBe(1);
      expect(released).toBe(false);
    } finally {
      cleanup.release();
      await vi.runAllTimersAsync();
      await result;
      vi.useRealTimers();
    }
    expect(await result).toEqual({ value: { ok: true } });
    expect(calls).toBe(2);
    expect(released).toBe(true);
    const expectedExchanges = status === 401 ? 2 : 1;
    expect(transport.exchanges).toBe(workload ? expectedExchanges : 0);
  },
);

describe.each([false, true])('retrying a known clone with workload identity: %s', (workload) => {
  test.each(['source', 'copy'] as const)(
    'does not wait for the retained sibling of the %s',
    async (selected) => {
      vi.useFakeTimers();
      const cloned = deferred();
      let retained: Response | undefined;
      let calls = 0;
      class CloneClient extends OpenAI {
        override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
          const response = await super.fetchWithTimeout(...args);
          if (response.ok) {
            return response;
          }
          const copy = this.cloneResponse(response);
          retained = selected === 'source' ? copy : response;
          cloned.release();
          return selected === 'source' ? response : copy;
        }
      }
      const transport = createWorkloadIdentityTransport(() => {
        calls += 1;
        return calls === 1
          ? new Response(new ReadableStream(), { status: 500, headers: { 'retry-after-ms': '1' } })
          : Response.json({ ok: true });
      });
      const client = new CloneClient({
        ...(workload ? createTestClientOptions() : {}),
        apiKey: workload ? null : 'synthetic-api-key',
        adminAPIKey: null,
        fetch: transport.fetch,
        maxRetries: 1,
      });
      const result = settle(client.get('/synthetic'));
      try {
        await cloned.promise;
        await vi.advanceTimersByTimeAsync(5);
        expect(calls).toBe(2);
      } finally {
        const cancelled = retained?.body?.cancel();
        await vi.runAllTimersAsync();
        await cancelled;
        await result;
        vi.useRealTimers();
      }
      expect(await result).toEqual({ value: { ok: true } });
    },
  );
});

test.each([false, true])(
  'awaits unrelated cleanup when a custom clone also tees its source: rejecting=%s',
  async (rejecting) => {
    vi.useFakeTimers();
    const cancelled = deferred();
    const cleanup = deferred();
    const cleanupError = new Error('Synthetic transport cleanup failed');
    let released = false;
    let retained: Response | undefined;
    let calls = 0;
    const unrelated = new Response(
      new ReadableStream({
        async cancel() {
          cancelled.release();
          await cleanup.promise;
          if (rejecting) {
            throw cleanupError;
          }
          released = true;
        },
      }),
      { status: 500, headers: { 'retry-after-ms': '1' } },
    );
    const source = new Response(new ReadableStream(), { status: 500 });
    Object.defineProperty(source, 'clone', {
      value() {
        retained = Response.prototype.clone.call(source);
        return unrelated;
      },
    });
    class CustomCloneClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const response = await super.fetchWithTimeout(...args);
        return response.ok ? response : this.cloneResponse(response);
      }
    }
    const client = new CustomCloneClient({
      apiKey: 'synthetic-api-key',
      adminAPIKey: null,
      maxRetries: 1,
      fetch: async () => {
        calls += 1;
        return calls === 1 ? source : Response.json({ ok: true });
      },
    });
    const result = settle(client.get('/synthetic'));
    try {
      await cancelled.promise;
      if (!rejecting) {
        await vi.advanceTimersByTimeAsync(5);
        expect(calls).toBe(1);
        expect(released).toBe(false);
      }
      cleanup.release();
      await vi.runAllTimersAsync();
      if (rejecting) {
        const outcome = await result;
        expect(outcome.error).toBe(cleanupError);
        expect(calls).toBe(1);
      } else {
        expect(await result).toEqual({ value: { ok: true } });
        expect(calls).toBe(2);
        expect(released).toBe(true);
      }
    } finally {
      cleanup.release();
      await vi.runAllTimersAsync();
      await Promise.all([source.body?.cancel(), retained?.body?.cancel(), result]);
      vi.useRealTimers();
    }
  },
);

test.skipIf(Number(process.versions.node.split('.')[0]) < 24)(
  'awaits cancellation of a foreign helper clone until its retained sibling is released',
  async () => {
    const { Response: ForeignResponse } = await import('undici');
    vi.useFakeTimers();
    const cloned = deferred();
    let retained: Response | undefined;
    let calls = 0;
    class ForeignCloneClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const response = await super.fetchWithTimeout(...args);
        if (response.ok) {
          return response;
        }
        const copy = this.cloneResponse(response);
        retained = response;
        cloned.release();
        return copy;
      }
    }
    const transport = createWorkloadIdentityTransport(() => {
      calls += 1;
      return calls === 1
        ? (new ForeignResponse(new ReadableStream(), { status: 401 }) as Response)
        : Response.json({ ok: true });
    });
    const client = new ForeignCloneClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      fetch: transport.fetch,
      maxRetries: 0,
    });
    const result = settle(client.get('/synthetic'));
    try {
      await cloned.promise;
      await vi.advanceTimersByTimeAsync(5);
      expect(calls).toBe(1);
      expect(transport.exchanges).toBe(1);
    } finally {
      const cancelled = retained?.body?.cancel();
      await vi.runAllTimersAsync();
      await cancelled;
      await result;
      vi.useRealTimers();
    }
    expect(await result).toEqual({ value: { ok: true } });
    expect(calls).toBe(2);
    expect(transport.exchanges).toBe(2);
  },
);
