// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../../core/resource';
import * as AutomationsAPI from './automations';
import * as AgentsAPI from '../agents';
import * as InvocationsAPI from './invocations';
import {
  AutomationInvocation,
  AutomationInvocationSource,
  AutomationInvocationsPage,
  InvocationListParams,
  InvocationRetrieveParams,
  Invocations,
} from './invocations';
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

export class Automations extends APIResource {
  invocations: InvocationsAPI.Invocations = new InvocationsAPI.Invocations(this._client);

  /**
   * Saves an active automation without invoking it immediately.
   *
   * @example
   * ```ts
   * const automation =
   *   await client.beta.agents.automations.create({
   *     expression: 'x',
   *     name: 'x',
   *     target: {
   *       environment: { type: 'none' },
   *       input: [
   *         {
   *           content: [{ text: 'text', type: 'input_text' }],
   *           role: 'user',
   *         },
   *       ],
   *       type: 'new_session',
   *     },
   *     timezone: 'x',
   *     type: 'periodic',
   *   });
   * ```
   */
  create(body: AutomationCreateParams, options?: RequestOptions): APIPromise<Automation> {
    return this._client.post(
      '/agents/automations',
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Retrieves a project-owned automation.
   *
   * @example
   * ```ts
   * const automation =
   *   await client.beta.agents.automations.retrieve(
   *     'automation_id',
   *   );
   * ```
   */
  retrieve(automationID: string, options?: RequestOptions): APIPromise<Automation> {
    return this._client.get(
      path`/agents/automations/${automationID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Updates supplied fields; target and metadata replace the whole field.
   *
   * @example
   * ```ts
   * const automation =
   *   await client.beta.agents.automations.update(
   *     'automation_id',
   *   );
   * ```
   */
  update(
    automationID: string,
    body: AutomationUpdateParams,
    options?: RequestOptions,
  ): APIPromise<Automation> {
    return this._client.post(
      path`/agents/automations/${automationID}`,
      resolveResourceRequestOptions(options, (options) => ({
        body,
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Lists project-owned automations, optionally filtered by target session.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const automation of client.beta.agents.automations.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query?:
      | (AutomationListParams &
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
  ): PagePromise<AutomationsPage, Automation>;
  list(
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
  ): PagePromise<AutomationsPage, Automation>;
  list(
    query:
      | AutomationListParams
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
  ): PagePromise<AutomationsPage, Automation> {
    const normalizeRequestOptionsForQueryOptions = normalizeRequestOptionsForQuery(
      query,
      ['after', 'limit', 'order', 'session_id'],
      options,
    );
    if (normalizeRequestOptionsForQueryOptions !== undefined) {
      options = normalizeRequestOptionsForQueryOptions;
      query = {};
    }
    query = query as AutomationListParams | null | undefined;
    return this._client.getAPIList(
      '/agents/automations',
      CursorPage<Automation>,
      resolveResourceRequestOptions(options, (options) => ({
        query,
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Deletes the automation and prevents future invocations without deleting its
   * target session.
   *
   * @example
   * ```ts
   * const automationDeleted =
   *   await client.beta.agents.automations.delete(
   *     'automation_id',
   *   );
   * ```
   */
  delete(automationID: string, options?: RequestOptions): APIPromise<AutomationDeleted> {
    return this._client.delete(
      path`/agents/automations/${automationID}`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Pauses future scheduled delivery without stopping an active session.
   *
   * @example
   * ```ts
   * const automation =
   *   await client.beta.agents.automations.pause(
   *     'automation_id',
   *   );
   * ```
   */
  pause(automationID: string, options?: RequestOptions): APIPromise<Automation> {
    return this._client.post(
      path`/agents/automations/${automationID}/pause`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
  }

  /**
   * Resumes scheduled delivery; one-time automations without a pending invocation
   * require a future run_at.
   *
   * @example
   * ```ts
   * const automation =
   *   await client.beta.agents.automations.resume(
   *     'automation_id',
   *   );
   * ```
   */
  resume(automationID: string, options?: RequestOptions): APIPromise<Automation> {
    return this._client.post(
      path`/agents/automations/${automationID}/resume`,
      resolveResourceRequestOptions(options, (options) => ({
        ...options,
        headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
        __security: { bearerAuth: true },
      })),
    );
  }
}

export type AutomationsPage = CursorPage<Automation>;

/**
 * A saved automation and its schedule.
 */
export type Automation = PeriodicAutomation | OneTimeAutomation;

/**
 * Inline agent configuration without a generated session-local identity.
 */
export interface AutomationAgentConfig {
  /**
   * Custom instructions, or null when absent.
   */
  instructions: string | null;

  /**
   * The requested model name.
   */
  model: string;

  /**
   * The configuration for creating and coordinating subagents.
   */
  multi_agent: AgentsAPI.MultiAgentConfig;

  /**
   * The configured reasoning policy.
   */
  reasoning: AgentsAPI.AgentReasoning;

  /**
   * The configured service-tier policy.
   */
  service_tier: 'auto' | 'default' | 'flex' | 'priority' | 'fast' | 'ultrafast';

  /**
   * The configured output format and verbosity.
   */
  text: AgentsAPI.AgentText;

  /**
   * Configured tools, excluding confidential credentials.
   */
  tools: Array<AgentsAPI.AgentTool>;
}

/**
 * How the automation was created, independently of how an invocation started.
 */
export type AutomationCreatedBy =
  | AutomationCreatedBy.AutomationCreatedByResourceDeveloper
  | AutomationCreatedBy.AutomationCreatedByResourceAgent;

export namespace AutomationCreatedBy {
  export interface AutomationCreatedByResourceDeveloper {
    /**
     * The type of the object. Always `developer`.
     */
    type: 'developer';
  }

  export interface AutomationCreatedByResourceAgent {
    /**
     * The creator session, which is also the automation's target.
     */
    session_id: string;

    /**
     * The tool call that created the automation.
     */
    tool_call_id: string;

    /**
     * The type of the object. Always `agent`.
     */
    type: 'agent';
  }
}

export interface AutomationDeleted {
  /**
   * The deleted automation ID.
   */
  id: string;

  /**
   * Always true.
   */
  deleted: boolean;

  /**
   * Always `agent.automation.deleted`.
   */
  object: 'agent.automation.deleted';
}

/**
 * Environment selection saved before an invocation creates its session.
 */
export type AutomationEnvironment =
  | AutomationEnvironment.AutomationEnvironmentResourceNone
  | AutomationEnvironment.AutomationEnvironmentResourceOpenAIHosted
  | AutomationEnvironment.AutomationEnvironmentResourceSelfHosted;

export namespace AutomationEnvironment {
  export interface AutomationEnvironmentResourceNone {
    /**
     * The type of the object. Always `none`.
     */
    type: 'none';
  }

  /**
   * Hosted environment selection with confidential setup commands and variables
   * omitted.
   */
  export interface AutomationEnvironmentResourceOpenAIHosted {
    /**
     * Directory overrides, or null to inherit the template or creation default.
     */
    capability_directories: Array<string> | null;

    /**
     * The configured container size, or null to use the creation default.
     */
    container_size: 'small' | 'medium' | 'large' | null;

    /**
     * Desktop overrides, or null to inherit the template or creation default.
     */
    desktop: AutomationEnvironmentResourceOpenAIHosted.Desktop | null;

    /**
     * An existing environment reference, or null when provisioning a new environment.
     */
    environment_id: string | null;

    /**
     * A template reference, or null when no template is selected.
     */
    environment_template_id: string | null;

    /**
     * File overrides, excluding contents, or null to inherit.
     */
    files: Array<
      | AutomationEnvironmentResourceOpenAIHosted.HostedTemplateFileResourceFileID
      | AutomationEnvironmentResourceOpenAIHosted.HostedTemplateFileResourceInline
    > | null;

    /**
     * Network overrides, or null to inherit the template or creation default.
     */
    network: AutomationEnvironmentResourceOpenAIHosted.Network | null;

    /**
     * Package overrides, or null to inherit the template or creation default.
     */
    packages: AutomationEnvironmentResourceOpenAIHosted.Packages | null;

    /**
     * Plugin overrides, excluding archive contents, or null to inherit.
     */
    plugins: Array<AgentsAPI.HostedPlugin> | null;

    /**
     * Skill overrides, excluding archive contents, or null to inherit.
     */
    skills: Array<
      | AutomationEnvironmentResourceOpenAIHosted.HostedTemplateSkillResourceSkillReference
      | AutomationEnvironmentResourceOpenAIHosted.HostedTemplateSkillResourceInline
    > | null;

    /**
     * The type of the object. Always `openai_hosted`.
     */
    type: 'openai_hosted';
  }

  export namespace AutomationEnvironmentResourceOpenAIHosted {
    /**
     * Desktop overrides, or null to inherit the template or creation default.
     */
    export interface Desktop {
      /**
       * Whether the environment provisions a desktop and browser proxy.
       */
      enabled: boolean;
    }

    /**
     * A project-scoped Files API reference resolved separately for each session.
     */
    export interface HostedTemplateFileResourceFileID {
      /**
       * The ID of the uploaded file.
       */
      file_id: string;

      /**
       * The file's absolute path inside the environment.
       */
      path: string;

      /**
       * The type of the object. Always `file_id`.
       */
      type: 'file_id';
    }

    /**
     * Metadata for confidential inline file contents.
     */
    export interface HostedTemplateFileResourceInline {
      /**
       * The file's absolute path inside the environment.
       */
      path: string;

      /**
       * The decoded size of the inline file in bytes.
       */
      size_bytes: number;

      /**
       * The type of the object. Always `inline`.
       */
      type: 'inline';
    }

    /**
     * Network overrides, or null to inherit the template or creation default.
     */
    export interface Network {
      /**
       * The environment's network access mode.
       *
       * - `enabled` - Allows unrestricted network access.
       * - `disabled` - Disables network access.
       * - `restricted` - Applies the configured domain restrictions.
       */
      access: 'enabled' | 'disabled' | 'restricted';

      /**
       * Domains the environment may access when network access is restricted.
       */
      allowed_domains: Array<string>;
    }

    /**
     * Package overrides, or null to inherit the template or creation default.
     */
    export interface Packages {
      /**
       * npm packages installed globally in the environment.
       */
      npm: Array<string>;

      /**
       * Python packages installed in the environment.
       */
      python: Array<string>;

      /**
       * System packages installed in the environment.
       */
      system: Array<string>;
    }

    /**
     * A skill resolved afresh from the Skills API whenever a session starts.
     */
    export interface HostedTemplateSkillResourceSkillReference {
      /**
       * The referenced skill ID.
       */
      skill_id: string;

      /**
       * The type of the object. Always `skill_reference`.
       */
      type: 'skill_reference';

      /**
       * The requested version selector, including `latest`.
       */
      version: string | null;
    }

    /**
     * Safe metadata for an inline skill archive.
     */
    export interface HostedTemplateSkillResourceInline {
      /**
       * The skill description declared in `SKILL.md`.
       */
      description: string;

      /**
       * The skill name declared in `SKILL.md`.
       */
      name: string;

      /**
       * The type of the object. Always `inline`.
       */
      type: 'inline';
    }
  }

  export interface AutomationEnvironmentResourceSelfHosted {
    /**
     * Directories that expose capabilities to the agent.
     */
    capability_directories: Array<string>;

    /**
     * An existing registration, or null to create a session-owned environment.
     */
    environment_id: string | null;

    /**
     * The type of the object. Always `self_hosted`.
     */
    type: 'self_hosted';

    /**
     * The absolute project directory in the environment.
     */
    workspace_directory: string;
  }
}

/**
 * Saved target configuration, excluding confidential request-only values.
 */
export type AutomationTarget =
  | AutomationTarget.AutomationTargetResourceNewSession
  | AutomationTarget.AutomationTargetResourceExistingSession;

export namespace AutomationTarget {
  export interface AutomationTargetResourceNewSession {
    /**
     * The inline agent configuration, or null when agent_id is configured.
     */
    agent: AutomationsAPI.AutomationAgentConfig | null;

    /**
     * The saved agent reference, or null when an inline agent is configured.
     */
    agent_id: string | null;

    /**
     * Configuration or references used to select the execution environment.
     */
    environment: AutomationsAPI.AutomationEnvironment;

    /**
     * Initial input delivered to each new session.
     */
    input: Array<AutomationTargetResourceNewSession.Input>;

    /**
     * Metadata attached to each new session.
     */
    metadata: { [key: string]: string };

    /**
     * The type of the object. Always `new_session`.
     */
    type: 'new_session';

    /**
     * Vaults made available to each new session.
     */
    vault_ids: Array<string>;
  }

  export namespace AutomationTargetResourceNewSession {
    /**
     * A user message recorded in a session.
     */
    export interface Input {
      /**
       * The content of the message.
       */
      content: Array<AgentsAPI.InputContent>;

      /**
       * The role of the message author. Always `user`.
       */
      role: 'user';

      /**
       * The type of the input item. Always `message`.
       */
      type: 'message';
    }
  }

  export interface AutomationTargetResourceExistingSession {
    /**
     * Saved instructions delivered as an automation notification.
     */
    instructions: string;

    /**
     * The session receiving each invocation.
     */
    session_id: string;

    /**
     * The type of the object. Always `existing_session`.
     */
    type: 'existing_session';
  }
}

/**
 * The session an automation invocation targets.
 */
export type AutomationTargetParam =
  | AutomationTargetParam.AutomationTargetParamNewSession
  | AutomationTargetParam.AutomationTargetParamExistingSession;

export namespace AutomationTargetParam {
  /**
   * Create a session for each invocation.
   */
  export interface AutomationTargetParamNewSession {
    /**
     * The execution environment for each new session.
     */
    environment: AgentsAPI.EnvironmentParam;

    /**
     * Initial user messages submitted with each new session.
     */
    input: Array<AgentsAPI.AgentSessionInputMessageParam>;

    /**
     * The type of the object. Always `new_session`.
     */
    type: 'new_session';

    /**
     * Inline agent configuration. Provide exactly one of agent and agent_id.
     */
    agent?: AutomationTargetParamNewSession.Agent;

    /**
     * A saved agent ID. Provide exactly one of agent and agent_id.
     */
    agent_id?: string;

    /**
     * Metadata attached to each new session.
     */
    metadata?: { [key: string]: string } | null;

    /**
     * The IDs of vaults made available to each new session.
     */
    vault_ids?: Array<string> | null;
  }

  export namespace AutomationTargetParamNewSession {
    /**
     * Inline agent configuration. Provide exactly one of agent and agent_id.
     */
    export interface Agent {
      /**
       * Additional instructions appended to the agent's default base instructions. Omit
       * to leave unchanged.
       */
      instructions?: string | null;

      /**
       * The model to use for the agent. The requested model name is preserved.
       */
      model?: string;

      /**
       * Configuration for creating and coordinating subagents.
       */
      multi_agent?: AgentsAPI.MultiAgentConfigParam | null;

      /**
       * Configuration for model reasoning. Omit to keep the current settings; pass
       * `null` to reset to the model's default effort.
       */
      reasoning?: AgentsAPI.AgentReasoningParam | null;

      /**
       * The service tier used for model requests.
       *
       * - `auto` - Selects the service tier automatically.
       * - `default` - Uses the default service tier.
       * - `flex` - Uses the flex service tier.
       * - `priority` - Uses the priority service tier.
       * - `fast` - Uses the fast service tier.
       * - `ultrafast` - Uses the ultrafast service tier.
       */
      service_tier?: 'auto' | 'default' | 'flex' | 'priority' | 'fast' | 'ultrafast' | null;

      /**
       * Configuration for text generated by the agent.
       */
      text?: AgentsAPI.AgentTextParam | null;

      /**
       * Tools available to the agent. Omit to inherit, or pass null to clear them. The
       * resolved tool list must fit within 3 MiB (3,145,728 bytes) of compact UTF-8
       * JSON.
       */
      tools?: Array<AgentsAPI.AgentToolParam> | null;
    }
  }

  /**
   * Deliver instructions to an existing session.
   */
  export interface AutomationTargetParamExistingSession {
    /**
     * Instructions delivered as an automation notification.
     */
    instructions: string;

    /**
     * The session receiving each invocation.
     */
    session_id: string;

    /**
     * The type of the object. Always `existing_session`.
     */
    type: 'existing_session';
  }
}

/**
 * Fields shared by periodic and one-time automations.
 */
export interface OneTimeAutomation {
  /**
   * The automation ID.
   */
  id: string;

  /**
   * The creation time as a Unix timestamp in seconds.
   */
  created_at: number;

  /**
   * Service-recorded provenance; callers cannot supply this field.
   */
  created_by: AutomationCreatedBy;

  /**
   * Custom string key-value pairs attached to the automation.
   */
  metadata: { [key: string]: string };

  /**
   * The automation's display name.
   */
  name: string;

  /**
   * Always `agent.automation`.
   */
  object: 'agent.automation';

  /**
   * The Unix timestamp, in seconds, of the scheduled occurrence.
   */
  run_at: number;

  /**
   * Completion means the schedule has finished, not the agent's work.
   */
  status: 'active' | 'paused' | 'completed';

  /**
   * The session configuration or existing session receiving invocations.
   */
  target: AutomationTarget;

  /**
   * The type of the object. Always `once`.
   */
  type: 'once';
}

/**
 * Fields shared by periodic and one-time automations.
 */
export interface PeriodicAutomation {
  /**
   * The automation ID.
   */
  id: string;

  /**
   * The creation time as a Unix timestamp in seconds.
   */
  created_at: number;

  /**
   * Service-recorded provenance; callers cannot supply this field.
   */
  created_by: AutomationCreatedBy;

  /**
   * The cron expression determining scheduled occurrences.
   */
  expression: string;

  /**
   * Custom string key-value pairs attached to the automation.
   */
  metadata: { [key: string]: string };

  /**
   * The automation's display name.
   */
  name: string;

  /**
   * Always `agent.automation`.
   */
  object: 'agent.automation';

  /**
   * Whether scheduled delivery is active or paused.
   */
  status: 'active' | 'paused';

  /**
   * The session configuration or existing session receiving invocations.
   */
  target: AutomationTarget;

  /**
   * The timezone used to interpret the expression.
   */
  timezone: string;

  /**
   * The type of the object. Always `periodic`.
   */
  type: 'periodic';
}

export type AutomationCreateParams = CreateAutomationParamsPeriodic | CreateAutomationParamsOnce;

export interface AutomationCreateParamsBase {
  /**
   * A standard five-field cron expression defining scheduled occurrences.
   */
  expression: string;

  /**
   * A human-readable name for the automation.
   */
  name: string;

  /**
   * The session an automation invocation targets.
   */
  target: AutomationTargetParam;

  /**
   * The IANA timezone used to interpret the cron expression.
   */
  timezone: string;

  /**
   * The type of the object. Always `periodic`.
   */
  type: 'periodic';

  metadata?: { [key: string]: string };
}

export interface CreateAutomationParamsPeriodic extends AutomationCreateParamsBase {}

export interface CreateAutomationParamsOnce {
  /**
   * A human-readable name for the automation.
   */
  name: string;

  /**
   * A future Unix timestamp in seconds.
   */
  run_at: number;

  /**
   * The session an automation invocation targets.
   */
  target: AutomationTargetParam;

  /**
   * The type of the object. Always `once`.
   */
  type: 'once';

  metadata?: { [key: string]: string };
}

export interface AutomationUpdateParams {
  /**
   * Only accepted for periodic automations.
   */
  expression?: string;

  /**
   * Replaces all metadata; omit to leave unchanged.
   */
  metadata?: { [key: string]: string };

  name?: string;

  /**
   * A future Unix timestamp in seconds; accepted only before a one-time scheduled
   * invocation exists.
   */
  run_at?: number;

  /**
   * Replaces the complete target, retaining its type and any creator session.
   */
  target?: AutomationTargetParam;

  /**
   * Only accepted for periodic automations.
   */
  timezone?: string;
}

export interface AutomationListParams extends CursorPageParams {
  /**
   * The order in which resources are returned. Defaults to `desc`.
   *
   * - `asc` - Returns resources in ascending order.
   * - `desc` - Returns resources in descending order.
   */
  order?: 'asc' | 'desc';

  /**
   * Matches existing-session targets, including agent-created automations.
   */
  session_id?: string;
}

Automations.Invocations = Invocations;

export declare namespace Automations {
  export {
    type Automation as Automation,
    type AutomationAgentConfig as AutomationAgentConfig,
    type AutomationCreatedBy as AutomationCreatedBy,
    type AutomationDeleted as AutomationDeleted,
    type AutomationEnvironment as AutomationEnvironment,
    type AutomationTarget as AutomationTarget,
    type AutomationTargetParam as AutomationTargetParam,
    type OneTimeAutomation as OneTimeAutomation,
    type PeriodicAutomation as PeriodicAutomation,
    type CreateAutomationParamsPeriodic as CreateAutomationParamsPeriodic,
    type CreateAutomationParamsOnce as CreateAutomationParamsOnce,
    type AutomationsPage as AutomationsPage,
    type AutomationCreateParams as AutomationCreateParams,
    type AutomationUpdateParams as AutomationUpdateParams,
    type AutomationListParams as AutomationListParams,
  };

  export {
    Invocations as Invocations,
    type AutomationInvocation as AutomationInvocation,
    type AutomationInvocationSource as AutomationInvocationSource,
    type AutomationInvocationsPage as AutomationInvocationsPage,
    type InvocationRetrieveParams as InvocationRetrieveParams,
    type InvocationListParams as InvocationListParams,
  };
}
