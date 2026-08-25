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
import type { BaseEvents, EventParameters } from './EventStream';
import { EventStream } from './EventStream';
import { hasOwn } from '../internal/utils';
import {
  accumulateAssistantStreamDelta,
  assertSafeAssistantStreamDelta,
  createAssistantStreamArrayDeltaCommit,
  defineAssistantStreamArrayEntry,
  isAssistantStreamValueExternallyMutable,
  markAssistantStreamValueExternallyMutable,
} from '../internal/assistant-stream-delta';

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

function stabilizeAssistantStreamEvent(event: AssistantStreamEvent): {
  event: AssistantStreamEvent;
  exposedEvent: AssistantStreamEvent;
} {
  const eventDescriptor = Object.getOwnPropertyDescriptor(event, 'event');
  const dataDescriptor = Object.getOwnPropertyDescriptor(event, 'data');
  const eventType = Reflect.get(event, 'event', event) as AssistantStreamEvent['event'];
  const data = Reflect.get(event, 'data', event) as AssistantStreamEvent['data'];
  let stableData = data;
  if (
    eventType === 'thread.message.created' ||
    eventType === 'thread.message.in_progress' ||
    eventType === 'thread.message.delta' ||
    eventType === 'thread.message.completed' ||
    eventType === 'thread.message.incomplete' ||
    eventType === 'thread.run.step.created' ||
    eventType === 'thread.run.step.in_progress' ||
    eventType === 'thread.run.step.delta' ||
    eventType === 'thread.run.step.completed' ||
    eventType === 'thread.run.step.failed' ||
    eventType === 'thread.run.step.cancelled' ||
    eventType === 'thread.run.step.expired'
  ) {
    const messageID = Object.getOwnPropertyDescriptor(data, 'id');
    if (messageID && 'value' in messageID && Reflect.get(data, 'id', data) !== messageID.value) {
      const canonicalID = messageID.value as unknown;
      stableData = new Proxy(data, {
        get(target, property) {
          return property === 'id' ? canonicalID : Reflect.get(target, property, target);
        },
      }) as AssistantStreamEvent['data'];
    }
  }
  const stableEvent = Object.freeze({ event: eventType, data: stableData }) as AssistantStreamEvent;
  const ordinaryEvent =
    eventDescriptor !== undefined &&
    'value' in eventDescriptor &&
    eventDescriptor.value === eventType &&
    dataDescriptor !== undefined &&
    'value' in dataDescriptor &&
    dataDescriptor.value === data &&
    stableData === data;

  return {
    event: stableEvent,
    exposedEvent: ordinaryEvent ? event : ({ event: eventType, data: stableData } as AssistantStreamEvent),
  };
}

