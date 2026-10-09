/**
 * Beta diagnostic for logging or monitoring failures from local `toolHandlers`.
 * The original error is local only; API and transport failures propagate separately.
 */
export interface AgentToolError {
  readonly error: unknown;
  readonly tool_name: string;
  readonly session_id: string;
  readonly turn_id: string;
  readonly call_id: string;
  readonly stage: 'arguments' | 'execution' | 'output';
}
