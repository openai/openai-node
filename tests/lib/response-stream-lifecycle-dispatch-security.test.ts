import { vi } from 'vitest';
import OpenAI, { OpenAIError } from 'openai';
import type { Response, ResponseStreamEvent } from 'openai/resources/responses/responses';

type LifecycleType = 'response.created' | 'response.completed';
type StreamMode = 'create' | 'replay';

function makeResponse(overrides: Partial<Response> = {}): Response {
  return {
    id: 'resp_lifecycle',
    object: 'response',
    created_at: 1,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: 'gpt-test',
    output: [],
    output_text: '',
    parallel_tool_calls: false,
    status: 'in_progress',
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    ...overrides,
  } as Response;
}

function startStream(events: ResponseStreamEvent[], mode: StreamMode = 'create') {
  const client = new OpenAI({ apiKey: 'synthetic-lifecycle-api-key' });
  const transport = {
    controller: new AbortController(),
    async *[Symbol.asyncIterator]() {
      yield* events;
    },
  };

  Object.defineProperties(client.responses, {
    create: { value: vi.fn(async () => transport) },
    retrieve: { value: vi.fn(async () => transport) },
  });

  return mode === 'replay'
    ? client.responses.stream({ response_id: 'resp_lifecycle', starting_after: -1 })
    : client.responses.stream({ model: 'gpt-test', input: 'synthetic lifecycle dispatch' });
}

function lifecycleEvent(
  type: LifecycleType,
  sequenceNumber: number,
  response = makeResponse({ status: type === 'response.completed' ? 'completed' : 'in_progress' }),
): Extract<ResponseStreamEvent, { type: LifecycleType }> {
  return { type, sequence_number: sequenceNumber, response };
}

