// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import * as RealtimeAPI from './realtime';
import * as ResponsesAPI from '../responses/responses';
import { APIPromise } from '../../core/api-promise';
import { buildHeaders } from '../../internal/headers';
import { RequestOptions } from '../../internal/request-options';
import { path } from '../../internal/utils/path';

export class Calls extends APIResource {
  /**
   * Accept an incoming SIP call and configure the realtime session that will handle
   * it.
   *
   * @example
   * ```ts
   * await client.realtime.calls.accept('call_id', {
   *   type: 'realtime',
   * });
   * ```
   */
  accept(callID: string, body: CallAcceptParams, options?: RequestOptions): APIPromise<void> {
    return this._client.post(path`/realtime/calls/${callID}/accept`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: '*/*' }, options?.headers]),
    });
  }

  /**
   * End an active Realtime API call, whether it was initiated over SIP or WebRTC.
   *
   * @example
   * ```ts
   * await client.realtime.calls.hangup('call_id');
   * ```
   */
  hangup(callID: string, options?: RequestOptions): APIPromise<void> {
    return this._client.post(path`/realtime/calls/${callID}/hangup`, {
      ...options,
      headers: buildHeaders([{ Accept: '*/*' }, options?.headers]),
    });
  }

  /**
   * Transfer an active SIP call to a new destination using the SIP REFER verb.
   *
   * @example
   * ```ts
   * await client.realtime.calls.refer('call_id', {
   *   target_uri: 'tel:+14155550123',
   * });
   * ```
   */
  refer(callID: string, body: CallReferParams, options?: RequestOptions): APIPromise<void> {
    return this._client.post(path`/realtime/calls/${callID}/refer`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: '*/*' }, options?.headers]),
    });
  }

  /**
   * Decline an incoming SIP call by returning a SIP status code to the caller.
   *
   * @example
   * ```ts
   * await client.realtime.calls.reject('call_id');
   * ```
   */
  reject(
    callID: string,
    body: CallRejectParams | null | undefined = {},
    options?: RequestOptions,
  ): APIPromise<void> {
    return this._client.post(path`/realtime/calls/${callID}/reject`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: '*/*' }, options?.headers]),
    });
  }
}

export interface CallAcceptParams {
  /**
   * The type of session to create. Always `realtime` for the Realtime API.
   */
  type: 'realtime';

  /**
   * Configuration for input and output audio.
   */
  audio?: RealtimeAPI.RealtimeAudioConfig;

  /**
   * Additional fields to include in server outputs.
   *
   * `item.input_audio_transcription.logprobs`: Include logprobs for input audio
   * transcription.
   */
  include?: Array<'item.input_audio_transcription.logprobs'>;

  /**
   * The default system instructions (i.e. system message) prepended to model calls.
   * This field allows the client to guide the model on desired responses. The model
   * can be instructed on response content and format, (e.g. "be extremely succinct",
   * "act friendly", "here are examples of good responses") and on audio behavior
   * (e.g. "talk quickly", "inject emotion into your voice", "laugh frequently"). The
   * instructions are not guaranteed to be followed by the model, but they provide
   * guidance to the model on the desired behavior.
   *
   * Note that the server sets default instructions which will be used if this field
   * is not set and are visible in the `session.created` event at the start of the
   * session.
   */
  instructions?: string;

  /**
   * Maximum number of output tokens for a single assistant response, inclusive of
   * tool calls. Provide an integer between 1 and 4096 to limit output tokens, or
   * `inf` for the maximum available tokens for a given model. Defaults to `inf`.
   */
  max_output_tokens?: number | 'inf';

  /**
   * The Realtime model used for this session.
   */
  model?:
    | (string & {})
    | 'gpt-realtime'
    | 'gpt-realtime-2025-08-28'
    | 'gpt-4o-realtime-preview'
    | 'gpt-4o-realtime-preview-2024-10-01'
    | 'gpt-4o-realtime-preview-2024-12-17'
    | 'gpt-4o-realtime-preview-2025-06-03'
    | 'gpt-4o-mini-realtime-preview'
    | 'gpt-4o-mini-realtime-preview-2024-12-17';

  /**
   * The set of modalities the model can respond with. It defaults to `["audio"]`,
   * indicating that the model will respond with audio plus a transcript. `["text"]`
   * can be used to make the model respond with text only. It is not possible to
   * request both `text` and `audio` at the same time.
   */
  output_modalities?: Array<'text' | 'audio'>;

  /**
   * Reference to a prompt template and its variables.
   * [Learn more](https://platform.openai.com/docs/guides/text?api-mode=responses#reusable-prompts).
   */
  prompt?: ResponsesAPI.ResponsePrompt | null;

  /**
   * How the model chooses tools. Provide one of the string modes or force a specific
   * function/MCP tool.
   */
  tool_choice?: RealtimeAPI.RealtimeToolChoiceConfig;

  /**
   * Tools available to the model.
   */
  tools?: RealtimeAPI.RealtimeToolsConfig;

  /**
   * Realtime API can write session traces to the
   * [Traces Dashboard](/logs?api=traces). Set to null to disable tracing. Once
   * tracing is enabled for a session, the configuration cannot be modified.
   *
   * `auto` will create a trace for the session with default values for the workflow
   * name, group id, and metadata.
   */
  tracing?: RealtimeAPI.RealtimeTracingConfig | null;

  /**
   * Controls how the realtime conversation is truncated prior to model inference.
   * The default is `auto`.
   */
  truncation?: RealtimeAPI.RealtimeTruncation;
}

export interface CallReferParams {
  /**
   * URI that should appear in the SIP Refer-To header. Supports values like
   * `tel:+14155550123` or `sip:agent@example.com`.
   */
  target_uri: string;
}

export interface CallRejectParams {
  /**
   * SIP response code to send back to the caller. Defaults to `603` (Decline) when
   * omitted.
   */
  status_code?: number;
}

export declare namespace Calls {
  export {
    type CallAcceptParams as CallAcceptParams,
    type CallReferParams as CallReferParams,
    type CallRejectParams as CallRejectParams,
  };
}
