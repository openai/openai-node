// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { APIResource } from '../../../core/resource';
import * as AgentsAPI from './agents';
import * as TurnsAPI from './sessions/turns';
import * as EnvironmentsAPI from './environments/environments';
import { EnvironmentInfo, Environments } from './environments/environments';
import * as SessionsAPI from './sessions/sessions';
import {
  SessionCreateParams,
  SessionCreateParamsNonStreaming,
  SessionCreateParamsStreaming,
  SessionListParams,
  SessionUpdateParams,
  Sessions,
} from './sessions/sessions';
import * as VaultsAPI from './vaults/vaults';
import {
  Vault,
  VaultCreateParams,
  VaultDeleted,
  VaultListParams,
  VaultStatus,
  VaultStatusFilter,
  Vaults,
  VaultsPage,
} from './vaults/vaults';
import { APIPromise } from '../../../core/api-promise';
import { CursorPage, type CursorPageParams, PagePromise } from '../../../core/pagination';
import { buildHeaders } from '../../../internal/headers';
import { RequestOptions } from '../../../internal/request-options';
import { path } from '../../../internal/utils/path';

export class Agents extends APIResource {
  environments: EnvironmentsAPI.Environments = new EnvironmentsAPI.Environments(this._client);
  vaults: VaultsAPI.Vaults = new VaultsAPI.Vaults(this._client);
  sessions: SessionsAPI.Sessions = new SessionsAPI.Sessions(this._client);

