// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as AutomationsAPI from './automations';
import { APIPromise } from '../../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../../core/pagination';
import { buildHeaders } from '../../../../internal/headers';
import { RequestOptions } from '../../../../internal/request-options';
import { path } from '../../../../internal/utils/path';

function resolveResourceRequestOptions(
  options: RequestOptions | undefined,
  buildOptions: (options: RequestOptions | undefined) => RequestOptions | Promise<RequestOptions>,
): Promise<RequestOptions> {
  return Promise.resolve(options).then(buildOptions);
}

// Recognizable options across SDK runtime versions. Keep this independent of
// private RequestOptions fields so older handwritten runtimes still compile.
const normalizeRequestOptionsForQueryKeys = new Set([
  'method',
  'path',
  'query',
  'body',
  'headers',
  'maxRetries',
  'stream',
  'timeout',
  'httpAgent',
  'fetchOptions',
  'signal',
  'idempotencyKey',
  'defaultBaseURL',
  '__metadata',
  '__binaryRequest',
  '__binaryResponse',
  '__streamClass',
  '__security',
  '__synthesizeEventData',
]);

function normalizeRequestOptionsForQuery(
  value: unknown,
  queryKeys: ReadonlyArray<string>,
  options: RequestOptions | undefined,
):
  | ({
      [K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query']?: RequestOptions[K];
    } & {
      [
        K in
          | 'method'
          | 'path'
          | 'body'
          | 'stream'
          | 'httpAgent'
          | 'fetchOptions'
          | 'defaultBaseURL'
          | '__metadata'
          | '__binaryRequest'
          | '__binaryResponse'
          | '__streamClass'
          | '__security'
          | '__synthesizeEventData'
      ]?: never;
    })
  | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  // Optional never fields can still be explicitly undefined unless consumers
  // enable exactOptionalPropertyTypes. Snapshot data without invoking getters.
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value)).filter(
    ([, descriptor]) => descriptor.enumerable && (!('value' in descriptor) || descriptor.value !== undefined),
  );
  const keys = entries.map(([key]) => key);
  const requestOnly = keys.some(
    (key) => normalizeRequestOptionsForQueryKeys.has(key) && !queryKeys.includes(key),
  );
  if (!requestOnly) return undefined;
  // Declared query fields, including stream, must use the query argument.
  // Mixing them with request-only options is ambiguous and could change the return type.
  if (
    options !== undefined ||
    keys.some((key) => !normalizeRequestOptionsForQueryKeys.has(key) || queryKeys.includes(key))
  ) {
    throw new TypeError('Query parameters and request options must be passed as separate arguments.');
  }
  // The query position must not gain authority to change the request destination
  // or transport. Those overrides require the explicit request options argument.
  if (
    keys.some(
      (key) => !['headers', 'maxRetries', 'timeout', 'signal', 'idempotencyKey', 'query'].includes(key),
    )
  ) {
    throw new TypeError('Pass transport overrides in the explicit request options argument.');
  }
  // Copy only the validated fields. Spreading value would reintroduce undefined
  // transport overrides, and deleting them would mutate the caller's object.
  return Object.fromEntries(
    entries.map(([key, descriptor]) => {
      if ('value' in descriptor) return [key, descriptor.value];
      return [key, descriptor.get ? Reflect.apply(descriptor.get, value, []) : undefined];
    }),
  ) as {
    [K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query']?: RequestOptions[K];
  } & {
    [
      K in
        | 'method'
        | 'path'
        | 'body'
        | 'stream'
        | 'httpAgent'
        | 'fetchOptions'
        | 'defaultBaseURL'
        | '__metadata'
        | '__binaryRequest'
        | '__binaryResponse'
        | '__streamClass'
        | '__security'
        | '__synthesizeEventData'
    ]?: never;
  };
}

