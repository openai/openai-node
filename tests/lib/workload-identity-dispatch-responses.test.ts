/* oxlint-disable max-classes-per-file -- Independent fixtures exercise protected dispatch hooks. */
import OpenAI from 'openai';
import type { RequestInit } from 'openai/internal/builtin-types';
import { test } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

test.each(
  (['fetchWithAuth', 'fetchWithTimeout'] as const).flatMap((hook) =>
    [false, true].flatMap((selectedWorkload) =>
      [false, true].map((reverseCompletion) => ({ hook, selectedWorkload, reverseCompletion })),
    ),
  ),
)(
  'attributes workload refresh to the response selected by %j',
  async ({ hook, selectedWorkload, reverseCompletion }) => {
    let releaseSelected: (() => void) | undefined;
    const selectFirstResponse = async (
      init: RequestInit,
      send: (request: RequestInit) => Promise<Response>,
    ) => {
      const independent = { ...init, headers: { Authorization: 'Bearer independent' } };
      const selected = send(selectedWorkload ? init : independent);
      if (!reverseCompletion) {
        await selected;
      }
      const ignored = await send(selectedWorkload ? independent : init);
      releaseSelected?.();
      await ignored.body?.cancel();
      return selected;
    };
    class HookClient extends OpenAI {
      protected override async fetchWithAuth(...args: Parameters<OpenAI['fetchWithAuth']>) {
        if (hook !== 'fetchWithAuth') {
          return super.fetchWithAuth(...args);
        }
        return selectFirstResponse(args[1], (request) =>
          super.fetchWithAuth(args[0], request, args[2], args[3], args[4], args[5]),
        );
      }

      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        if (hook !== 'fetchWithTimeout' || !args[1]) {
          return super.fetchWithTimeout(...args);
        }
        return selectFirstResponse(args[1], (request) =>
          super.fetchWithTimeout(args[0], request, args[2], args[3], args[4]),
        );
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const authorization = new Headers(init?.headers).get('Authorization');
      sent.push(authorization);
      const response =
        authorization === 'Bearer access-token-2'
          ? Response.json({ data: [] })
          : Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
      if (reverseCompletion && sent.length % 2 === 1) {
        // oxlint-disable-next-line promise/avoid-new -- The fixture completes the first send after the second.
        return new Promise<Response>((resolve) => {
          releaseSelected = () => resolve(response);
        });
      }
      return response;
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      maxRetries: 0,
      fetch: transport.fetch,
    });

    const request = client.models.list();
    await (selectedWorkload ? request : expect(request).rejects.toMatchObject({ status: 401 }));

    expect(sent).toEqual(
      selectedWorkload
        ? ['Bearer access-token-1', 'Bearer independent', 'Bearer access-token-2', 'Bearer independent']
        : ['Bearer independent', 'Bearer access-token-1'],
    );
    expect(transport.exchanges).toBe(selectedWorkload ? 2 : 1);
  },
);

test.each([false, true])(
  'does not refresh a response shared by independent sends: %s',
  async (workloadFirst) => {
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const independent = { ...args[1], headers: { Authorization: 'Bearer independent' } };
        const first = await super.fetchWithTimeout(
          args[0],
          workloadFirst ? args[1] : independent,
          args[2],
          args[3],
          args[4],
        );
        await super.fetchWithTimeout(
          args[0],
          workloadFirst ? independent : args[1],
          args[2],
          args[3],
          args[4],
        );
        return first;
      }
    }
    const response = Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    let sends = 0;
    const transport = createWorkloadIdentityTransport(() => {
      sends += 1;
      return response;
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      maxRetries: 0,
      fetch: transport.fetch,
    });

    await expect(client.models.list()).rejects.toMatchObject({ status: 401 });

    expect(sends).toBe(2);
    expect(transport.exchanges).toBe(1);
  },
);

test.each(
  (['clone', 'reconstruct'] as const).flatMap((copy) =>
    [false, true].map((multiple) => ({ copy, multiple })),
  ),
)(
  'preserves response-copy refresh when every dispatch uses workload authentication: %j',
  async ({ copy, multiple }) => {
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const response = await super.fetchWithTimeout(...args);
        if (multiple) {
          const ignored = await super.fetchWithTimeout(...args);
          await ignored.body?.cancel();
        }
        if (copy === 'clone') {
          const cloned = response.clone();
          // Both tee branches must close before the SDK can await cancellation of a rejected response.
          void response.body?.cancel();
          return cloned;
        }
        return new Response(response.body, { status: response.status, headers: response.headers });
      }
    }
    const sent: (string | null)[] = [];
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const authorization = new Headers(init?.headers).get('Authorization');
      sent.push(authorization);
      return authorization === 'Bearer access-token-2'
        ? Response.json({ data: [] })
        : Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      maxRetries: 0,
      fetch: transport.fetch,
    });

    await client.models.list();

    expect(sent).toEqual(
      multiple
        ? ['Bearer access-token-1', 'Bearer access-token-1', 'Bearer access-token-2', 'Bearer access-token-2']
        : ['Bearer access-token-1', 'Bearer access-token-2'],
    );
    expect(transport.exchanges).toBe(2);
  },
);

test.each([false, true])(
  'refreshes a clone of the selected workload response after mixed sends (independent pending: %s)',
  async (pending) => {
    const discarded: Promise<Response>[] = [];
    const releases: (() => void)[] = [];
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const selected = await super.fetchWithTimeout(...args);
        const independent = super.fetchWithTimeout(
          args[0],
          { ...args[1], headers: { Authorization: 'Bearer independent' } },
          args[2],
          new AbortController(),
          args[4],
        );
        discarded.push(independent);
        if (!pending) {
          // oxlint-disable-next-line unicorn/prefer-at -- Tests use the SDK's ES2020 TypeScript library.
          releases[releases.length - 1]?.();
          await independent;
        }
        const clone = selected.clone();
        void selected.body?.cancel();
        return clone;
      }
    }
    let sends = 0;
    const transport = createWorkloadIdentityTransport((_url, init) => {
      sends += 1;
      const response = Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
      if (new Headers(init?.headers).get('Authorization') === 'Bearer independent') {
        // oxlint-disable-next-line promise/avoid-new -- The fixture keeps an independent dispatch pending through response selection.
        return new Promise<Response>((resolve) => {
          releases.push(() => resolve(response));
        });
      }
      return response;
    });
    const client = new HookClient({
      ...createTestClientOptions(),
      apiKey: null,
      adminAPIKey: null,
      maxRetries: 0,
      fetch: transport.fetch,
    });

    try {
      await expect(client.models.list()).rejects.toMatchObject({ status: 401 });
      expect(sends).toBe(4);
      expect(transport.exchanges).toBe(2);
    } finally {
      for (const release of releases) {
        release();
      }
      const responses = await Promise.all(discarded);
      await Promise.all(responses.map((response) => response.body?.cancel()));
    }
  },
);