describe('public Responses lifecycle dispatch boundary', () => {
  it.each(['response.created', 'response.completed'] as const)(
    'pins the validated %s discriminator when an extensible transport proxy omits its own key',
    async (type) => {
      const sequenceNumber = type === 'response.created' ? 0 : 7;
      const target = lifecycleEvent(type, sequenceNumber);
      const lifecycle = new Proxy(target, {
        ownKeys(current) {
          return Reflect.ownKeys(current).filter((key) => key !== 'type');
        },
      });
      const stream = startStream(
        type === 'response.created' ? [lifecycle] : [lifecycleEvent('response.created', 0), lifecycle],
      );
      const generic = vi.fn();
      const typed = vi.fn();
      stream.on('event', (event) => {
        if (event.sequence_number === sequenceNumber) {
          generic(event);
        }
      });
      stream.on(type, typed);
      const iteration = (async () => {
        const observed: ResponseStreamEvent[] = [];
        for await (const event of stream) {
          observed.push(event);
        }
        return observed;
      })();

      const [final, iterated] = await Promise.all([stream.finalResponse(), iteration]);

      expect(final.id).toBe('resp_lifecycle');
      expect(generic).toHaveBeenCalledTimes(1);
      expect(typed).toHaveBeenCalledTimes(1);
      const emitted = typed.mock.calls[0]?.[0] as ResponseStreamEvent;
      expect(generic).toHaveBeenCalledWith(emitted);
      expect(iterated.find((event) => event.sequence_number === sequenceNumber)).toBe(emitted);
      expect(Object.getOwnPropertyDescriptor(emitted, 'type')).toMatchObject({ value: type });
      expect(emitted.type).toBe(type);
    },
  );

  it.each(['own', 'inherited'] as const)(
    'captures the original lifecycle cursor before %s metadata mutates it',
    async (location) => {
      let mutateSequence: () => void;
      const readMetadata = vi.fn(() => {
        mutateSequence();
        return 'validated provider metadata';
      });
      let lifecycle: ResponseStreamEvent;

      if (location === 'own') {
        const event = {
          type: 'response.completed' as const,
          get provider_metadata() {
            return readMetadata();
          },
          sequence_number: 7,
          response: makeResponse({ status: 'completed' }),
        };
        mutateSequence = () => {
          event.sequence_number = 41;
        };
        lifecycle = event;
      } else {
        const sequenceOwner = { sequence_number: 7 };
        const metadataOwner = Object.create(sequenceOwner) as object;
        Object.defineProperty(metadataOwner, 'provider_metadata', {
          configurable: true,
          enumerable: true,
          get: readMetadata,
        });
        mutateSequence = () => {
          sequenceOwner.sequence_number = 41;
        };
        lifecycle = Object.assign(Object.create(metadataOwner) as object, {
          type: 'response.completed' as const,
          response: makeResponse({ status: 'completed' }),
        }) as ResponseStreamEvent;
      }

      const stream = startStream([lifecycleEvent('response.created', 0), lifecycle]);
      const generic: ResponseStreamEvent[] = [];
      const typed: ResponseStreamEvent[] = [];
      stream.on('event', (event) => generic.push(event));
      stream.on('response.completed', (event) => typed.push(event));
      const iteration = (async () => {
        const observed: ResponseStreamEvent[] = [];
        for await (const event of stream) {
          observed.push(event);
        }
        return observed;
      })();

      const [final, iterated] = await Promise.all([stream.finalResponse(), iteration]);

      expect(final.status).toBe('completed');
      expect(readMetadata).toHaveBeenCalledTimes(1);
      expect(lifecycle.sequence_number).toBe(41);
      expect(generic.map((event) => event.sequence_number)).toEqual([0, 7]);
      expect(typed.map((event) => event.sequence_number)).toEqual([7]);
      expect(iterated.map((event) => event.sequence_number)).toEqual([0, 7]);
      expect(generic[1]).toBe(typed[0]);
      expect(iterated[1]).toBe(typed[0]);
      expect(Reflect.get(typed[0] ?? {}, 'provider_metadata')).toBe('validated provider metadata');
    },
  );

  it.each(['create', 'replay'] as const)(
    'clones large %s responses only for accumulation when lifecycle metadata has no consumers',
    async (mode) => {
      const largeText = 'synthetic lifecycle response payload '.repeat(65_536);
      const output = {
        id: 'msg_lifecycle',
        type: 'message' as const,
        role: 'assistant' as const,
        status: 'completed' as const,
        content: [{ type: 'output_text' as const, annotations: [], text: largeText }],
      };
      const created = makeResponse({ output: [output], output_text: largeText });
      const completed = makeResponse({ output: [output], output_text: largeText, status: 'completed' });
      const inspectMetadata = vi.fn((target: object) => Reflect.ownKeys(target));
      const readMetadata = vi.fn(() => {
        throw new Error('synthetic-private-unobserved-provider-metadata');
      });
      const unobserved = (type: LifecycleType, sequenceNumber: number, response: Response) =>
        new Proxy(
          {
            ...lifecycleEvent(type, sequenceNumber, response),
            get provider_metadata(): string {
              return readMetadata();
            },
          },
          {
            ownKeys(target) {
              return inspectMetadata(target);
            },
          },
        );
      const clone = vi.spyOn(globalThis, 'structuredClone');

      try {
        const stream = startStream(
          [unobserved('response.created', 0, created), unobserved('response.completed', 1, completed)],
          mode,
        );
        stream.on('response.output_text.delta', vi.fn());
        stream.on('error', vi.fn());

        const final = await stream.finalResponse();

        expect(final.id).toBe('resp_lifecycle');
        expect(final.status).toBe('completed');
        expect(final.output_text).toHaveLength(largeText.length);
        expect(inspectMetadata).not.toHaveBeenCalled();
        expect(readMetadata).not.toHaveBeenCalled();
        expect(clone).toHaveBeenCalledTimes(2);
        expect(clone.mock.calls[0]?.[0]).toBe(created);
        expect(clone.mock.calls[1]?.[0]).toBe(completed);
      } finally {
        clone.mockRestore();
      }
    },
  );

  it.each([
    'generic listener',
    'typed listener',
    'async iterator',
    'generic event iterator',
    'typed event iterator',
    'emitted promise',
    'once listener',
  ] as const)('materializes a lifecycle event exactly once for an active %s', async (consumer) => {
    const response = makeResponse();
    const readMetadata = vi.fn(() => 'observable provider metadata');
    const event = {
      ...lifecycleEvent('response.created', 7, response),
      get provider_metadata() {
        return readMetadata();
      },
    };
    const clone = vi.spyOn(globalThis, 'structuredClone');

    try {
      const stream = startStream([event]);
      let observed: Promise<ResponseStreamEvent> | undefined;
      const listener = vi.fn<(event: ResponseStreamEvent) => void>();

      switch (consumer) {
        case 'generic listener': {
          stream.on('event', listener);
          break;
        }
        case 'typed listener': {
          stream.on('response.created', listener);
          break;
        }
        case 'async iterator': {
          observed = stream[Symbol.asyncIterator]()
            .next()
            .then(({ value }) => value);
          break;
        }
        case 'generic event iterator': {
          observed = stream
            .events('event')
            .next()
            .then(({ value }) => value[0]);
          break;
        }
        case 'typed event iterator': {
          observed = stream
            .events('response.created')
            .next()
            .then(({ value }) => value[0]);
          break;
        }
        case 'emitted promise': {
          observed = stream.emitted('response.created');
          break;
        }
        case 'once listener': {
          stream.once('response.created', listener);
          break;
        }
        default: {
          throw new Error(`Unsupported lifecycle consumer: ${consumer}`);
        }
      }

      const final = await stream.finalResponse();
      const emitted = observed ? await observed : listener.mock.calls[0]?.[0];
      if (!emitted) {
        throw new Error('Expected an observed lifecycle event.');
      }

      expect(final.id).toBe('resp_lifecycle');
      expect(emitted.type).toBe('response.created');
      expect(emitted.sequence_number).toBe(7);
      expect(Reflect.get(emitted, 'provider_metadata')).toBe('observable provider metadata');
      expect('response' in emitted && emitted.response).not.toBe(response);
      expect(readMetadata).toHaveBeenCalledTimes(1);
      expect(clone).toHaveBeenCalledTimes(2);
    } finally {
      clone.mockRestore();
    }
  });

  it.each(['generic', 'typed'] as const)(
    'does not materialize metadata after its only %s lifecycle listener is removed',
    async (channel) => {
      const readMetadata = vi.fn(() => {
        throw new Error('synthetic-private-removed-listener-metadata');
      });
      const event = {
        ...lifecycleEvent('response.created', 0),
        get provider_metadata(): string {
          return readMetadata();
        },
      };
      const stream = startStream([event]);
      const listener = vi.fn();

      if (channel === 'generic') {
        stream.on('event', listener);
        stream.off('event', listener);
      } else {
        stream.on('response.created', listener);
        stream.off('response.created', listener);
      }

      await expect(stream.finalResponse()).resolves.toMatchObject({ id: 'resp_lifecycle' });

      expect(listener).not.toHaveBeenCalled();
      expect(readMetadata).not.toHaveBeenCalled();
    },
  );

  it('stops materializing later lifecycle events after a one-time generic consumer is removed', async () => {
    const readMetadata = vi.fn(() => {
      throw new Error('synthetic-private-expired-consumer-metadata');
    });
    const completed = {
      ...lifecycleEvent('response.completed', 1),
      get provider_metadata(): string {
        return readMetadata();
      },
    };
    const clone = vi.spyOn(globalThis, 'structuredClone');

    try {
      const stream = startStream([lifecycleEvent('response.created', 0), completed]);
      const observed = vi.fn();
      stream.once('event', observed);

      await expect(stream.finalResponse()).resolves.toMatchObject({ status: 'completed' });

      expect(observed).toHaveBeenCalledTimes(1);
      expect(readMetadata).not.toHaveBeenCalled();
      expect(clone).toHaveBeenCalledTimes(3);
    } finally {
      clone.mockRestore();
    }
  });

  it('materializes lifecycle events for typed consumers registered during connection or generic dispatch', async () => {
    const readMetadata = vi.fn(() => 'dynamically observed metadata');
    const event = {
      ...lifecycleEvent('response.created', 0),
      get provider_metadata() {
        return readMetadata();
      },
    };
    const stream = startStream([event]);
    const connected = vi.fn();
    const duringGeneric = vi.fn();
    stream.on('connect', () => stream.on('response.created', connected));
    stream.on('event', () => stream.on('response.created', duringGeneric));

    await expect(stream.finalResponse()).resolves.toMatchObject({ id: 'resp_lifecycle' });

    expect(readMetadata).toHaveBeenCalledTimes(1);
    expect(connected).toHaveBeenCalledTimes(1);
    expect(duringGeneric).toHaveBeenCalledTimes(1);
    expect(connected.mock.calls[0]?.[0]).toBe(duringGeneric.mock.calls[0]?.[0]);
  });

  it.each(['generic', 'typed', 'iterator'] as const)(
    'redacts throwing lifecycle metadata when an active %s consumer requires materialization',
    async (consumer) => {
      const privateMessage = 'synthetic-private-observed-provider-metadata';
      const readMetadata = vi.fn(() => {
        throw new Error(privateMessage);
      });
      const event = {
        ...lifecycleEvent('response.created', 0),
        get provider_metadata(): string {
          return readMetadata();
        },
      };
      const stream = startStream([event]);
      const errors: OpenAIError[] = [];
      stream.on('error', (error) => errors.push(error));
      let iteration: Promise<unknown> = Promise.resolve();

      if (consumer === 'generic') {
        stream.on('event', vi.fn());
      } else if (consumer === 'typed') {
        stream.on('response.created', vi.fn());
      } else {
        iteration = (async () => {
          try {
            return await stream[Symbol.asyncIterator]().next();
          } catch (error: unknown) {
            return error;
          }
        })();
      }

      await expect(stream.finalResponse()).rejects.toThrow(
        'Response event does not match the active response.',
      );
      await iteration;

      expect(readMetadata).toHaveBeenCalledTimes(1);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(OpenAIError);
      expect(errors[0]?.message).not.toContain(privateMessage);
      expect(errors[0]).not.toHaveProperty('cause');
    },
  );
});
