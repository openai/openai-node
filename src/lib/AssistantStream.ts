import {
  TextContentBlock,
  ImageFileContentBlock,
  Message,
  MessageContentDelta,
  Text,
  ImageFile,
  TextDelta,
  Messages,
} from 'openai/resources/beta/threads/messages/messages';
import * as Core from 'openai/core';
import { RequestOptions } from 'openai/core';
import {
  Run,
  RunCreateParamsBase,
  RunCreateParamsStreaming,
  Runs,
  RunSubmitToolOutputsParamsBase,
  RunSubmitToolOutputsParamsStreaming,
} from 'openai/resources/beta/threads/runs/runs';
import {
  AbstractAssistantRunnerEvents,
  AbstractAssistantStreamRunner,
} from './AbstractAssistantStreamRunner';
import { type ReadableStream } from 'openai/_shims/index';
import { Stream } from 'openai/streaming';
import { APIUserAbortError, OpenAIError } from 'openai/error';
import {
  AssistantStreamEvent,
  MessageStreamEvent,
  RunStepStreamEvent,
  RunStreamEvent,
} from 'openai/resources/beta/assistants/assistants';
import { RunStep, RunStepDelta, ToolCall, ToolCallDelta } from 'openai/resources/beta/threads/runs/steps';
import { ThreadCreateAndRunParamsBase, Threads } from 'openai/resources/beta/threads/threads';
import MessageDelta = Messages.MessageDelta;

export interface AssistantStreamEvents extends AbstractAssistantRunnerEvents {
  //New event structure
  messageCreated: (message: Message) => void;
  messageDelta: (message: MessageDelta, snapshot: Message) => void;
  messageDone: (message: Message) => void;

  runStepCreated: (runStep: RunStep) => void;
  runStepDelta: (delta: RunStepDelta, snapshot: Runs.RunStep) => void;
  runStepDone: (runStep: Runs.RunStep, snapshot: Runs.RunStep) => void;

  toolCallCreated: (toolCall: ToolCall) => void;
  toolCallDelta: (delta: ToolCallDelta, snapshot: ToolCall) => void;
  toolCallDone: (toolCall: ToolCall) => void;

  textCreated: (content: Text) => void;
  textDelta: (delta: TextDelta, snapshot: Text) => void;
  textDone: (content: Text, snapshot: Message) => void;

  //No created or delta as this is not streamed
  imageFileDone: (content: ImageFile, snapshot: Message) => void;

  end: () => void;

  event: (event: AssistantStreamEvent) => void;
}

export type ThreadCreateAndRunParamsBaseStream = Omit<ThreadCreateAndRunParamsBase, 'stream'> & {
  stream?: true;
};

export type RunCreateParamsBaseStream = Omit<RunCreateParamsBase, 'stream'> & {
  stream?: true;
};

export type RunSubmitToolOutputsParamsStream = Omit<RunSubmitToolOutputsParamsBase, 'stream'> & {
  stream?: true;
};

