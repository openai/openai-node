import type { AgentToolHandler } from '../../agents/agent-session-stream';
import type { AgentToolError } from './tool-error';

/** @internal */
export const toolStages = Symbol.for('openai.beta.agents.toolStages');

/**
 * Handler metadata works across ESM/CJS imports without wrapping original errors.
 * @internal
 */
export type StagedToolHandler = AgentToolHandler & {
  [toolStages]?: (
    arguments_: Parameters<AgentToolHandler>[0],
    setStage: (stage: AgentToolError['stage']) => void,
  ) => ReturnType<AgentToolHandler>;
};
