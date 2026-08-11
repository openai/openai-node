import type {
  TextContentBlock,
  ImageFileContentBlock,
  Message,
  MessageContentDelta,
  Text,
  ImageFile,
  TextDelta,
  MessageDelta,
  MessageContent,
} from '../resources/beta/threads/messages';
import type { RequestOptions } from '../internal/request-options';
import type {
  Run,
  RunCreateParamsBase,
  RunCreateParamsStreaming,
  Runs,
  RunSubmitToolOutputsParamsBase,
  RunSubmitToolOutputsParamsStreaming,
} from '../resources/beta/threads/runs/runs';
import type { ReadableStream } from '../internal/shim-types';
import { Stream } from '../streaming';
import { APIUserAbortError, OpenAIError } from '../error';
import type {
  AssistantStreamEvent,
  MessageStreamEvent,
  RunStepStreamEvent,
  RunStreamEvent,
} from '../resources/beta/assistants';
import type { RunStep, RunStepDelta, ToolCall, ToolCallDelta } from '../resources/beta/threads/runs/steps';
import type { ThreadCreateAndRunParamsBase, Threads } from '../resources/beta/threads/threads';
import type { BaseEvents } from './EventStream';
import { EventStream } from './EventStream';
import { hasOwn, isObj } from '../internal/utils';

/** Lifecycle, message, run-step, tool-call, and content events emitted by an assistant stream. */
export interface AssistantStreamEvents extends BaseEvents {
  /** Called with the finalized assistant run after all stream events have been processed. */
  run: (run: Run) => void;

  /** Called when a new assistant-thread message is created. */
  messageCreated: (message: Message) => void;
  /** Called with a message delta and the message snapshot after applying that delta. */
  messageDelta: (message: MessageDelta, snapshot: Message) => void;
  /** Called when an assistant-thread message reaches a completed or incomplete terminal state. */
  messageDone: (message: Message) => void;

  /** Called when a new step is added to the assistant run. */
  runStepCreated: (runStep: RunStep) => void;
  /** Called with a run-step delta and the step snapshot after applying that delta. */
  runStepDelta: (delta: RunStepDelta, snapshot: Runs.RunStep) => void;
  /** Called with the terminal run-step event and its accumulated snapshot. */
  runStepDone: (runStep: Runs.RunStep, snapshot: Runs.RunStep) => void;

  /** Called when a new tool call begins within an assistant run step. */
  toolCallCreated: (toolCall: ToolCall) => void;
  /** Called with a tool-call delta and the tool-call snapshot after applying that delta. */
  toolCallDelta: (delta: ToolCallDelta, snapshot: ToolCall) => void;
  /** Called when the current tool call finishes or a subsequent tool call begins. */
  toolCallDone: (toolCall: ToolCall) => void;

  /** Called when a new text content block is added to an assistant message. */
  textCreated: (content: Text) => void;
  /** Called with a text fragment and the complete text accumulated for its content block. */
  textDelta: (delta: TextDelta, snapshot: Text) => void;
  /** Called when a text content block finishes, together with its containing message. */
  textDone: (content: Text, snapshot: Message) => void;

  /** Called with a completed image-file content block; image files do not have delta events. */
  imageFileDone: (content: ImageFile, snapshot: Message) => void;

  /** Called for every raw assistant-stream event received from the API. */
  event: (event: AssistantStreamEvent) => void;
}

/** Parameters for creating an assistant thread and immediately streaming its run. */
export type ThreadCreateAndRunParamsBaseStream = Omit<ThreadCreateAndRunParamsBase, 'stream'> & {
  /** Streaming is always enabled by the helper and may be specified explicitly. */
  stream?: true;
};

/** Parameters for creating and streaming an assistant run on an existing thread. */
export type RunCreateParamsBaseStream = Omit<RunCreateParamsBase, 'stream'> & {
  /** Streaming is always enabled by the helper and may be specified explicitly. */
  stream?: true;
};

/** Parameters for submitting tool outputs and streaming the resumed assistant run. */
export type RunSubmitToolOutputsParamsStream = Omit<RunSubmitToolOutputsParamsBase, 'stream'> & {
  /** Streaming is always enabled by the helper and may be specified explicitly. */
  stream?: true;
};