export class AssistantStream
  extends AbstractAssistantStreamRunner<AssistantStreamEvents>
  implements AsyncIterable<AssistantStreamEvent>
{
  //Track all events in a single list for reference
  #events: AssistantStreamEvent[] = [];

  //Used to accumulate deltas
  //We are accumulating many types so the value here is not strict
  #runStepSnapshots: { [id: string]: Runs.RunStep } = {};
  #messageSnapshots: { [id: string]: Message } = {};
  #messageSnapshot: Message | undefined;
  #finalRun: Run | undefined;
  #currentContentIndex: number | undefined;
  #currentContent: TextContentBlock | ImageFileContentBlock | undefined;
  #currentToolCallIndex: number | undefined;
  #currentToolCall: ToolCall | undefined;

  //For current snapshot methods
  #currentEvent: AssistantStreamEvent | undefined;
  #currentRunSnapshot: Run | undefined;
  #currentRunStepSnapshot: Runs.RunStep | undefined;

  [Symbol.asyncIterator](): AsyncIterator<AssistantStreamEvent> {
    const pushQueue: AssistantStreamEvent[] = [];
    const readQueue: {
      resolve: (chunk: AssistantStreamEvent | undefined) => void;
      reject: (err: unknown) => void;
    }[] = [];
    let done = false;

    //Catch all for passing along all events
    this.on('event', (event) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(event);
      } else {
        pushQueue.push(event);
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

  static fromReadableStream(stream: ReadableStream): AssistantStream {
    const runner = new AssistantStream();
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }

  protected async _fromReadableStream(
    readableStream: ReadableStream,
    options?: Core.RequestOptions,
  ): Promise<Run> {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      signal.addEventListener('abort', () => this.controller.abort());
    }
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

  toReadableStream(): ReadableStream {
    const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
    return stream.toReadableStream();
  }

  static createToolAssistantStream(
    threadId: string,
    runId: string,
    runs: Runs,
    body: RunSubmitToolOutputsParamsStream,
    options: RequestOptions | undefined,
  ) {
    const runner = new AssistantStream();
    runner._run(() =>
      runner._runToolAssistantStream(threadId, runId, runs, body, {
        ...options,
        headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
      }),
    );
    return runner;
  }

  protected override async _createToolAssistantStream(
    run: Runs,
    threadId: string,
    runId: string,
    params: RunSubmitToolOutputsParamsStream,
    options?: Core.RequestOptions,
  ): Promise<Run> {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      signal.addEventListener('abort', () => this.controller.abort());
    }

    const body: RunSubmitToolOutputsParamsStreaming = { ...params, stream: true };
    const stream = await run.submitToolOutputs(threadId, runId, body, {
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

  static createThreadAssistantStream(
    body: ThreadCreateAndRunParamsBaseStream,
    thread: Threads,
    options?: RequestOptions,
  ) {
    const runner = new AssistantStream();
    runner._run(() =>
      runner._threadAssistantStream(body, thread, {
        ...options,
        headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
      }),
    );
    return runner;
  }

  static createAssistantStream(
    threadId: string,
    runs: Runs,
    params: RunCreateParamsBaseStream,
    options?: RequestOptions,
  ) {
    const runner = new AssistantStream();
    runner._run(() =>
      runner._runAssistantStream(threadId, runs, params, {
        ...options,
        headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
      }),
    );
    return runner;
  }

  currentEvent(): AssistantStreamEvent | undefined {
    return this.#currentEvent;
  }

  currentRun(): Run | undefined {
    return this.#currentRunSnapshot;
  }

  currentMessageSnapshot(): Message | undefined {
    return this.#messageSnapshot;
  }

  currentRunStepSnapshot(): Runs.RunStep | undefined {
    return this.#currentRunStepSnapshot;
  }

  async finalRunSteps(): Promise<Runs.RunStep[]> {
    await this.done();

    return Object.values(this.#runStepSnapshots);
  }

  async finalMessages(): Promise<Message[]> {
    await this.done();

    return Object.values(this.#messageSnapshots);
  }

  async finalRun(): Promise<Run> {
    await this.done();
    if (!this.#finalRun) throw Error('Final run was not received.');

    return this.#finalRun;
  }

  protected override async _createThreadAssistantStream(
    thread: Threads,
    params: ThreadCreateAndRunParamsBase,
    options?: Core.RequestOptions,
  ): Promise<Run> {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      signal.addEventListener('abort', () => this.controller.abort());
    }

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

  protected override async _createAssistantStream(
    run: Runs,
    threadId: string,
    params: RunCreateParamsBase,
    options?: Core.RequestOptions,
  ): Promise<Run> {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      signal.addEventListener('abort', () => this.controller.abort());
    }

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
    if (this.ended) return;

    this.#currentEvent = event;

    this.#handleEvent(event);

    switch (event.event) {
      case 'thread.created':
        //No action on this event.
        break;

      case 'thread.run.created':
      case 'thread.run.queued':
      case 'thread.run.in_progress':
      case 'thread.run.requires_action':
      case 'thread.run.completed':
      case 'thread.run.failed':
      case 'thread.run.cancelling':
      case 'thread.run.cancelled':
      case 'thread.run.expired':
        this.#handleRun(event);
        break;

      case 'thread.run.step.created':
      case 'thread.run.step.in_progress':
      case 'thread.run.step.delta':
      case 'thread.run.step.completed':
      case 'thread.run.step.failed':
      case 'thread.run.step.cancelled':
      case 'thread.run.step.expired':
        this.#handleRunStep(event);
        break;

      case 'thread.message.created':
      case 'thread.message.in_progress':
      case 'thread.message.delta':
      case 'thread.message.completed':
      case 'thread.message.incomplete':
        this.#handleMessage(event);
        break;

      case 'error':
        //This is included for completeness, but errors are processed in the SSE event processing so this should not occur
        throw new Error(
          'Encountered an error event in event processing - errors should be processed earlier',
        );
    }
  }

  #endRequest(): Run {
    if (this.ended) {
      throw new OpenAIError(`stream has ended, this shouldn't happen`);
    }

    if (!this.#finalRun) throw Error('Final run has not been received');

    return this.#finalRun;
  }

  #handleMessage(event: MessageStreamEvent) {
    const [accumulatedMessage, newContent] = this.#accumulateMessage(event, this.#messageSnapshot);
    this.#messageSnapshot = accumulatedMessage;
    this.#messageSnapshots[accumulatedMessage.id] = accumulatedMessage;

    for (const content of newContent) {
      const snapshotContent = accumulatedMessage.content[content.index];
      if (snapshotContent?.type == 'text') {
        this._emit('textCreated', snapshotContent.text);
      }
    }

    switch (event.event) {
      case 'thread.message.created':
        this._emit('messageCreated', event.data);
        break;

      case 'thread.message.in_progress':
        break;

      case 'thread.message.delta':
        this._emit('messageDelta', event.data.delta, accumulatedMessage);

        if (event.data.delta.content) {
          for (const content of event.data.delta.content) {
            //If it is text delta, emit a text delta event
            if (content.type == 'text' && content.text) {
              let textDelta = content.text;
              let snapshot = accumulatedMessage.content[content.index];
              if (snapshot && snapshot.type == 'text') {
                this._emit('textDelta', textDelta, snapshot.text);
              } else {
                throw Error('The snapshot associated with this text delta is not text or missing');
              }
            }

            if (content.index != this.#currentContentIndex) {
              //See if we have in progress content
              if (this.#currentContent) {
                switch (this.#currentContent.type) {
                  case 'text':
                    this._emit('textDone', this.#currentContent.text, this.#messageSnapshot);
                    break;
                  case 'image_file':
                    this._emit('imageFileDone', this.#currentContent.image_file, this.#messageSnapshot);
                    break;
                }
              }

              this.#currentContentIndex = content.index;
            }

            this.#currentContent = accumulatedMessage.content[content.index];
          }
        }

        break;

      case 'thread.message.completed':
      case 'thread.message.incomplete':
        //We emit the latest content we were working on on completion (including incomplete)
        if (this.#currentContentIndex !== undefined) {
          const currentContent = event.data.content[this.#currentContentIndex];
          if (currentContent) {
            switch (currentContent.type) {
              case 'image_file':
                this._emit('imageFileDone', currentContent.image_file, this.#messageSnapshot);
                break;
              case 'text':
                this._emit('textDone', currentContent.text, this.#messageSnapshot);
                break;
            }
          }
        }

        if (this.#messageSnapshot) {
          this._emit('messageDone', event.data);
        }

        this.#messageSnapshot = undefined;
    }
  }

  #handleRunStep(event: RunStepStreamEvent) {
    const accumulatedRunStep = this.#accumulateRunStep(event);
    this.#currentRunStepSnapshot = accumulatedRunStep;

    switch (event.event) {
      case 'thread.run.step.created':
        this._emit('runStepCreated', event.data);
        break;
      case 'thread.run.step.delta':
        const delta = event.data.delta;
        if (
          delta.step_details &&
          delta.step_details.type == 'tool_calls' &&
          delta.step_details.tool_calls &&
          accumulatedRunStep.step_details.type == 'tool_calls'
        ) {
          for (const toolCall of delta.step_details.tool_calls) {
            if (toolCall.index == this.#currentToolCallIndex) {
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
              if (this.#currentToolCall) this._emit('toolCallCreated', this.#currentToolCall);
            }
          }
        }

        this._emit('runStepDelta', event.data.delta, accumulatedRunStep);
        break;
      case 'thread.run.step.completed':
      case 'thread.run.step.failed':
      case 'thread.run.step.cancelled':
      case 'thread.run.step.expired':
        this.#currentRunStepSnapshot = undefined;
        const details = event.data.step_details;
        if (details.type == 'tool_calls') {
          if (this.#currentToolCall) {
            this._emit('toolCallDone', this.#currentToolCall as ToolCall);
            this.#currentToolCall = undefined;
          }
        }
        this._emit('runStepDone', event.data, accumulatedRunStep);
        break;
      case 'thread.run.step.in_progress':
        break;
    }
  }

  #handleEvent(event: AssistantStreamEvent) {
    this.#events.push(event);
    this._emit('event', event);
  }

  #accumulateRunStep(event: RunStepStreamEvent): Runs.RunStep {
    switch (event.event) {
      case 'thread.run.step.created':
        this.#runStepSnapshots[event.data.id] = event.data;
        return event.data;

      case 'thread.run.step.delta':
        let snapshot = this.#runStepSnapshots[event.data.id] as Runs.RunStep;
        if (!snapshot) {
          throw Error('Received a RunStepDelta before creation of a snapshot');
        }

        let data = event.data;

        if (data.delta) {
          const accumulated = AssistantStream.accumulateDelta(snapshot, data.delta) as Runs.RunStep;
          this.#runStepSnapshots[event.data.id] = accumulated;
        }

        return this.#runStepSnapshots[event.data.id] as Runs.RunStep;

      case 'thread.run.step.completed':
      case 'thread.run.step.failed':
      case 'thread.run.step.cancelled':
      case 'thread.run.step.expired':
      case 'thread.run.step.in_progress':
        this.#runStepSnapshots[event.data.id] = event.data;
        break;
    }

    if (this.#runStepSnapshots[event.data.id]) return this.#runStepSnapshots[event.data.id] as Runs.RunStep;
    throw new Error('No snapshot available');
  }

  #accumulateMessage(
    event: AssistantStreamEvent,
    snapshot: Message | undefined,
  ): [Message, MessageContentDelta[]] {
    let newContent: MessageContentDelta[] = [];

    switch (event.event) {
      case 'thread.message.created':
        //On creation the snapshot is just the initial message
        return [event.data, newContent];

      case 'thread.message.delta':
        if (!snapshot) {
          throw Error(
            'Received a delta with no existing snapshot (there should be one from message creation)',
          );
        }

        let data = event.data;

        //If this delta does not have content, nothing to process
        if (data.delta.content) {
          for (const contentElement of data.delta.content) {
            if (contentElement.index in snapshot.content) {
              let currentContent = snapshot.content[contentElement.index];
              snapshot.content[contentElement.index] = this.#accumulateContent(
                contentElement,
                currentContent,
              );
            } else {
              snapshot.content[contentElement.index] = contentElement as
                | TextContentBlock
                | ImageFileContentBlock;
              //This is a new element
              newContent.push(contentElement);
            }
          }
        }

        return [snapshot, newContent];

      case 'thread.message.in_progress':
      case 'thread.message.completed':
      case 'thread.message.incomplete':
        //No changes on other thread events
        if (snapshot) {
          return [snapshot, newContent];
        } else {
          throw Error('Received thread message event with no existing snapshot');
        }
    }
    throw Error('Tried to accumulate a non-message event');
  }

  #accumulateContent(
    contentElement: MessageContentDelta,
    currentContent: TextContentBlock | ImageFileContentBlock | undefined,
  ): TextContentBlock | ImageFileContentBlock {
    return AssistantStream.accumulateDelta(currentContent as unknown as Record<any, any>, contentElement) as
      | TextContentBlock
      | ImageFileContentBlock;
  }

  static accumulateDelta(acc: Record<string, any>, delta: Record<string, any>): Record<string, any> {
    for (const [key, deltaValue] of Object.entries(delta)) {
      if (!acc.hasOwnProperty(key)) {
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
      } else if (Core.isObj(accValue) && Core.isObj(deltaValue)) {
        accValue = this.accumulateDelta(accValue as Record<string, any>, deltaValue as Record<string, any>);
      } else if (Array.isArray(accValue) && Array.isArray(deltaValue)) {
        if (accValue.every((x) => typeof x === 'string' || typeof x === 'number')) {
          accValue.push(...deltaValue); // Use spread syntax for efficient addition
          continue;
        }
      } else {
        throw Error(`Unhandled record type: ${key}, deltaValue: ${deltaValue}, accValue: ${accValue}`);
      }
      acc[key] = accValue;
    }

    return acc;
  }

  #handleRun(event: RunStreamEvent) {
    this.#currentRunSnapshot = event.data;
    switch (event.event) {
      case 'thread.run.created':
        break;
      case 'thread.run.queued':
        break;
      case 'thread.run.in_progress':
        break;
      case 'thread.run.requires_action':
      case 'thread.run.cancelled':
      case 'thread.run.failed':
      case 'thread.run.completed':
      case 'thread.run.expired':
        this.#finalRun = event.data;
        if (this.#currentToolCall) {
          this._emit('toolCallDone', this.#currentToolCall);
          this.#currentToolCall = undefined;
        }
        break;
      case 'thread.run.cancelling':
        break;
    }
  }
}
