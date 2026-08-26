import { vi } from 'vitest';
import OpenAI, { APIError, APIUserAbortError, OpenAIError } from 'openai';
import { ReadableStreamFrom } from 'openai/internal/shims';
import { ResponseStream } from 'openai/lib/responses/ResponseStream';
import type { Response, ResponseStreamEvent } from 'openai/resources/responses/responses';
import { makeStreamSnapshotRequest } from '../utils/mock-snapshots';

class ProviderLifecycleEvent {
  readonly type: 'response.created' | 'response.in_progress' | 'response.completed';
  #sequenceNumber: number;
  #response: Response;
  #metadata: string;
  #readMetadata: (value: string) => string;
  #failingProperty: 'sequence_number' | 'provider_metadata' | undefined;

  constructor(
    type: 'response.created' | 'response.in_progress' | 'response.completed',
    sequenceNumber: number,
    readMetadata: (value: string) => string = (value) => value,
    failingProperty?: 'sequence_number' | 'provider_metadata',
  ) {
    this.type = type;
    this.#sequenceNumber = sequenceNumber;
    this.#response = makeResponse({ status: type === 'response.completed' ? 'completed' : 'in_progress' });
    this.#metadata = `provider-${sequenceNumber}`;
    this.#readMetadata = readMetadata;
    this.#failingProperty = failingProperty;
  }

  get sequence_number(): number {
    if (this.#failingProperty === 'sequence_number') {
      throw new Error('synthetic-private-inherited-sequence_number-secret');
    }
    return this.#sequenceNumber;
  }

  get response(): Response {
    return this.#response;
  }

  get provider_metadata(): string {
    if (this.#failingProperty === 'provider_metadata') {
      throw new Error('synthetic-private-inherited-provider_metadata-secret');
    }
    return this.#readMetadata(this.#metadata);
  }
}

