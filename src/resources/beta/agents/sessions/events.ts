// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as AgentsAPI from '../agents';
import { APIPromise } from '../../../../core/api-promise';
import { Stream } from '../../../../core/streaming';
import { buildHeaders } from '../../../../internal/headers';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

export class Events extends APIResource {
  /**
   * Submits message, cancellation, or tool-result events to a managed agent session.
   * See
   * [session events](https://developers.openai.com/api/docs/guides/agents-api/sessions/events).
   *
   * @example
   * ```ts
   * await client.beta.agents.sessions.events.create(
   *   'session_id',
   *   {
   *     events: [
   *       {
   *         input: [
   *           {
   *             content: [{ text: 'text', type: 'input_text' }],
   *             role: 'user',
   *           },
   *         ],
   *         type: 'agent.session.input.message',
   *       },
   *     ],
   *   },
   * );
   * ```
   */
  create(sessionID: string, params: EventCreateParams, options?: RequestOptions): APIPromise<void> {
    const { 'Idempotency-Key': idempotencyKey, ...body } = params;
    return this._client.post(path`/agents/sessions/${sessionID}/events`, {
      body,
      ...options,
      headers: buildHeaders([
        {
          'OpenAI-Beta': 'agents=v1',
          Accept: '*/*',
          ...(idempotencyKey != null ? { 'Idempotency-Key': idempotencyKey } : undefined),
        },
        options?.headers,
      ]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Streams live events for an agent session. See
   * [session events](https://developers.openai.com/api/docs/guides/agents-api/sessions/events).
   *
   * @example
   * ```ts
   * const agentSessionEvent =
   *   await client.beta.agents.sessions.events.stream(
   *     'session_id',
   *   );
   * ```
   */
  stream(sessionID: string, options?: RequestOptions): APIPromise<Stream<AgentsAPI.AgentSessionEvent>> {
    return this._client.get(path`/agents/sessions/${sessionID}/events`, {
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1', Accept: 'text/event-stream' }, options?.headers]),
      stream: true,
      __security: { bearerAuth: true },
    }) as APIPromise<Stream<AgentsAPI.AgentSessionEvent>>;
  }
}

export interface EventCreateParams {
  /**
   * Body param: The input events to submit to the session.
   */
  events: Array<AgentsAPI.AgentSessionInputParam>;

  /**
   * Header param: An optional client-generated key that makes retries of submitted
   * messages idempotent.
   */
  'Idempotency-Key'?: string;
}

export declare namespace Events {
  export { type EventCreateParams as EventCreateParams };
}
