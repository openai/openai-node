import OpenAI, { APIError } from 'openai';
import type { AgentSessionErrorEvent } from 'openai/resources/beta/agents/agents';
import { Stream } from 'openai/streaming';

const domainError: AgentSessionErrorEvent = {
  type: 'error',
  event_id: 'event_error',
  session_id: 'session_test',
  error: {
    type: 'server_error',
    code: null,
    param: null,
    message: 'Synthetic session failure.',
  },
};
const sessionIdle = {
  type: 'agent.session.idle',
  event_id: 'event_idle',
  session: { id: 'session_test', status: 'idle' },
};

function requestFor(wire: string, surface: 'subscription' | 'creation') {
  const client = new OpenAI({
    apiKey: 'sk-synthetic-session-error-test',
    maxRetries: 0,
    fetch: async () => new Response(wire, { headers: { 'content-type': 'text/event-stream' } }),
  });
  return surface === 'subscription'
    ? client.beta.agents.sessions.events.stream('session_test')
    : client.beta.agents.sessions.create({ environment: { type: 'none' }, stream: true });
}

function record(data: unknown, event?: string): string {
  return `${event === undefined ? '' : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`;
}

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const received: unknown[] = [];
  for await (const event of stream) {
    received.push(event);
  }
  return received;
}

describe.each(['subscription', 'creation'] as const)('Agents %s error events', (surface) => {
  test.each([false, true])(
    'delivers errors and subsequent session-idle notifications (named: %s)',
    async (named) => {
      const events = [domainError, sessionIdle];
      const wire = events.map((event) => record(event, named ? event.type : undefined)).join('');
      const stream = await requestFor(wire, surface);
      await expect(collect(stream)).resolves.toEqual(events);
      expect(stream.controller.signal.aborted).toBe(false);
    },
  );

  test('aborts when the caller stops after a domain error', async () => {
    const stream = await requestFor(record(domainError, 'error') + record(sessionIdle), surface);
    for await (const event of stream) {
      expect(event).toEqual(domainError);
      if (event.type === 'error') {
        break;
      }
    }
    expect(stream.controller.signal.aborted).toBe(true);
  });

  test('still rejects malformed JSON after a domain error', async () => {
    const stream = await requestFor(`${record(domainError, 'error')}data: {invalid}\n\n`, surface);
    await expect(collect(stream)).rejects.toBeInstanceOf(SyntaxError);
    expect(stream.controller.signal.aborted).toBe(true);
  });

  test('preserves raw SSE responses', async () => {
    const wire = record(domainError, 'error') + record(sessionIdle, sessionIdle.type);
    const response = await requestFor(wire, surface).asResponse();
    expect(await response.text()).toBe(wire);
  });
});

const errorPayloads = [
  { name: 'full domain error', data: domainError },
  { name: 'flat diagnostic', data: domainError.error },
  { name: 'nested diagnostic', data: { error: domainError.error } },
  { name: 'null diagnostic', data: { type: 'error', error: null } },
  { name: 'missing diagnostic', data: { type: 'error' } },
  { name: 'null payload', data: null },
];

describe.each(['subscription', 'creation'] as const)('Agents %s event delivery', (surface) => {
  describe.each([undefined, 'error'])('SSE name %s', (name) => {
    test.each(errorPayloads)('delivers $name and later lifecycle events', async ({ data }) => {
      const stream = await requestFor(record(data, name) + record(sessionIdle), surface);
      await expect(collect(stream)).resolves.toEqual([data, sessionIdle]);
      expect(stream.controller.signal.aborted).toBe(false);
    });
  });

  test('ignores events after the completion sentinel', async () => {
    const stream = await requestFor(`${record(domainError)}data: [DONE]\n\n${record(sessionIdle)}`, surface);
    await expect(collect(stream)).resolves.toEqual([domainError]);
    expect(stream.controller.signal.aborted).toBe(false);
  });
});

describe('generic SSE event delivery', () => {
  test('does not inspect error properties on event payloads or falsey legacy payloads', async () => {
    const previous = Object.getOwnPropertyDescriptor(Number.prototype, 'error');
    // oxlint-disable-next-line no-extend-native -- Restore the descriptor below after proving primitive payloads are never inspected.
    Object.defineProperty(Number.prototype, 'error', {
      configurable: true,
      get() {
        throw new Error('Payload error property was inspected');
      },
    });
    let received: unknown[][];
    try {
      received = await Promise.all(
        (['events', undefined] as const).map(async (mode) => {
          const stream = Stream.fromSSEResponse(
            new Response(record(0)),
            new AbortController(),
            undefined,
            false,
            mode,
          );
          return await collect(stream);
        }),
      );
    } finally {
      if (previous) {
        // oxlint-disable-next-line no-extend-native -- Restore the exact descriptor saved before the regression fixture.
        Object.defineProperty(Number.prototype, 'error', previous);
      } else {
        Reflect.deleteProperty(Number.prototype, 'error');
      }
    }
    expect(received).toEqual([[0], [0]]);
  });

  describe.each([false, true])('synthesizeEventData %s', (synthesizeEventData) => {
    test.each([undefined, 'error', 'thread.error', 'custom.event'])(
      'delivers parsed payloads with SSE name %s',
      async (event) => {
        const response = new Response(record(domainError, event));
        const controller = new AbortController();
        const stream = Stream.fromSSEResponse(response, controller, undefined, synthesizeEventData, 'events');
        await expect(collect(stream)).resolves.toEqual([
          synthesizeEventData ? { event: event ?? null, data: domainError } : domainError,
        ]);
        expect(controller.signal.aborted).toBe(false);
      },
    );
  });

  test.each([undefined, 'legacy'] as const)(
    'keeps %s mode fatal for the same domain envelope',
    async (mode) => {
      const stream = Stream.fromSSEResponse(
        new Response(record(domainError)),
        new AbortController(),
        undefined,
        false,
        mode,
      );
      await expect(collect(stream)).rejects.toBeInstanceOf(APIError);
    },
  );

  test.each(['chat', 'responses', 'assistants'] as const)('keeps %s errors fatal', async (surface) => {
    const client = new OpenAI({
      apiKey: 'sk-synthetic-legacy-error-test',
      maxRetries: 0,
      fetch: async () =>
        new Response(record(domainError, 'error'), { headers: { 'content-type': 'text/event-stream' } }),
    });
    let request;
    if (surface === 'chat') {
      request = client.chat.completions.create({ model: 'gpt-synthetic', messages: [], stream: true });
    } else if (surface === 'responses') {
      request = client.responses.create({ model: 'gpt-synthetic', input: 'hello', stream: true });
    } else {
      request = client.beta.threads.runs.create('thread_test', {
        assistant_id: 'assistant_test',
        stream: true,
      });
    }
    const stream = await request;
    await expect(collect(stream)).rejects.toBeInstanceOf(APIError);
  });
});