/** Streams assistant-run events while accumulating messages, run steps, and tool-call snapshots. */
export class AssistantStream
  extends EventStream<AssistantStreamEvents>
  implements AsyncIterable<AssistantStreamEvent>
{
  //Used to accumulate deltas
  //We are accumulating many types so the value here is not strict
  #runStepSnapshots: Record<string, Runs.RunStep> = Object.create(null);
  #runStepIDOwners = new Map<string, string>();
  #activeRunStepID: string | undefined;
  #messageSnapshots: Record<string, Message> = Object.create(null);
  #messageIDOwners = new Map<string, string>();
  #messageSnapshot: Message | undefined;
  #activeMessageID: string | undefined;
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
    return this._createIterator<AssistantStreamEvent>(
      (push) => {
        //Catch all for passing along all events
        const onEvent = (event: AssistantStreamEvent) => push(structuredClone(event));
        this.on('event', onEvent);
        return () => this.off('event', onEvent);
      },
      { onReturn: () => this.abort() },
    );
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
        __metadata: { ...options?.__metadata, helperMethod: 'stream' },
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
        __metadata: { ...options?.__metadata, helperMethod: 'stream' },
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
        __metadata: { ...options?.__metadata, helperMethod: 'stream' },
      }),
    );
    return runner;
  }

  /** Returns the most recent raw event, or `undefined` before any event arrives. */
  currentEvent(): AssistantStreamEvent | undefined {
    markAssistantStreamValueExternallyMutable(this.#currentEvent);
    return this.#currentEvent;
  }

  /** Returns the latest run snapshot, or `undefined` before a run event arrives. */
  currentRun(): Run | undefined {
    markAssistantStreamValueExternallyMutable(this.#currentRunSnapshot);
    return this.#currentRunSnapshot;
  }

  /** Returns the message currently being accumulated, or `undefined` before message creation. */
  currentMessageSnapshot(): Message | undefined {
    markAssistantStreamValueExternallyMutable(this.#messageSnapshot);
    return this.#messageSnapshot;
  }

  /** Returns the run step currently being accumulated, or `undefined` before a step begins. */
  currentRunStepSnapshot(): Runs.RunStep | undefined {
    markAssistantStreamValueExternallyMutable(this.#currentRunStepSnapshot);
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

    const { event: stableEvent, exposedEvent } = stabilizeAssistantStreamEvent(event);

    let messageID: string | undefined;
    let messageData: MessageStreamEvent['data'] | undefined;
    let runStepID: string | undefined;
    let runStepData: RunStepStreamEvent['data'] | undefined;
    switch (stableEvent.event) {
      case 'thread.message.created':
      case 'thread.message.in_progress':
      case 'thread.message.delta':
      case 'thread.message.completed':
      case 'thread.message.incomplete': {
        messageID = this.#validateMessageEvent(stableEvent);
        messageData = stableEvent.data;
        break;
      }
      case 'thread.run.step.created':
      case 'thread.run.step.in_progress':
      case 'thread.run.step.delta':
      case 'thread.run.step.completed':
      case 'thread.run.step.failed':
      case 'thread.run.step.cancelled':
      case 'thread.run.step.expired': {
        runStepID = this.#validateRunStepEvent(stableEvent);
        runStepData = stableEvent.data;
        break;
      }
    }

    this.#currentEvent = exposedEvent;

    this.#handleEvent(exposedEvent);
    if (messageID !== undefined && messageData !== undefined) {
      this.#reserveMessageAlias(messageData, messageID);
    }
    if (runStepID !== undefined && runStepData !== undefined) {
      this.#reserveRunStepAlias(runStepData, runStepID);
    }
    if (runStepID === undefined && this.#activeRunStepID !== undefined && this.#currentRunStepSnapshot) {
      this.#reserveRunStepAlias(this.#currentRunStepSnapshot, this.#activeRunStepID);
    }

    switch (stableEvent.event) {
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
        this.#handleRun(stableEvent);
        break;
      }

      case 'thread.run.step.created':
      case 'thread.run.step.in_progress':
      case 'thread.run.step.delta':
      case 'thread.run.step.completed':
      case 'thread.run.step.failed':
      case 'thread.run.step.cancelled':
      case 'thread.run.step.expired': {
        if (runStepID === undefined) {
          throw new OpenAIError('Received assistant run-step event without a canonical run-step ID');
        }
        const activeRunStep = this.#runStepSnapshots[runStepID];
        if (activeRunStep) {
          this.#reserveRunStepAlias(activeRunStep, runStepID);
        }
        this.#handleRunStep(stableEvent, runStepID);
        this.#reserveRunStepAlias(stableEvent.data, runStepID);
        const retainedRunStep = this.#runStepSnapshots[runStepID];
        if (retainedRunStep) {
          this.#reserveRunStepAlias(retainedRunStep, runStepID);
        }
        break;
      }

      case 'thread.message.created':
      case 'thread.message.in_progress':
      case 'thread.message.delta':
      case 'thread.message.completed':
      case 'thread.message.incomplete': {
        this.#handleMessage(stableEvent);
        if (messageID !== undefined) {
          this.#reserveMessageAlias(stableEvent.data, messageID);
          const retainedMessage = this.#messageSnapshots[messageID];
          if (retainedMessage) {
            this.#reserveMessageAlias(retainedMessage, messageID);
          }
        }
        break;
      }

      case 'error': {
        //This is included for completeness, but errors are processed in the SSE event processing so this should not occur
        throw new Error(
          'Encountered an error event in event processing - errors should be processed earlier',
        );
      }
      default: {
        assertNever(stableEvent);
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

  #validateRunStepEvent(event: RunStepStreamEvent): string {
    const descriptor = Object.getOwnPropertyDescriptor(event.data, 'id');
    const runStepID = descriptor && 'value' in descriptor ? descriptor.value : undefined;

    if (typeof runStepID !== 'string' || runStepID.length === 0) {
      throw new OpenAIError('Received assistant run-step event with an invalid run-step ID');
    }

    if (event.event === 'thread.run.step.created') {
      if (this.#activeRunStepID !== undefined) {
        throw new OpenAIError(
          `Received run-step creation for "${runStepID}" before the active run step "${this.#activeRunStepID}" reached a terminal state`,
        );
      }

      if (hasOwn(this.#runStepSnapshots, runStepID) || this.#runStepIDOwners.has(runStepID)) {
        throw new OpenAIError(
          `Received run-step creation for run step "${runStepID}", which has already been created`,
        );
      }

      this.#activeRunStepID = runStepID;
      this.#runStepIDOwners.set(runStepID, runStepID);
      return runStepID;
    }

    if (this.#activeRunStepID !== undefined) {
      if (runStepID !== this.#activeRunStepID) {
        throw new OpenAIError(
          `Received ${event.event} for run step "${runStepID}", which does not match the active run step "${this.#activeRunStepID}"`,
        );
      }
      return runStepID;
    }

    if (event.event === 'thread.run.step.delta') {
      if (!hasOwn(this.#runStepSnapshots, runStepID)) {
        throw new OpenAIError('Received a RunStepDelta before creation of a snapshot');
      }
      throw new OpenAIError(`Received run-step delta for "${runStepID}" with no active run step`);
    }

    if (hasOwn(this.#runStepSnapshots, runStepID) || this.#runStepIDOwners.has(runStepID)) {
      throw new OpenAIError(
        `Received run-step event for run step "${runStepID}", which has already been created`,
      );
    }

    this.#runStepIDOwners.set(runStepID, runStepID);
    if (event.event === 'thread.run.step.in_progress') {
      this.#activeRunStepID = runStepID;
    }
    return runStepID;
  }

  #reserveRunStepAlias(data: RunStepStreamEvent['data'], canonicalID: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(data, 'id');
    const runStepID = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    if (typeof runStepID !== 'string' || runStepID.length === 0) {
      throw new OpenAIError('Received assistant run-step event with an invalid run-step ID');
    }
    const owner = this.#runStepIDOwners.get(runStepID);
    if (owner !== undefined && owner !== canonicalID) {
      throw new OpenAIError(
        `Received run-step creation for run step "${runStepID}", which has already been created`,
      );
    }
    this.#runStepIDOwners.set(runStepID, canonicalID);
  }

  #validateMessageEvent(event: MessageStreamEvent): string {
    const descriptor = Object.getOwnPropertyDescriptor(event.data, 'id');
    const messageID = descriptor && 'value' in descriptor ? descriptor.value : undefined;

    if (typeof messageID !== 'string' || messageID.length === 0) {
      throw new OpenAIError('Received assistant message event with an invalid message ID');
    }

    if (event.event === 'thread.message.created') {
      if (this.#messageSnapshot) {
        throw new OpenAIError(
          `Received message creation for "${messageID}" before the active message "${this.#activeMessageID}" reached a terminal state`,
        );
      }

      if (hasOwn(this.#messageSnapshots, messageID) || this.#messageIDOwners.has(messageID)) {
        throw new OpenAIError(
          `Received message creation for message "${messageID}", which has already been created`,
        );
      }

      this.#activeMessageID = messageID;
      this.#messageIDOwners.set(messageID, messageID);
      return messageID;
    }

    if (!this.#messageSnapshot) {
      if (event.event === 'thread.message.delta') {
        throw new OpenAIError(
          'Received a delta with no existing snapshot (there should be one from message creation)',
        );
      }

      throw new OpenAIError('Received thread message event with no existing snapshot');
    }

    if (messageID !== this.#activeMessageID) {
      throw new OpenAIError(
        `Received ${event.event} for message "${messageID}", which does not match the active message "${this.#activeMessageID}"`,
      );
    }
    return messageID;
  }

  #reserveMessageAlias(data: MessageStreamEvent['data'], canonicalID: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(data, 'id');
    const messageID = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    if (typeof messageID !== 'string' || messageID.length === 0) {
      throw new OpenAIError('Received assistant message event with an invalid message ID');
    }
    const owner = this.#messageIDOwners.get(messageID);
    if (owner !== undefined && owner !== canonicalID) {
      throw new OpenAIError(
        `Received message creation for message "${messageID}", which has already been created`,
      );
    }
    this.#messageIDOwners.set(messageID, canonicalID);
  }

  #handleMessage(this: AssistantStream, event: MessageStreamEvent) {
    const [accumulatedMessage, newContent] = this.#accumulateMessage(event, this.#messageSnapshot);
    this.#messageSnapshot = accumulatedMessage;
    if (!this.#activeMessageID) {
      throw new OpenAIError('Received thread message event with no active message ID');
    }
    this.#messageSnapshots[this.#activeMessageID] = accumulatedMessage;

    for (const content of newContent) {
      const snapshotContent = accumulatedMessage.content[content.index];
      if (snapshotContent?.type === 'text') {
        this.#emitExposed('textCreated', snapshotContent.text);
      }
    }

    switch (event.event) {
      case 'thread.message.created': {
        this.#currentContentIndex = undefined;
        this.#currentContent = undefined;
        this.#emitExposed('messageCreated', event.data);
        break;
      }

      case 'thread.message.in_progress': {
        break;
      }

      case 'thread.message.delta': {
        this.#emitExposed('messageDelta', event.data.delta, accumulatedMessage);

        if (event.data.delta.content) {
          for (const content of event.data.delta.content) {
            //If it is text delta, emit a text delta event
            if (content.type === 'text' && content.text) {
              const textDelta = content.text;
              const snapshot = accumulatedMessage.content[content.index];
              if (snapshot && snapshot.type === 'text') {
                this.#emitExposed('textDelta', textDelta, snapshot.text);
              } else {
                throw new Error('The snapshot associated with this text delta is not text or missing');
              }
            }

            if (content.index !== this.#currentContentIndex) {
              //See if we have in progress content
              if (this.#currentContent) {
                switch (this.#currentContent.type) {
                  case 'text': {
                    this.#emitExposed('textDone', this.#currentContent.text, this.#messageSnapshot);
                    break;
                  }
                  case 'image_file': {
                    this.#emitExposed(
                      'imageFileDone',
                      this.#currentContent.image_file,
                      this.#messageSnapshot,
                    );
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
                this.#emitExposed('imageFileDone', currentContent.image_file, this.#messageSnapshot);
                break;
              }
              case 'text': {
                this.#emitExposed('textDone', currentContent.text, this.#messageSnapshot);
                break;
              }
            }
          }
        }

        if (this.#messageSnapshot) {
          this.#emitExposed('messageDone', event.data);
        }

        this.#currentContentIndex = undefined;
        this.#currentContent = undefined;
        this.#messageSnapshot = undefined;
        this.#activeMessageID = undefined;
      }
    }
  }

  #handleRunStep(this: AssistantStream, event: RunStepStreamEvent, runStepID: string) {
    const accumulatedRunStep = this.#accumulateRunStep(event, runStepID);
    this.#currentRunStepSnapshot = accumulatedRunStep;

    switch (event.event) {
      case 'thread.run.step.created': {
        this.#currentToolCallIndex = undefined;
        this.#currentToolCall = undefined;
        this.#emitExposed('runStepCreated', event.data);
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
              this.#emitExposed(
                'toolCallDelta',
                toolCall,
                accumulatedRunStep.step_details.tool_calls[toolCall.index] as ToolCall,
              );
            } else {
              if (this.#currentToolCall) {
                this.#emitExposed('toolCallDone', this.#currentToolCall);
              }

              this.#currentToolCallIndex = toolCall.index;
              this.#currentToolCall = accumulatedRunStep.step_details.tool_calls[toolCall.index];
              if (this.#currentToolCall) {
                this.#emitExposed('toolCallCreated', this.#currentToolCall);
              }
            }
          }
        }

        this.#emitExposed('runStepDelta', event.data.delta, accumulatedRunStep);
        break;
      }
      case 'thread.run.step.completed':
      case 'thread.run.step.failed':
      case 'thread.run.step.cancelled':
      case 'thread.run.step.expired': {
        this.#currentRunStepSnapshot = undefined;
        this.#activeRunStepID = undefined;
        const details = event.data.step_details;
        if (details.type === 'tool_calls' && this.#currentToolCall) {
          this.#emitExposed('toolCallDone', this.#currentToolCall as ToolCall);
        }
        this.#emitExposed('runStepDone', event.data, accumulatedRunStep);
        this.#currentToolCallIndex = undefined;
        this.#currentToolCall = undefined;
        break;
      }
      case 'thread.run.step.in_progress': {
        break;
      }
    }
  }

  #emitExposed<Event extends keyof AssistantStreamEvents>(
    event: Event,
    ...args: EventParameters<AssistantStreamEvents, Event>
  ): void {
    if (this._hasListeners(event)) {
      for (const value of args) {
        markAssistantStreamValueExternallyMutable(value);
      }
    }
    this._emit(event, ...args);
  }

  #handleEvent(this: AssistantStream, event: AssistantStreamEvent) {
    this.#emitExposed('event', event);
  }

  #accumulateRunStep(event: RunStepStreamEvent, runStepID: string): Runs.RunStep {
    switch (event.event) {
      case 'thread.run.step.created': {
        this.#runStepSnapshots[runStepID] = event.data;
        return event.data;
      }

      case 'thread.run.step.delta': {
        const snapshot = this.#runStepSnapshots[runStepID] as Runs.RunStep;
        if (!snapshot) {
          throw new Error('Received a RunStepDelta before creation of a snapshot');
        }

        const data = event.data;

        if (data.delta) {
          const accumulated = accumulateAssistantStreamDelta(snapshot, data.delta, true) as Runs.RunStep;
          this.#runStepSnapshots[runStepID] = accumulated;
        }

        return this.#runStepSnapshots[runStepID] as Runs.RunStep;
      }

      case 'thread.run.step.completed':
      case 'thread.run.step.failed':
      case 'thread.run.step.cancelled':
      case 'thread.run.step.expired':
      case 'thread.run.step.in_progress': {
        this.#runStepSnapshots[runStepID] = event.data;
        break;
      }
    }

    if (this.#runStepSnapshots[runStepID]) {
      return this.#runStepSnapshots[runStepID] as Runs.RunStep;
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
          const cacheArrays = !isAssistantStreamValueExternallyMutable(snapshot);
          const commitProjection = createAssistantStreamArrayDeltaCommit(
            snapshot.content,
            data.delta.content,
            'content',
            cacheArrays,
          );

          for (const contentElement of data.delta.content) {
            if (hasOwn(snapshot.content, contentElement.index)) {
              const currentContent = snapshot.content[contentElement.index];
              snapshot.content[contentElement.index] = this.#accumulateContent(
                contentElement,
                currentContent,
                cacheArrays,
              );
            } else {
              defineAssistantStreamArrayEntry(snapshot.content, contentElement.index, contentElement);
              // This is a new element
              newContent.push(contentElement);
            }
          }

          commitProjection();
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
    cacheArrays: boolean,
  ): TextContentBlock | ImageFileContentBlock {
    return accumulateAssistantStreamDelta(
      currentContent as unknown as Record<any, any>,
      contentElement,
      cacheArrays,
    ) as TextContentBlock | ImageFileContentBlock;
  }

  /**
   * Applies an assistant delta to its mutable snapshot, concatenating text and
   * merging nested objects and indexed array entries.
   */
  static accumulateDelta(acc: Record<string, any>, delta: Record<string, any>): Record<string, any> {
    return accumulateAssistantStreamDelta(acc, delta);
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
          this.#emitExposed('toolCallDone', this.#currentToolCall);
        }
        this.#currentToolCallIndex = undefined;
        this.#currentToolCall = undefined;
        break;
      }
      case 'thread.run.cancelling': {
        break;
      }
    }
  }

  protected _addRun(run: Run): Run {
    this.#emitExposed('run', run);
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

function assertNever(_x: never) {
  return _x;
}