export class Invocations extends APIResource {
  /**
   * Queues a manual delivery without changing the saved schedule.
   *
   * @example
   * ```ts
   * const automationInvocation =
   *   await client.beta.agents.automations.invocations.create(
   *     'automation_id',
   *   );
   * ```
   */
  create(automationID: string, options?: RequestOptions): APIPromise<AutomationInvocation> {
    return this._client.post(
      path`/agents/automations/${automationID}/invocations`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Retrieves a delivery record for a project-owned automation.
   *
   * @example
   * ```ts
   * const automationInvocation =
   *   await client.beta.agents.automations.invocations.retrieve(
   *     'invocation_id',
   *     { automation_id: 'automation_id' },
   *   );
   * ```
   */
  retrieve(
    invocationID: string,
    params: InvocationRetrieveParams,
    options?: RequestOptions,
  ): APIPromise<AutomationInvocation> {
    const { automation_id } = params;
    return this._client.get(
      path`/agents/automations/${automation_id}/invocations/${invocationID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Lists delivery records for a project-owned automation.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const automationInvocation of client.beta.agents.automations.invocations.list(
   *   'automation_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(
    automationID: string,
    query?:
      | (InvocationListParams &
          (
            | {
                [
                  K in
                    | 'method'
                    | 'path'
                    | 'query'
                    | 'body'
                    | 'headers'
                    | 'maxRetries'
                    | 'stream'
                    | 'timeout'
                    | 'httpAgent'
                    | 'fetchOptions'
                    | 'signal'
                    | 'idempotencyKey'
                    | 'defaultBaseURL'
                    | '__metadata'
                    | '__binaryRequest'
                    | '__binaryResponse'
                    | '__streamClass'
                    | '__security'
                    | '__synthesizeEventData'
                ]?: never;
              }
            | null
            | undefined
          ))
      | null
      | undefined,
    options?: RequestOptions,
  ): PagePromise<AutomationInvocationsPage, AutomationInvocation>;
  list(
    automationID: string,
    options?: {
      [K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query']?: RequestOptions[K];
    } & {
      [
        K in
          | 'method'
          | 'path'
          | 'body'
          | 'stream'
          | 'httpAgent'
          | 'fetchOptions'
          | 'defaultBaseURL'
          | '__metadata'
          | '__binaryRequest'
          | '__binaryResponse'
          | '__streamClass'
          | '__security'
          | '__synthesizeEventData'
      ]?: never;
    },
  ): PagePromise<AutomationInvocationsPage, AutomationInvocation>;
  list(
    automationID: string,
    query:
      | InvocationListParams
      | ({
          [
            K in 'headers' | 'maxRetries' | 'timeout' | 'signal' | 'idempotencyKey' | 'query'
          ]?: RequestOptions[K];
        } & {
          [
            K in
              | 'method'
              | 'path'
              | 'body'
              | 'stream'
              | 'httpAgent'
              | 'fetchOptions'
              | 'defaultBaseURL'
              | '__metadata'
              | '__binaryRequest'
              | '__binaryResponse'
              | '__streamClass'
              | '__security'
              | '__synthesizeEventData'
          ]?: never;
        })
      | null
      | undefined = {},
    options?: RequestOptions,
  ): PagePromise<AutomationInvocationsPage, AutomationInvocation> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit', 'order'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as InvocationListParams | null | undefined;
    return this._client.getAPIList(
      path`/agents/automations/${automationID}/invocations`,
      CursorPage<AutomationInvocation>,
      resolveResourceRequestOptions(options, (options) => ({
        query,
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
  }
}

export type AutomationInvocationsPage = CursorPage<AutomationInvocation>;

/**
 * One attempted delivery by an automation.
 */
export interface AutomationInvocation {
  /**
   * The invocation ID.
   */
  id: string;

  /**
   * The automation that owns the invocation.
   */
  automation_id: string;

  /**
   * The creation time as a Unix timestamp in seconds.
   */
  created_at: number;

  /**
   * The permanent delivery failure, or null when no failure occurred.
   */
  error: AutomationInvocation.Error | null;

  /**
   * Always `agent.automation.invocation`.
   */
  object: 'agent.automation.invocation';

  /**
   * The intended occurrence as a Unix timestamp in seconds, or null for manual runs.
   */
  scheduled_at: number | null;

  /**
   * The target or newly created session ID, or null before one is available.
   */
  session_id: string | null;

  /**
   * Why an occurrence was skipped, or null when it was not skipped.
   */
  skip_reason: 'pending_delivery' | null;

  /**
   * Whether the invocation was manual or scheduled.
   */
  source: AutomationInvocationSource;

  /**
   * Delivery status; completed does not mean the agent's work has finished.
   */
  status: 'queued' | 'completed' | 'failed' | 'skipped';
}

export namespace AutomationInvocation {
  /**
   * The permanent delivery failure, or null when no failure occurred.
   */
  export interface Error {
    /**
     * A machine-readable error code.
     */
    code: string;

    /**
     * A public explanation of the delivery failure.
     */
    message: string;
  }
}

export type AutomationInvocationSource =
  | AutomationInvocationSource.AutomationInvocationSourceResourceManual
  | AutomationInvocationSource.AutomationInvocationSourceResourceAutomation;

export namespace AutomationInvocationSource {
  export interface AutomationInvocationSourceResourceManual {
    /**
     * The type of the object. Always `manual`.
     */
    type: 'manual';
  }

  export interface AutomationInvocationSourceResourceAutomation {
    /**
     * The automation snapshot for this occurrence, excluding confidential values.
     */
    automation: AutomationsAPI.Automation;

    /**
     * The type of the object. Always `automation`.
     */
    type: 'automation';
  }
}

export interface InvocationRetrieveParams {
  automation_id: string;
}

export interface InvocationListParams extends CursorPageParams {
  /**
   * The order in which resources are returned. Defaults to `desc`.
   *
   * - `asc` - Returns resources in ascending order.
   * - `desc` - Returns resources in descending order.
   */
  order?: 'asc' | 'desc';
}

export declare namespace Invocations {
  export {
    type AutomationInvocation as AutomationInvocation,
    type AutomationInvocationSource as AutomationInvocationSource,
    type AutomationInvocationsPage as AutomationInvocationsPage,
    type InvocationRetrieveParams as InvocationRetrieveParams,
    type InvocationListParams as InvocationListParams,
  };
}
