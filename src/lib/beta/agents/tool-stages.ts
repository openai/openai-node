import type { AgentToolHandler } from '../../agents/agent-session-stream';
import type { AgentToolError } from './tool-error';

/** @internal */
export const toolStages = Symbol.for('openai.beta.agents.toolStages');

/**
 * Marks handlers that accept stage updates, including across ESM/CJS imports.
 * @internal
 */
export type StagedToolHandler = ((
  arguments_: Parameters<AgentToolHandler>[0],
  setStage?: (stage: AgentToolError['stage']) => void,
) => ReturnType<AgentToolHandler>) & { [toolStages]?: true };