  /**
   * Creates a reusable agent without storing credentials. See
   * [agent configuration](https://developers.openai.com/api/docs/guides/agents-api/configuration).
   *
   * @example
   * ```ts
   * const agent = await client.beta.agents.create({
   *   model: 'model',
   * });
   * ```
   */
  create(body: AgentCreateParams, options?: RequestOptions): APIPromise<Agent> {
    return this._client.post('/agents', {
      body,
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Retrieves a reusable agent by ID. See
   * [agent configuration](https://developers.openai.com/api/docs/guides/agents-api/configuration).
   *
   * @example
   * ```ts
   * const agent = await client.beta.agents.retrieve('agent_id');
   * ```
   */
  retrieve(agentID: string, options?: RequestOptions): APIPromise<Agent> {
    return this._client.get(path`/agents/${agentID}`, {
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Updates a reusable agent. See
   * [agent configuration](https://developers.openai.com/api/docs/guides/agents-api/configuration).
   *
   * @example
   * ```ts
   * const agent = await client.beta.agents.update('agent_id');
   * ```
   */
  update(
    agentID: string,
    body: AgentUpdateParams | null | undefined = {},
    options?: RequestOptions,
  ): APIPromise<Agent> {
    return this._client.post(path`/agents/${agentID}`, {
      body,
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Lists reusable agents in the current project. See
   * [agent configuration](https://developers.openai.com/api/docs/guides/agents-api/configuration).
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const agent of client.beta.agents.list()) {
   *   // ...
   * }
   * ```
   */
  list(
    query: AgentListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<AgentsPage, Agent> {
    return this._client.getAPIList('/agents', CursorPage<Agent>, {
      query,
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }

  /**
   * Deletes a reusable agent. See
   * [agent configuration](https://developers.openai.com/api/docs/guides/agents-api/configuration).
   *
   * @example
   * ```ts
   * const agentDeleted = await client.beta.agents.delete(
   *   'agent_id',
   * );
   * ```
   */
  delete(agentID: string, options?: RequestOptions): APIPromise<AgentDeleted> {
    return this._client.delete(path`/agents/${agentID}`, {
      ...options,
      headers: buildHeaders([{ 'OpenAI-Beta': 'agents=v1' }, options?.headers]),
      __security: { bearerAuth: true },
    });
  }
}

export type AgentsPage = CursorPage<Agent>;

export type AgentSessionsPage = CursorPage<AgentSession>;

export type SubagentsPage = CursorPage<Subagent>;

export type AgentSessionItemsPage = CursorPage<AgentSessionItem>;

/**
 * A reusable agent scoped to the caller's project.
 */
export interface Agent {
  /**
   * The ID of the reusable agent.
   */
  id: string;

  /**
   * The Unix timestamp, in seconds, when the agent was created.
   */
  created_at: number;

  /**
   * Custom instructions appended to the agent's default base instructions.
   */
  instructions: string | null;

  /**
   * Custom string key-value pairs attached to the agent.
   */
  metadata: { [key: string]: string };

  /**
   * The requested model name used for inference.
   */
  model: string;

  /**
   * The resolved configuration for creating and coordinating subagents.
   */
  multi_agent: MultiAgentConfig;

  /**
   * A human-readable name for the agent, or null if it is unnamed.
   */
  name: string | null;

  /**
   * The object type. Always `agent`.
   */
  object: 'agent';

  /**
   * The resolved reasoning configuration, including the model default for an omitted
   * effort.
   */
  reasoning: AgentReasoning;

  /**
   * The resolved service-tier policy used for model requests.
   */
  service_tier: 'auto' | 'default' | 'flex' | 'priority' | 'fast';

  /**
   * The resolved configuration for text generated by the agent.
   */
  text: AgentText;

  /**
   * Tools available to the agent.
   */
  tools: Array<PersistedAgentTool>;

  /**
   * The Unix timestamp, in seconds, when the agent was last updated.
   */
  updated_at: number;
}

/**
 * A request to close a subagent.
 */
export interface AgentCloseSubagentCallItem {
  /**
   * The ID of the tool call item.
   */
  id: string;

  /**
   * The ID of the agent to close.
   */
  recipient_agent_id: string;

  /**
   * The ID of the agent requesting the close.
   */
  sender_agent_id: string;

  /**
   * The status of the tool call.
   */
  status: AgentFunctionCallStatus;

  /**
   * The ID of the turn that contains this item.
   */
  turn_id: string;

  /**
   * The item type. Always `close_subagent_call`.
   */
  type: 'close_subagent_call';
}

/**
 * A command execution produced by the agent.
 */
export interface AgentCommandExecutionItem {
  /**
   * The ID of the command execution item.
   */
  id: string;

  /**
   * The command that was executed.
   */
  command: string;

  /**
   * The working directory used to execute the command.
   */
  cwd: string | null;

  /**
   * The command duration in milliseconds.
   */
  duration_ms: number | null;

  /**
   * The process exit code, if the command completed.
   */
  exit_code: number | null;

  /**
   * The command output, if available.
   */
  output: string | null;

  /**
   * The status of the command execution.
   */
  status: AgentFunctionCallStatus;

  /**
   * The ID of the turn that contains this item.
   */
  turn_id: string;

  /**
   * The item type. Always `command_execution`.
   */
  type: 'command_execution';
}

/**
 * A plaintext or encrypted content part exchanged between agents.
 */
export type AgentContent = OutputText | AgentContent.EncryptedContentResource;

export namespace AgentContent {
  /**
   * Encrypted content exchanged between agents.
   */
  export interface EncryptedContentResource {
    /**
     * The encrypted content payload.
     */
    encrypted_content: string;

    /**
     * The content type. Always `encrypted_content`.
     */
    type: 'encrypted_content';
  }
}

/**
 * A request to spawn a subagent.
 */
export interface AgentCreateSubagentCallItem {
  /**
   * The ID of the tool call item.
   */
  id: string;

  /**
   * The ID of the agent that requested the subagent.
   */
  agent_id: string;

  /**
   * The task given to the spawned agent.
   */
  content: Array<AgentContent>;

  /**
   * The model requested for the spawned agent.
   */
  model: string | null;

  /**
   * The reasoning effort requested for the spawned agent.
   */
  reasoning_effort: string | null;

  /**
   * The status of the tool call.
   */
  status: AgentFunctionCallStatus;

  /**
   * The ID of the turn that contains this item.
   */
  turn_id: string;

  /**
   * The item type. Always `create_subagent_call`.
   */
  type: 'create_subagent_call';
}

/**
 * A deleted reusable agent.
 */
export interface AgentDeleted {
  /**
   * The ID of the deleted agent.
   */
  id: string;

  /**
   * Whether the agent was deleted. Always `true`.
   */
  deleted: boolean;

  /**
   * The object type. Always `agent.deleted`.
   */
  object: 'agent.deleted';
}

/**
 * A function call produced by the agent.
 */
export interface AgentFunctionCallItem {
  /**
   * The ID of the function call item.
   */
  id: string;

  /**
   * The arguments to pass to the function.
   */
  arguments: unknown;

  /**
   * The ID used to submit the function result.
   */
  call_id: string;

  /**
   * The name of the function to call.
   */
  name: string;

  /**
   * The status of the function call.
   */
  status: AgentFunctionCallStatus;

  /**
   * The ID of the turn that contains this item.
   */
  turn_id: string;

  /**
   * The item type. Always `function_call`.
   */
  type: 'function_call';
}

/**
 * The text or model-input content supplied as a function result.
 */
export type AgentFunctionCallOutput = string | Array<InputContent>;

/**
 * A function result represented as text or supported model-input content.
 */
export type AgentFunctionCallOutputParam = string | Array<InputContentParam>;

/**
 * The status of a tool call.
 *
 * - `in_progress` - The call is in progress.
 * - `completed` - The call completed successfully.
 * - `failed` - The call failed.
 * - `incomplete` - The call stopped before completing.
 */
export type AgentFunctionCallStatus = 'in_progress' | 'completed' | 'failed' | 'incomplete';

/**
 * A request to interrupt a subagent's current turn. The subagent remains
 * available.
 */
export interface AgentInterruptSubagentCallItem {
  /**
   * The ID of the tool call item.
   */
  id: string;

  /**
   * The ID of the agent to interrupt.
   */
  recipient_agent_id: string;

  /**
   * The ID of the agent requesting the interrupt.
   */
  sender_agent_id: string;

  /**
   * The status of the tool call.
   */
  status: AgentFunctionCallStatus;

  /**
   * The ID of the turn that contains this item.
   */
  turn_id: string;

  /**
   * The item type. Always `interrupt_subagent_call`.
   */
  type: 'interrupt_subagent_call';
}

/**
 * A call to a tool on an MCP server.
 */
export interface AgentMcpCallItem {
  /**
   * The ID of the MCP call item.
   */
  id: string;

  /**
   * The arguments passed to the MCP tool.
   */
  arguments: unknown;

  /**
   * The error returned by the MCP tool, if any.
   */
  error: unknown;

  /**
   * The name of the MCP tool.
   */
  name: string;

  /**
   * The output returned by the MCP tool, if any.
   */
  output: unknown;

  /**
   * The label of the MCP server.
   */
  server_label: string;

  /**
   * The status of the MCP tool call.
   */
  status: AgentFunctionCallStatus;

  /**
   * The ID of the turn that contains this item.
   */
  turn_id: string;

  /**
   * The item type. Always `mcp_call`.
   */
  type: 'mcp_call';
}

/**
 * Emitted when command execution produces an output delta.
 */
export interface AgentOutputCommandExecutionOutputDeltaEvent {
  /**
   * The output text that was appended.
   */
  delta: string;

  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the command execution item.
   */
  item_id: string;

  /**
   * The index of the item in the turn output.
   */
  output_index: number;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always `agent.output.command_execution_output.delta`.
   */
  type: 'agent.output.command_execution_output.delta';
}

/**
 * An output item produced by an agent.
 */
export type AgentOutputItem =
  | AgentSessionAssistantMessage
  | AgentReasoningItem
  | AgentFunctionCallItem
  | AgentMcpCallItem
  | AgentWebSearchCallItem
  | AgentCommandExecutionItem
  | AgentCreateSubagentCallItem
  | AgentSendSubagentInputCallItem
  | AgentResumeSubagentCallItem
  | AgentWaitForSubagentsCallItem
  | AgentInterruptSubagentCallItem
  | AgentCloseSubagentCallItem;

/**
 * The status of an agent output item.
 *
 * - `in_progress` - The item is in progress.
 * - `completed` - The item is complete.
 * - `incomplete` - The item stopped before completing.
 */
export type AgentOutputItemStatus = 'in_progress' | 'completed' | 'incomplete';

/**
 * The reasoning configuration used by an agent.
 */
export interface AgentReasoning {
  /**
   * The amount of reasoning effort used by an agent.
   */
  effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null;

  /**
   * The reasoning summary format requested from an agent.
   *
   * - `concise` - Returns a concise reasoning summary when supported.
   * - `detailed` - Returns a detailed reasoning summary when supported.
   * - `auto` - Automatically selects the most detailed summary supported by the
   *   model.
   */
  summary: 'concise' | 'detailed' | 'auto' | null;
}

/**
 * A reasoning item produced by the agent.
 */
export interface AgentReasoningItem {
  /**
   * The ID of the reasoning item.
   */
  id: string;

  /**
   * The status of an agent output item.
   */
  status: AgentOutputItemStatus | null;

  /**
   * The reasoning summaries produced by the agent.
   */
  summary: Array<SummaryText>;

  /**
   * The ID of the turn that contains this item.
   */
  turn_id: string;

  /**
   * The item type. Always `reasoning`.
   */
  type: 'reasoning';
}

/**
 * Reasoning configuration for the agent.
 */
export interface AgentReasoningParam {
  /**
   * The amount of reasoning effort the model should use.
   */
  effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null;

  /**
   * The reasoning summary format requested from the model.
   *
   * - `concise` - Returns a concise reasoning summary when supported.
   * - `detailed` - Returns a detailed reasoning summary when supported.
   * - `auto` - Automatically selects the most detailed summary supported by the
   *   model.
   */
  summary?: 'concise' | 'detailed' | 'auto' | null;
}

/**
 * A request to resume a subagent.
 */
export interface AgentResumeSubagentCallItem {
  /**
   * The ID of the tool call item.
   */
  id: string;

  /**
   * The ID of the agent to resume.
   */
  recipient_agent_id: string;

  /**
   * The ID of the agent requesting the resume.
   */
  sender_agent_id: string;

  /**
   * The status of the tool call.
   */
  status: AgentFunctionCallStatus;

  /**
   * The ID of the turn that contains this item.
   */
  turn_id: string;

  /**
   * The item type. Always `resume_subagent_call`.
   */
  type: 'resume_subagent_call';
}

/**
 * A request to send input to another agent.
 */
export interface AgentSendSubagentInputCallItem {
  /**
   * The ID of the tool call item.
   */
  id: string;

  /**
   * The input sent to the receiving agent.
   */
  content: Array<AgentContent>;

  /**
   * The ID of the agent receiving the input.
   */
  recipient_agent_id: string;

  /**
   * The ID of the agent sending the input.
   */
  sender_agent_id: string;

  /**
   * The status of the tool call.
   */
  status: AgentFunctionCallStatus;

  /**
   * The ID of the turn that contains this item.
   */
  turn_id: string;

  /**
   * The item type. Always `send_subagent_input_call`.
   */
  type: 'send_subagent_input_call';
}

/**
 * A Managed Agents session.
 */
export interface AgentSession {
  /**
   * The ID of the session.
   */
  id: string;

  /**
   * The agent running in the session.
   */
  agent: AgentSession.Agent;

  /**
   * The Unix timestamp, in seconds, when the session was created.
   */
  created_at: number;

  /**
   * The execution environment for the session.
   */
  environment: Environment;

  /**
   * The error that caused the session to fail, if any.
   */
  error: string | null;

  /**
   * The Unix timestamp, in seconds, when the session was last active.
   */
  last_active_at: number;

  /**
   * Custom string key-value pairs attached to the session.
   */
  metadata: { [key: string]: string };

  /**
   * The object type. Always `agent.session`.
   */
  object: 'agent.session';

  /**
   * Actions that must be completed before the session can continue.
   */
  required_actions: Array<
    | AgentSession.SessionRequiredActionResourceFunctionCall
    | AgentSession.SessionRequiredActionResourceEnvironmentConnection
  >;

  /**
   * The current status of the session.
   *
   * - `idle` - The session has no turn in progress and is ready for input. A hosted
   *   environment may still be provisioning.
   * - `in_progress` - The session is processing a turn.
   * - `requires_action` - The session is waiting for one or more required actions.
   * - `failed` - The session failed.
   */
  status: 'idle' | 'in_progress' | 'requires_action' | 'failed';

  /**
   * Recorded token usage for a session or turn. Usage is best effort and may change.
   */
  usage: TokenUsage | null;

  /**
   * The IDs of vaults made available to the session.
   */
  vault_ids: Array<string>;
}

export namespace AgentSession {
  /**
   * The agent running in the session.
   */
  export interface Agent {
    /**
     * The ID of the agent.
     */
    id: string;

    /**
     * Custom instructions appended to the agent's default base instructions.
     */
    instructions: string | null;

    /**
     * The model used by the agent.
     */
    model: string;

    /**
     * Configuration for creating and coordinating subagents.
     */
    multi_agent: AgentsAPI.MultiAgentConfig;

    /**
     * The reusable agent's name when the session was created, or null if no name was
     * saved. Later changes to the agent's name do not affect this value.
     */
    name: string | null;

    /**
     * The agent's reasoning configuration.
     */
    reasoning: AgentsAPI.AgentReasoning;

    /**
     * The effective service-tier policy for model requests. Defaults to `auto`.
     */
    service_tier: 'auto' | 'default' | 'flex' | 'priority' | 'fast';

    /**
     * Configuration for text generated by the agent.
     */
    text: AgentsAPI.AgentText;

    /**
     * Tools available to the agent.
     */
    tools: Array<AgentsAPI.AgentTool>;
  }

  /**
   * Run a function tool and submit its result.
   */
  export interface SessionRequiredActionResourceFunctionCall {
    /**
     * The arguments supplied by the model.
     */
    arguments: unknown;

    /**
     * The ID to include when submitting the function result.
     */
    call_id: string;

    /**
     * The function name.
     */
    name: string;

    /**
     * The ID of the turn that requested the function call.
     */
    turn_id: string;

    /**
     * The type of the object. Always `function_call`.
     */
    type: 'function_call';
  }

  /**
   * Reconnect a session environment.
   */
  export interface SessionRequiredActionResourceEnvironmentConnection {
    /**
     * The ID of the environment to reconnect.
     */
    environment_id: string;

    /**
     * The type of the object. Always `environment_connection`.
     */
    type: 'environment_connection';
  }
}

/**
 * An assistant message produced by the agent.
 */
export interface AgentSessionAssistantMessage {
  /**
   * The ID of the message.
   */
  id: string;

  /**
   * The content of the message.
   */
  content: Array<OutputText>;

  /**
   * The phase of an assistant message.
   *
   * - `commentary` - Commentary produced while the agent works.
   * - `final_answer` - The agent's final answer.
   */
  phase: 'commentary' | 'final_answer' | null;

  /**
   * The role of the message author. Always `assistant`.
   */
  role: 'assistant';

  /**
   * The status of the message.
   */
  status: AgentOutputItemStatus;

  /**
   * The ID of the turn that contains this item.
   */
  turn_id: string;

  /**
   * The item type. Always `message`.
   */
  type: 'message';
}

/**
 * Emitted when a session is created.
 */
export interface AgentSessionCreatedEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The session that was created.
   */
  session: AgentSession;

  /**
   * The type of the object. Always `agent.session.created`.
   */
  type: 'agent.session.created';
}

/**
 * A Managed Agents session removed from the public API. Physical cleanup may
 * continue asynchronously.
 */
export interface AgentSessionDeleted {
  /**
   * The ID of the deleted session.
   */
  id: string;

  /**
   * Whether the session has been removed from the public API. Always `true`.
   * Physical cleanup may still be in progress.
   */
  deleted: boolean;

  /**
   * The object type. Always `agent.session.deleted`.
   */
  object: 'agent.session.deleted';
}

/**
 * Emitted when a session environment connects.
 */
export interface AgentSessionEnvironmentConnectedEvent {
  /**
   * The current environment state.
   */
  environment: AgentSessionEnvironmentState;

  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always `agent.session.environment.connected`.
   */
  type: 'agent.session.environment.connected';
}

/**
 * Emitted when a session environment disconnects.
 */
export interface AgentSessionEnvironmentDisconnectedEvent {
  /**
   * The current environment state.
   */
  environment: AgentSessionEnvironmentState;

  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always `agent.session.environment.disconnected`.
   */
  type: 'agent.session.environment.disconnected';
}

/**
 * Emitted when a session environment fails.
 */
export interface AgentSessionEnvironmentFailedEvent {
  /**
   * The current environment state.
   */
  environment: AgentSessionEnvironmentState;

  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always `agent.session.environment.failed`.
   */
  type: 'agent.session.environment.failed';
}

/**
 * Emitted while a session environment is being prepared.
 */
export interface AgentSessionEnvironmentPendingEvent {
  /**
   * The current environment state.
   */
  environment: AgentSessionEnvironmentState;

  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always `agent.session.environment.pending`.
   */
  type: 'agent.session.environment.pending';
}

/**
 * Emitted when a hosted session environment is ready to connect.
 */
export interface AgentSessionEnvironmentReadyEvent {
  /**
   * The current environment state.
   */
  environment: AgentSessionEnvironmentState;

  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always `agent.session.environment.ready`.
   */
  type: 'agent.session.environment.ready';
}

/**
 * The current state of a session environment.
 */
export interface AgentSessionEnvironmentState {
  /**
   * The public ID of the environment.
   */
  id: string;

  /**
   * An error reported while preparing a session environment.
   */
  error: AgentSessionEnvironmentState.Error | null;

  /**
   * The environment's connection status.
   *
   * - `pending` - The environment is being prepared.
   * - `ready` - The environment is ready to connect.
   * - `connected` - The environment is connected.
   * - `disconnected` - The environment is disconnected.
   * - `failed` - The environment failed to connect.
   */
  status: 'pending' | 'ready' | 'connected' | 'disconnected' | 'failed';

  /**
   * The environment type.
   */
  type: string;
}

export namespace AgentSessionEnvironmentState {
  /**
   * An error reported while preparing a session environment.
   */
  export interface Error {
    /**
     * A machine-readable error code.
     */
    code: string;

    /**
     * A human-readable error message.
     */
    message: string;

    /**
     * The error type.
     */
    type: string;
  }
}

/**
 * Emitted when a turn or session fails.
 */
export interface AgentSessionErrorEvent {
  /**
   * The error that occurred.
   */
  error: SessionError;

  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The type of the object. Always `error`.
   */
  type: 'error';
}

/**
 * An event emitted by a Managed Agents session.
 */
export type AgentSessionEvent =
  | AgentSessionErrorEvent
  | AgentSessionEnvironmentReadyEvent
  | AgentOutputCommandExecutionOutputDeltaEvent
  | AgentSessionCreatedEvent
  | AgentSessionTurnCreatedEvent
  | AgentSessionTurnInProgressEvent
  | AgentSessionTurnCompletedEvent
  | AgentSessionTurnFailedEvent
  | AgentSessionTurnCancelledEvent
  | AgentSessionTurnItemAddedEvent
  | AgentSessionIdleEvent
  | AgentSessionInProgressEvent
  | AgentSessionRequiresActionEvent
  | AgentSessionFailedEvent
  | AgentSessionEnvironmentPendingEvent
  | AgentSessionEnvironmentConnectedEvent
  | AgentSessionEnvironmentDisconnectedEvent
  | AgentSessionEnvironmentFailedEvent
  | AgentSessionSubagentCreatedEvent
  | AgentSessionSubagentActiveEvent
  | AgentSessionSubagentClosedEvent
  | AgentSessionTurnItemDoneEvent
  | AgentSessionTurnContentPartAddedEvent
  | AgentSessionTurnContentPartDoneEvent
  | AgentSessionTurnOutputTextDeltaEvent
  | AgentSessionTurnOutputTextDoneEvent
  | AgentSessionTurnReasoningSummaryPartAddedEvent
  | AgentSessionTurnReasoningSummaryPartDoneEvent
  | AgentSessionTurnReasoningSummaryTextDeltaEvent
  | AgentSessionTurnReasoningSummaryTextDoneEvent;

/**
 * Emitted when a session fails.
 */
export interface AgentSessionFailedEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The failed session.
   */
  session: AgentSession;

  /**
   * The type of the object. Always `agent.session.failed`.
   */
  type: 'agent.session.failed';
}

/**
 * Emitted when a session becomes idle.
 */
export interface AgentSessionIdleEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The session that became idle.
   */
  session: AgentSession;

  /**
   * The type of the object. Always `agent.session.idle`.
   */
  type: 'agent.session.idle';
}

/**
 * Emitted when a session starts processing a turn.
 */
export interface AgentSessionInProgressEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The session that started processing.
   */
  session: AgentSession;

  /**
   * The type of the object. Always `agent.session.in_progress`.
   */
  type: 'agent.session.in_progress';
}

/**
 * A user message submitted to a session.
 */
export interface AgentSessionInputMessageParam {
  /**
   * The content of the message.
   */
  content: Array<InputContentParam>;

  /**
   * The role of the message author. Always `user`.
   */
  role: 'user';

  /**
   * The type of the input item. Always `message`.
   */
  type?: 'message';
}

/**
 * Input submitted to an existing session.
 */
export type AgentSessionInputParam =
  | AgentSessionInputParam.SessionInputParamAgentSessionInputMessage
  | AgentSessionInputParam.SessionInputParamAgentSessionInputCancel
  | AgentSessionInputParam.SessionInputParamAgentSessionInputToolResult;

export namespace AgentSessionInputParam {
  /**
   * Adds one or more user messages and starts a turn.
   */
  export interface SessionInputParamAgentSessionInputMessage {
    /**
     * The user messages to add to the session.
     */
    input: Array<AgentsAPI.AgentSessionInputMessageParam>;

    /**
     * The type of the object. Always `agent.session.input.message`.
     */
    type: 'agent.session.input.message';
  }

  /**
   * Cancels the session's active turn.
   */
  export interface SessionInputParamAgentSessionInputCancel {
    /**
     * The type of the object. Always `agent.session.input.cancel`.
     */
    type: 'agent.session.input.cancel';
  }

  /**
   * Submits the result of a function call.
   */
  export interface SessionInputParamAgentSessionInputToolResult {
    /**
     * The ID of the function call.
     */
    call_id: string;

    /**
     * Whether the function call succeeded.
     */
    success: boolean;

    /**
     * The ID of the turn that requested the function call.
     */
    turn_id: string;

    /**
     * The type of the object. Always `agent.session.input.tool_result`.
     */
    type: 'agent.session.input.tool_result';

    /**
     * The error message when the call failed.
     */
    error?: string | null;

    /**
     * A function result represented as text or supported model-input content.
     */
    output?: AgentsAPI.AgentFunctionCallOutputParam | null;
  }
}

/**
 * An item associated with a session turn.
 */
export type AgentSessionItem =
  | AgentSessionMessage
  | AgentReasoningItem
  | AgentFunctionCallItem
  | AgentSessionItem.FunctionCallOutputItemResource
  | AgentSessionItem.AgentMessageItemResource
  | AgentMcpCallItem
  | AgentWebSearchCallItem
  | AgentCommandExecutionItem
  | AgentCreateSubagentCallItem
  | AgentSendSubagentInputCallItem
  | AgentResumeSubagentCallItem
  | AgentWaitForSubagentsCallItem
  | AgentInterruptSubagentCallItem
  | AgentCloseSubagentCallItem;

export namespace AgentSessionItem {
  /**
   * The result supplied for a function call.
   */
  export interface FunctionCallOutputItemResource {
    /**
     * The ID of the function call output item.
     */
    id: string;

    /**
     * The ID of the function call that produced this output.
     */
    call_id: string;

    /**
     * The error message, if the call failed.
     */
    error: string | null;

    /**
     * The text or model-input content supplied as a function result.
     */
    output: AgentsAPI.AgentFunctionCallOutput | null;

    /**
     * The status of the function call.
     */
    status: AgentsAPI.AgentFunctionCallStatus;

    /**
     * The ID of the turn that contains this item.
     */
    turn_id: string;

    /**
     * The item type. Always `function_call_output`.
     */
    type: 'function_call_output';
  }

  /**
   * A message exchanged between agent threads.
   */
  export interface AgentMessageItemResource {
    /**
     * The ID of the message.
     */
    id: string;

    /**
     * The content exchanged between the agents.
     */
    content: Array<AgentsAPI.AgentContent>;

    /**
     * The ID or name of the receiving agent.
     */
    recipient_agent_id: string;

    /**
     * The ID or name of the sending agent.
     */
    sender_agent_id: string;

    /**
     * The ID of the turn that contains this item.
     */
    turn_id: string;

    /**
     * The item type. Always `agent_message`.
     */
    type: 'agent_message';
  }
}

/**
 * A user or assistant message recorded in a session.
 */
export interface AgentSessionMessage {
  /**
   * The ID of this item, or null for legacy user messages whose ID was not recorded.
   */
  id: string | null;

  /**
   * The content of the message. User messages contain input text or images;
   * assistant messages contain output text.
   */
  content: Array<AgentSessionMessageContent>;

  /**
   * The phase of an assistant message.
   *
   * - `commentary` - Commentary produced while the agent works.
   * - `final_answer` - The agent's final answer.
   */
  phase: 'commentary' | 'final_answer' | null;

  /**
   * The role of the message author.
   */
  role: 'user' | 'assistant';

  /**
   * The status of the message. User messages are always `completed`.
   */
  status: AgentOutputItemStatus;

  /**
   * The ID of the turn that contains this item.
   */
  turn_id: string;

  /**
   * The item type. Always `message`.
   */
  type: 'message';
}

/**
 * A content part in a session message.
 */
export type AgentSessionMessageContent =
  | AgentSessionMessageContent.MessageContentResourceInputText
  | AgentSessionMessageContent.MessageContentResourceInputImage
  | AgentSessionMessageContent.MessageContentResourceOutputText;

export namespace AgentSessionMessageContent {
  /**
   * Text supplied by the user.
   */
  export interface MessageContentResourceInputText {
    /**
     * The text supplied by the user.
     */
    text: string;

    /**
     * The type of the object. Always `input_text`.
     */
    type: 'input_text';
  }

  /**
   * An image supplied by the user.
   */
  export interface MessageContentResourceInputImage {
    /**
     * The URL of the image supplied by the user, which may be a base64-encoded data
     * URL.
     */
    image_url: string;

    /**
     * The type of the object. Always `input_image`.
     */
    type: 'input_image';
  }

  /**
   * Text produced by the assistant.
   */
  export interface MessageContentResourceOutputText {
    /**
     * The text produced by the assistant.
     */
    text: string;

    /**
     * The type of the object. Always `output_text`.
     */
    type: 'output_text';
  }
}

/**
 * Emitted when a session is waiting for one or more required actions.
 */
export interface AgentSessionRequiresActionEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The session and its current required actions.
   */
  session: AgentSession;

  /**
   * The type of the object. Always `agent.session.requires_action`.
   */
  type: 'agent.session.requires_action';
}

/**
 * Emitted when a closed subagent successfully resumes.
 */
export interface AgentSessionSubagentActiveEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The subagent that resumed.
   */
  subagent: Subagent;

  /**
   * The type of the object. Always `agent.session.subagent.active`.
   */
  type: 'agent.session.subagent.active';
}

/**
 * Emitted when a subagent is closed.
 */
export interface AgentSessionSubagentClosedEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The subagent that was closed.
   */
  subagent: Subagent;

  /**
   * The type of the object. Always `agent.session.subagent.closed`.
   */
  type: 'agent.session.subagent.closed';
}

/**
 * Emitted when a subagent is created.
 */
export interface AgentSessionSubagentCreatedEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The subagent that was created.
   */
  subagent: Subagent;

  /**
   * The type of the object. Always `agent.session.subagent.created`.
   */
  type: 'agent.session.subagent.created';
}

/**
 * Emitted when a turn is cancelled.
 */
export interface AgentSessionTurnCancelledEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The cancelled turn.
   */
  turn: TurnsAPI.Turn;

  /**
   * The ID of the turn associated with the event.
   */
  turn_id: string;

  /**
   * The type of the object. Always `agent.session.turn.cancelled`.
   */
  type: 'agent.session.turn.cancelled';

  /**
   * Recorded token usage for a session or turn. Usage is best effort and may change.
   */
  usage: TokenUsage | null;
}

/**
 * Emitted when a turn completes.
 */
export interface AgentSessionTurnCompletedEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The completed turn.
   */
  turn: TurnsAPI.Turn;

  /**
   * The ID of the turn associated with the event.
   */
  turn_id: string;

  /**
   * The type of the object. Always `agent.session.turn.completed`.
   */
  type: 'agent.session.turn.completed';

  /**
   * Recorded token usage for a session or turn. Usage is best effort and may change.
   */
  usage: TokenUsage | null;
}

/**
 * Emitted when an output text content part is added.
 */
export interface AgentSessionTurnContentPartAddedEvent {
  /**
   * The index of the content part in the message.
   */
  content_index: number;

  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the message item.
   */
  item_id: string;

  /**
   * The index of the item in the turn output.
   */
  output_index: number;

  /**
   * The initial content part.
   */
  part: OutputText;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always `agent.session.turn.content_part.added`.
   */
  type: 'agent.session.turn.content_part.added';
}

/**
 * Emitted when an output content part is complete.
 */
export interface AgentSessionTurnContentPartDoneEvent {
  /**
   * The index of the content part in the message.
   */
  content_index: number;

  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the message item.
   */
  item_id: string;

  /**
   * The index of the item in the turn output.
   */
  output_index: number;

  /**
   * The completed content part.
   */
  part: OutputText;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always `agent.session.turn.content_part.done`.
   */
  type: 'agent.session.turn.content_part.done';
}

/**
 * Emitted when a turn is created.
 */
export interface AgentSessionTurnCreatedEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The turn at the time it was created.
   */
  turn: TurnsAPI.Turn;

  /**
   * The ID of the turn associated with the event.
   */
  turn_id: string;

  /**
   * The type of the object. Always `agent.session.turn.created`.
   */
  type: 'agent.session.turn.created';
}

/**
 * Emitted when a turn fails.
 */
export interface AgentSessionTurnFailedEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The failed turn.
   */
  turn: TurnsAPI.Turn;

  /**
   * The ID of the turn associated with the event.
   */
  turn_id: string;

  /**
   * The type of the object. Always `agent.session.turn.failed`.
   */
  type: 'agent.session.turn.failed';

  /**
   * Recorded token usage for a session or turn. Usage is best effort and may change.
   */
  usage: TokenUsage | null;
}

/**
 * Emitted when a turn starts running.
 */
export interface AgentSessionTurnInProgressEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The turn at the time it started running.
   */
  turn: TurnsAPI.Turn;

  /**
   * The ID of the turn associated with the event.
   */
  turn_id: string;

  /**
   * The type of the object. Always `agent.session.turn.in_progress`.
   */
  type: 'agent.session.turn.in_progress';
}

/**
 * Emitted when an item is added to a turn.
 */
export interface AgentSessionTurnItemAddedEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The item that was added.
   */
  item: AgentSessionItem;

  /**
   * The index of the item in the turn output, when the item is agent output.
   */
  output_index: number | null;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always `agent.session.turn.item.added`.
   */
  type: 'agent.session.turn.item.added';
}

/**
 * Emitted when an output item is complete.
 */
export interface AgentSessionTurnItemDoneEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The completed output item.
   */
  item: AgentOutputItem;

  /**
   * The index of the output item in the turn output.
   */
  output_index: number;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always `agent.session.turn.item.done`.
   */
  type: 'agent.session.turn.item.done';
}

/**
 * Emitted when text is appended to an output text content part.
 */
export interface AgentSessionTurnOutputTextDeltaEvent {
  /**
   * The index of the content part in the message.
   */
  content_index: number;

  /**
   * The text that was appended.
   */
  delta: string;

  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the message item.
   */
  item_id: string;

  /**
   * The index of the item in the turn output.
   */
  output_index: number;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always `agent.session.turn.output_text.delta`.
   */
  type: 'agent.session.turn.output_text.delta';
}

/**
 * Emitted when an output text content part is complete.
 */
export interface AgentSessionTurnOutputTextDoneEvent {
  /**
   * The index of the content part in the message.
   */
  content_index: number;

  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the message item.
   */
  item_id: string;

  /**
   * The index of the item in the turn output.
   */
  output_index: number;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The complete output text.
   */
  text: string;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always `agent.session.turn.output_text.done`.
   */
  type: 'agent.session.turn.output_text.done';
}

/**
 * Emitted when a reasoning summary content part is added.
 */
export interface AgentSessionTurnReasoningSummaryPartAddedEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the reasoning item.
   */
  item_id: string;

  /**
   * The index of the item in the turn output.
   */
  output_index: number;

  /**
   * The initial summary part.
   */
  part: SummaryText;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The index of the summary content part.
   */
  summary_index: number;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always
   * `agent.session.turn.reasoning_summary_part.added`.
   */
  type: 'agent.session.turn.reasoning_summary_part.added';
}

/**
 * Emitted when a reasoning summary part is complete.
 */
export interface AgentSessionTurnReasoningSummaryPartDoneEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the reasoning item.
   */
  item_id: string;

  /**
   * The index of the item in the turn output.
   */
  output_index: number;

  /**
   * The completed summary part.
   */
  part: SummaryText;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * Present as `incomplete` when summary generation was interrupted.
   */
  status: 'incomplete' | null;

  /**
   * The index of the summary part.
   */
  summary_index: number;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always `agent.session.turn.reasoning_summary_part.done`.
   */
  type: 'agent.session.turn.reasoning_summary_part.done';
}

/**
 * Emitted when text is appended to a reasoning summary.
 */
export interface AgentSessionTurnReasoningSummaryTextDeltaEvent {
  /**
   * The summary text that was appended.
   */
  delta: string;

  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the reasoning item.
   */
  item_id: string;

  /**
   * The index of the item in the turn output.
   */
  output_index: number;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The index of the summary content part.
   */
  summary_index: number;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always
   * `agent.session.turn.reasoning_summary_text.delta`.
   */
  type: 'agent.session.turn.reasoning_summary_text.delta';
}

/**
 * Emitted when a reasoning summary content part is complete.
 */
export interface AgentSessionTurnReasoningSummaryTextDoneEvent {
  /**
   * The unique ID of the event.
   */
  event_id: string;

  /**
   * The ID of the reasoning item.
   */
  item_id: string;

  /**
   * The index of the item in the turn output.
   */
  output_index: number;

  /**
   * The ID of the session associated with the event.
   */
  session_id: string;

  /**
   * The index of the summary content part.
   */
  summary_index: number;

  /**
   * The complete reasoning summary text.
   */
  text: string;

  /**
   * The ID of the turn associated with the event, when applicable.
   */
  turn_id: string | null;

  /**
   * The type of the object. Always `agent.session.turn.reasoning_summary_text.done`.
   */
  type: 'agent.session.turn.reasoning_summary_text.done';
}

/**
 * The text configuration used by an agent.
 */
export interface AgentText {
  /**
   * The effective output format. Defaults to ordinary text.
   */
  format: TextFormat;

  /**
   * The amount of text produced by the agent. Defaults to `medium`.
   */
  verbosity: 'low' | 'medium' | 'high';
}

/**
 * Configuration for text generated by the agent.
 */
export interface AgentTextParam {
  /**
   * The output format for generated text.
   */
  format?: TextFormatParam | null;

  /**
   * The amount of text the model should produce.
   *
   * - `low` - Produces less text.
   * - `medium` - Uses the default amount of text.
   * - `high` - Produces more text.
   */
  verbosity?: 'low' | 'medium' | 'high' | null;
}

/**
 * A tool available to the agent.
 */
export type AgentTool =
  | AgentTool.AgentToolResourceFunction
  | AgentTool.AgentToolResourceProgrammaticToolCalling
  | AgentTool.AgentToolResourceMcp
  | AgentTool.AgentToolResourceWebSearch;

export namespace AgentTool {
  /**
   * A function defined by the application.
   */
  export interface AgentToolResourceFunction {
    /**
     * Whether the function is deferred and discovered through tool search.
     */
    defer_loading: boolean;

    /**
     * A description of what the function does.
     */
    description: string;

    /**
     * The name of the function.
     */
    name: string;

    /**
     * A JSON Schema object describing the function's arguments.
     */
    parameters: { [key: string]: unknown };

    /**
     * The type of the object. Always `function`.
     */
    type: 'function';
  }

  /**
   * Enables calling tools from model-generated code.
   */
  export interface AgentToolResourceProgrammaticToolCalling {
    /**
     * Whether tools can be called from model-generated code.
     */
    enabled: boolean;

    /**
     * The type of the object. Always `programmatic_tool_calling`.
     */
    type: 'programmatic_tool_calling';
  }

  /**
   * Tools provided by a remote MCP server.
   */
  export interface AgentToolResourceMcp {
    /**
     * The MCP tools the agent may call.
     */
    allowed_tools: Array<string> | null;

    /**
     * Where outbound MCP HTTP connections originate.
     */
    connection_origin: 'service' | 'environment';

    /**
     * The attached vault credential selected for this MCP server, if any. Optional
     * when exactly one attached credential matches the server URL.
     */
    credential_id: string | null;

    /**
     * Metadata included with requests to this MCP server.
     */
    request_metadata: { [key: string]: unknown };

    /**
     * Whether this MCP server must initialize before the first turn.
     */
    required: boolean;

    /**
     * A label used to identify the MCP server in tool calls.
     */
    server_label: string;

    /**
     * The transport used to connect to the MCP server.
     */
    transport: AgentsAPI.McpTransport;

    /**
     * The type of the object. Always `mcp`.
     */
    type: 'mcp';
  }

  /**
   * Web search.
   */
  export interface AgentToolResourceWebSearch {
    /**
     * Allowed search domains, or `null` when the search is unrestricted.
     */
    allowed_domains: Array<string> | null;

    /**
     * The amount of search context made available to the model. Defaults to `medium`.
     */
    context_size: 'low' | 'medium' | 'high';

    /**
     * Approximate user location used to localize web search results.
     */
    location: AgentToolResourceWebSearch.Location | null;

    /**
     * The source used for web search results.
     */
    mode: 'disabled' | 'cached' | 'live';

    /**
     * The type of the object. Always `web_search`.
     */
    type: 'web_search';
  }

  export namespace AgentToolResourceWebSearch {
    /**
     * Approximate user location used to localize web search results.
     */
    export interface Location {
      /**
       * The city name.
       */
      city: string | null;

      /**
       * The two-letter ISO country code, such as `US`.
       */
      country: string | null;

      /**
       * The region or state name.
       */
      region: string | null;

      /**
       * The IANA timezone, such as `America/Los_Angeles`.
       */
      timezone: string | null;
    }
  }
}

/**
 * A tool available to the agent.
 */
export type AgentToolParam =
  | AgentToolParam.AgentToolConfigParamFunction
  | AgentToolParam.AgentToolConfigParamToolSearch
  | AgentToolParam.AgentToolConfigParamProgrammaticToolCalling
  | AgentToolParam.AgentToolConfigParamMcp
  | AgentToolParam.AgentToolConfigParamWebSearch;

export namespace AgentToolParam {
  /**
   * A function defined by the application.
   */
  export interface AgentToolConfigParamFunction {
    /**
     * A description of what the function does.
     */
    description: string;

    /**
     * The name of the function.
     */
    name: string;

    /**
     * A JSON Schema object describing the function's arguments.
     */
    parameters: { [key: string]: unknown };

    /**
     * The type of the object. Always `function`.
     */
    type: 'function';

    /**
     * Whether this function is deferred and discovered through tool search. Defaults
     * to `false`.
     */
    defer_loading?: boolean;
  }

  /**
   * Discovers deferred function tools and loads them into the model context.
   */
  export interface AgentToolConfigParamToolSearch {
    /**
     * The type of the object. Always `tool_search`.
     */
    type: 'tool_search';
  }

  /**
   * Enables calling tools from model-generated code.
   */
  export interface AgentToolConfigParamProgrammaticToolCalling {
    /**
     * The type of the object. Always `programmatic_tool_calling`.
     */
    type: 'programmatic_tool_calling';

    /**
     * Whether tools can be called from model-generated code. Defaults to `true`.
     */
    enabled?: boolean;
  }

  /**
   * Tools provided by a remote MCP server.
   */
  export interface AgentToolConfigParamMcp {
    /**
     * A label used to identify the MCP server in tool calls.
     */
    server_label: string;

    /**
     * The transport used to connect to the MCP server.
     */
    transport: AgentsAPI.McpTransportParam;

    /**
     * The type of the object. Always `mcp`.
     */
    type: 'mcp';

    /**
     * The MCP tools the agent may call. All server tools are allowed when omitted.
     */
    allowed_tools?: Array<string> | null;

    /**
     * Where outbound MCP HTTP connections originate.
     *
     * - `service` - Uses the Managed Agents service network.
     * - `environment` - Uses the session's execution environment.
     */
    connection_origin?: 'service' | 'environment' | null;

    /**
     * The attached vault credential used to authenticate this MCP server. Optional
     * when exactly one attached credential matches the server URL.
     */
    credential_id?: string | null;

    /**
     * Metadata included with requests to this MCP server.
     */
    request_metadata?: { [key: string]: unknown } | null;

    /**
     * Whether this MCP server must initialize before the first turn. Defaults to
     * `false`.
     */
    required?: boolean;
  }

  /**
   * Web search.
   */
  export interface AgentToolConfigParamWebSearch {
    /**
     * The type of the object. Always `web_search`.
     */
    type: 'web_search';

    /**
     * Domains the search may include.
     */
    allowed_domains?: Array<string> | null;

    /**
     * The amount of web search context made available to the model.
     */
    context_size?: 'low' | 'medium' | 'high' | null;

    /**
     * Approximate user location used to localize web search results.
     */
    location?: AgentToolConfigParamWebSearch.Location | null;

    /**
     * The source used for web search results.
     *
     * - `disabled` - Disables web search.
     * - `cached` - Uses cached search results.
     * - `live` - Searches the live web.
     */
    mode?: 'disabled' | 'cached' | 'live' | null;
  }

  export namespace AgentToolConfigParamWebSearch {
    /**
     * Approximate user location used to localize web search results.
     */
    export interface Location {
      /**
       * The city name.
       */
      city?: string | null;

      /**
       * The two-letter ISO country code, such as `US`.
       */
      country?: string | null;

      /**
       * The region or state name.
       */
      region?: string | null;

      /**
       * The IANA timezone, such as `America/Los_Angeles`.
       */
      timezone?: string | null;
    }
  }
}

/**
 * A request to wait for one or more subagents.
 */
export interface AgentWaitForSubagentsCallItem {
  /**
   * The ID of the tool call item.
   */
  id: string;

  /**
   * The IDs of the agents to wait for.
   */
  recipient_agent_ids: Array<string>;

  /**
   * The ID of the agent waiting for results.
   */
  sender_agent_id: string;

  /**
   * The status of the tool call.
   */
  status: AgentFunctionCallStatus;

  /**
   * The ID of the turn that contains this item.
   */
  turn_id: string;

  /**
   * The item type. Always `wait_for_subagents_call`.
   */
  type: 'wait_for_subagents_call';
}

/**
 * A web search call produced by the agent.
 */
export interface AgentWebSearchCallItem {
  /**
   * The ID of the web search call.
   */
  id: string;

  /**
   * An action performed by the web search tool.
   */
  action: WebSearchAction | null;

  /**
   * The status of the web search call.
   */
  status: AgentOutputItemStatus;

  /**
   * The ID of the turn that contains this item.
   */
  turn_id: string;

  /**
   * The item type. Always `web_search_call`.
   */
  type: 'web_search_call';
}

/**
 * The execution environment for a session.
 */
export type Environment =
  | Environment.EnvironmentResourceNone
  | Environment.EnvironmentResourceOpenAIHosted
  | Environment.EnvironmentResourceSelfHosted;

export namespace Environment {
  /**
   * The session talks to CCA without selecting or provisioning an execution
   * environment.
   */
  export interface EnvironmentResourceNone {
    /**
     * The type of the object. Always `none`.
     */
    type: 'none';
  }

  /**
   * An environment hosted by OpenAI.
   */
  export interface EnvironmentResourceOpenAIHosted {
    /**
     * The public ID of the environment.
     */
    id: string;

    /**
     * Directories that contain capabilities exposed to the agent.
     */
    capability_directories: Array<string>;

    /**
     * Files available in the environment, excluding their contents.
     */
    files: Array<AgentsAPI.HostedEnvironmentFile>;

    /**
     * The effective network access policy for the environment.
     */
    network: EnvironmentResourceOpenAIHosted.Network;

    /**
     * Packages installed in the environment.
     */
    packages: EnvironmentResourceOpenAIHosted.Packages;

    /**
     * Plugins installed in the environment, excluding their archive contents.
     */
    plugins: Array<AgentsAPI.HostedPlugin>;

    /**
     * Skills installed in the environment, excluding their archive contents.
     */
    skills: Array<AgentsAPI.HostedSkill>;

    /**
     * The type of the object. Always `openai_hosted`.
     */
    type: 'openai_hosted';
  }

  export namespace EnvironmentResourceOpenAIHosted {
    /**
     * The effective network access policy for the environment.
     */
    export interface Network {
      /**
       * The environment's network access mode.
       *
       * - `enabled` - Allows unrestricted network access.
       * - `disabled` - Disables network access.
       * - `restricted` - Allows access only to configured domains.
       */
      access: 'enabled' | 'disabled' | 'restricted';

      /**
       * Domains the environment may access when network access is restricted.
       */
      allowed_domains: Array<string>;
    }

    /**
     * Packages installed in the environment.
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
  }

  /**
   * An environment hosted by the application.
   */
  export interface EnvironmentResourceSelfHosted {
    /**
     * The public ID of the environment.
     */
    id: string;

    /**
     * Directories that contain capabilities exposed to the agent.
     */
    capability_directories: Array<string>;

    /**
     * Pass this URL unchanged to `codex exec-server --remote` when connecting this
     * environment.
     */
    remote_url: string;

    /**
     * The type of the object. Always `self_hosted`.
     */
    type: 'self_hosted';

    /**
     * The absolute project directory inside the environment. Defaults to `/workspace`.
     */
    workspace_directory: string;
  }
}

/**
 * The execution environment and optional reusable template for a session.
 */
export type EnvironmentParam =
  | EnvironmentParam.EnvironmentParamNone
  | EnvironmentParam.EnvironmentParamOpenAIHosted
  | EnvironmentParam.EnvironmentParamSelfHosted;

export namespace EnvironmentParam {
  /**
   * Runs the agent without an execution environment.
   */
  export interface EnvironmentParamNone {
    /**
     * The type of the object. Always `none`.
     */
    type: 'none';
  }

  /**
   * An OpenAI-hosted environment, optionally based on a reusable template.
   */
  export interface EnvironmentParamOpenAIHosted {
    /**
     * The type of the object. Always `openai_hosted`.
     */
    type: 'openai_hosted';

    /**
     * Directories that contain capabilities exposed to the agent. Defaults to an empty
     * list.
     */
    capability_directories?: Array<string> | null;

    /**
     * Environment variables made available to the agent.
     */
    env?: { [key: string]: string } | null;

    /**
     * A reusable hosted template applied before inline session configuration. Omitted
     * fields inherit the template; network overrides cannot broaden its policy.
     */
    environment_template_id?: string;

    /**
     * Files available before the agent starts. Defaults to an empty list.
     */
    files?: Array<AgentsAPI.HostedEnvironmentFileParam> | null;

    /**
     * Network access for an OpenAI-hosted environment.
     */
    network?: EnvironmentParamOpenAIHosted.Network | null;

    /**
     * Packages to install in an OpenAI-hosted environment.
     */
    packages?: EnvironmentParamOpenAIHosted.Packages | null;

    /**
     * Plugins provided as inline ZIP archives. Defaults to an empty list.
     */
    plugins?: Array<AgentsAPI.HostedPluginParam> | null;

    /**
     * Ordered, confidential setup commands. Command bodies are never returned.
     */
    setup_commands?: Array<AgentsAPI.SetupCommandParam> | null;

    /**
     * Skills referenced by ID or provided as inline ZIP archives. Defaults to an empty
     * list.
     */
    skills?: Array<AgentsAPI.HostedSkillParam> | null;
  }

  export namespace EnvironmentParamOpenAIHosted {
    /**
     * Network access for an OpenAI-hosted environment.
     */
    export interface Network {
      /**
       * The environment's network access mode.
       *
       * - `enabled` - Allows unrestricted network access, matching an omitted network
       *   policy.
       * - `disabled` - Disables network access.
       * - `restricted` - Allows access only to configured domains.
       */
      access: 'enabled' | 'disabled' | 'restricted';

      /**
       * Domains the environment may access when network access is restricted.
       */
      allowed_domains?: Array<string> | null;
    }

    /**
     * Packages to install in an OpenAI-hosted environment.
     */
    export interface Packages {
      /**
       * npm packages to install globally. Defaults to an empty list.
       */
      npm?: Array<string> | null;

      /**
       * Python packages to install. Defaults to an empty list.
       */
      python?: Array<string> | null;

      /**
       * System packages to install. Defaults to an empty list.
       */
      system?: Array<string> | null;
    }
  }

  /**
   * An application-hosted environment configured inline.
   */
  export interface EnvironmentParamSelfHosted {
    /**
     * The type of the object. Always `self_hosted`.
     */
    type: 'self_hosted';

    /**
     * Absolute project directory inside the self-hosted environment.
     */
    workspace_directory: string;

    /**
     * Directories that contain capabilities exposed to the agent. Defaults to an empty
     * list.
     */
    capability_directories?: Array<string> | null;
  }
}

/**
 * Metadata for a file materialized in an OpenAI-hosted execution environment.
 */
export type HostedEnvironmentFile =
  | HostedEnvironmentFileID
  | HostedEnvironmentFile.HostedEnvironmentFileResourceInline;

export namespace HostedEnvironmentFile {
  /**
   * A file supplied inline when the session was created.
   */
  export interface HostedEnvironmentFileResourceInline {
    /**
     * The session-scoped ID of the file in the execution environment.
     */
    id: string;

    /**
     * The file's absolute path inside the environment.
     */
    path: string;

    /**
     * The decoded file size in bytes.
     */
    size_bytes: number;

    /**
     * The type of the object. Always `inline`.
     */
    type: 'inline';
  }
}

/**
 * A file copied from the OpenAI Files API.
 */
export interface HostedEnvironmentFileID {
  /**
   * The session-scoped ID of the file in the execution environment.
   */
  id: string;

  /**
   * The ID of the uploaded file.
   */
  file_id: string;

  /**
   * The file's absolute path inside the environment.
   */
  path: string;

  /**
   * The decoded file size in bytes.
   */
  size_bytes: number;

  /**
   * The type of the object. Always `file_id`.
   */
  type: 'file_id';
}

/**
 * A file materialized in an OpenAI-hosted execution environment.
 */
export type HostedEnvironmentFileParam =
  | HostedEnvironmentFileParam.HostedEnvironmentFileParamFileID
  | HostedEnvironmentFileParam.HostedEnvironmentFileParamInline;

export namespace HostedEnvironmentFileParam {
  /**
   * A file previously uploaded through the OpenAI Files API.
   */
  export interface HostedEnvironmentFileParamFileID {
    /**
     * The ID of the uploaded file.
     */
    file_id: string;

    /**
     * The absolute destination path inside `/workspace`.
     */
    path: string;

    /**
     * The type of the object. Always `file_id`.
     */
    type: 'file_id';
  }

  /**
   * A file supplied directly as standard-base64 data.
   */
  export interface HostedEnvironmentFileParamInline {
    /**
     * The standard-base64-encoded file contents.
     */
    data: string;

    /**
     * The absolute destination path inside `/workspace`.
     */
    path: string;

    /**
     * The type of the object. Always `inline`.
     */
    type: 'inline';
  }
}

/**
 * A plugin installed from an inline ZIP archive.
 */
export interface HostedPlugin {
  /**
   * The installed plugin description.
   */
  description: string;

  /**
   * The installed plugin name.
   */
  name: string;

  /**
   * The type of the object. Always `inline`.
   */
  type: 'inline';
}

/**
 * Supplies a plugin ZIP directly in the session request.
 */
export interface HostedPluginParam {
  /**
   * The plugin description declared in `.codex-plugin/plugin.json`.
   */
  description: string;

  /**
   * The plugin name declared in `.codex-plugin/plugin.json`.
   */
  name: string;

  /**
   * Provides ZIP bytes encoded with standard base64.
   */
  source: InlineCapabilitySourceParam;

  /**
   * The type of the object. Always `inline`.
   */
  type: 'inline';
}

/**
 * A skill installed in an OpenAI-hosted environment.
 */
export type HostedSkill = HostedSkillReference | HostedSkill.HostedSkillResourceInline;

export namespace HostedSkill {
  /**
   * A skill installed from an inline ZIP archive.
   */
  export interface HostedSkillResourceInline {
    /**
     * The installed skill description.
     */
    description: string;

    /**
     * The installed skill name.
     */
    name: string;

    /**
     * The type of the object. Always `inline`.
     */
    type: 'inline';
  }
}

/**
 * A skill installed in an OpenAI-hosted environment.
 */
export type HostedSkillParam =
  | HostedSkillParam.HostedSkillParamSkillReference
  | HostedSkillParam.HostedSkillParamInline;

export namespace HostedSkillParam {
  /**
   * References a skill uploaded through the Skills API.
   */
  export interface HostedSkillParamSkillReference {
    /**
     * The ID of the skill created through `/v1/skills`.
     */
    skill_id: string;

    /**
     * The type of the object. Always `skill_reference`.
     */
    type: 'skill_reference';

    /**
     * The skill version, a positive integer or `latest`; omission selects the default.
     */
    version?: string | null;
  }

  /**
   * Supplies a skill ZIP directly in the session request.
   */
  export interface HostedSkillParamInline {
    /**
     * The skill description declared in `SKILL.md`.
     */
    description: string;

    /**
     * The skill name declared in `SKILL.md`.
     */
    name: string;

    /**
     * Provides ZIP bytes encoded with standard base64.
     */
    source: AgentsAPI.InlineCapabilitySourceParam;

    /**
     * The type of the object. Always `inline`.
     */
    type: 'inline';
  }
}

/**
 * A skill installed from the Skills API.
 */
export interface HostedSkillReference {
  /**
   * The installed skill description.
   */
  description: string;

  /**
   * The installed skill name.
   */
  name: string;

  /**
   * The referenced skill ID.
   */
  skill_id: string;

  /**
   * The type of the object. Always `skill_reference`.
   */
  type: 'skill_reference';

  /**
   * The concrete skill version installed for this session.
   */
  version: string;
}

/**
 * Provides ZIP bytes encoded with standard base64.
 */
export interface InlineCapabilitySourceParam {
  /**
   * Standard-base64 encoded ZIP archive bytes.
   */
  data: string;

  /**
   * The archive media type, always `application/zip`.
   */
  media_type: 'application/zip';

  /**
   * The type of the object. Always `base64`.
   */
  type: 'base64';
}

/**
 * User-provided content recorded in a session item.
 */
export type InputContent =
  | InputContent.InputContentResourceInputText
  | InputContent.InputContentResourceInputImage;

export namespace InputContent {
  /**
   * Text input recorded in a session item.
   */
  export interface InputContentResourceInputText {
    /**
     * The text supplied to the agent.
     */
    text: string;

    /**
     * The type of the object. Always `input_text`.
     */
    type: 'input_text';
  }

  /**
   * Image input recorded in a session item.
   */
  export interface InputContentResourceInputImage {
    /**
     * The URL of the image supplied to the agent, which may be a base64-encoded data
     * URL.
     */
    image_url: string;

    /**
     * The type of the object. Always `input_image`.
     */
    type: 'input_image';
  }
}

/**
 * Content included in an input message.
 */
export type InputContentParam =
  | InputContentParam.InputContentParamInputText
  | InputContentParam.InputContentParamInputImage;

export namespace InputContentParam {
  /**
   * Text input to the model.
   */
  export interface InputContentParamInputText {
    /**
     * The text sent to the model.
     */
    text: string;

    /**
     * The type of the object. Always `input_text`.
     */
    type: 'input_text';
  }

  /**
   * Image input to the model.
   */
  export interface InputContentParamInputImage {
    /**
     * The URL of the image sent to the model.
     */
    image_url: string;

    /**
     * The type of the object. Always `input_image`.
     */
    type: 'input_image';
  }
}

/**
 * The transport used to connect to an MCP server.
 */
export type McpTransport = McpTransport.McpTransportResourceHTTP | McpTransport.McpTransportResourceStdio;

export namespace McpTransport {
  /**
   * Connects to an MCP server over HTTP.
   */
  export interface McpTransportResourceHTTP {
    /**
     * The URL of the MCP server.
     */
    server_url: string;

    /**
     * The type of the object. Always `http`.
     */
    type: 'http';
  }

  /**
   * Starts an MCP server as a local process.
   */
  export interface McpTransportResourceStdio {
    /**
     * Arguments passed to the MCP server command.
     */
    args: Array<string>;

    /**
     * The command used to start the MCP server.
     */
    command: string;

    /**
     * The working directory used to start the MCP server.
     */
    cwd: string;

    /**
     * Environment variable names inherited from the execution environment.
     */
    env_vars: Array<string>;

    /**
     * The type of the object. Always `stdio`.
     */
    type: 'stdio';
  }
}

/**
 * The transport used to connect to an MCP server.
 */
export type McpTransportParam =
  | McpTransportParam.McpTransportConfigParamHTTP
  | McpTransportParam.McpTransportConfigParamStdio;

export namespace McpTransportParam {
  /**
   * Connects to an MCP server over HTTP.
   */
  export interface McpTransportConfigParamHTTP {
    /**
     * The URL of the MCP server.
     */
    server_url: string;

    /**
     * The type of the object. Always `http`.
     */
    type: 'http';

    /**
     * The authorization value sent to the MCP server, if any.
     */
    authorization?: string | null;

    /**
     * Additional HTTP headers sent to the MCP server.
     */
    headers?: { [key: string]: string } | null;
  }

  /**
   * Starts an MCP server as a local process.
   */
  export interface McpTransportConfigParamStdio {
    /**
     * The command used to start the MCP server.
     */
    command: string;

    /**
     * The working directory used to start the MCP server.
     */
    cwd: string;

    /**
     * The type of the object. Always `stdio`.
     */
    type: 'stdio';

    /**
     * Arguments passed to the MCP server command.
     */
    args?: Array<string> | null;

    /**
     * Environment variables set for the MCP server process.
     */
    env?: { [key: string]: string } | null;

    /**
     * Environment variable names to inherit from the selected execution environment.
     */
    env_vars?: Array<string> | null;
  }
}

/**
 * The resolved configuration for creating and coordinating subagents.
 */
export interface MultiAgentConfig {
  /**
   * Whether subagent tools are enabled. Defaults to false.
   */
  enabled: boolean;

  /**
   * Maximum number of subagents that may run concurrently, or null when disabled.
   * Defaults to 6 when enabled.
   */
  max_concurrent_subagents: number | null;
}

/**
 * Explicit configuration for creating and coordinating subagents.
 */
export interface MultiAgentConfigParam {
  /**
   * Whether subagent tools are enabled.
   */
  enabled: boolean;

  /**
   * Maximum number of subagents that may run concurrently. Defaults to 6.
   */
  max_concurrent_subagents?: number;
}

/**
 * A text content part produced by the agent.
 */
export interface OutputText {
  /**
   * The text produced by the agent.
   */
  text: string;

  /**
   * The content type. Always `output_text`.
   */
  type: 'output_text';
}

/**
 * A credential-free tool available to a reusable agent.
 */
export type PersistedAgentTool =
  | PersistedAgentTool.PersistedAgentToolResourceFunction
  | PersistedAgentTool.PersistedAgentToolResourceToolSearch
  | PersistedAgentTool.PersistedAgentToolResourceProgrammaticToolCalling
  | PersistedAgentTool.PersistedAgentToolResourceMcp
  | PersistedAgentTool.PersistedAgentToolResourceWebSearch;

export namespace PersistedAgentTool {
  /**
   * A function defined by the application.
   */
  export interface PersistedAgentToolResourceFunction {
    /**
     * Whether the function is deferred and discovered through tool search.
     */
    defer_loading: boolean;

    /**
     * A description of what the function does.
     */
    description: string;

    /**
     * The name of the function.
     */
    name: string;

    /**
     * A JSON Schema object describing the function's arguments.
     */
    parameters: { [key: string]: unknown };

    /**
     * The type of the object. Always `function`.
     */
    type: 'function';
  }

  /**
   * Discovers deferred function tools and loads them into the model context.
   */
  export interface PersistedAgentToolResourceToolSearch {
    /**
     * The type of the object. Always `tool_search`.
     */
    type: 'tool_search';
  }

  /**
   * Enables calling tools from model-generated code.
   */
  export interface PersistedAgentToolResourceProgrammaticToolCalling {
    /**
     * Whether tools can be called from model-generated code.
     */
    enabled: boolean;

    /**
     * The type of the object. Always `programmatic_tool_calling`.
     */
    type: 'programmatic_tool_calling';
  }

  /**
   * Tools provided by a remote MCP server without stored credentials.
   */
  export interface PersistedAgentToolResourceMcp {
    /**
     * The MCP tools the agent may call, or null when all server tools are allowed.
     */
    allowed_tools: Array<string> | null;

    /**
     * Where outbound MCP HTTP connections originate.
     */
    connection_origin: 'service' | 'environment';

    /**
     * The vault credential selected for this MCP server, if any.
     */
    credential_id: string | null;

    /**
     * Metadata included with requests to this MCP server.
     */
    request_metadata: { [key: string]: unknown };

    /**
     * Whether this MCP server must initialize before the first turn.
     */
    required: boolean;

    /**
     * A label used to identify the MCP server in tool calls.
     */
    server_label: string;

    /**
     * The credential-free transport used to connect to the MCP server.
     */
    transport: AgentsAPI.PersistedMcpTransport;

    /**
     * The type of the object. Always `mcp`.
     */
    type: 'mcp';
  }

  /**
   * Web search.
   */
  export interface PersistedAgentToolResourceWebSearch {
    /**
     * Allowed search domains, or `null` when the search is unrestricted.
     */
    allowed_domains: Array<string> | null;

    /**
     * The amount of search context made available to the model. Defaults to `medium`.
     */
    context_size: 'low' | 'medium' | 'high';

    /**
     * Approximate user location used to localize web search results.
     */
    location: PersistedAgentToolResourceWebSearch.Location | null;

    /**
     * The source used for web search results.
     */
    mode: 'disabled' | 'cached' | 'live';

    /**
     * The type of the object. Always `web_search`.
     */
    type: 'web_search';
  }

  export namespace PersistedAgentToolResourceWebSearch {
    /**
     * Approximate user location used to localize web search results.
     */
    export interface Location {
      /**
       * The city name.
       */
      city: string | null;

      /**
       * The two-letter ISO country code, such as `US`.
       */
      country: string | null;

      /**
       * The region or state name.
       */
      region: string | null;

      /**
       * The IANA timezone, such as `America/Los_Angeles`.
       */
      timezone: string | null;
    }
  }
}

/**
 * A tool that can be stored on a reusable agent without session credentials.
 */
export type PersistedAgentToolParam =
  | PersistedAgentToolParam.PersistedAgentToolConfigParamFunction
  | PersistedAgentToolParam.PersistedAgentToolConfigParamToolSearch
  | PersistedAgentToolParam.PersistedAgentToolConfigParamProgrammaticToolCalling
  | PersistedAgentToolParam.PersistedAgentToolConfigParamMcp
  | PersistedAgentToolParam.PersistedAgentToolConfigParamWebSearch;

export namespace PersistedAgentToolParam {
  /**
   * A function defined by the application.
   */
  export interface PersistedAgentToolConfigParamFunction {
    /**
     * A description of what the function does.
     */
    description: string;

    /**
     * The name of the function.
     */
    name: string;

    /**
     * A JSON Schema object describing the function's arguments.
     */
    parameters: { [key: string]: unknown };

    /**
     * The type of the object. Always `function`.
     */
    type: 'function';

    /**
     * Whether this function is deferred and discovered through tool search. Defaults
     * to `false`.
     */
    defer_loading?: boolean;
  }

  /**
   * Discovers deferred function tools and loads them into the model context.
   */
  export interface PersistedAgentToolConfigParamToolSearch {
    /**
     * The type of the object. Always `tool_search`.
     */
    type: 'tool_search';
  }

  /**
   * Enables calling tools from model-generated code.
   */
  export interface PersistedAgentToolConfigParamProgrammaticToolCalling {
    /**
     * The type of the object. Always `programmatic_tool_calling`.
     */
    type: 'programmatic_tool_calling';

    /**
     * Whether tools can be called from model-generated code. Defaults to `true`.
     */
    enabled?: boolean;
  }

  /**
   * Tools provided by a remote MCP server without stored credentials.
   */
  export interface PersistedAgentToolConfigParamMcp {
    /**
     * A label used to identify the MCP server in tool calls.
     */
    server_label: string;

    /**
     * The credential-free transport used to connect to the MCP server.
     */
    transport: AgentsAPI.PersistedMcpTransportParam;

    /**
     * The type of the object. Always `mcp`.
     */
    type: 'mcp';

    /**
     * The MCP tools the agent may call. All server tools are allowed when omitted.
     */
    allowed_tools?: Array<string> | null;

    /**
     * Where outbound MCP HTTP connections originate.
     *
     * - `service` - Uses the Managed Agents service network.
     * - `environment` - Uses the session's execution environment.
     */
    connection_origin?: 'service' | 'environment' | null;

    /**
     * The vault credential selected for this MCP server. Optional when exactly one
     * attached credential matches the server URL.
     */
    credential_id?: string | null;

    /**
     * Metadata included with requests to this MCP server.
     */
    request_metadata?: { [key: string]: unknown } | null;

    /**
     * Whether this MCP server must initialize before the first turn. Defaults to
     * `false`.
     */
    required?: boolean;
  }

  /**
   * Web search.
   */
  export interface PersistedAgentToolConfigParamWebSearch {
    /**
     * The type of the object. Always `web_search`.
     */
    type: 'web_search';

    /**
     * Domains the search may include.
     */
    allowed_domains?: Array<string> | null;

    /**
     * The amount of web search context made available to the model.
     */
    context_size?: 'low' | 'medium' | 'high' | null;

    /**
     * Approximate user location used to localize web search results.
     */
    location?: PersistedAgentToolConfigParamWebSearch.Location | null;

    /**
     * The source used for web search results.
     *
     * - `disabled` - Disables web search.
     * - `cached` - Uses cached search results.
     * - `live` - Searches the live web.
     */
    mode?: 'disabled' | 'cached' | 'live' | null;
  }

  export namespace PersistedAgentToolConfigParamWebSearch {
    /**
     * Approximate user location used to localize web search results.
     */
    export interface Location {
      /**
       * The city name.
       */
      city?: string | null;

      /**
       * The two-letter ISO country code, such as `US`.
       */
      country?: string | null;

      /**
       * The region or state name.
       */
      region?: string | null;

      /**
       * The IANA timezone, such as `America/Los_Angeles`.
       */
      timezone?: string | null;
    }
  }
}

/**
 * A credential-free transport used to connect to an MCP server.
 */
export type PersistedMcpTransport =
  | PersistedMcpTransport.PersistedMcpTransportResourceHTTP
  | PersistedMcpTransport.PersistedMcpTransportResourceStdio;

export namespace PersistedMcpTransport {
  /**
   * Connects to an MCP server over HTTP.
   */
  export interface PersistedMcpTransportResourceHTTP {
    /**
     * Non-secret HTTP headers sent to the MCP server.
     */
    headers: { [key: string]: string };

    /**
     * The URL of the MCP server.
     */
    server_url: string;

    /**
     * The type of the object. Always `http`.
     */
    type: 'http';
  }

  /**
   * Starts an MCP server as a local process.
   */
  export interface PersistedMcpTransportResourceStdio {
    /**
     * Arguments passed to the MCP server command.
     */
    args: Array<string>;

    /**
     * The command used to start the MCP server.
     */
    command: string;

    /**
     * The working directory used to start the MCP server.
     */
    cwd: string;

    /**
     * Environment variable names inherited from the execution environment.
     */
    env_vars: Array<string>;

    /**
     * The type of the object. Always `stdio`.
     */
    type: 'stdio';
  }
}

/**
 * A credential-free transport used to connect to an MCP server.
 */
export type PersistedMcpTransportParam =
  | PersistedMcpTransportParam.PersistedMcpTransportConfigParamHTTP
  | PersistedMcpTransportParam.PersistedMcpTransportConfigParamStdio;

export namespace PersistedMcpTransportParam {
  /**
   * Connects to an MCP server over HTTP.
   */
  export interface PersistedMcpTransportConfigParamHTTP {
    /**
     * The URL of the MCP server.
     */
    server_url: string;

    /**
     * The type of the object. Always `http`.
     */
    type: 'http';

    /**
     * Non-secret HTTP headers sent to the MCP server.
     */
    headers?: { [key: string]: string } | null;
  }

  /**
   * Starts an MCP server as a local process.
   */
  export interface PersistedMcpTransportConfigParamStdio {
    /**
     * The command used to start the MCP server.
     */
    command: string;

    /**
     * The working directory used to start the MCP server.
     */
    cwd: string;

    /**
     * The type of the object. Always `stdio`.
     */
    type: 'stdio';

    /**
     * Arguments passed to the MCP server command.
     */
    args?: Array<string> | null;

    /**
     * Environment variable names to inherit from the selected execution environment.
     */
    env_vars?: Array<string> | null;
  }
}

/**
 * An error payload with the same public fields as Responses API streaming errors.
 */
export interface SessionError {
  /**
   * The machine-readable error code, if any.
   */
  code: string | null;

  /**
   * A customer-safe explanation of the error.
   */
  message: string;

  /**
   * The request parameter associated with the error, if any.
   */
  param: string | null;

  /**
   * The error type.
   */
  type: string;
}

/**
 * A customer-safe error describing why a session request failed.
 */
export interface SessionTurnError {
  /**
   * A stable, machine-readable failure category.
   *
   * - `context_length_exceeded` - The request exceeds the model's context window.
   * - `session_budget_exceeded` - The session has reached its usage budget.
   * - `usage_limit_exceeded` - The organization has reached a usage, plan, or
   *   billing limit.
   * - `rate_limit_exceeded` - The request exceeds the available rate limit.
   * - `server_overloaded` - The model service is temporarily overloaded.
   * - `cyber_policy` - The request was rejected by a safety policy.
   * - `connection_failed` - The request could not connect to the model service.
   * - `server_error` - The model service encountered an unexpected error.
   * - `authentication_error` - The API credentials are invalid or lack the required
   *   access.
   * - `invalid_request` - The request contains invalid input or configuration.
   * - `resource_not_found` - The requested model or resource is unavailable.
   * - `sandbox_error` - The request could not complete in its execution environment.
   * - `executor_version_incompatible` - The executor must be upgraded before it can
   *   run this turn.
   * - `active_turn_not_steerable` - The session cannot accept additional input while
   *   a request is running.
   * - `request_timeout` - The request timed out before the model service responded.
   * - `internal_error` - An unexpected internal error prevented the session request
   *   from completing.
   */
  code:
    | 'context_length_exceeded'
    | 'session_budget_exceeded'
    | 'usage_limit_exceeded'
    | 'rate_limit_exceeded'
    | 'server_overloaded'
    | 'cyber_policy'
    | 'connection_failed'
    | 'server_error'
    | 'authentication_error'
    | 'invalid_request'
    | 'resource_not_found'
    | 'sandbox_error'
    | 'executor_version_incompatible'
    | 'active_turn_not_steerable'
    | 'request_timeout'
    | 'internal_error';

  /**
   * A customer-safe explanation of the failure.
   */
  message: string;
}

/**
 * A confidential setup command executed before the hosted agent starts.
 */
export interface SetupCommandParam {
  /**
   * The shell command to execute.
   */
  command: string;

  /**
   * The absolute working directory. Defaults to `/workspace`.
   */
  cwd?: string | null;
}

/**
 * A subagent created within a session.
 */
export interface Subagent {
  /**
   * The ID of the subagent.
   */
  id: string;

  /**
   * The Unix timestamp, in seconds, when the subagent was closed. Null while active,
   * including after resume.
   */
  closed_at: number | null;

  /**
   * Initial task content, or null when unavailable. Text may contain placeholders
   * for images or audio when only a preview is available.
   */
  instructions: Array<AgentContent> | null;

  /**
   * The runner-assigned nickname, or null when unavailable.
   */
  name: string | null;

  /**
   * The object type. Always `agent.session.subagent`.
   */
  object: 'agent.session.subagent';

  /**
   * The Unix timestamp, in seconds, when the subagent was first opened. Resuming
   * does not change it.
   */
  opened_at: number;

  /**
   * The ID of the agent that created this subagent.
   */
  parent_agent_id: string;

  /**
   * The ID of the session that owns the subagent.
   */
  session_id: string;

  /**
   * The current status of the subagent.
   *
   * - `active` - The subagent remains available, including while idle between turns.
   * - `closed` - The subagent is closed.
   */
  status: 'active' | 'closed';
}

/**
 * A reasoning summary content part.
 */
export interface SummaryText {
  /**
   * The reasoning summary text.
   */
  text: string;

  /**
   * The content type. Always `summary_text`.
   */
  type: 'summary_text';
}

/**
 * The effective output format for generated text.
 */
export type TextFormat = TextFormat.TextFormatResourceText | TextFormat.TextFormatResourceJSONSchema;

export namespace TextFormat {
  /**
   * Generates ordinary text without a structured-output constraint.
   */
  export interface TextFormatResourceText {
    /**
     * The type of the object. Always `text`.
     */
    type: 'text';
  }

  /**
   * Constrains generated text to a JSON Schema.
   */
  export interface TextFormatResourceJSONSchema {
    /**
     * The JSON Schema that generated text must match.
     */
    schema: { [key: string]: unknown };

    /**
     * The type of the object. Always `json_schema`.
     */
    type: 'json_schema';
  }
}

/**
 * The output format for generated text.
 */
export type TextFormatParam = TextFormatParam.TextFormatParamText | TextFormatParam.TextFormatParamJSONSchema;

export namespace TextFormatParam {
  /**
   * Generates ordinary text without a structured-output constraint.
   */
  export interface TextFormatParamText {
    /**
     * The type of the object. Always `text`.
     */
    type: 'text';
  }

  /**
   * Constrains generated text to a JSON Schema.
   */
  export interface TextFormatParamJSONSchema {
    /**
     * The JSON Schema that generated text must match.
     */
    schema: { [key: string]: unknown };

    /**
     * The type of the object. Always `json_schema`.
     */
    type: 'json_schema';
  }
}

/**
 * Recorded token usage for a session or turn. Usage is best effort and may change.
 */
export interface TokenUsage {
  /**
   * The number of input tokens used by the agent.
   */
  input_tokens: number;

  /**
   * A breakdown of the agent's input token usage.
   */
  input_tokens_details: TokenUsage.InputTokensDetails;

  /**
   * The number of output tokens generated by the agent.
   */
  output_tokens: number;

  /**
   * A breakdown of the agent's output token usage.
   */
  output_tokens_details: TokenUsage.OutputTokensDetails;

  /**
   * The total number of input and output tokens used by the agent.
   */
  total_tokens: number;
}

export namespace TokenUsage {
  /**
   * A breakdown of the agent's input token usage.
   */
  export interface InputTokensDetails {
    /**
     * The number of input tokens retrieved from the prompt cache.
     */
    cached_tokens: number;
  }

  /**
   * A breakdown of the agent's output token usage.
   */
  export interface OutputTokensDetails {
    /**
     * The number of output tokens used for reasoning.
     */
    reasoning_tokens: number;
  }
}

/**
 * An action performed by the web search tool.
 */
export type WebSearchAction =
  | WebSearchAction.WebSearchActionResourceSearch
  | WebSearchAction.WebSearchActionResourceOpenPage
  | WebSearchAction.WebSearchActionResourceFindInPage
  | WebSearchAction.WebSearchActionResourceOther;

export namespace WebSearchAction {
  /**
   * A search query or group of search queries.
   */
  export interface WebSearchActionResourceSearch {
    /**
     * The search queries, when multiple queries were used.
     */
    queries: Array<string> | null;

    /**
     * The search query, when a single query was used.
     */
    query: string | null;

    /**
     * The type of the object. Always `search`.
     */
    type: 'search';
  }

  /**
   * Opens a web page.
   */
  export interface WebSearchActionResourceOpenPage {
    /**
     * The type of the object. Always `open_page`.
     */
    type: 'open_page';

    /**
     * The URL of the page that was opened.
     */
    url: string | null;
  }

  /**
   * Finds text within a web page.
   */
  export interface WebSearchActionResourceFindInPage {
    /**
     * The text pattern that was searched for.
     */
    pattern: string | null;

    /**
     * The type of the object. Always `find_in_page`.
     */
    type: 'find_in_page';

    /**
     * The URL of the page that was searched.
     */
    url: string | null;
  }

  /**
   * Another web search action.
   */
  export interface WebSearchActionResourceOther {
    /**
     * The type of the object. Always `other`.
     */
    type: 'other';
  }
}

export interface AgentCreateParams {
  /**
   * The model to use for the agent. The requested model name is preserved.
   */
  model: string;

  /**
   * Additional instructions appended to the agent's default base instructions. Omit
   * or set to null to add no custom instructions.
   */
  instructions?: string | null;

  /**
   * Up to 16 string key-value pairs, with keys up to 64 and values up to 512
   * characters. Omission or null defaults to an empty map.
   */
  metadata?: { [key: string]: string } | null;

  /**
   * Explicit configuration for creating and coordinating subagents.
   */
  multi_agent?: MultiAgentConfigParam | null;

  /**
   * A human-readable name for the agent. Omission or null leaves the agent unnamed.
   */
  name?: string | null;

  /**
   * Reasoning configuration for the agent.
   */
  reasoning?: AgentReasoningParam | null;

  /**
   * The service tier used for model requests.
   *
   * - `auto` - Selects the service tier automatically.
   * - `default` - Uses the default service tier.
   * - `flex` - Uses the flex service tier.
   * - `priority` - Uses the priority service tier.
   * - `fast` - Uses the fast service tier.
   */
  service_tier?: 'auto' | 'default' | 'flex' | 'priority' | 'fast' | null;

  /**
   * Configuration for text generated by the agent.
   */
  text?: AgentTextParam | null;

  /**
   * Tools available to the agent. Defaults to an empty list.
   */
  tools?: Array<PersistedAgentToolParam> | null;
}

export interface AgentUpdateParams {
  /**
   * Additional instructions appended to the agent's default base instructions. Omit
   * to leave unchanged.
   */
  instructions?: string | null;

  /**
   * Replaces all metadata. Omit to leave unchanged, or pass null or {} to clear it.
   * Up to 16 string key-value pairs, with keys up to 64 and values up to 512
   * characters.
   */
  metadata?: { [key: string]: string } | null;

  /**
   * The model to use for the agent. The requested model name is preserved.
   */
  model?: string;

  /**
   * Explicit configuration for creating and coordinating subagents.
   */
  multi_agent?: MultiAgentConfigParam | null;

  /**
   * A replacement name. Omit to leave unchanged, or pass null to clear it.
   */
  name?: string | null;

  /**
   * Reasoning configuration for the agent.
   */
  reasoning?: AgentReasoningParam | null;

  /**
   * The service tier used for model requests.
   *
   * - `auto` - Selects the service tier automatically.
   * - `default` - Uses the default service tier.
   * - `flex` - Uses the flex service tier.
   * - `priority` - Uses the priority service tier.
   * - `fast` - Uses the fast service tier.
   */
  service_tier?: 'auto' | 'default' | 'flex' | 'priority' | 'fast' | null;

  /**
   * Configuration for text generated by the agent.
   */
  text?: AgentTextParam | null;

  /**
   * Tools available to the agent.
   */
  tools?: Array<PersistedAgentToolParam> | null;
}

export interface AgentListParams extends CursorPageParams {
  /**
   * The order in which resources are returned. Defaults to `desc`.
   *
   * - `asc` - Returns resources in ascending order.
   * - `desc` - Returns resources in descending order.
   */
  order?: 'asc' | 'desc';
}

Agents.Environments = Environments;
Agents.Vaults = Vaults;
Agents.Sessions = Sessions;

export declare namespace Agents {
  export {
    type Agent as Agent,
    type AgentCloseSubagentCallItem as AgentCloseSubagentCallItem,
    type AgentCommandExecutionItem as AgentCommandExecutionItem,
    type AgentContent as AgentContent,
    type AgentCreateSubagentCallItem as AgentCreateSubagentCallItem,
    type AgentDeleted as AgentDeleted,
    type AgentFunctionCallItem as AgentFunctionCallItem,
    type AgentFunctionCallOutput as AgentFunctionCallOutput,
    type AgentFunctionCallOutputParam as AgentFunctionCallOutputParam,
    type AgentFunctionCallStatus as AgentFunctionCallStatus,
    type AgentInterruptSubagentCallItem as AgentInterruptSubagentCallItem,
    type AgentMcpCallItem as AgentMcpCallItem,
    type AgentOutputCommandExecutionOutputDeltaEvent as AgentOutputCommandExecutionOutputDeltaEvent,
    type AgentOutputItem as AgentOutputItem,
    type AgentOutputItemStatus as AgentOutputItemStatus,
    type AgentReasoning as AgentReasoning,
    type AgentReasoningItem as AgentReasoningItem,
    type AgentReasoningParam as AgentReasoningParam,
    type AgentResumeSubagentCallItem as AgentResumeSubagentCallItem,
    type AgentSendSubagentInputCallItem as AgentSendSubagentInputCallItem,
    type AgentSession as AgentSession,
    type AgentSessionAssistantMessage as AgentSessionAssistantMessage,
    type AgentSessionCreatedEvent as AgentSessionCreatedEvent,
    type AgentSessionDeleted as AgentSessionDeleted,
    type AgentSessionEnvironmentConnectedEvent as AgentSessionEnvironmentConnectedEvent,
    type AgentSessionEnvironmentDisconnectedEvent as AgentSessionEnvironmentDisconnectedEvent,
    type AgentSessionEnvironmentFailedEvent as AgentSessionEnvironmentFailedEvent,
    type AgentSessionEnvironmentPendingEvent as AgentSessionEnvironmentPendingEvent,
    type AgentSessionEnvironmentReadyEvent as AgentSessionEnvironmentReadyEvent,
    type AgentSessionEnvironmentState as AgentSessionEnvironmentState,
    type AgentSessionErrorEvent as AgentSessionErrorEvent,
    type AgentSessionEvent as AgentSessionEvent,
    type AgentSessionFailedEvent as AgentSessionFailedEvent,
    type AgentSessionIdleEvent as AgentSessionIdleEvent,
    type AgentSessionInProgressEvent as AgentSessionInProgressEvent,
    type AgentSessionInputMessageParam as AgentSessionInputMessageParam,
    type AgentSessionInputParam as AgentSessionInputParam,
    type AgentSessionItem as AgentSessionItem,
    type AgentSessionMessage as AgentSessionMessage,
    type AgentSessionMessageContent as AgentSessionMessageContent,
    type AgentSessionRequiresActionEvent as AgentSessionRequiresActionEvent,
    type AgentSessionSubagentActiveEvent as AgentSessionSubagentActiveEvent,
    type AgentSessionSubagentClosedEvent as AgentSessionSubagentClosedEvent,
    type AgentSessionSubagentCreatedEvent as AgentSessionSubagentCreatedEvent,
    type AgentSessionTurnCancelledEvent as AgentSessionTurnCancelledEvent,
    type AgentSessionTurnCompletedEvent as AgentSessionTurnCompletedEvent,
    type AgentSessionTurnContentPartAddedEvent as AgentSessionTurnContentPartAddedEvent,
    type AgentSessionTurnContentPartDoneEvent as AgentSessionTurnContentPartDoneEvent,
    type AgentSessionTurnCreatedEvent as AgentSessionTurnCreatedEvent,
    type AgentSessionTurnFailedEvent as AgentSessionTurnFailedEvent,
    type AgentSessionTurnInProgressEvent as AgentSessionTurnInProgressEvent,
    type AgentSessionTurnItemAddedEvent as AgentSessionTurnItemAddedEvent,
    type AgentSessionTurnItemDoneEvent as AgentSessionTurnItemDoneEvent,
    type AgentSessionTurnOutputTextDeltaEvent as AgentSessionTurnOutputTextDeltaEvent,
    type AgentSessionTurnOutputTextDoneEvent as AgentSessionTurnOutputTextDoneEvent,
    type AgentSessionTurnReasoningSummaryPartAddedEvent as AgentSessionTurnReasoningSummaryPartAddedEvent,
    type AgentSessionTurnReasoningSummaryPartDoneEvent as AgentSessionTurnReasoningSummaryPartDoneEvent,
    type AgentSessionTurnReasoningSummaryTextDeltaEvent as AgentSessionTurnReasoningSummaryTextDeltaEvent,
    type AgentSessionTurnReasoningSummaryTextDoneEvent as AgentSessionTurnReasoningSummaryTextDoneEvent,
    type AgentText as AgentText,
    type AgentTextParam as AgentTextParam,
    type AgentTool as AgentTool,
    type AgentToolParam as AgentToolParam,
    type AgentWaitForSubagentsCallItem as AgentWaitForSubagentsCallItem,
    type AgentWebSearchCallItem as AgentWebSearchCallItem,
    type Environment as Environment,
    type EnvironmentParam as EnvironmentParam,
    type HostedEnvironmentFile as HostedEnvironmentFile,
    type HostedEnvironmentFileID as HostedEnvironmentFileID,
    type HostedEnvironmentFileParam as HostedEnvironmentFileParam,
    type HostedPlugin as HostedPlugin,
    type HostedPluginParam as HostedPluginParam,
    type HostedSkill as HostedSkill,
    type HostedSkillParam as HostedSkillParam,
    type HostedSkillReference as HostedSkillReference,
    type InlineCapabilitySourceParam as InlineCapabilitySourceParam,
    type InputContent as InputContent,
    type InputContentParam as InputContentParam,
    type McpTransport as McpTransport,
    type McpTransportParam as McpTransportParam,
    type MultiAgentConfig as MultiAgentConfig,
    type MultiAgentConfigParam as MultiAgentConfigParam,
    type OutputText as OutputText,
    type PersistedAgentTool as PersistedAgentTool,
    type PersistedAgentToolParam as PersistedAgentToolParam,
    type PersistedMcpTransport as PersistedMcpTransport,
    type PersistedMcpTransportParam as PersistedMcpTransportParam,
    type SessionError as SessionError,
    type SessionTurnError as SessionTurnError,
    type SetupCommandParam as SetupCommandParam,
    type Subagent as Subagent,
    type SummaryText as SummaryText,
    type TextFormat as TextFormat,
    type TextFormatParam as TextFormatParam,
    type TokenUsage as TokenUsage,
    type WebSearchAction as WebSearchAction,
    type AgentsPage as AgentsPage,
    type AgentCreateParams as AgentCreateParams,
    type AgentUpdateParams as AgentUpdateParams,
    type AgentListParams as AgentListParams,
  };

  export { Environments as Environments, type EnvironmentInfo as EnvironmentInfo };

  export {
    Vaults as Vaults,
    type Vault as Vault,
    type VaultDeleted as VaultDeleted,
    type VaultStatus as VaultStatus,
    type VaultStatusFilter as VaultStatusFilter,
    type VaultsPage as VaultsPage,
    type VaultCreateParams as VaultCreateParams,
    type VaultListParams as VaultListParams,
  };

  export {
    Sessions as Sessions,
    type SessionCreateParams as SessionCreateParams,
    type SessionCreateParamsNonStreaming as SessionCreateParamsNonStreaming,
    type SessionCreateParamsStreaming as SessionCreateParamsStreaming,
    type SessionUpdateParams as SessionUpdateParams,
    type SessionListParams as SessionListParams,
  };
}
