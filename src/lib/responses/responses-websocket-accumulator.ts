import { OpenAIError } from '../../core/error';
import type { ResponseOutputSnapshot } from '../../internal/responses/canonical-output-text';
import { ensureCanonicalOutputText } from '../../internal/responses/canonical-output-text';
import {
  accumulateWebSocketOutput,
  cloneValidatedResponse,
  createResponseContext,
  isResponseOutputEvent,
} from '../../internal/responses/response-accumulator';
import { isObj } from '../../internal/utils/values';
import type { ResponsesWebSocketEvent } from './responses-websocket-lane';

/** Provisional output is never substituted for a completed, failed, or incomplete response. */
export type ResponsesWebSocketAccumulatorState =
  | { phase: 'provisional'; snapshot: ResponseOutputSnapshot }
  | { phase: 'unavailable'; error: Error }
  | { phase: 'terminal'; event: ResponsesWebSocketEvent };

/**
 * Optional, caller-fed reconstruction of one lane's provisional output.
 *
 * Feed the raw events returned by lane.receive(). Use a separate instance per
 * lane. This helper never reads, sends, closes, or registers a listener on a
 * socket; raw events remain in the caller's hands. Tools remain output data.
 * Reading current returns a detached copy.
 *
 * A socket stream can omit the item/content scaffolding required for deltas.
 * Such a response is marked unavailable until the next creation or terminal
 * event. Terminal events, including failures and errors, are retained exactly as
 * delivered, without filling omitted output from provisional data.
 */
export class ResponsesWebSocketAccumulator {
  #context = createResponseContext();
  #current: ResponsesWebSocketAccumulatorState | undefined;

  get current(): ResponsesWebSocketAccumulatorState | undefined {
    return structuredClone(this.#current);
  }

  /** Drop retained provisional and terminal state without affecting any lane. */
  reset(): void {
    this.#context = createResponseContext();
    this.#current = undefined;
  }

  #start(event: { response?: unknown }): void {
    this.reset();
    if (!isObj(event.response)) {
      throw new OpenAIError('Responses WebSocket created event must contain a response');
    }
    // Only output fields are normalized; omitted response metadata is never invented.
    const { output, output_text: outputText } = event.response;
    if (
      (output !== undefined && !Array.isArray(output)) ||
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate optional text from an untyped WebSocket lifecycle before placing it in a typed provisional snapshot.
      (outputText !== undefined && typeof outputText !== 'string')
    ) {
      throw new OpenAIError('Invalid Responses WebSocket initial output');
    }
    const snapshot = cloneValidatedResponse(this.#context, {
      output: output ?? [],
      output_text: outputText ?? '',
    });
    if (outputText === undefined) {
      ensureCanonicalOutputText(this.#context, snapshot);
    }
    this.#current = { phase: 'provisional', snapshot };
  }

  /** Record one raw lane event. Unknown event types leave the current state unchanged. */
  add(event: ResponsesWebSocketEvent): void {
    if (
      event.type === 'response.completed' ||
      event.type === 'response.failed' ||
      event.type === 'response.incomplete' ||
      event.type === 'error'
    ) {
      this.#context = createResponseContext();
      this.#current = { phase: 'terminal', event: structuredClone(event) };
      return;
    }
    try {
      if (event.type === 'response.created') {
        this.#start({ response: event.response });
        return;
      }
      if (!isResponseOutputEvent(event) || this.#current?.phase === 'unavailable') {
        return;
      }
      if (this.#current?.phase !== 'provisional') {
        throw new OpenAIError("Cannot reconstruct WebSocket output before 'response.created'");
      }
      accumulateWebSocketOutput(event, this.#current.snapshot, this.#context);
    } catch (error) {
      this.#current = {
        phase: 'unavailable',
        error: error instanceof Error ? error : new OpenAIError('Invalid Responses WebSocket output event'),
      };
    }
  }
}
