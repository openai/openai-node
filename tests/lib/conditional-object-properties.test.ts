import { WorkloadIdentityAuth } from 'openai/auth/workload-identity-auth';
import { makeChatCompletionReadableStreamMessageChunk } from 'openai/lib/ChatCompletionStream';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import { vi } from 'vitest';

const chunk: ChatCompletionChunk = {
  id: 'completion_123',
  object: 'chat.completion.chunk',
  created: 1,
  model: 'gpt-4o',
  choices: [],
};

describe.each(['setter', 'readonly'] as const)('inherited %s properties', (mode) => {
  test('tool-message serialization preserves its own tool-call identifiers', () => {
    const key = 'tool_call_ids';
    const original = Object.getOwnPropertyDescriptor(Object.prototype, key);
    const setter = vi.fn();
    // oxlint-disable-next-line no-extend-native -- Deliberately exercise inherited property interference; finally restores the prior prototype descriptor.
    Object.defineProperty(
      Object.prototype,
      key,
      mode === 'setter'
        ? { configurable: true, set: setter }
        : { configurable: true, value: ['inherited_call'], writable: false },
    );

    try {
      const message = { role: 'tool' as const, tool_call_id: 'call_123', content: 'result' };
      const encoded = makeChatCompletionReadableStreamMessageChunk(chunk, message, ['call_123']);
      expect(encoded.object).toBe(
        `chat.completion.chunk.message:${JSON.stringify({ type: 'message', message, tool_call_ids: ['call_123'] })}`,
      );
      expect(Object.getPrototypeOf(encoded)).toBe(Object.prototype);
      expect(setter).not.toHaveBeenCalled();

      const withoutIDs = makeChatCompletionReadableStreamMessageChunk(chunk, message);
      expect(withoutIDs.object).toBe(
        `chat.completion.chunk.message:${JSON.stringify({ type: 'message', message })}`,
      );
    } finally {
      if (original) {
        // oxlint-disable-next-line no-extend-native -- Restore the exact prototype descriptor saved before this regression case.
        Object.defineProperty(Object.prototype, key, original);
      } else {
        Reflect.deleteProperty(Object.prototype, key);
      }
    }
  });

  test.each(['clientId', 'refreshBufferSeconds'] as const)(
    'workload authentication snapshots its own %s option',
    async (key) => {
      const original = Object.getOwnPropertyDescriptor(Object.prototype, key);
      const setter = vi.fn();
      const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({ access_token: 'safe-test-token', expires_in: 3600 }),
      );
      // oxlint-disable-next-line no-extend-native -- Deliberately exercise inherited property interference; finally restores the prior prototype descriptor.
      Object.defineProperty(
        Object.prototype,
        key,
        mode === 'setter'
          ? { configurable: true, set: setter }
          : { configurable: true, value: undefined, writable: false },
      );

      try {
        const auth = new WorkloadIdentityAuth(
          {
            identityProviderId: 'test-identity-provider',
            serviceAccountId: 'test-service-account',
            clientId: 'test-client',
            refreshBufferSeconds: 30,
            provider: { tokenType: 'jwt', getToken: async () => 'safe-subject-token' },
          },
          fetch,
        );
        expect(await auth.getToken()).toBe('safe-test-token');
        expect(fetch.mock.calls[0]?.[1]?.body).toContain('"client_id":"test-client"');
        expect(setter).not.toHaveBeenCalled();
      } finally {
        if (original) {
          // oxlint-disable-next-line no-extend-native -- Restore the exact prototype descriptor saved before this regression case.
          Object.defineProperty(Object.prototype, key, original);
        } else {
          Reflect.deleteProperty(Object.prototype, key);
        }
      }
    },
  );
});