/** Streams assistant-run events while accumulating messages, run steps, and tool-call snapshots. */
export class AssistantStream
  extends EventStream<AssistantStreamEvents>
  implements AsyncIterable<AssistantStreamEvent>
{
  //Track all events in a single list for reference
  #events: AssistantStreamEvent[] = [];

  //Used to accumulate deltas
  //We are accumulating many types so the value here is not strict
  #runStepSnapshots: Record<string, Runs.RunStep> = {};
  #messageSnapshots: Record<string, Message> = {};
  #messageSnapshot: Message | undefined;
  #finalRun: Run | undefined;
  #currentContentIndex: number | undefined;
  #currentContent: MessageContent | undefined;
  #currentToolCallIndex: number | undefined;
  #currentToolCall: ToolCall | undefined;

  //For current snapshot methods
  #currentEvent: AssistantStreamEvent | undefined;
  #currentRunSnapshot: Run | undefined;
  #currentRunStepSnapshot: Runs.RunStep | undefined;

  /** Iterates over cloned raw assistant events; stopping early aborts the underlying request. */
  [Symbol.asyncIterator](): AsyncIterator<AssistantStreamEvent> {
    const pushQueue: AssistantStreamEvent[] = [];
    const readQueue: {
      resolve: (chunk: AssistantStreamEvent | undefined) => void;
      reject: (err: unknown) => void;
    }[] = [];
    let done = false;

    //Catch all for passing along all events
    this.on('event', (event) => {
      const eventCopy = structuredClone(event);
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(eventCopy);
      } else {
        pushQueue.push(eventCopy);
      }
    });

    this.on('end', () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(undefined);
      }
      readQueue.length = 0;
    });

    this.on('abort', (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });

    this.on('error', (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });

    return {
      next: async (): Promise<IteratorResult<AssistantStreamEvent>> => {
        if (!pushQueue.length) {
          if (done) {
            return { value: undefined, done: true };
          }
          return new Promise<AssistantStreamEvent | undefined>((resolve, reject) =>
            readQueue.push({ resolve, reject }),
          ).then((chunk) => (chunk ? { value: chunk, done: false } : { value: undefined, done: true }));
        }
        const chunk = pushQueue.shift()!;
        return { value: chunk, done: false };
      },
      return: async () => {
        this.abort();
        return { value: undefined, done: true };
      },
    };
  }

  /** Restores an assistant stream from events serialized by `toReadableStream()`. */
  static fromReadableStream(stream: ReadableStream): AssistantStream {
    const runner = new AssistantStream();
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }

  protected async _fromReadableStream(
    readableStream: ReadableStream,
    options?: RequestOptions,
  ): Promise<Run> {
    this._listenForAbort(options?.signal);
    this._connected();
    const stream = Stream.fromReadableStream<AssistantStreamEvent>(readableStream, this.controller);
    for await (const event of stream) {
      this.#addEvent(event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addRun(this.#endRequest());
  }

  /** Serializes assistant events into a readable stream for transfer to another runtime. */
  toReadableStream(): ReadableStream {
    const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
    return stream.toReadableStream();
  }

  /** Submits tool outputs and starts streaming the continuation of an existing assistant run. */
  static createToolAssistantStream(
    runId: string,
    runs: Runs,
    params: RunSubmitToolOutputsParamsStream,
    options: RequestOptions | undefined,
  ): AssistantStream {
    const runner = new AssistantStream();
    runner._run(() =>
      runner._runToolAssistantStream(runId, runs, params, {
        ...options,
        headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
      }),
    );
    return runner;
  }

  protected async _createToolAssistantStream(
    run: Runs,
    runId: string,
    params: RunSubmitToolOutputsParamsStream,
    options?: RequestOptions,
  ): Promise<Run> {
    this._listenForAbort(options?.signal);

    const body: RunSubmitToolOutputsParamsStreaming = { ...params, stream: true };
    const stream = await run.submitToolOutputs(runId, body, {
      ...options,
      signal: this.controller.signal,
    });

    this._connected();

    for await (const event of stream) {
      this.#addEvent(event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }

    return this._addRun(this.#endRequest());
  }

  /** Creates an assistant thread and starts streaming its newly created run. */
  static createThreadAssistantStream(
    params: ThreadCreateAndRunParamsBaseStream,
    thread: Threads,
    options?: RequestOptions,
  ): AssistantStream {
    const runner = new AssistantStream();
    runner._run(() =>
      runner._threadAssistantStream(params, thread, {
        ...options,
        headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
      }),
    );
    return runner;
  }

  /** Creates a run on an existing assistant thread and starts streaming its events. */
  static createAssistantStream(
    threadId: string,
    runs: Runs,
    params: RunCreateParamsBaseStream,
    options?: RequestOptions,
  ): AssistantStream {
    const runner = new AssistantStream();
    runner._run(() =>
      runner._runAssistantStream(threadId, runs, params, {
        ...options,
        headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
      }),
    );
    return runner;
  }

  /** Returns the most recent raw event, or `undefined` before any event arrives. */
  currentEvent(): AssistantStreamEvent | undefined {
    return this.#currentEvent;
  }

  /** Returns the latest run snapshot, or `undefined` before a run event arrives. */
  currentRun(): Run | undefined {
    return this.#currentRunSnapshot;
  }

  /** Returns the message currently being accumulated, or `undefined` before message creation. */
  currentMessageSnapshot(): Message | undefined {
    return this.#messageSnapshot;
  }

  /** Returns the run step currently being accumulated, or `undefined` before a step begins. */
  currentRunStepSnapshot(): Runs.RunStep | undefined {
    return this.#currentRunStepSnapshot;
  }

  /** Waits for successful completion and returns the final snapshot of every observed run step. */
  async finalRunSteps(): Promise<Runs.RunStep[]> {
    await this.done();

    return Object.values(this.#runStepSnapshots);
  }

  /** Waits for successful completion and returns the final snapshot of every observed message. */
  async finalMessages(): Promise<Message[]> {
    await this.done();

    return Object.values(this.#messageSnapshots);
  }

  /** Waits for completion and returns the final run, or rejects if no terminal run was received. */
  async finalRun(): Promise<Run> {
    await this.done();
    if (!this.#finalRun) {
      throw new Error('Final run was not received.');
    }

    return this.#finalRun;
  }

  protected async _createThreadAssistantStream(
    thread: Threads,
    params: ThreadCreateAndRunParamsBase,
    options?: RequestOptions,
  ): Promise<Run> {
    this._listenForAbort(options?.signal);

    const body: RunCreateParamsStreaming = { ...params, stream: true };
    const stream = await thread.createAndRun(body, { ...options, signal: this.controller.signal });

    this._connected();

    for await (const event of stream) {
      this.#addEvent(event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }

    return this._addRun(this.#endRequest());
  }

  protected async _createAssistantStream(
    run: Runs,
    threadId: string,
    params: RunCreateParamsBase,
    options?: RequestOptions,
  ): Promise<Run> {
    this._listenForAbort(options?.signal);

    const body: RunCreateParamsStreaming = { ...params, stream: true };
    const stream = await run.create(threadId, body, { ...options, signal: this.controller.signal });

    this._connected();

    for await (const event of stream) {
      this.#addEvent(event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }

    return this._addRun(this.#endRequest());
  }

  #addEvent(event: AssistantStreamEvent) {
    if (this.ended) {
      return;
    }

    this.#currentEvent = event;

    this.#handleEvent(event);

    switch (event.event) {
      case 'thread.created': {
        //No action on this event.
        break;
      }

      case 'thread.run.created':
      case 'thread.run.queued':
      case 'thread.run.in_progress':
      case 'thread.run.requires_action':
      case 'thread.run.completed':
      case 'thread.run.incomplete':
      case 'thread.run.failed':
      case 'thread.run.cancelling':
      case 'thread.run.cancelled':
      case 'thread.run.expired': {
        this.#handleRun(event);
        break;
      }

      case 'thread.run.step.created':
      case 'thread.run.step.in_progress':
      case 'thread.run.step.delta':
      case 'thread.run.step.completed':
      case 'thread.run.step.failed':
      case 'thread.run.step.cancelled':
      case 'thread.run.step.expired': {
        this.#handleRunStep(event);
        break;
      }

      case 'thread.message.created':
      case 'thread.message.in_progress':
      case 'thread.message.delta':
      case 'thread.message.completed':
      case 'thread.message.incomplete': {
        this.#handleMessage(event);
        break;
      }

      case 'error': {
        //This is included for completeness, but errors are processed in the SSE event processing so this should not occur
        throw new Error(
          'Encountered an error event in event processing - errors should be processed earlier',
        );
      }
      default: {
        assertNever(event);
      }
    }
  }

  #endRequest(): Run {
    if (this.ended) {
      throw new OpenAIError(`stream has ended, this shouldn't happen`);
    }

    if (!this.#finalRun) {
      throw new Error('Final run has not been received');
    }

    return this.#finalRun;
  }

  #handleMessage(this: AssistantStream, event: MessageStreamEvent) {
    const [accumulatedMessage, newContent] = this.#accumulateMessage(event, this.#messageSnapshot);
    this.#messageSnapshot = accumulatedMessage;
    this.#messageSnapshots[accumulatedMessage.id] = accumulatedMessage;

    for (const content of newContent) {
      const snapshotContent = accumulatedMessage.content[content.index];
      if (snapshotContent?.type === 'text') {
        this._emit('textCreated', snapshotContent.text);
      }
    }

    switch (event.event) {
      case 'thread.message.created': {
        this._emit('messageCreated', event.data);
        break;
      }

      case 'thread.message.in_progress': {
        break;
      }

      case 'thread.message.delta': {
        this._emit('messageDelta', event.data.delta, accumulatedMessage);

        if (event.data.delta.content) {
          for (const content of event.data.delta.content) {
            //If it is text delta, emit a text delta event
            if (content.type === 'text' && content.text) {
              const textDelta = content.text;
              const snapshot = accumulatedMessage.content[content.index];
              if (snapshot && snapshot.type === 'text') {
                this._emit('textDelta', textDelta, snapshot.text);
              } else {
                throw new Error('The snapshot associated with this text delta is not text or missing');
              }
            }

            if (content.index !== this.#currentContentIndex) {
              //See if we have in progress content
              if (this.#currentContent) {
                switch (this.#currentContent.type) {
                  case 'text': {
                    this._emit('textDone', this.#currentContent.text, this.#messageSnapshot);
                    break;
                  }
                  case 'image_file': {
                    this._emit('imageFileDone', this.#currentContent.image_file, this.#messageSnapshot);
                    break;
                  }
                }
              }

              this.#currentContentIndex = content.index;
            }

            this.#currentContent = accumulatedMessage.content[content.index];
          }
        }

        break;
      }

      case 'thread.message.completed':
      case 'thread.message.incomplete': {
        //We emit the latest content we were working on on completion (including incomplete)
        if (this.#currentContentIndex !== undefined) {
          const currentContent = event.data.content[this.#currentContentIndex];
          if (currentContent) {
            switch (currentContent.type) {
              case 'image_file': {
                this._emit('imageFileDone', currentContent.image_file, this.#messageSnapshot);
                break;
              }
              case 'text': {
                this._emit('textDone', currentContent.text, this.#messageSnapshot);
                break;
              }
            }
          }
        }

        if (this.#messageSnapshot) {
          this._emit('messageDone', event.data);
        }

        this.#messageSnapshot = undefined;
      }
    }
  }

  #handleRunStep(this: AssistantStream, event: RunStepStreamEvent) {
    const accumulatedRunStep = this.#accumulateRunStep(event);
    this.#currentRunStepSnapshot = accumulatedRunStep;

    switch (event.event) {
      case 'thread.run.step.created': {
        this._emit('runStepCreated', event.data);
        break;
      }
      case 'thread.run.step.delta': {
        const delta = event.data.delta;
        if (
          delta.step_details &&
          delta.step_details.type === 'tool_calls' &&
          delta.step_details.tool_calls &&
          accumulatedRunStep.step_details.type === 'tool_calls'
        ) {
          for (const toolCall of delta.step_details.tool_calls) {
            if (toolCall.index === this.#currentToolCallIndex) {
              this._emit(
                'toolCallDelta',
                toolCall,
                accumulatedRunStep.step_details.tool_calls[toolCall.index] as ToolCall,
              );
            } else {
              if (this.#currentToolCall) {
                this._emit('toolCallDone', this.#currentToolCall);
              }

              this.#currentToolCallIndex = toolCall.index;
              this.#currentToolCall = accumulatedRunStep.step_details.tool_calls[toolCall.index];
              if (this.#currentToolCall) {
                this._emit('toolCallCreated', this.#currentToolCall);
              }
            }
          }
        }

        this._emit('runStepDelta', event.data.delta, accumulatedRunStep);
        break;
      }
      case 'thread.run.step.completed':
      case 'thread.run.step.failed':
      case 'thread.run.step.cancelled':
      case 'thread.run.step.expired': {
        this.#currentRunStepSnapshot = undefined;
        const details = event.data.step_details;
        if (details.type === 'tool_calls' && this.#currentToolCall) {
          this._emit('toolCallDone', this.#currentToolCall as ToolCall);
          this.#currentToolCall = undefined;
        }
        this._emit('runStepDone', event.data, accumulatedRunStep);
        break;
      }
      case 'thread.run.step.in_progress': {
        break;
      }
    }
  }

  #handleEvent(this: AssistantStream, event: AssistantStreamEvent) {
    this.#events.push(event);
    this._emit('event', event);
  }

  #accumulateRunStep(event: RunStepStreamEvent): Runs.RunStep {
    switch (event.event) {
      case 'thread.run.step.created': {
        this.#runStepSnapshots[event.data.id] = event.data;
        return event.data;
      }

      case 'thread.run.step.delta': {
        const snapshot = this.#runStepSnapshots[event.data.id] as Runs.RunStep;
        if (!snapshot) {
          throw new Error('Received a RunStepDelta before creation of a snapshot');
        }

        const data = event.data;

        if (data.delta) {
          const accumulated = AssistantStream.accumulateDelta(snapshot, data.delta) as Runs.RunStep;
          this.#runStepSnapshots[event.data.id] = accumulated;
        }

        return this.#runStepSnapshots[event.data.id] as Runs.RunStep;
      }

      case 'thread.run.step.completed':
      case 'thread.run.step.failed':
      case 'thread.run.step.cancelled':
      case 'thread.run.step.expired':
      case 'thread.run.step.in_progress': {
        this.#runStepSnapshots[event.data.id] = event.data;
        break;
      }
    }

    if (this.#runStepSnapshots[event.data.id]) {
      return this.#runStepSnapshots[event.data.id] as Runs.RunStep;
    }
    throw new Error('No snapshot available');
  }

  #accumulateMessage(
    event: AssistantStreamEvent,
    snapshot: Message | undefined,
  ): [Message, MessageContentDelta[]] {
    const newContent: MessageContentDelta[] = [];

    switch (event.event) {
      case 'thread.message.created': {
        //On creation the snapshot is just the initial message
        return [event.data, newContent];
      }

      case 'thread.message.delta': {
        if (!snapshot) {
          throw new Error(
            'Received a delta with no existing snapshot (there should be one from message creation)',
          );
        }

        const data = event.data;

        //If this delta does not have content, nothing to process
        if (data.delta.content) {
          assertSafeAssistantStreamDelta(data.delta);

          for (const contentElement of data.delta.content) {
            if (!Number.isInteger(contentElement.index) || contentElement.index < 0) {
              throw new OpenAIError(
                `Assistant stream delta contains an invalid content index: ${contentElement.index}`,
              );
            }
          }

          for (const contentElement of data.delta.content) {
            if (contentElement.index in snapshot.content) {
              const currentContent = snapshot.content[contentElement.index];
              snapshot.content[contentElement.index] = this.#accumulateContent(
                contentElement,
                currentContent,
              );
            } else {
              snapshot.content[contentElement.index] = contentElement as MessageContent;
              // This is a new element
              newContent.push(contentElement);
            }
          }
        }

        return [snapshot, newContent];
      }

      case 'thread.message.in_progress':
      case 'thread.message.completed':
      case 'thread.message.incomplete': {
        //No changes on other thread events
        if (snapshot) {
          return [snapshot, newContent];
        }
        throw new Error('Received thread message event with no existing snapshot');
      }
    }
    throw new Error('Tried to accumulate a non-message event');
  }

  // oxlint-disable-next-line class-methods-use-this -- Keeping this helper on the instance preserves nearby accumulator method structure.
  #accumulateContent(
    contentElement: MessageContentDelta,
    currentContent: MessageContent | undefined,
  ): TextContentBlock | ImageFileContentBlock {
    return AssistantStream.accumulateDelta(currentContent as unknown as Record<any, any>, contentElement) as
      | TextContentBlock
      | ImageFileContentBlock;
  }

  /**
   * Applies an assistant delta to its mutable snapshot, concatenating text and
   * merging nested objects and indexed array entries.
   */
  static accumulateDelta(acc: Record<string, any>, delta: Record<string, any>): Record<string, any> {
    assertSafeAssistantStreamDelta(delta);

    for (const [key, deltaValue] of Object.entries(delta)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new OpenAIError(`Assistant stream delta contains an unsafe property: ${key}`);
      }

      if (!hasOwn(acc, key)) {
        acc[key] = deltaValue;
        continue;
      }

      let accValue = acc[key];
      if (accValue === null || accValue === undefined) {
        acc[key] = deltaValue;
        continue;
      }

      // We don't accumulate these special properties
      if (key === 'index' || key === 'type') {
        acc[key] = deltaValue;
        continue;
      }

      // Type-specific accumulation logic
      if (typeof accValue === 'string' && typeof deltaValue === 'string') {
        accValue += deltaValue;
      } else if (typeof accValue === 'number' && typeof deltaValue === 'number') {
        accValue += deltaValue;
      } else if (isObj(accValue) && isObj(deltaValue)) {
        accValue = this.accumulateDelta(accValue as Record<string, any>, deltaValue as Record<string, any>);
      } else if (Array.isArray(accValue) && Array.isArray(deltaValue)) {
        if (accValue.every((x) => typeof x === 'string' || typeof x === 'number')) {
          accValue.push(...deltaValue); // Use spread syntax for efficient addition
          continue;
        }

        for (const deltaEntry of deltaValue) {
          if (!isObj(deltaEntry)) {
            throw new Error(`Expected array delta entry to be an object but got: ${deltaEntry}`);
          }

          const index = deltaEntry['index'];
          if (index == null) {
            console.error(deltaEntry);
            throw new Error('Expected array delta entry to have an `index` property');
          }

          if (typeof index !== 'number') {
            throw new TypeError(
              `Expected array delta entry \`index\` property to be a number but got ${index}`,
            );
          }

          const accEntry = accValue[index];
          accValue[index] = accEntry == null ? deltaEntry : this.accumulateDelta(accEntry, deltaEntry);
        }
        continue;
      } else {
        throw new TypeError(
          `Unhandled record type: ${key}, deltaValue: ${deltaValue}, accValue: ${accValue}`,
        );
      }
      acc[key] = accValue;
    }

    return acc;
  }

  #handleRun(this: AssistantStream, event: RunStreamEvent) {
    this.#currentRunSnapshot = event.data;

    switch (event.event) {
      case 'thread.run.created': {
        break;
      }
      case 'thread.run.queued': {
        break;
      }
      case 'thread.run.in_progress': {
        break;
      }
      case 'thread.run.requires_action':
      case 'thread.run.cancelled':
      case 'thread.run.failed':
      case 'thread.run.completed':
      case 'thread.run.expired':
      case 'thread.run.incomplete': {
        this.#finalRun = event.data;
        if (this.#currentToolCall) {
          this._emit('toolCallDone', this.#currentToolCall);
          this.#currentToolCall = undefined;
        }
        break;
      }
      case 'thread.run.cancelling': {
        break;
      }
    }
  }

  protected _addRun(run: Run): Run {
    this._emit('run', run);
    return run;
  }

  protected async _threadAssistantStream(
    params: ThreadCreateAndRunParamsBase,
    thread: Threads,
    options?: RequestOptions,
  ): Promise<Run> {
    return await this._createThreadAssistantStream(thread, params, options);
  }

  protected async _runAssistantStream(
    threadId: string,
    runs: Runs,
    params: RunCreateParamsBase,
    options?: RequestOptions,
  ): Promise<Run> {
    return await this._createAssistantStream(runs, threadId, params, options);
  }

  protected async _runToolAssistantStream(
    runId: string,
    runs: Runs,
    params: RunSubmitToolOutputsParamsStream,
    options?: RequestOptions,
  ): Promise<Run> {
    return await this._createToolAssistantStream(runs, runId, params, options);
  }
}

function assertSafeAssistantStreamDelta(value: unknown): void {
  if (!isObj(value) && !Array.isArray(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new OpenAIError(`Assistant stream delta contains an unsafe property: ${key}`);
    }

    assertSafeAssistantStreamDelta(nestedValue);
  }
}

function assertNever(_x: never) {
  return _x;
}
