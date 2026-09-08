import OpenAI from 'openai';
import { describe, expect, test } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['before send', 'after send'] as const)('configured fetch mutation %s', (timing) => {
  test.each(['replacement', 'removal', 'same-byte', 'unrelated'] as const)(
    'attributes a 401 conservatively after %s',
    async (mutation) => {
      const sent: (string | null)[] = [];
      const transport = createWorkloadIdentityTransport((_url, init) => {
        const headers = init?.headers;
        if (!(headers instanceof Headers)) {
          throw new Error('Expected the dispatched native Headers collection');
        }
        const mutate = () => {
          if (mutation === 'replacement') {
            headers.set('Authorization', 'Bearer independent');
          } else if (mutation === 'removal') {
            headers.delete('Authorization');
          } else if (mutation === 'same-byte') {
            headers.set('Authorization', headers.get('Authorization') ?? '');
          } else {
            headers.set('X-Custom', 'preserved');
          }
        };
        if (sent.length === 0 && timing === 'before send') {
          mutate();
        }
        sent.push(headers.get('Authorization'));
        if (sent.length === 1 && timing === 'after send') {
          mutate();
        }
        return sent.length === 1
          ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
          : Response.json({ ok: true });
      });
      const client = new OpenAI({
        ...createTestClientOptions(),
        apiKey: null,
        adminAPIKey: null,
        fetch: transport.fetch,
        maxRetries: 0,
      });
      const request = client.post('/synthetic', { body: { input: 'synthetic' } });
      const changed = mutation === 'replacement' || mutation === 'removal';

      if (changed) {
        await expect(request).rejects.toMatchObject({ status: 401 });
        const changedAuthorization = mutation === 'removal' ? null : 'Bearer independent';
        expect(sent).toEqual([timing === 'after send' ? 'Bearer access-token-1' : changedAuthorization]);
        expect(transport.exchanges).toBe(1);
      } else {
        await expect(request).resolves.toEqual({ ok: true });
        expect(sent).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
        expect(transport.exchanges).toBe(2);
      }
    },
  );
});

test('keeps a selected SDK dispatch independent of a mutated sibling dispatch', async () => {
  let waitForDiscarded = Promise.resolve();
  class DispatchClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      const [url, init, timeout, , context] = args;
      let releaseSelected!: () => void;
      // oxlint-disable-next-line promise/avoid-new -- Order the two delegated transport completions.
      waitForDiscarded = new Promise<void>((resolve) => {
        releaseSelected = resolve;
      });
      const dispatch = (name: string) => {
        const headers = new Headers(init?.headers);
        headers.set('X-Delegation', name);
        return super.fetchWithTimeout(url, { ...init, headers }, timeout, new AbortController(), context);
      };
      const discarded = dispatch('discarded');
      const selected = dispatch('selected');
      try {
        const discardedResponse = await discarded;
        await discardedResponse.body?.cancel();
      } finally {
        releaseSelected();
      }
      return selected;
    }
  }
  const selectedAuthorizations: (string | null)[] = [];
  let discardedSends = 0;
  const transport = createWorkloadIdentityTransport(async (_url, init) => {
    const headers = init?.headers;
    if (!(headers instanceof Headers)) {
      throw new Error('Expected the dispatched native Headers collection');
    }
    if (headers.get('X-Delegation') === 'discarded') {
      headers.set('Authorization', 'Bearer independent');
      discardedSends += 1;
      return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
    }
    selectedAuthorizations.push(headers.get('Authorization'));
    await waitForDiscarded;
    return selectedAuthorizations.length === 1
      ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
      : Response.json({ ok: true });
  });
  const client = new DispatchClient({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await expect(client.post('/synthetic', { body: { input: 'synthetic' } })).resolves.toEqual({ ok: true });

  expect(selectedAuthorizations).toEqual(['Bearer access-token-1', 'Bearer access-token-2']);
  expect(discardedSends).toBe(2);
  expect(transport.exchanges).toBe(2);
});
