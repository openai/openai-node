// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../core/resource';
import * as LiveAPI from './live';
import { APIPromise } from '../../core/api-promise';
import { buildHeaders } from '../../internal/headers';
import { RequestOptions } from '../../internal/request-options';
import { path } from '../../internal/utils/path';

export class Sessions extends APIResource {
  /**
   * Accept an incoming SIP call. Supply session with type live, the model, and
   * startup configuration. Before accepting calls, follow the
   * [Live prompting guide](https://developers.openai.com/api/docs/guides/live-prompting)
   * to write frontend conversation instructions and a separate backend prompt. SIP
   * media format is negotiated; omit audio.format.
   *
   * @example
   * ```ts
   * await client.live.sessions.accept('session_id', {
   *   session: { model: 'gpt-live-1', type: 'live' },
   * });
   * ```
   */
  accept(sessionID: string, body: SessionAcceptParams, options?: RequestOptions): APIPromise<void> {
    return this._client.post(path`/live/sessions/${sessionID}/accept`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: '*/*' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Get Live session content
   *
   * @example
   * ```ts
   * const response =
   *   await client.live.sessions.downloadRecording('live_SQ');
   *
   * const content = await response.blob();
   * console.log(content);
   * ```
   */
  downloadRecording(sessionID: string, options?: RequestOptions): APIPromise<Response> {
    return this._client.get(path`/live/sessions/${sessionID}/content`, {
      ...options,
      headers: buildHeaders([{ Accept: 'application/binary' }, options?.headers]),
      __security: { bearerAuth: true },
      __binaryResponse: true,
    });
  }

  /**
   * Fork a stored Live session onto a new WebRTC connection.
   *
   * @example
   * ```ts
   * const response = await client.live.sessions.fork(
   *   'session_id',
   *   { transport: { sdp: 'x', type: 'webrtc' } },
   * );
   * ```
   */
  fork(
    sessionID: string,
    body: SessionForkParams,
    options?: RequestOptions,
  ): APIPromise<SessionForkResponse> {
    return this._client.post(path`/live/sessions/${sessionID}/fork`, {
      body,
      ...options,
      __security: { bearerAuth: true },
    });
  }

  /**
   * End a SIP call identified by session_id.
   *
   * @example
   * ```ts
   * await client.live.sessions.hangup('session_id');
   * ```
   */
  hangup(sessionID: string, options?: RequestOptions): APIPromise<void> {
    return this._client.post(path`/live/sessions/${sessionID}/hangup`, {
      ...options,
      headers: buildHeaders([{ Accept: '*/*' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Transfer a SIP call to another destination. Supply a nonblank target_uri for the
   * SIP Refer-To header.
   *
   * @example
   * ```ts
   * await client.live.sessions.refer('session_id', {
   *   target_uri: 'tel:+14155550123',
   * });
   * ```
   */
  refer(sessionID: string, body: SessionReferParams, options?: RequestOptions): APIPromise<void> {
    return this._client.post(path`/live/sessions/${sessionID}/refer`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: '*/*' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Reject an incoming SIP call. Send a required SIP rejection status_code between
   * 300 and 699.
   *
   * @example
   * ```ts
   * await client.live.sessions.reject('session_id', {
   *   status_code: 486,
   * });
   * ```
   */
  reject(sessionID: string, body: SessionRejectParams, options?: RequestOptions): APIPromise<void> {
    return this._client.post(path`/live/sessions/${sessionID}/reject`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: '*/*' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }
}

/**
 * The created Live session identifier and WebRTC answer. Apply transport.sdp as
 * the peer's remote answer and wait for session.started on the data channel before
 * sending commands.
 */
export interface SessionForkResponse {
  /**
   * The newly created Live session. Use its ID for session controls and sideband
   * connections.
   */
  session: SessionForkResponse.Session;

  /**
   * WebRTC transport with the SDP answer.
   */
  transport: SessionForkResponse.Transport;
}

export namespace SessionForkResponse {
  /**
   * The newly created Live session. Use its ID for session controls and sideband
   * connections.
   */
  export interface Session {
    /**
     * Opaque session identifier. Preserve the returned value unchanged, including its
     * prefix.
     */
    id: string;
  }

  /**
   * WebRTC transport with the SDP answer.
   */
  export interface Transport {
    /**
     * Session Description Protocol message for the WebRTC connection.
     */
    sdp: string;

    /**
     * The transport used for the Live session. Always `webrtc`.
     */
    type: 'webrtc';
  }
}

export interface SessionAcceptParams {
  /**
   * Model and startup configuration for the Live session that answers the incoming
   * SIP call.
   */
  session: SessionAcceptParams.Session;
}

export namespace SessionAcceptParams {
  /**
   * Model and startup configuration for the Live session that answers the incoming
   * SIP call.
   */
  export interface Session {
    /**
     * The Live model to use for the accepted call.
     */
    model: (string & {}) | 'gpt-live-1';

    /**
     * The session type. Always `live`.
     */
    type: 'live';

    /**
     * Startup audio output configuration. SIP negotiates the media format;
     * audio.format is only accepted for primary WebSockets. Voice cannot change after
     * startup.
     */
    audio?: Session.Audio;

    /**
     * Who handles tasks delegated by the Live model. Omitted or null selects your
     * application; use `responses` to let the API manage a Responses backend.
     */
    delegation?: LiveAPI.ClientDelegation | Session.Responses | null;

    /**
     * Ordered text-only history supplied before startup. Supports developer, user, and
     * assistant messages with one text part each; at most 128 messages and 8,192
     * rendered tokens in total.
     */
    input?: Array<LiveAPI.InitialItem>;

    /**
     * Frontend instructions for voice, conversation, interruptions, and when to
     * delegate. Start with the
     * [Live prompting guide](https://developers.openai.com/api/docs/guides/live-prompting);
     * put business rules and tool workflows in a separate
     * [backend prompt](https://developers.openai.com/api/docs/guides/live-delegation#start-with-your-existing-backend-prompt).
     * Limited to 16,384 client-supplied tokens. Omitted or blank instructions use
     * server defaults. Immutable after startup.
     */
    instructions?: string | null;

    /**
     * Whether to store the session for later forking and recording download. Defaults
     * to false for new sessions.
     */
    store?: boolean;
  }

  export namespace Session {
    /**
     * Startup audio output configuration. SIP negotiates the media format;
     * audio.format is only accepted for primary WebSockets. Voice cannot change after
     * startup.
     */
    export interface Audio {
      /**
       * Settings for speech generated by the Live model. Choose the voice before
       * starting the session.
       */
      output?: Audio.Output;
    }

    export namespace Audio {
      /**
       * Settings for speech generated by the Live model. Choose the voice before
       * starting the session.
       */
      export interface Output {
        /**
         * The voice used for Live speech, as a built-in voice name or a custom voice
         * object containing its ID. Defaults to `marin` and cannot change after startup.
         */
        voice?: string | LiveAPI.BuiltInVoice | LiveAPI.CustomVoice;
      }
    }

    /**
     * Delegate tasks to a Responses model managed by the Live session.
     */
    export interface Responses {
      /**
       * Backend model, prompt, and tools used when the Live session delegates a task to
       * Responses.
       */
      responses: LiveAPI.ResponsesDelegationConfig;

      /**
       * The delegation owner. Always `responses` for tasks handled by the Responses API.
       */
      type: 'responses';
    }
  }
}

export interface SessionForkParams {
  /**
   * WebRTC transport with an SDP offer for the new connection to the forked session.
   */
  transport: SessionForkParams.Transport;

  /**
   * Optional configuration overrides for the new Live session. Omit this object or
   * send an empty object to inherit the stored session's settings.
   */
  session?: LiveAPI.MediaSessionForkConfig;
}

export namespace SessionForkParams {
  /**
   * WebRTC transport with an SDP offer for the new connection to the forked session.
   */
  export interface Transport {
    /**
     * Session Description Protocol message for the WebRTC connection.
     */
    sdp: string;

    /**
     * The transport used for the Live session. Always `webrtc`.
     */
    type: 'webrtc';
  }
}

export interface SessionReferParams {
  /**
   * Nonblank URI for the SIP Refer-To header, such as tel:+14155550123 or
   * sip:agent@example.com.
   */
  target_uri: string;
}

export interface SessionRejectParams {
  /**
   * SIP rejection status sent to the caller. This field is required.
   */
  status_code: number;
}

export declare namespace Sessions {
  export {
    type SessionForkResponse as SessionForkResponse,
    type SessionAcceptParams as SessionAcceptParams,
    type SessionForkParams as SessionForkParams,
    type SessionReferParams as SessionReferParams,
    type SessionRejectParams as SessionRejectParams,
  };
}
