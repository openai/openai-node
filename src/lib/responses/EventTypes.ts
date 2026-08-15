import type {
  ResponseAudioDeltaEvent,
  ResponseAudioDoneEvent,
  ResponseAudioTranscriptDeltaEvent,
  ResponseAudioTranscriptDoneEvent,
  ResponseCodeInterpreterCallCodeDeltaEvent,
  ResponseCodeInterpreterCallCodeDoneEvent,
  ResponseCodeInterpreterCallCompletedEvent,
  ResponseCodeInterpreterCallInProgressEvent,
  ResponseCodeInterpreterCallInterpretingEvent,
  ResponseCompletedEvent,
  ResponseContentPartAddedEvent,
  ResponseContentPartDoneEvent,
  ResponseCreatedEvent,
  ResponseErrorEvent,
  ResponseFailedEvent,
  ResponseFileSearchCallCompletedEvent,
  ResponseFileSearchCallInProgressEvent,
  ResponseFileSearchCallSearchingEvent,
  ResponseFunctionCallArgumentsDeltaEvent as RawResponseFunctionCallArgumentsDeltaEvent,
  ResponseFunctionCallArgumentsDoneEvent,
  ResponseInProgressEvent,
  ResponseOutputItemAddedEvent,
  ResponseOutputItemDoneEvent,
  ResponseRefusalDeltaEvent,
  ResponseRefusalDoneEvent,
  ResponseShellCallCommandAddedEvent,
  ResponseShellCallCommandDeltaEvent,
  ResponseShellCallCommandDoneEvent,
  ResponseShellCallOutputContentDeltaEvent,
  ResponseShellCallOutputContentDoneEvent,
  ResponseTextDeltaEvent as RawResponseTextDeltaEvent,
  ResponseTextDoneEvent,
  ResponseIncompleteEvent,
  ResponseWebSearchCallCompletedEvent,
  ResponseWebSearchCallInProgressEvent,
  ResponseWebSearchCallSearchingEvent,
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
  | ResponseAudioDeltaEvent
  | ResponseAudioDoneEvent
  | ResponseAudioTranscriptDeltaEvent
  | ResponseAudioTranscriptDoneEvent
  | ResponseCodeInterpreterCallCodeDeltaEvent
  | ResponseCodeInterpreterCallCodeDoneEvent
  | ResponseCodeInterpreterCallCompletedEvent
  | ResponseCodeInterpreterCallInProgressEvent
  | ResponseCodeInterpreterCallInterpretingEvent
  | ResponseCompletedEvent
  | ResponseContentPartAddedEvent
  | ResponseContentPartDoneEvent
  | ResponseCreatedEvent
  | ResponseErrorEvent
  | ResponseFileSearchCallCompletedEvent
  | ResponseFileSearchCallInProgressEvent
  | ResponseFileSearchCallSearchingEvent
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseFunctionCallArgumentsDoneEvent
  | ResponseInProgressEvent
  | ResponseFailedEvent
  | ResponseIncompleteEvent
  | ResponseOutputItemAddedEvent
  | ResponseOutputItemDoneEvent
  | ResponseRefusalDeltaEvent
  | ResponseRefusalDoneEvent
  | ResponseShellCallCommandAddedEvent
  | ResponseShellCallCommandDeltaEvent
  | ResponseShellCallCommandDoneEvent
  | ResponseShellCallOutputContentDeltaEvent
  | ResponseShellCallOutputContentDoneEvent
  | ResponseTextDeltaEvent
  | ResponseTextDoneEvent
  | ResponseWebSearchCallCompletedEvent
  | ResponseWebSearchCallInProgressEvent
  | ResponseWebSearchCallSearchingEvent;
