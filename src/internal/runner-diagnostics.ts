import type { ResponseUsage } from '../resources/responses/responses';
import type { Decision } from '../resources/decisions';

/** Local execution evidence. Call identities can contain application data; inspect before sharing. */
export interface RunnerDiagnostic {
  api: 'responses' | 'decisions' | 'browser' | 'computer';
  stage: 'run' | 'request' | 'arguments' | 'approval' | 'action' | 'output' | 'selection' | 'verification';
  reason:
    | 'started'
    | 'completed'
    | 'refused'
    | 'cancelled'
    | 'invalid_input'
    | 'invalid_output'
    | 'api_failed'
    | 'driver_failed'
    | 'policy_failed'
    | 'step_limit'
    | 'busy'
    | 'closed';
  call_id: string | null;
  member: string | null;
  duration_ms: number;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
}

/** Observers cannot change an execution result. Promise failures are consumed without waiting. */
export type RunnerDiagnosticObserver = (event: Readonly<RunnerDiagnostic>) => void;

const failureReasons = {
  run: 'invalid_output',
  request: 'api_failed',
  arguments: 'invalid_input',
  approval: 'policy_failed',
  action: 'driver_failed',
  output: 'invalid_output',
  selection: 'invalid_output',
  verification: 'invalid_output',
} as const satisfies Record<RunnerDiagnostic['stage'], RunnerDiagnostic['reason']>;

export function diagnosticFailure(
  stage: RunnerDiagnostic['stage'],
  signal?: AbortSignal,
): RunnerDiagnostic['reason'] {
  return signal?.aborted ? 'cancelled' : failureReasons[stage];
}

async function settleDiagnostic(result: ReturnType<RunnerDiagnosticObserver>): Promise<void> {
  try {
    await result;
  } catch {
    // Observer failures must not change the execution they describe.
  }
}

export function reportDiagnostic(
  observer: RunnerDiagnosticObserver | undefined,
  event: Pick<RunnerDiagnostic, 'api' | 'stage' | 'reason'> &
    Partial<Pick<RunnerDiagnostic, 'call_id' | 'member'>>,
  started: number,
  nativeUsage?: ResponseUsage | Decision['usage'] | null,
): void {
  if (!observer) {
    return;
  }
  try {
    let usage: RunnerDiagnostic['usage'] = null;
    if (nativeUsage) {
      const { input_tokens, output_tokens, total_tokens } = nativeUsage;
      if (
        Number.isSafeInteger(input_tokens) &&
        input_tokens >= 0 &&
        Number.isSafeInteger(output_tokens) &&
        output_tokens >= 0 &&
        Number.isSafeInteger(total_tokens) &&
        total_tokens >= 0
      ) {
        usage = { input_tokens, output_tokens, total_tokens };
      }
    }
    const result = observer({
      ...event,
      call_id: event.call_id ?? null,
      member: event.member ?? null,
      duration_ms: Math.max(0, performance.now() - started),
      usage,
    });
    // Diagnostics never wait for a sink, and rejected observers cannot change dispatch.
    void settleDiagnostic(result);
  } catch {
    // Even a broken usage field or observer is outside execution policy.
  }
}