describe('.stream()', () => {
  it('replays prior events when resuming by ID so snapshots stay complete', async () => {
    const requests: string[] = [];
    const response = {
      id: 'resp_123',
      object: 'response',
      created_at: 0,
      model: 'gpt-4o',
      output: [],
      error: null,
      incomplete_details: null,
      instructions: null,
      metadata: null,
      parallel_tool_calls: false,
      temperature: null,
      tools: [],
      top_p: null,
      status: 'completed',
      usage: null,
    };
    const events = [
      {
        type: 'response.created',
        sequence_number: 0,
        response: { ...response, status: 'in_progress' },
      },
      {
        type: 'response.output_item.added',
        sequence_number: 1,
        output_index: 0,
        item: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      },
      { type: 'response.completed', sequence_number: 2, response },
    ];
    const openai = new OpenAI({
      apiKey: 'My API Key',
      fetch: async (url) => {
        const requestURL = String(url);
        requests.push(requestURL);
        // Match the API's cursor behavior: forwarding `starting_after` omits the prefix needed
        // by the accumulator, while omitting it replays the complete event sequence.
        const streamEvents = requestURL.includes('starting_after=') ? events.slice(1) : events;
        const body = `${streamEvents
          .map((event) => `data: ${JSON.stringify(event)}`)
          .join('\n\n')}\n\ndata: [DONE]\n\n`;
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });

    const emittedEvents: number[] = [];
    const stream = openai.responses
      .stream({ response_id: 'resp_123', starting_after: 0 })
      .on('event', (event) => emittedEvents.push(event.sequence_number));
    const final = await stream.finalResponse();

    expect(requests).toEqual(['https://api.openai.com/v1/responses/resp_123?stream=true']);
    expect(emittedEvents).toEqual([1, 2]);
    expect(final.id).toBe('resp_123');
  });

  it.each(['create', 'replay', 'readable'] as const)(
    'preserves omitted lifecycle response fields for %s listeners and iterators',
    async (mode) => {
      const created = makeResponse({ output: [makeTextMessage('created wire text')] });
      const completed = makeResponse({
        status: 'completed',
        output: [makeTextMessage('completed wire text')],
      });
      Reflect.deleteProperty(created, 'output_text');
      Reflect.deleteProperty(completed, 'output_text');
      const events: ResponseStreamEvent[] = [
        { type: 'response.created', sequence_number: 0, response: created },
        { type: 'response.completed', sequence_number: 1, response: completed },
      ];
      const transport = {
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
      };
      const client = {
        responses: { create: vi.fn(async () => transport), retrieve: vi.fn(async () => transport) },
      } as unknown as OpenAI;
      let stream: ResponseStream<null>;
      if (mode === 'readable') {
        stream = ResponseStream.fromReadableStream(readableStreamFromEvents(events));
      } else if (mode === 'replay') {
        stream = ResponseStream.createResponse(client, { response_id: 'resp_123', starting_after: 0 });
      } else {
        stream = ResponseStream.createResponse(client, { model: 'gpt-test', input: 'preserve wire shape' });
      }
      const generic: ResponseStreamEvent[] = [];
      const typed: ResponseStreamEvent[] = [];
      stream.on('event', (event) => {
        if (event.type !== 'response.created' && event.type !== 'response.completed') {
          return;
        }
        expect(Object.getOwnPropertyDescriptor(event.response, 'output_text')).toBeUndefined();
        expect(JSON.stringify(event.response)).not.toContain('"output_text":');
        generic.push(event);
        if (event.type === 'response.completed') {
          const item = event.response.output[0];
          if (item?.type === 'message' && item.content[0]?.type === 'output_text') {
            item.content[0].text = 'listener-only mutation';
          }
        }
      });
      stream.on('response.created', (event) => typed.push(event));
      stream.on('response.completed', (event) => typed.push(event));
      const iteration = (async () => {
        const iterated: ResponseStreamEvent[] = [];
        for await (const event of stream) {
          iterated.push(event);
        }
        return iterated;
      })();

      const [final, iterated] = await Promise.all([stream.finalResponse(), iteration]);

      expect(generic.map((event) => event.type)).toEqual(
        mode === 'replay' ? ['response.completed'] : ['response.created', 'response.completed'],
      );
      expect(typed).toEqual(generic);
      expect(iterated).toEqual(generic);
      expect(final.output_text).toBe('completed wire text');
      expect(final.output[0]).toMatchObject({ content: [{ text: 'completed wire text' }] });
      expect(completed.output[0]).toMatchObject({ content: [{ text: 'completed wire text' }] });
      expect(Object.getOwnPropertyDescriptor(completed, 'output_text')).toBeUndefined();
    },
  );

  it.each(
    (['create', 'replay'] as const).flatMap((mode) =>
      ([null, undefined] as const).map((wireValue) => ({ mode, wireValue })),
    ),
  )(
    'preserves a getter-returned $wireValue lifecycle wire field during $mode',
    async ({ mode, wireValue }) => {
      const response = makeResponse({
        output: [makeTextMessage('canonical text')],
      });
      const readOutputText = vi.fn(() => wireValue);
      Object.defineProperty(response, 'output_text', {
        configurable: true,
        enumerable: true,
        get: readOutputText,
      });
      const transport = {
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() {
          yield { type: 'response.created' as const, sequence_number: 0, response };
        },
      };
      const client = {
        responses: { create: vi.fn(async () => transport), retrieve: vi.fn(async () => transport) },
      } as unknown as OpenAI;
      const stream =
        mode === 'replay'
          ? ResponseStream.createResponse(client, { response_id: 'resp_123', starting_after: -1 })
          : ResponseStream.createResponse(client, {
              model: 'gpt-test',
              input: 'preserve nullable wire field',
            });
      const generic = vi.fn();
      const typed = vi.fn();
      stream.on('event', generic);
      stream.on('response.created', typed);

      await expect(stream.finalResponse()).resolves.toMatchObject({ output_text: 'canonical text' });

      expect(readOutputText).toHaveBeenCalledTimes(1);
      expect(generic).toHaveBeenCalledTimes(1);
      expect(typed).toHaveBeenCalledWith(generic.mock.calls[0]?.[0]);
      const emitted = generic.mock.calls[0]?.[0];
      expect(Object.getOwnPropertyDescriptor(emitted.response, 'output_text')).toBeDefined();
      expect(emitted.response.output_text).toBe(wireValue);
      expect(emitted.response).not.toBe(response);
    },
  );

  it('stabilizes a replay lifecycle cursor without exposing later mutations to its wire response', async () => {
    const response = makeResponse({ output: [makeTextMessage('validated wire text')] });
    Reflect.deleteProperty(response, 'output_text');
    const readSequence = vi.fn(() => {
      response.id = 'resp_foreign';
      const item = response.output[0];
      if (item?.type === 'message' && item.content[0]?.type === 'output_text') {
        item.content[0].text = 'synthetic-private-foreign-payload';
      }
      return readSequence.mock.calls.length === 1 ? 1 : 0;
    });
    const lifecycle = {
      type: 'response.created' as const,
      get sequence_number() {
        return readSequence();
      },
      response,
    };
    const transport = {
      controller: new AbortController(),
      async *[Symbol.asyncIterator]() {
        yield lifecycle;
      },
    };
    const client = { responses: { retrieve: vi.fn(async () => transport) } } as unknown as OpenAI;
    const stream = ResponseStream.createResponse(client, { response_id: 'resp_123', starting_after: 0 });
    const generic = vi.fn();
    const typed = vi.fn();
    stream.on('event', generic);
    stream.on('response.created', typed);

    await expect(stream.finalResponse()).resolves.toMatchObject({
      id: 'resp_123',
      output_text: 'validated wire text',
    });

    expect(readSequence).toHaveBeenCalledTimes(1);
    expect(generic).toHaveBeenCalledTimes(1);
    expect(typed).toHaveBeenCalledWith(generic.mock.calls[0]?.[0]);
    const emitted = generic.mock.calls[0]?.[0];
    expect(emitted.sequence_number).toBe(1);
    expect(emitted.response.id).toBe('resp_123');
    expect(emitted.response.output[0]).toMatchObject({ content: [{ text: 'validated wire text' }] });
    expect(Object.getOwnPropertyDescriptor(emitted.response, 'output_text')).toBeUndefined();
    expect(response.id).toBe('resp_foreign');
  });

  it.each(['text delta', 'output item'] as const)(
    'accumulates a replayed %s before its cursor getter can mutate the payload',
    async (kind) => {
      const message = makeTextMessage('safe');
      const initial = makeResponse({
        output: kind === 'text delta' ? [message] : [],
        output_text: kind === 'text delta' ? 'safe' : '',
      });
      const event: ResponseStreamEvent =
        kind === 'text delta'
          ? {
              type: 'response.output_text.delta',
              sequence_number: 1,
              item_id: 'msg_123',
              output_index: 0,
              content_index: 0,
              delta: ' original',
              logprobs: [],
            }
          : {
              type: 'response.output_item.added',
              sequence_number: 1,
              output_index: 0,
              item: message,
            };
      const readSequence = vi.fn(() => {
        if (event.type === 'response.output_text.delta') {
          event.delta = ' corrupted';
        } else if (event.type === 'response.output_item.added' && event.item.type === 'message') {
          event.item.id = 'msg_corrupted';
          const part = event.item.content[0];
          if (part?.type === 'output_text') {
            part.text = 'corrupted';
          }
        }
        return 1;
      });
      Object.defineProperty(event, 'sequence_number', {
        configurable: true,
        enumerable: true,
        get: readSequence,
      });
      const transport = {
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() {
          yield { type: 'response.created' as const, sequence_number: 0, response: initial };
          yield event;
        },
      };
      const client = { responses: { retrieve: vi.fn(async () => transport) } } as unknown as OpenAI;
      const stream = ResponseStream.createResponse(client, { response_id: 'resp_123', starting_after: 0 });
      const generic = vi.fn();
      const typed = vi.fn();
      stream.on('event', generic);
      if (kind === 'text delta') {
        stream.on('response.output_text.delta', typed);
      } else {
        stream.on('response.output_item.added', typed);
      }
      const iteration = (async () => {
        const iterated: ResponseStreamEvent[] = [];
        for await (const emitted of stream) {
          iterated.push(emitted);
        }
        return iterated;
      })();

      const [final, iterated] = await Promise.all([stream.finalResponse(), iteration]);

      expect(readSequence).toHaveBeenCalledTimes(1);
      expect(generic).toHaveBeenCalledTimes(1);
      expect(typed).toHaveBeenCalledTimes(1);
      expect(iterated).toEqual([event]);
      expect(final.output[0]).toMatchObject({
        id: 'msg_123',
        content: [{ text: kind === 'text delta' ? 'safe original' : 'safe' }],
      });
      expect(final.output_text).toBe(kind === 'text delta' ? 'safe original' : 'safe');
      if (kind === 'text delta') {
        expect(typed).toHaveBeenCalledWith(expect.objectContaining({ snapshot: 'safe original' }));
      }
    },
  );

  it.each(['keepalive', 'response.audio.delta'] as const)(
    'redacts a failing replay cursor getter on a supported %s event',
    async (type) => {
      const privateMessage = `synthetic-private-${type}-cursor-secret`;
      const readSequence = vi.fn(() => {
        throw new Error(privateMessage);
      });
      const event = {
        type,
        get sequence_number(): number {
          return readSequence();
        },
        ...(type === 'response.audio.delta' ? { delta: 'synthetic-private-audio' } : {}),
      };
      const transport = {
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() {
          yield { type: 'response.created' as const, sequence_number: 0, response: makeResponse() };
          yield event;
        },
      };
      const client = { responses: { retrieve: vi.fn(async () => transport) } } as unknown as OpenAI;
      const stream = ResponseStream.createResponse(client, { response_id: 'resp_123', starting_after: 0 });
      const emitted = vi.fn();
      const errors: OpenAIError[] = [];
      stream.on('event', emitted);
      stream.on('error', (error) => errors.push(error));

      await expect(stream.finalResponse()).rejects.toThrow(
        'Response event does not match the active response.',
      );

      expect(readSequence).toHaveBeenCalledTimes(1);
      expect(emitted).not.toHaveBeenCalled();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(OpenAIError);
      expect(errors[0]?.message).not.toContain(privateMessage);
      expect(errors[0]).not.toHaveProperty('cause');
    },
  );

  it.each(['create', 'replay', 'readable'] as const)(
    'applies the replay boundary consistently to %s keepalive listeners and iterators',
    async (mode) => {
      const events = [
        { type: 'response.created' as const, sequence_number: 0, response: makeResponse() },
        { type: 'keepalive' as const, sequence_number: 1 },
        { type: 'response.audio.delta' as const, sequence_number: 2, delta: 'stale' },
        { type: 'keepalive' as const, sequence_number: 3 },
        { type: 'keepalive' as const, sequence_number: 4 },
        { type: 'response.audio.delta' as const, sequence_number: 5, delta: 'live' },
        {
          type: 'response.completed' as const,
          sequence_number: 6,
          response: makeResponse({ status: 'completed' }),
        },
      ];
      const transport = {
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
      };
      const client = {
        responses: { create: vi.fn(async () => transport), retrieve: vi.fn(async () => transport) },
      } as unknown as OpenAI;
      const encoder = new TextEncoder();
      let stream: ResponseStream<null>;
      if (mode === 'readable') {
        stream = ResponseStream.fromReadableStream(
          ReadableStreamFrom(events.map((event) => encoder.encode(`${JSON.stringify(event)}\n`))),
        );
      } else if (mode === 'replay') {
        stream = ResponseStream.createResponse(client, { response_id: 'resp_123', starting_after: 3 });
      } else {
        stream = ResponseStream.createResponse(client, { model: 'gpt-test', input: 'keepalive events' });
      }
      const generic: number[] = [];
      const keepalives: number[] = [];
      const audio: string[] = [];
      stream.on('event', (event) => generic.push(event.sequence_number));
      Reflect.apply(stream.on, stream, [
        'keepalive',
        (event: { sequence_number: number }) => keepalives.push(event.sequence_number),
      ]);
      stream.on('response.audio.delta', (event) => audio.push(event.delta));
      const iteration = (async () => {
        const iterated: number[] = [];
        for await (const event of stream) {
          iterated.push(event.sequence_number);
        }
        return iterated;
      })();

      const [final, iterated] = await Promise.all([stream.finalResponse(), iteration]);

      expect(final.id).toBe('resp_123');
      expect(generic).toEqual(mode === 'replay' ? [4, 5, 6] : [0, 1, 2, 3, 4, 5, 6]);
      expect(iterated).toEqual(generic);
      expect(keepalives).toEqual(mode === 'replay' ? [4] : [1, 3, 4]);
      expect(audio).toEqual(mode === 'replay' ? ['live'] : ['stale', 'live']);
    },
  );

  it('does not detach lifecycle responses discarded while replaying prior events', async () => {
    const output = {
      id: 'msg_123',
      type: 'message' as const,
      role: 'assistant' as const,
      status: 'in_progress' as const,
      content: [{ type: 'output_text' as const, annotations: [], text: 'replayed' }],
    };
    const created = makeResponse({
      metadata: { stage: 'created' },
      output: [output],
      output_text: 'replayed',
    });
    const inProgress = makeResponse({
      metadata: { stage: 'replayed' },
      output: [output],
      output_text: 'replayed',
    });
    const completed = makeResponse({
      status: 'completed',
      metadata: { stage: 'completed' },
      output: [
        {
          ...output,
          status: 'completed',
          content: [{ type: 'output_text', annotations: [], text: 'replayed live' }],
        },
      ],
      output_text: 'replayed live',
    });
    const readCreated = vi.fn(() => created);
    const readInProgress = vi.fn(() => inProgress);
    const inspectReplayMetadata = vi.fn((target: object) => Reflect.ownKeys(target));
    const replayLifecycle = (
      type: 'response.created' | 'response.in_progress',
      sequenceNumber: number,
      readResponse: () => Response,
    ): ResponseStreamEvent =>
      new Proxy(
        {
          type,
          sequence_number: sequenceNumber,
          get response() {
            return readResponse();
          },
        },
        {
          ownKeys(target) {
            return inspectReplayMetadata(target);
          },
        },
      );
    const events: ResponseStreamEvent[] = [
      replayLifecycle('response.created', 0, readCreated),
      replayLifecycle('response.in_progress', 1, readInProgress),
      {
        type: 'response.output_text.delta',
        sequence_number: 2,
        item_id: 'msg_123',
        output_index: 0,
        content_index: 0,
        delta: ' live',
        logprobs: [],
      },
      { type: 'response.completed', sequence_number: 3, response: completed },
    ];
    const transport = {
      controller: new AbortController(),
      async *[Symbol.asyncIterator]() {
        yield* events;
      },
    };
    const client = { responses: { retrieve: vi.fn(async () => transport) } } as unknown as OpenAI;
    const clone = vi.spyOn(globalThis, 'structuredClone');

    try {
      const stream = ResponseStream.createResponse(client, { response_id: 'resp_123', starting_after: 1 });
      const emitted: ResponseStreamEvent[] = [];
      const snapshots: string[] = [];
      const replayed = vi.fn();
      stream.on('event', (event) => emitted.push(event));
      stream.on('response.created', replayed);
      stream.on('response.in_progress', replayed);
      stream.on('response.output_text.delta', (event) => snapshots.push(event.snapshot));

      await expect(stream.finalResponse()).resolves.toMatchObject({
        id: 'resp_123',
        metadata: { stage: 'completed' },
        output_text: 'replayed live',
      });

      expect(readCreated).toHaveBeenCalledTimes(1);
      expect(readInProgress).toHaveBeenCalledTimes(1);
      expect(inspectReplayMetadata).not.toHaveBeenCalled();
      expect(clone).toHaveBeenCalledTimes(4);
      expect(clone.mock.calls[0]?.[0]).toBe(created);
      expect(clone.mock.calls[1]?.[0]).toBe(inProgress);
      expect(clone.mock.calls[2]?.[0]).toBe(completed);
      expect(replayed).not.toHaveBeenCalled();
      expect(snapshots).toEqual(['replayed live']);
      expect(emitted.map((event) => event.sequence_number)).toEqual([2, 3]);
    } finally {
      clone.mockRestore();
    }
  });

  it.each([
    { disposition: 'discarded', sequenceNumber: 1 },
    { disposition: 'emitted', sequenceNumber: 2 },
  ])(
    'rejects a foreign $disposition replay lifecycle response before its cursor can rewrite the identity',
    async ({ sequenceNumber }) => {
      const foreign = makeResponse({
        id: 'resp_foreign',
        metadata: { source: 'synthetic-private-foreign-response' },
      });
      const readSequence = vi.fn(() => {
        foreign.id = 'resp_123';
        return sequenceNumber;
      });
      const lifecycle = {
        type: 'response.completed' as const,
        sequence_number: sequenceNumber,
        response: foreign,
      };
      Object.defineProperty(lifecycle, 'sequence_number', {
        configurable: true,
        enumerable: true,
        get: readSequence,
      });
      const transport = {
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() {
          yield { type: 'response.created' as const, sequence_number: 0, response: makeResponse() };
          yield lifecycle;
        },
      };
      const client = { responses: { retrieve: vi.fn(async () => transport) } } as unknown as OpenAI;
      const stream = ResponseStream.createResponse(client, { response_id: 'resp_123', starting_after: 1 });
      const emitted = vi.fn();
      const completed = vi.fn();
      const errors: OpenAIError[] = [];
      stream.on('event', emitted);
      stream.on('response.completed', completed);
      stream.on('error', (error) => errors.push(error));

      await expect(stream.finalResponse()).rejects.toThrow(
        'Response event does not match the active response.',
      );

      expect(readSequence).not.toHaveBeenCalled();
      expect(foreign.id).toBe('resp_foreign');
      expect(emitted).not.toHaveBeenCalled();
      expect(completed).not.toHaveBeenCalled();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(OpenAIError);
      expect(errors[0]?.message).not.toContain('synthetic-private-foreign-response');
      expect(errors[0]).not.toHaveProperty('cause');
    },
  );

  it('creates a response stream from a readable stream', async () => {
    const events: ResponseStreamEvent[] = [
      {
        type: 'response.created',
        sequence_number: 0,
        response: makeResponse(),
      },
      {
        type: 'response.output_item.added',
        sequence_number: 1,
        output_index: 0,
        item: {
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      },
      {
        type: 'response.content_part.added',
        sequence_number: 2,
        item_id: 'msg_123',
        output_index: 0,
        content_index: 0,
        part: {
          type: 'output_text',
          annotations: [],
          text: '',
        },
      },
      {
        type: 'response.output_text.delta',
        sequence_number: 3,
        item_id: 'msg_123',
        output_index: 0,
        content_index: 0,
        delta: 'Hello world',
        logprobs: [],
      },
      {
        type: 'response.completed',
        sequence_number: 4,
        response: makeResponse({
          status: 'completed',
          output_text: 'Hello world',
          output: [
            {
              id: 'msg_123',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', annotations: [], text: 'Hello world' }],
            },
          ],
        }),
      },
    ];
    const snapshots: string[] = [];
    const stream = ResponseStream.fromReadableStream(readableStreamFromEvents(events)).on(
      'response.output_text.delta',
      (event) => snapshots.push(event.snapshot),
    );
    const emittedEvents: ResponseStreamEvent[] = [];

    for await (const event of stream) {
      emittedEvents.push(event);
    }

    const final = await stream.finalResponse();

    expect(emittedEvents).toEqual(events);
    expect(snapshots).toEqual(['Hello world']);
    expect(final.output_text).toBe('Hello world');
    expect(final.output[0]).toMatchObject({
      type: 'message',
      content: [{ type: 'output_text', text: 'Hello world' }],
    });
  });

  it.each([
    { field: 'output_index', mutation: 'changes' },
    { field: 'content_index', mutation: 'changes' },
    { field: 'output_index', mutation: 'deletes' },
    { field: 'content_index', mutation: 'deletes' },
    { field: 'output_index', mutation: 'hides' },
    { field: 'content_index', mutation: 'hides' },
  ] as const)(
    'dispatches the originally validated text route when a raw listener $mutation $field',
    async ({ field, mutation }) => {
      const output: Response['output'] = [
        {
          id: 'msg_first',
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [
            { type: 'output_text', annotations: [], text: 'first' },
            { type: 'output_text', annotations: [], text: 'second' },
          ],
        },
        {
          id: 'msg_other',
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [{ type: 'output_text', annotations: [], text: 'foreign' }],
        },
      ];
      const events: ResponseStreamEvent[] = [
        {
          type: 'response.created',
          sequence_number: 0,
          response: makeResponse({ output, output_text: 'firstsecondforeign' }),
        },
        {
          type: 'response.output_text.delta',
          sequence_number: 1,
          item_id: 'msg_first',
          output_index: 0,
          content_index: 0,
          delta: '!',
          logprobs: [],
        },
      ];
      const emitted = vi.fn();
      const raw: ResponseStreamEvent[] = [];
      const stream = ResponseStream.fromReadableStream(readableStreamFromEvents(events));
      stream.on('event', (event) => {
        raw.push(event);
        if (event.type === 'response.output_text.delta') {
          if (mutation === 'deletes') {
            Reflect.deleteProperty(event, field);
          } else if (mutation === 'hides') {
            Object.defineProperty(event, field, { configurable: true, enumerable: false, value: 1 });
          } else {
            event[field] = 1;
          }
        }
      });
      stream.on('response.output_text.delta', emitted);

      await expect(stream.finalResponse()).resolves.toBeDefined();

      expect(raw[1]).toBeDefined();
      expect(emitted).toHaveBeenCalledTimes(1);
      expect(emitted).toHaveBeenCalledWith(
        expect.objectContaining({
          output_index: 0,
          content_index: 0,
          snapshot: 'first!',
        }),
      );
    },
  );

  it('dispatches validated function-call routes even when raw listeners alter their identities', async () => {
    const output: Response['output'] = [
      {
        id: 'function_first',
        type: 'function_call',
        call_id: 'call_first',
        name: 'first',
        arguments: '{"first":',
        status: 'in_progress',
      },
      {
        id: 'function_other',
        type: 'function_call',
        call_id: 'call_other',
        name: 'other',
        arguments: '{"other":',
        status: 'in_progress',
      },
    ];
    const events: ResponseStreamEvent[] = [
      { type: 'response.created', sequence_number: 0, response: makeResponse({ output }) },
      {
        type: 'response.function_call_arguments.delta',
        sequence_number: 1,
        item_id: 'function_first',
        output_index: 0,
        delta: 'true}',
      },
    ];
    const emitted = vi.fn();
    const stream = ResponseStream.fromReadableStream(readableStreamFromEvents(events));
    stream.on('event', (event) => {
      if (event.type === 'response.function_call_arguments.delta') {
        event.output_index = 1;
        event.item_id = 'function_other';
      }
    });
    stream.on('response.function_call_arguments.delta', emitted);

    await expect(stream.finalResponse()).resolves.toBeDefined();

    expect(emitted).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'response.function_call_arguments.delta',
        item_id: 'function_first',
        output_index: 0,
        snapshot: '{"first":true}',
      }),
    );
  });

  it('captures a custom-transport routing accessor exactly once for accumulation and dispatch', async () => {
    const output: Response['output'] = [
      {
        id: 'msg_first',
        type: 'message',
        role: 'assistant',
        status: 'in_progress',
        content: [{ type: 'output_text', annotations: [], text: 'first' }],
      },
      {
        id: 'msg_other',
        type: 'message',
        role: 'assistant',
        status: 'in_progress',
        content: [{ type: 'output_text', annotations: [], text: 'foreign' }],
      },
    ];
    const delta = {
      type: 'response.output_text.delta' as const,
      sequence_number: 1,
      item_id: 'msg_first',
      output_index: 0,
      content_index: 0,
      delta: '!',
      logprobs: [],
    };
    const readIndex = vi.fn(() => (readIndex.mock.calls.length === 1 ? 0 : 1));
    Object.defineProperty(delta, 'output_index', { configurable: true, enumerable: true, get: readIndex });
    const events: ResponseStreamEvent[] = [
      {
        type: 'response.created',
        sequence_number: 0,
        response: makeResponse({ output, output_text: 'firstforeign' }),
      },
      delta,
    ];
    const transport = {
      controller: new AbortController(),
      async *[Symbol.asyncIterator]() {
        yield* events;
      },
    };
    const client = { responses: { create: vi.fn(async () => transport) } } as unknown as OpenAI;
    const stream = ResponseStream.createResponse(client, { model: 'gpt-test', input: 'route safely' });
    const emitted = vi.fn();
    stream.on('response.output_text.delta', emitted);

    await expect(stream.finalResponse()).resolves.toBeDefined();

    expect(readIndex).toHaveBeenCalledTimes(1);
    expect(emitted).toHaveBeenCalledWith(
      expect.objectContaining({ output_index: 0, content_index: 0, snapshot: 'first!' }),
    );
  });

  it.each(
    (
      [
        'response.created',
        'response.queued',
        'response.in_progress',
        'response.completed',
        'response.failed',
        'response.incomplete',
      ] as const
    ).flatMap((type) =>
      (['error', 'response.output_text.delta', 'response.queued'] as const).map((mutatedType) => ({
        type,
        mutatedType:
          type === 'response.queued' && mutatedType === 'response.queued'
            ? ('response.completed' as const)
            : mutatedType,
      })),
    ),
  )(
    'keeps the validated $type route when a generic listener changes its type to $mutatedType',
    async ({ type, mutatedType }) => {
      const lifecycle = {
        type,
        sequence_number: type === 'response.created' ? 0 : 1,
        response: makeResponse(),
      } as ResponseStreamEvent;
      const events: ResponseStreamEvent[] =
        type === 'response.created'
          ? [lifecycle]
          : [{ type: 'response.created', sequence_number: 0, response: makeResponse() }, lifecycle];
      const stream = ResponseStream.fromReadableStream(readableStreamFromEvents(events));
      const typed = vi.fn();
      const misrouted = vi.fn();
      stream.on('event', (event) => {
        if (event.type === type && event.sequence_number === lifecycle.sequence_number) {
          Reflect.set(event, 'type', mutatedType);
        }
      });
      stream.on(type, typed);
      stream.on('error', misrouted);
      if (mutatedType === 'response.output_text.delta') {
        stream.on(mutatedType, misrouted);
      } else if (mutatedType === 'response.queued' || mutatedType === 'response.completed') {
        stream.on(mutatedType, misrouted);
      }

      await expect(stream.finalResponse()).resolves.toMatchObject({ id: 'resp_123' });

      expect(typed).toHaveBeenCalledTimes(1);
      expect(typed).toHaveBeenCalledWith(expect.objectContaining({ type: mutatedType }));
      expect(misrouted).not.toHaveBeenCalled();
    },
  );

  it.each(['create', 'replay'] as const)(
    'materializes private inherited lifecycle metadata and sequence numbers through %s',
    async (mode) => {
      const readMetadata = vi.fn((value: string) => value);

      const events: ResponseStreamEvent[] = [
        new ProviderLifecycleEvent('response.created', 0, readMetadata),
        new ProviderLifecycleEvent('response.in_progress', 1, readMetadata),
        new ProviderLifecycleEvent('response.completed', 2, readMetadata),
      ];
      const transport = {
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
      };
      const client = {
        responses: { create: vi.fn(async () => transport), retrieve: vi.fn(async () => transport) },
      } as unknown as OpenAI;
      const stream =
        mode === 'replay'
          ? ResponseStream.createResponse(client, { response_id: 'resp_123', starting_after: 0 })
          : ResponseStream.createResponse(client, { model: 'gpt-test', input: 'private lifecycle metadata' });
      const emitted: ResponseStreamEvent[] = [];
      const typed: ResponseStreamEvent[] = [];
      stream.on('event', (event) => {
        expect(Reflect.get(event, 'provider_metadata')).toBe(`provider-${event.sequence_number}`);
        emitted.push(event);
      });
      stream.on('response.created', (event) => typed.push(event));
      stream.on('response.in_progress', (event) => typed.push(event));
      stream.on('response.completed', (event) => typed.push(event));

      await expect(stream.finalResponse()).resolves.toMatchObject({ id: 'resp_123', status: 'completed' });

      const expectedSequences = mode === 'replay' ? [1, 2] : [0, 1, 2];
      expect(emitted.map((event) => event.sequence_number)).toEqual(expectedSequences);
      expect(typed).toEqual(emitted);
      expect(readMetadata).toHaveBeenCalledTimes(expectedSequences.length);
      for (const event of emitted) {
        expect(Object.getPrototypeOf(event)).toBe(Object.prototype);
        expect(event).not.toBeInstanceOf(ProviderLifecycleEvent);
        expect(Object.getOwnPropertyDescriptor(event, 'provider_metadata')).toMatchObject({
          value: `provider-${event.sequence_number}`,
        });
        expect(Object.getOwnPropertyDescriptor(event, 'sequence_number')).toMatchObject({
          value: event.sequence_number,
        });
      }
    },
  );

  it.each(
    (['create', 'replay'] as const).flatMap((mode) =>
      (['sequence_number', 'provider_metadata'] as const).map((property) => ({ mode, property })),
    ),
  )('redacts inherited $property accessor failures during $mode', async ({ mode, property }) => {
    const privateMessage = `synthetic-private-inherited-${property}-secret`;

    const transport = {
      controller: new AbortController(),
      async *[Symbol.asyncIterator]() {
        yield new ProviderLifecycleEvent('response.created', 0, undefined, property);
      },
    };
    const client = {
      responses: { create: vi.fn(async () => transport), retrieve: vi.fn(async () => transport) },
    } as unknown as OpenAI;
    const stream =
      mode === 'replay'
        ? ResponseStream.createResponse(client, { response_id: 'resp_123', starting_after: -1 })
        : ResponseStream.createResponse(client, { model: 'gpt-test', input: 'redact inherited metadata' });
    const emitted = vi.fn();
    const errors: OpenAIError[] = [];
    stream.on('event', emitted);
    stream.on('error', (error) => errors.push(error));

    await expect(stream.finalResponse()).rejects.toThrow(
      'Response event does not match the active response.',
    );

    expect(emitted).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(OpenAIError);
    expect(errors[0]?.message).not.toContain(privateMessage);
    expect(errors[0]).not.toHaveProperty('cause');
  });

  it.each([
    'response.created',
    'response.queued',
    'response.in_progress',
    'response.completed',
    'response.failed',
    'response.incomplete',
  ] as const)(
    'emits the validated %s response when a transport getter changes its identity and raw event type',
    async (type) => {
      const matching = makeResponse({ metadata: { source: 'validated' } });
      const foreign = makeResponse({ id: 'resp_foreign', metadata: { source: 'private foreign response' } });
      const readResponse = vi.fn(() => (readResponse.mock.calls.length === 1 ? matching : foreign));
      const lifecycle = {
        type,
        sequence_number: type === 'response.created' ? 0 : 1,
        get response() {
          const response = readResponse();
          lifecycle.type = 'error';
          return response;
        },
        provider_metadata: 'preserved',
      } as ResponseStreamEvent;
      const events: ResponseStreamEvent[] =
        type === 'response.created'
          ? [lifecycle]
          : [{ type: 'response.created', sequence_number: 0, response: makeResponse() }, lifecycle];
      const transport = {
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
      };
      const client = { responses: { create: vi.fn(async () => transport) } } as unknown as OpenAI;
      const stream = ResponseStream.createResponse(client, { model: 'gpt-test', input: 'protect lifecycle' });
      const rawLifecycleResponses: Response[] = [];
      const typedLifecycleResponses: Response[] = [];
      const emittedEvents: ResponseStreamEvent[] = [];

      stream.on('event', (event) => {
        if (event.type === type && event.sequence_number === lifecycle.sequence_number) {
          emittedEvents.push(event);
          rawLifecycleResponses.push(event.response);
        }
      });
      stream.on(type, (event: Extract<ResponseStreamEvent, { response: Response }>) =>
        typedLifecycleResponses.push(event.response),
      );

      const final = await stream.finalResponse();

      expect(readResponse).toHaveBeenCalledTimes(1);
      expect(rawLifecycleResponses).toHaveLength(1);
      expect(typedLifecycleResponses).toHaveLength(1);
      expect(rawLifecycleResponses[0]).toBe(typedLifecycleResponses[0]);
      expect(rawLifecycleResponses[0]).not.toBe(matching);
      expect(rawLifecycleResponses[0]).toMatchObject({ id: 'resp_123', metadata: { source: 'validated' } });
      expect(emittedEvents[0]).toMatchObject({ type, provider_metadata: 'preserved' });
      expect(Object.getOwnPropertyDescriptor(emittedEvents[0] ?? {}, 'type')?.value).toBe(type);
      expect(lifecycle.type).toBe('error');
      expect(final.id).toBe('resp_123');
    },
  );

  it('preserves frozen lifecycle event metadata while exposing its validated response snapshot', async () => {
    const response = makeResponse({ status: 'completed' });
    const lifecycle = Object.freeze({
      type: 'response.completed' as const,
      sequence_number: 1,
      response,
      provider_metadata: 'frozen',
    });
    const events: ResponseStreamEvent[] = [
      { type: 'response.created', sequence_number: 0, response: makeResponse() },
      lifecycle,
    ];
    const transport = {
      controller: new AbortController(),
      async *[Symbol.asyncIterator]() {
        yield* events;
      },
    };
    const client = { responses: { create: vi.fn(async () => transport) } } as unknown as OpenAI;
    const stream = ResponseStream.createResponse(client, { model: 'gpt-test', input: 'frozen lifecycle' });
    let raw: ResponseStreamEvent | undefined;
    let typed: ResponseStreamEvent | undefined;

    stream.on('event', (event) => {
      if (event.type === 'response.completed') {
        raw = event;
      }
    });
    stream.on('response.completed', (event) => {
      typed = event;
    });

    await expect(stream.finalResponse()).resolves.toMatchObject({ id: 'resp_123' });

    expect(raw).toBe(typed);
    expect(raw).toMatchObject({ type: 'response.completed', provider_metadata: 'frozen' });
    expect(raw).not.toBe(lifecycle);
    expect(raw && 'response' in raw ? raw.response : undefined).not.toBe(response);
    expect(Object.isFrozen(lifecycle)).toBe(true);
  });

  it.each(
    (['create', 'replay'] as const).flatMap((mode) =>
      (['initial', 'subsequent'] as const).flatMap((position) =>
        ([127, 128, 129, 256] as const).map((prototypeDepth) => ({ mode, position, prototypeDepth })),
      ),
    ),
  )(
    'accepts an $position lifecycle event with $prototypeDepth ordinary prototypes during $mode',
    async ({ mode, position, prototypeDepth }) => {
      let providerPrototype: object = Object.prototype;
      for (let depth: number = prototypeDepth; depth > 0; depth -= 1) {
        const prototype = Object.create(providerPrototype) as {
          provider_metadata?: string;
          provider_boundary?: string;
          provider_beyond?: string;
        };
        if (depth === 1) {
          prototype.provider_metadata = 'nearby metadata';
        } else if (depth === 127) {
          prototype.provider_boundary = 'metadata within the bound';
        } else if (depth === 128) {
          prototype.provider_beyond = 'metadata outside the bound';
        }
        providerPrototype = prototype;
      }

      const lifecycle = Object.assign(Object.create(providerPrototype) as object, {
        type: position === 'initial' ? ('response.created' as const) : ('response.completed' as const),
        sequence_number: position === 'initial' ? 0 : 1,
        response: makeResponse({ status: position === 'initial' ? 'in_progress' : 'completed' }),
      });
      const events: ResponseStreamEvent[] =
        position === 'initial'
          ? [lifecycle]
          : [{ type: 'response.created', sequence_number: 0, response: makeResponse() }, lifecycle];
      const transport = {
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
      };
      const client = {
        responses: { create: vi.fn(async () => transport), retrieve: vi.fn(async () => transport) },
      } as unknown as OpenAI;
      const stream =
        mode === 'replay'
          ? ResponseStream.createResponse(client, { response_id: 'resp_123', starting_after: -1 })
          : ResponseStream.createResponse(client, { model: 'gpt-test', input: 'deep ordinary prototypes' });
      const emitted: ResponseStreamEvent[] = [];
      const typed = vi.fn();
      stream.on('event', (event) => emitted.push(event));
      stream.on(position === 'initial' ? 'response.created' : 'response.completed', typed);

      await expect(stream.finalResponse()).resolves.toMatchObject({ id: 'resp_123' });

      const emittedLifecycle = emitted[position === 'initial' ? 0 : 1];
      expect(typed).toHaveBeenCalledWith(emittedLifecycle);
      expect(emittedLifecycle).toMatchObject({
        type: lifecycle.type,
        sequence_number: lifecycle.sequence_number,
        provider_metadata: 'nearby metadata',
        provider_boundary: 'metadata within the bound',
      });
      expect(emittedLifecycle).not.toHaveProperty('provider_beyond');
      expect(Object.getPrototypeOf(emittedLifecycle)).toBe(Object.prototype);
    },
  );

  it.each(
    (['create', 'replay'] as const).flatMap((mode) =>
      (['initial', 'subsequent'] as const).flatMap((position) =>
        (['self cycle', 'multi-node cycle', 'boundary cycle'] as const).map((chain) => ({
          mode,
          position,
          chain,
        })),
      ),
    ),
  )(
    'rejects an $position $chain lifecycle prototype chain during $mode',
    async ({ mode, position, chain }) => {
      const privateMessage = 'synthetic-private-unbounded-prototype-secret';
      const stopUnsafeFixture = vi.fn(() => {
        throw new Error(privateMessage);
      });
      const inspectPrototype = vi.fn(() => {
        if (inspectPrototype.mock.calls.length > 512) {
          stopUnsafeFixture();
        }
      });
      const cyclicPrototype: { root?: ResponseStreamEvent; first?: object } = {};
      const createPrototype = (cycleDepth = 2): object => {
        const prototype = new Proxy(Object.create(null) as object, {
          getPrototypeOf() {
            inspectPrototype();
            if (chain === 'multi-node cycle' && cycleDepth === 1) {
              return cyclicPrototype.root ?? null;
            }
            if (chain === 'boundary cycle' && inspectPrototype.mock.calls.length === 128) {
              return cyclicPrototype.first ?? null;
            }
            return createPrototype(cycleDepth - 1);
          },
        });
        cyclicPrototype.first ??= prototype;
        return prototype;
      };

      const lifecycle: ResponseStreamEvent = new Proxy(
        {
          type: position === 'initial' ? ('response.created' as const) : ('response.completed' as const),
          sequence_number: position === 'initial' ? 0 : 1,
          response: makeResponse(),
        },
        {
          getPrototypeOf() {
            inspectPrototype();
            return chain === 'self cycle' ? (cyclicPrototype.root ?? null) : createPrototype();
          },
        },
      );
      cyclicPrototype.root = lifecycle;
      const events: ResponseStreamEvent[] =
        position === 'initial'
          ? [lifecycle]
          : [{ type: 'response.created', sequence_number: 0, response: makeResponse() }, lifecycle];
      const transport = {
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
      };
      const client = {
        responses: { create: vi.fn(async () => transport), retrieve: vi.fn(async () => transport) },
      } as unknown as OpenAI;
      const stream =
        mode === 'replay'
          ? ResponseStream.createResponse(client, { response_id: 'resp_123', starting_after: -1 })
          : ResponseStream.createResponse(client, {
              model: 'gpt-test',
              input: 'reject malformed prototypes',
            });
      const emitted = vi.fn();
      const errors: OpenAIError[] = [];
      stream.on('event', emitted);
      stream.on('error', (error) => errors.push(error));

      await expect(stream.finalResponse()).rejects.toThrow(
        'Response event does not match the active response.',
      );

      expect(stopUnsafeFixture).not.toHaveBeenCalled();
      const expectedPrototypeReads = { 'self cycle': 2, 'multi-node cycle': 6, 'boundary cycle': 128 };
      expect(inspectPrototype).toHaveBeenCalledTimes(expectedPrototypeReads[chain]);
      expect(emitted).toHaveBeenCalledTimes(position === 'initial' ? 0 : 1);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(OpenAIError);
      expect(errors[0]?.message).not.toContain(privateMessage);
      expect(errors[0]).not.toHaveProperty('cause');
    },
  );

  it.each(
    (['create', 'replay'] as const).flatMap((mode) =>
      (['initial', 'subsequent'] as const).map((position) => ({ mode, position })),
    ),
  )(
    'bounds an endlessly fabricated $position lifecycle prototype chain during $mode',
    async ({ mode, position }) => {
      const privateMessage = 'synthetic-private-unbounded-prototype-secret';
      const stopUnsafeFixture = vi.fn(() => {
        throw new Error(privateMessage);
      });
      const readUnsafeMetadata = vi.fn(() => {
        throw new Error(privateMessage);
      });
      const inspectPrototype = vi.fn(() => {
        if (inspectPrototype.mock.calls.length > 512) {
          stopUnsafeFixture();
        }
      });
      const createPrototype = (depth: number): object => {
        const prototype = Object.create(null) as { provider_metadata?: string };
        if (depth === 1) {
          prototype.provider_metadata = 'bounded metadata';
        } else if (depth === 128) {
          Object.defineProperty(prototype, 'provider_private', {
            configurable: true,
            enumerable: true,
            get: readUnsafeMetadata,
          });
        }
        return new Proxy(prototype, {
          getPrototypeOf() {
            inspectPrototype();
            return createPrototype(depth + 1);
          },
        });
      };
      const lifecycle = new Proxy(
        {
          type: position === 'initial' ? ('response.created' as const) : ('response.completed' as const),
          sequence_number: position === 'initial' ? 0 : 1,
          response: makeResponse(),
        },
        {
          getPrototypeOf() {
            inspectPrototype();
            return createPrototype(1);
          },
        },
      );
      const events: ResponseStreamEvent[] =
        position === 'initial'
          ? [lifecycle]
          : [{ type: 'response.created', sequence_number: 0, response: makeResponse() }, lifecycle];
      const transport = {
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
      };
      const client = {
        responses: { create: vi.fn(async () => transport), retrieve: vi.fn(async () => transport) },
      } as unknown as OpenAI;
      const stream =
        mode === 'replay'
          ? ResponseStream.createResponse(client, { response_id: 'resp_123', starting_after: -1 })
          : ResponseStream.createResponse(client, {
              model: 'gpt-test',
              input: 'bound fabricated prototypes',
            });
      const emitted: ResponseStreamEvent[] = [];
      const errors: OpenAIError[] = [];
      stream.on('event', (event) => emitted.push(event));
      stream.on('error', (error) => errors.push(error));

      await expect(stream.finalResponse()).resolves.toMatchObject({ id: 'resp_123' });

      expect(inspectPrototype).toHaveBeenCalledTimes(128);
      expect(stopUnsafeFixture).not.toHaveBeenCalled();
      expect(readUnsafeMetadata).not.toHaveBeenCalled();
      expect(errors).toEqual([]);
      expect(emitted).toHaveLength(position === 'initial' ? 1 : 2);
      const emittedLifecycle = emitted[position === 'initial' ? 0 : 1];
      expect(emittedLifecycle).toMatchObject({ provider_metadata: 'bounded metadata' });
      expect(emittedLifecycle).not.toHaveProperty('provider_private');
    },
  );

  it('preserves metadata from ordinary multi-level lifecycle prototype chains', async () => {
    const providerPrototype = Object.assign(
      Object.create({ provider_region: 'synthetic-region' }) as object,
      {
        provider_metadata: 'inherited metadata',
      },
    );
    const lifecycle = Object.assign(Object.create(providerPrototype) as object, {
      type: 'response.created' as const,
      sequence_number: 0,
      response: makeResponse(),
    });

    const transport = {
      controller: new AbortController(),
      async *[Symbol.asyncIterator]() {
        yield lifecycle;
      },
    };
    const client = { responses: { create: vi.fn(async () => transport) } } as unknown as OpenAI;
    const stream = ResponseStream.createResponse(client, { model: 'gpt-test', input: 'normal prototypes' });
    const emitted = vi.fn();
    stream.on('response.created', emitted);

    await expect(stream.finalResponse()).resolves.toMatchObject({ id: 'resp_123' });

    expect(emitted).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_metadata: 'inherited metadata',
        provider_region: 'synthetic-region',
      }),
    );
  });

  it.each(
    (['initial', 'subsequent'] as const).flatMap((position) =>
      (['own keys', 'descriptor', 'prototype'] as const).map((trap) => ({ position, trap })),
    ),
  )('redacts $position lifecycle event metadata failures from its $trap trap', async ({ position, trap }) => {
    const privateMessage = `synthetic-private-lifecycle-${trap}-secret`;
    const lifecycle = new Proxy(
      {
        type: position === 'initial' ? ('response.created' as const) : ('response.completed' as const),
        sequence_number: position === 'initial' ? 0 : 1,
        response: makeResponse(),
        provider_metadata: 'preserved when valid',
      },
      {
        ownKeys(target) {
          if (trap === 'own keys') {
            throw new Error(privateMessage);
          }
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, property) {
          if (trap === 'descriptor' && property === 'provider_metadata') {
            throw new Error(privateMessage);
          }
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
        getPrototypeOf(target) {
          if (trap === 'prototype') {
            throw new Error(privateMessage);
          }
          return Reflect.getPrototypeOf(target);
        },
      },
    );
    const events: ResponseStreamEvent[] =
      position === 'initial'
        ? [lifecycle]
        : [{ type: 'response.created', sequence_number: 0, response: makeResponse() }, lifecycle];
    const transport = {
      controller: new AbortController(),
      async *[Symbol.asyncIterator]() {
        yield* events;
      },
    };
    const client = { responses: { create: vi.fn(async () => transport) } } as unknown as OpenAI;
    const stream = ResponseStream.createResponse(client, { model: 'gpt-test', input: 'redact metadata' });
    const emitted = vi.fn();
    const errors: OpenAIError[] = [];
    stream.on('event', emitted);
    stream.on('error', (error) => errors.push(error));

    await expect(stream.finalResponse()).rejects.toThrow(
      'Response event does not match the active response.',
    );

    expect(emitted).toHaveBeenCalledTimes(position === 'initial' ? 0 : 1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(OpenAIError);
    expect(errors[0]?.message).not.toContain(privateMessage);
    expect(errors[0]).not.toHaveProperty('cause');
  });

  it.each(
    (['initial', 'subsequent'] as const).flatMap((position) =>
      (
        [
          'missing',
          'inherited',
          'polluted prototype',
          'throwing accessor',
          'non-enumerable',
          'undefined',
          'null',
          'number',
          'boolean',
          'object',
          'symbol',
        ] as const
      ).map((kind) => ({ position, kind })),
    ),
  )(
    'rejects an $position lifecycle response with a $kind ID before exposing private payloads or events',
    async ({ position, kind }) => {
      const response = makeResponse();
      const readID = vi.fn(() => {
        throw new Error('synthetic-private-stream-id');
      });
      const readOutput = vi.fn(() => {
        throw new Error('synthetic-private-stream-output');
      });
      Object.defineProperty(response, 'output', { configurable: true, enumerable: true, get: readOutput });

      if (kind === 'missing' || kind === 'inherited' || kind === 'polluted prototype') {
        Reflect.deleteProperty(response, 'id');
        if (kind !== 'missing') {
          const prototype = kind === 'inherited' ? { id: 'resp_123' } : Object.create(Object.prototype);
          if (kind === 'polluted prototype') {
            Object.defineProperty(prototype, 'id', {
              configurable: true,
              enumerable: true,
              value: 'resp_123',
            });
          }
          Object.setPrototypeOf(response, prototype);
        }
      } else if (kind === 'throwing accessor') {
        Object.defineProperty(response, 'id', { configurable: true, enumerable: true, get: readID });
      } else if (kind === 'non-enumerable') {
        Object.defineProperty(response, 'id', { configurable: true, enumerable: false, value: 'resp_123' });
      } else {
        const invalidIDs = {
          undefined,
          null: null,
          number: 123,
          boolean: false,
          object: {},
          symbol: Symbol('invalid stream response ID'),
        };
        Object.defineProperty(response, 'id', {
          configurable: true,
          enumerable: true,
          value: invalidIDs[kind],
        });
      }

      const lifecycle = {
        type: position === 'initial' ? ('response.created' as const) : ('response.completed' as const),
        sequence_number: position === 'initial' ? 0 : 1,
        response,
      };
      const events: ResponseStreamEvent[] =
        position === 'initial'
          ? [lifecycle]
          : [{ type: 'response.created', sequence_number: 0, response: makeResponse() }, lifecycle];
      const transport = {
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
      };
      const client = { responses: { create: vi.fn(async () => transport) } } as unknown as OpenAI;
      const stream = ResponseStream.createResponse(client, {
        model: 'gpt-test',
        input: 'reject private output',
      });
      const emitted = vi.fn();
      const errors: OpenAIError[] = [];
      stream.on('event', emitted);
      stream.on('error', (error) => errors.push(error));

      await expect(stream.finalResponse()).rejects.toThrow(
        'Response event does not match the active response.',
      );

      expect(readID).not.toHaveBeenCalled();
      expect(readOutput).not.toHaveBeenCalled();
      expect(emitted).toHaveBeenCalledTimes(position === 'initial' ? 0 : 1);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(OpenAIError);
      expect(errors[0]?.message).not.toContain('synthetic-private-stream-output');
    },
  );

  it.each(['changed', 'deleted', 'throwing accessor'] as const)(
    'retains its canonical response identity when a listener leaves the emitted snapshot ID %s',
    async (mutation) => {
      const foreign = makeResponse({ id: 'resp_foreign' });
      const readOutput = vi.fn(() => {
        throw new Error('synthetic-private-foreign-stream-output');
      });
      Object.defineProperty(foreign, 'output', { configurable: true, enumerable: true, get: readOutput });
      const events: ResponseStreamEvent[] = [
        { type: 'response.created', sequence_number: 0, response: makeResponse() },
        { type: 'response.in_progress', sequence_number: 1, response: makeResponse() },
        { type: 'response.completed', sequence_number: 2, response: foreign },
      ];
      const transport = {
        controller: new AbortController(),
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
      };
      const client = { responses: { create: vi.fn(async () => transport) } } as unknown as OpenAI;
      const stream = ResponseStream.createResponse(client, {
        model: 'gpt-test',
        input: 'preserve canonical response identity',
      });
      const emitted: ResponseStreamEvent[] = [];
      const readID = vi.fn(() => {
        throw new Error('synthetic-private-mutated-stream-id');
      });
      stream.on('event', (event) => {
        emitted.push(event);
        if (event.type !== 'response.created') {
          return;
        }
        if (mutation === 'changed') {
          event.response.id = 'resp_foreign';
        } else if (mutation === 'deleted') {
          Reflect.deleteProperty(event.response, 'id');
        } else {
          Object.defineProperty(event.response, 'id', { configurable: true, enumerable: true, get: readID });
        }
      });

      await expect(stream.finalResponse()).rejects.toThrow(
        'Response event does not match the active response.',
      );

      expect(emitted.map((event) => event.type)).toEqual(['response.created', 'response.in_progress']);
      expect(readID).not.toHaveBeenCalled();
      expect(readOutput).not.toHaveBeenCalled();
    },
  );

  it('replays hosted shell events, dispatches typed listeners, and preserves each command output', async () => {
    const events: ResponseStreamEvent[] = [
      {
        type: 'response.created',
        sequence_number: 0,
        response: makeResponse(),
      },
      {
        type: 'response.output_item.added',
        sequence_number: 1,
        output_index: 0,
        item: {
          id: 'sh_123',
          type: 'shell_call',
          call_id: 'call_123',
          environment: null,
          status: 'in_progress',
          action: { commands: [], timeout_ms: null, max_output_length: null },
        },
      },
      {
        type: 'response.shell_call_command.added',
        sequence_number: 2,
        output_index: 0,
        command_index: 0,
        command: '',
      },
      {
        type: 'response.shell_call_command.added',
        sequence_number: 3,
        output_index: 0,
        command_index: 1,
        command: '',
      },
      {
        type: 'response.shell_call_command.delta',
        sequence_number: 4,
        output_index: 0,
        command_index: 1,
        delta: 'echo second',
        obfuscation: 'padding',
      },
      {
        type: 'response.shell_call_command.delta',
        sequence_number: 5,
        output_index: 0,
        command_index: 0,
        delta: 'echo first draft',
      },
      {
        type: 'response.shell_call_command.done',
        sequence_number: 6,
        output_index: 0,
        command_index: 0,
        command: 'echo first',
      },
      {
        type: 'response.shell_call_command.done',
        sequence_number: 7,
        output_index: 0,
        command_index: 1,
        command: 'echo second',
      },
      {
        type: 'response.output_item.added',
        sequence_number: 8,
        output_index: 1,
        item: {
          id: 'sho_123',
          type: 'shell_call_output',
          call_id: 'call_123',
          status: 'in_progress',
          max_output_length: null,
          output: [],
        },
      },
      {
        type: 'response.shell_call_output_content.delta',
        sequence_number: 9,
        item_id: 'sho_123',
        output_index: 1,
        command_index: 1,
        delta: { stdout: 'second output' },
      },
      {
        type: 'response.shell_call_output_content.delta',
        sequence_number: 10,
        item_id: 'sho_123',
        output_index: 1,
        command_index: 0,
        delta: { stdout: 'first output', stderr: 'first warning' },
      },
      {
        type: 'response.shell_call_output_content.done',
        sequence_number: 11,
        item_id: 'sho_123',
        output_index: 1,
        command_index: 1,
        output: [{ stdout: 'second final', stderr: '', outcome: { type: 'timeout' } }],
      },
      {
        type: 'response.shell_call_output_content.done',
        sequence_number: 12,
        item_id: 'sho_123',
        output_index: 1,
        command_index: 0,
        output: [{ stdout: 'first final', stderr: 'final warning', outcome: { type: 'exit', exit_code: 7 } }],
      },
    ];
    const emittedTypes: ResponseStreamEvent['type'][] = [];
    const obfuscation: (string | undefined)[] = [];
    const stream = ResponseStream.fromReadableStream(readableStreamFromEvents(events))
      .on('response.shell_call_command.added', (event) => emittedTypes.push(event.type))
      .on('response.shell_call_command.delta', (event) => {
        emittedTypes.push(event.type);
        obfuscation.push(event.obfuscation);
      })
      .on('response.shell_call_command.done', (event) => emittedTypes.push(event.type))
      .on('response.shell_call_output_content.delta', (event) => emittedTypes.push(event.type))
      .on('response.shell_call_output_content.done', (event) => emittedTypes.push(event.type));

    const final = await stream.finalResponse();

    expect(emittedTypes).toEqual(
      events
        .filter((event) => event.type !== 'response.created' && event.type !== 'response.output_item.added')
        .map((event) => event.type),
    );
    expect(obfuscation).toEqual(['padding', undefined]);
    expect(final.output).toMatchObject([
      { type: 'shell_call', action: { commands: ['echo first', 'echo second'] } },
      {
        type: 'shell_call_output',
        output: [
          { stdout: 'first final', stderr: 'final warning', outcome: { type: 'exit', exit_code: 7 } },
          { stdout: 'second final', stderr: '', outcome: { type: 'timeout' } },
        ],
      },
    ]);
  });

  it.each(
    (
      [
        'response.shell_call_command.added',
        'response.shell_call_command.delta',
        'response.shell_call_command.done',
      ] as const
    ).flatMap((type) =>
      (['message', 'reasoning', 'shell_call_output'] as const).map((itemType) => ({ type, itemType })),
    ),
  )('rejects public $type targeting $itemType before any emission', async ({ type, itemType }) => {
    const outputByType: Record<typeof itemType, Response['output'][number]> = {
      message: {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        status: 'in_progress',
        content: [],
      },
      reasoning: { id: 'reasoning_123', type: 'reasoning', summary: [] },
      shell_call_output: {
        id: 'shell_output_123',
        type: 'shell_call_output',
        call_id: 'call_123',
        max_output_length: null,
        output: [],
        status: 'in_progress',
      },
    };
    const output = outputByType[itemType];
    const shellEvent: ResponseStreamEvent =
      type === 'response.shell_call_command.delta'
        ? { type, sequence_number: 1, output_index: 0, command_index: 0, delta: 'injected' }
        : { type, sequence_number: 1, output_index: 0, command_index: 0, command: 'injected' };
    const events: ResponseStreamEvent[] = [
      { type: 'response.created', sequence_number: 0, response: makeResponse({ output: [output] }) },
      shellEvent,
    ];
    const emitted = vi.fn();
    const rawEvents: string[] = [];
    const stream = ResponseStream.fromReadableStream(readableStreamFromEvents(events));
    stream.on(type, emitted).on('event', (event) => rawEvents.push(event.type));

    await expect(stream.finalResponse()).rejects.toThrow(
      `expected output item type 'shell_call', got '${itemType}'`,
    );
    expect(emitted).not.toHaveBeenCalled();
    expect(rawEvents).toEqual(['response.created']);
  });

  it('converts an error event into an APIError', async () => {
    const events: ResponseStreamEvent[] = [
      {
        type: 'response.created',
        sequence_number: 0,
        response: makeResponse(),
      },
      {
        type: 'error',
        sequence_number: 1,
        code: 'server_error',
        message: 'The server had an error while processing your request.',
        param: null,
      },
    ];
    const stream = ResponseStream.fromReadableStream(readableStreamFromEvents(events));
    const listenerErrors: OpenAIError[] = [];
    stream.on('error', (error) => listenerErrors.push(error));

    const rejection = await stream.finalResponse().then(
      () => {
        throw new Error('expected finalResponse() to reject');
      },
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(OpenAIError);
    expect(rejection).toBeInstanceOf(APIError);
    expect((rejection as APIError).message).toBe('The server had an error while processing your request.');
    expect((rejection as APIError).code).toBe('server_error');
    // `.on('error')` must observe the converted error, not the raw stream frame.
    expect(listenerErrors).toHaveLength(1);
    expect(listenerErrors[0]).toBe(rejection);
  });

  it('converts an initial error event into an APIError', async () => {
    const event = {
      type: 'error',
      sequence_number: 0,
      code: 'server_error',
      message: 'The server had an error before creating a response.',
      param: 'input',
    } satisfies ResponseStreamEvent;
    const stream = ResponseStream.fromReadableStream(readableStreamFromEvents([event]));

    const rejection = await stream.finalResponse().then(
      () => {
        throw new Error('expected finalResponse() to reject');
      },
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(APIError);
    expect(rejection).toMatchObject({
      message: 'The server had an error before creating a response.',
      code: 'server_error',
      param: 'input',
    });
  });

  it.each([false, true])(
    'preserves nested provider errors after a response was created: %s',
    async (createdFirst) => {
      const created = {
        type: 'response.created',
        sequence_number: 0,
        response: makeResponse(),
      } satisfies ResponseStreamEvent;
      const payload = {
        type: 'invalid_request_error',
        code: 'rate_limit_exceeded',
        message: 'The provider rejected the streamed response.',
        param: 'input',
        headers: { 'retry-after': '300' },
      };
      const error = {
        type: 'error',
        sequence_number: createdFirst ? 1 : 0,
        error: payload,
      };
      const events = createdFirst ? [created, error] : [error];
      const readable = ReadableStreamFrom(
        events.map((event) => new TextEncoder().encode(`${JSON.stringify(event)}\n`)),
      );
      const stream = ResponseStream.fromReadableStream(readable);
      const emittedEvents: ResponseStreamEvent[] = [];
      const emittedErrors: OpenAIError[] = [];
      stream.on('event', (event) => emittedEvents.push(event));
      stream.on('error', (streamError) => emittedErrors.push(streamError));

      const rejection = await stream.finalResponse().then(
        () => {
          throw new Error('expected finalResponse() to reject');
        },
        (streamError: unknown) => streamError,
      );

      expect(rejection).toBeInstanceOf(APIError);
      expect(rejection).toMatchObject({
        message: payload.message,
        code: payload.code,
        param: payload.param,
        type: payload.type,
        error: payload,
        status: undefined,
        headers: undefined,
      });
      expect(emittedErrors).toEqual([rejection]);
      expect(emittedEvents).toEqual(createdFirst ? [created] : []);
    },
  );

  it('propagates real nested SSE errors to a delayed async iterator', async () => {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const readable = new ReadableStream<Uint8Array>({
      start(readableController) {
        controller = readableController;
      },
    });
    const created = {
      type: 'response.created',
      sequence_number: 0,
      response: makeResponse(),
    } satisfies ResponseStreamEvent;
    const payload = {
      type: 'invalid_request_error',
      code: 'rate_limit_exceeded',
      message: 'The model is currently over capacity.',
      param: 'input',
      headers: { 'retry-after': '300' },
    };
    const error = { type: 'error', sequence_number: 1, error: payload };
    const openai = new OpenAI({
      apiKey: 'My API Key',
      fetch: async () =>
        new Response(readable, {
          status: 200,
          headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_nested_stream' },
        }),
    });
    const stream = openai.responses.stream({ model: 'gpt-4o', input: 'Hello' });
    const errorEmitted = stream.emitted('error');
    const received: ResponseStreamEvent[] = [];
    let resolveCreatedRead!: () => void;
    const createdRead = new Promise<void>((resolve) => {
      resolveCreatedRead = resolve;
    });
    let releaseCreatedRead!: () => void;
    const createdReadReleased = new Promise<void>((resolve) => {
      releaseCreatedRead = resolve;
    });
    const consuming = (async () => {
      for await (const event of stream) {
        received.push(event);
        resolveCreatedRead();
        await createdReadReleased;
      }
    })();

    controller.enqueue(encoder.encode(`event: response.created\ndata: ${JSON.stringify(created)}\n\n`));
    await createdRead;
    controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(error)}\n\n`));
    const emittedError = await errorEmitted;
    releaseCreatedRead();

    await expect(consuming).rejects.toBe(emittedError);
    expect(emittedError).toBeInstanceOf(APIError);
    expect(emittedError).toMatchObject({
      message: payload.message,
      code: payload.code,
      param: payload.param,
      type: payload.type,
      requestID: 'req_nested_stream',
      error: payload,
    });
    expect(received).toEqual([created]);
  });

  it('converts documented flat SSE error events before accumulating them', async () => {
    const created = {
      type: 'response.created',
      sequence_number: 0,
      response: makeResponse(),
    } satisfies ResponseStreamEvent;
    const error = {
      type: 'error',
      sequence_number: 1,
      code: 'provider_error',
      message: 'The provider returned a documented flat error.',
      param: 'model',
    } satisfies ResponseStreamEvent;
    const openai = new OpenAI({
      apiKey: 'My API Key',
      fetch: async () =>
        new Response([created, error].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    });
    const stream = openai.responses.stream({ model: 'gpt-4o', input: 'Hello' });
    const received: ResponseStreamEvent[] = [];
    stream.on('event', (event) => received.push(event));

    await expect(stream.finalResponse()).rejects.toMatchObject({
      message: error.message,
      code: error.code,
      param: error.param,
    });
    expect(received).toEqual([created]);
  });

  it('rejects async iteration when an error event arrives with no pending read', async () => {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const readable = new ReadableStream<Uint8Array>({
      start(readableController) {
        controller = readableController;
      },
    });
    const created = {
      type: 'response.created',
      sequence_number: 0,
      response: makeResponse(),
    } satisfies ResponseStreamEvent;
    const error = {
      type: 'error',
      sequence_number: 1,
      code: 'server_error',
      message: 'The server had an error while streaming a response.',
      param: null,
    } satisfies ResponseStreamEvent;
    let resolveCreatedRead!: () => void;
    const createdRead = new Promise<void>((resolve) => {
      resolveCreatedRead = resolve;
    });
    let releaseCreatedRead!: () => void;
    const createdReadReleased = new Promise<void>((resolve) => {
      releaseCreatedRead = resolve;
    });
    const stream = ResponseStream.fromReadableStream(readable);
    const errorEmitted = stream.emitted('error');
    const received: ResponseStreamEvent[] = [];
    const consuming = (async () => {
      for await (const event of stream) {
        received.push(event);
        resolveCreatedRead();
        await createdReadReleased;
      }
    })();

    controller.enqueue(encoder.encode(JSON.stringify(created) + '\n'));
    await createdRead;
    controller.enqueue(encoder.encode(JSON.stringify(error) + '\n'));
    controller.close();
    const emittedError = await errorEmitted;
    releaseCreatedRead();

    await expect(consuming).rejects.toBe(emittedError);
    expect(emittedError).toBeInstanceOf(APIError);
    expect(emittedError).toMatchObject({
      message: 'The server had an error while streaming a response.',
      code: 'server_error',
      param: null,
    });
    expect(received).toEqual([created]);
  });

  it('drains queued response events before surfacing a nested stream error', async () => {
    const created = {
      type: 'response.created',
      sequence_number: 0,
      response: makeResponse(),
    } satisfies ResponseStreamEvent;
    const inProgress = {
      type: 'response.in_progress',
      sequence_number: 1,
      response: makeResponse(),
    } satisfies ResponseStreamEvent;
    const payload = {
      type: 'server_error',
      code: 'server_error',
      message: 'The response failed after queued events.',
      param: null,
    };
    const error = { type: 'error', sequence_number: 2, error: payload };
    const readable = ReadableStreamFrom(
      [created, inProgress, error].map((event) => new TextEncoder().encode(`${JSON.stringify(event)}\n`)),
    );
    const stream = ResponseStream.fromReadableStream(readable);
    const iterator = stream[Symbol.asyncIterator]();
    const errorEmitted = stream.emitted('error');
    const emittedError = await errorEmitted;

    await expect(iterator.next()).resolves.toEqual({ value: created, done: false });
    await expect(iterator.next()).resolves.toEqual({ value: inProgress, done: false });
    await expect(iterator.next()).rejects.toBe(emittedError);
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it('finishes immediately when iteration begins after the stream has ended', async () => {
    const created = {
      type: 'response.created',
      sequence_number: 0,
      response: makeResponse(),
    } satisfies ResponseStreamEvent;
    const stream = ResponseStream.fromReadableStream(readableStreamFromEvents([created]));

    await stream.finalResponse();

    await expect(stream[Symbol.asyncIterator]().next()).resolves.toEqual({ value: undefined, done: true });
  });

  it('preserves failed response snapshots when no separate error event is sent', async () => {
    const created = {
      type: 'response.created',
      sequence_number: 0,
      response: makeResponse(),
    } satisfies ResponseStreamEvent;
    const failed = {
      type: 'response.failed',
      sequence_number: 1,
      response: makeResponse({
        status: 'failed',
        error: { code: 'server_error', message: 'The response failed.' },
      }),
    } satisfies ResponseStreamEvent;
    const stream = ResponseStream.fromReadableStream(readableStreamFromEvents([created, failed]));
    const received: ResponseStreamEvent[] = [];

    for await (const event of stream) {
      received.push(event);
    }

    await expect(stream.finalResponse()).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'server_error', message: 'The response failed.' },
    });
    expect(received).toEqual([created, failed]);
  });

  it('cancels a stalled readable stream when iteration stops early', async () => {
    const encoder = new TextEncoder();
    const created = {
      type: 'response.created',
      sequence_number: 0,
      response: makeResponse(),
    } satisfies ResponseStreamEvent;
    let resolvePullStarted!: () => void;
    const pullStarted = new Promise<void>((resolve) => {
      resolvePullStarted = resolve;
    });
    let resolveCancelled!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      resolveCancelled = resolve;
    });
    const cancel = vi.fn(() => resolveCancelled());
    let pulls = 0;
    const readable = new ReadableStream({
      pull(controller) {
        if (pulls++ === 0) {
          controller.enqueue(encoder.encode(`${JSON.stringify(created)}\n`));
          return;
        }

        resolvePullStarted();
        return new Promise<void>(() => {});
      },
      cancel,
    });
    const stream = ResponseStream.fromReadableStream(readable);
    const aborted = new Promise<void>((resolve) => {
      stream.once('abort', () => resolve());
    });

    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: created, done: false });
    await pullStarted;
    await iterator.return?.();

    await cancelled;
    await aborted;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.aborted).toBe(true);
  }, 5000);

  it('cancels a stalled readable stream when aborted', async () => {
    const encoder = new TextEncoder();
    const created = {
      type: 'response.created',
      sequence_number: 0,
      response: makeResponse(),
    } satisfies ResponseStreamEvent;

    let resolvePullStarted!: () => void;
    const pullStarted = new Promise<void>((resolve) => {
      resolvePullStarted = resolve;
    });
    let resolveCancelled!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      resolveCancelled = resolve;
    });
    const cancel = vi.fn(() => resolveCancelled());
    let pulls = 0;
    const readable = new ReadableStream({
      pull(controller) {
        if (pulls++ === 0) {
          controller.enqueue(encoder.encode(`${JSON.stringify(created)}\n`));
          return;
        }

        resolvePullStarted();
        return new Promise<void>(() => {});
      },
      cancel,
    });
    const stream = ResponseStream.fromReadableStream(readable);

    await stream.emitted('response.created');
    await pullStarted;

    const done = expect(stream.done()).rejects.toThrow(APIUserAbortError);
    stream.abort();

    await cancelled;
    await done;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.aborted).toBe(true);
  }, 5000);

  it('standard text works', async () => {
    const deltas: string[] = [];

    const request = await makeStreamSnapshotRequest((openai) =>
      openai.responses.stream({
        model: 'gpt-4o-2024-08-06',
        input: 'Say hello world',
      }),
    );
    const stream = request.on('response.output_text.delta', (e) => {
      deltas.push(e.snapshot);
    });

    const final = await stream.finalResponse();
    // The raw stream omits the SDK-only `output_text` convenience field.
    expect(final.output_text).toBe('Hello world');
    expect(deltas).toEqual(['Hello ', 'Hello world']);

    // basic shape checks
    expect(final.object).toBe('response');
    expect(final.output[0]?.type).toBe('message');
    // message should contain a single output_text part with the final text
    const msg = final.output[0];
    if (msg?.type === 'message') {
      expect(msg.content[0]).toMatchObject({ type: 'output_text', text: 'Hello world' });
    }
  });

  it('reasoning works', async () => {
    const stream = await makeStreamSnapshotRequest((openai) =>
      openai.responses.stream({
        model: 'o3',
        input: 'Compute 6 * 7',
        reasoning: { effort: 'medium' },
      }),
    );

    const final = await stream.finalResponse();
    expect(final.object).toBe('response');
    // first item should be reasoning with accumulated text
    expect(final.output[0]?.type).toBe('reasoning');
    if (final.output[0]?.type === 'reasoning') {
      expect(final.output[0].content?.[0]).toMatchObject({
        type: 'reasoning_text',
        text: 'Chain: Step 1. Step 2.',
      });
    }
    // second item should be the assistant message with the final text
    expect(final.output[1]?.type).toBe('message');
    if (final.output[1]?.type === 'message') {
      expect(final.output[1].content[0]).toMatchObject({ type: 'output_text', text: 'The answer is 42' });
    }
    expect(final.output_text).toBe('The answer is 42');
  });

  it('surfaces a mid-stream error when events are buffered before consumption', async () => {
    // Two valid events, then a malformed delta that references a missing output
    // index so accumulation throws mid-stream (the stream itself closes cleanly,
    // so the two earlier events are delivered).
    const validEvents: ResponseStreamEvent[] = [
      { type: 'response.created', sequence_number: 0, response: makeResponse() },
      {
        type: 'response.output_item.added',
        sequence_number: 1,
        output_index: 0,
        item: { id: 'msg_1', type: 'message', role: 'assistant', status: 'in_progress', content: [] },
      },
    ];
    const malformedEvent = {
      type: 'response.output_text.delta',
      sequence_number: 2,
      item_id: 'msg_1',
      output_index: 99,
      content_index: 0,
      delta: 'boom',
      logprobs: [],
    } as unknown as ResponseStreamEvent;

    const stream = ResponseStream.fromReadableStream(
      readableStreamFromEvents([...validEvents, malformedEvent]),
    );
    // Grab the iterator (registering its listeners) but do not consume yet, so
    // the valid events and the error land while no reader is waiting: they
    // buffer in the iterator's internal queue instead of rejecting a pending
    // reader.
    const iterator = stream[Symbol.asyncIterator]();
    // Wait for the stream's terminal signal so the events and the error have
    // definitely been emitted before we start reading.
    await expect(stream.done()).rejects.toThrow('missing output at index 99');

    await expect(iterator.next()).resolves.toEqual({ value: validEvents[0], done: false });
    await expect(iterator.next()).resolves.toEqual({ value: validEvents[1], done: false });

    const failure = await iterator.next().then(
      () => {
        throw new Error('Expected the response iterator to reject');
      },
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(OpenAIError);
    expect((failure as OpenAIError).message).toBe('missing output at index 99');
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });
});

function readableStreamFromEvents(events: ResponseStreamEvent[]) {
  const encoder = new TextEncoder();
  return ReadableStreamFrom(events.map((event) => encoder.encode(JSON.stringify(event) + '\n')));
}

function makeTextMessage(text: string): Extract<Response['output'][number], { type: 'message' }> {
  return {
    id: 'msg_123',
    type: 'message',
    role: 'assistant',
    status: 'in_progress',
    content: [{ type: 'output_text', annotations: [], text }],
  };
}

function makeResponse(overrides: Partial<Response> = {}): Response {
  return {
    id: 'resp_123',
    object: 'response',
    created_at: 1,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: 'gpt-5',
    output: [],
    output_text: '',
    parallel_tool_calls: false,
    status: 'in_progress',
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    max_output_tokens: null,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    service_tier: null,
    store: true,
    text: { format: { type: 'text' }, verbosity: null },
    truncation: 'disabled',
    usage: null,
    user: null,
    ...overrides,
  } as Response;
}
