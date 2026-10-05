import type { AgentToolHandler } from '../../agents/agent-session-stream';
import type { AgentToolError } from './tool-error';

/**
 * Keeps typed handlers callable directly without wrapping their original errors.
 * @internal
 */
export const stagedToolHandlers = new WeakMap<
  AgentToolHandler,
  (
    arguments_: Parameters<AgentToolHandler>[0],
    setStage: (stage: AgentToolError['stage']) => void,
  ) => ReturnType<AgentToolHandler>
>();
