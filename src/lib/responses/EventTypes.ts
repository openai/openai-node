import type {
  ResponseFunctionCallArgumentsDeltaEvent as RawResponseFunctionCallArgumentsDeltaEvent,
  ResponseStreamEvent,
  ResponseTextDeltaEvent as RawResponseTextDeltaEvent,
} from '../../resources/responses/responses';

/** A function-argument delta enhanced with the argument JSON accumulated so far. */
export type ResponseFunctionCallArgumentsDeltaEvent = RawResponseFunctionCallArgumentsDeltaEvent & {
  /** All argument JSON received for this function call, including the current delta. */
  snapshot: string;
};

/** An output-text delta enhanced with the text accumulated for its content part. */
export type ResponseTextDeltaEvent = RawResponseTextDeltaEvent & {
  /** All output text received for this content part, including the current delta. */
  snapshot: string;
};

/** A Responses API event, with accumulated snapshots attached to text and argument deltas. */
export type ParsedResponseStreamEvent =
  | Exclude<ResponseStreamEvent, RawResponseFunctionCallArgumentsDeltaEvent | RawResponseTextDeltaEvent>
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseTextDeltaEvent;
