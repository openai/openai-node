import { tasks } from './tasks.mjs';

const owners = ['agent', 'draining-to-human', 'human', 'draining-to-agent', 'stopped'];
const phases = ['prepare', 'transfer', 'cleanup'];
const fileStatuses = ['ready', 'in_progress', 'completed', 'refused', 'interrupted', 'unknown', 'failed'];
const cleanupStatuses = ['not_started', 'pending', 'completed', 'failed'];
const member = (value, choices, fallback = null) => (choices.includes(value) ? value : fallback);
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
const milliseconds = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);

export function recordReceipt(run, value) {
  const entry = { ...value, atMs: milliseconds(performance.now() - run.started) };
  run.receipts ??= [];
  run.receipts.push(entry);
  if (run.receipts.length > 256) {
    run.receipts.shift();
    run.receiptsDropped = count(run.receiptsDropped) + 1;
  }
  return entry;
}

export async function recordRequest(run, send, signal) {
  const started = performance.now();
  const receipt =
    run.mode === 'live'
      ? recordReceipt(run, {
          kind: 'request',
          attempt: run.requests,
          phase: 'pending',
          status: null,
          headersMs: null,
          durationMs: null,
        })
      : null;
  const finish = (phase) => {
    if (receipt && receipt.durationMs === null) {
      if (phase) {
        receipt.phase = phase;
      }
      receipt.durationMs = performance.now() - started;
    }
  };
  try {
    const response = await send();
    const headersMs = performance.now() - started;
    if (receipt) {
      receipt.phase = 'headers';
      receipt.status = response.status;
      receipt.headersMs = headersMs;
      run.requestHeadersMs += headersMs;
    }
    if (!receipt || !response.body) {
      finish();
      return { response, headersMs };
    }
    const reader = response.body.getReader();
    let cancelling = false;
    const body = new ReadableStream(
      {
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            // Cancelling the source also resolves pending reads as EOF. Only the
            // cancel path can finalize their timing and release the reader.
            if (cancelling) {
              return;
            }
            if (done) {
              finish();
              reader.releaseLock();
              controller.close();
            } else {
              controller.enqueue(value);
            }
          } catch (error) {
            if (!cancelling) {
              finish(signal?.aborted ? 'cancelled' : 'failed');
              reader.releaseLock();
              controller.error(error);
            }
          }
        },
        async cancel(reason) {
          cancelling = true;
          try {
            await reader.cancel(reason);
            finish('cancelled');
          } catch (error) {
            finish(signal?.aborted ? 'cancelled' : 'failed');
            throw error;
          } finally {
            reader.releaseLock();
          }
        },
      },
      { highWaterMark: 0 },
    );
    const recorded = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperties(recorded, {
      url: { value: response.url },
      type: { value: response.type },
      redirected: { value: response.redirected },
    });
    return { response: recorded, headersMs };
  } catch (error) {
    finish(signal?.aborted ? 'cancelled' : 'failed');
    throw error;
  }
}

function publicEvent(event) {
  const atMs = milliseconds(event.atMs);
  switch (event.kind) {
    case 'request': {
      return {
        kind: 'request',
        atMs,
        attempt: count(event.attempt),
        phase: member(event.phase, ['pending', 'headers', 'failed', 'cancelled']),
        status:
          Number.isInteger(event.status) && event.status >= 100 && event.status <= 599 ? event.status : null,
        headersMs: event.headersMs === null ? null : milliseconds(event.headersMs),
        durationMs: event.durationMs === null ? null : milliseconds(event.durationMs),
      };
    }
    case 'approval': {
      return {
        kind: 'approval',
        atMs,
        outcome: member(event.outcome, ['offered', 'approved', 'refused', 'expired', 'cancelled']),
      };
    }
    case 'control': {
      return { kind: 'control', atMs, owner: member(event.owner, owners) };
    }
    case 'cleanup': {
      return { kind: 'cleanup', atMs, outcome: member(event.outcome, cleanupStatuses) };
    }
    case 'tools': {
      return {
        kind: 'tools',
        atMs,
        phaseIndex: count(event.phaseIndex),
        phase: member(event.phase, ['boundary', 'pending', 'final']),
        attempted: count(event.attempted),
        returned: count(event.returned),
      };
    }
    default: {
      return null;
    }
  }
}

function fileState(state) {
  if (!state || state.version !== 1) {
    return null;
  }
  const effect = (value) => member(value, ['none', 'completed', 'unknown']);
  return {
    version: 1,
    direction: member(state.direction, ['upload', 'download']),
    current: state.current
      ? { status: member(state.current.status, fileStatuses), effect: effect(state.current.effect) }
      : null,
    cleanup: member(state.cleanup, cleanupStatuses),
    earlier_omitted: state.earlier_omitted === true,
    recent: Array.isArray(state.recent)
      ? state.recent.slice(-32).map((change) => ({
          phase: member(change.phase, phases),
          status: member(change.status, [...fileStatuses, ...cleanupStatuses]),
          ...(change.effect === undefined ? {} : { effect: effect(change.effect) }),
        }))
      : [],
  };
}

/** A fixed projection. Model text, error strings, image data and native ledger history never enter it. */
export function exportRun(run) {
  const file = fileState(run.session?.fileState?.());
  return {
    version: 1,
    id: typeof run.id === 'string' && /^[a-f0-9-]{36}$/u.test(run.id) ? run.id : null,
    environment: ['desktop', 'mixed'].includes(run.environment) ? run.environment : 'browser',
    taskId: Object.hasOwn(tasks, run.taskId) || ['desktop', 'mixed'].includes(run.taskId) ? run.taskId : null,
    api: member(run.api, ['responses', 'decisions']),
    mode: member(run.mode, ['live', 'rehearsal']),
    status: member(
      run.status,
      [
        'running',
        'paused',
        'complete',
        'unverified',
        'refused',
        'approval_expired',
        'stopped',
        'failed',
        'expired',
        'view_failed',
        'input_failed',
        'handoff_failed',
        'handoff_unavailable',
        'uncertain',
        'browser_closed',
        'cleanup_failed',
      ],
      'unknown',
    ),
    owner: member(run.owner, owners),
    result: member(run.result, ['verified', 'unverified']),
    uncertainEffects:
      run.uncertainEffects === true ||
      run.session?.hasUncertainEffects?.() === true ||
      file?.current?.effect === 'unknown',
    cleanup: member(run.cleanup, cleanupStatuses, 'not_started'),
    requests: count(run.requests),
    turns: count(run.turns),
    stepLimit: count(run.stepLimit),
    elapsedMs: milliseconds(
      run.owner === 'stopped' && !run.agentActive ? run.elapsedMs : performance.now() - run.started,
    ),
    requestHeadersMs: milliseconds(run.requestHeadersMs),
    diagnostics: run.diagnostics?.summary(run.requests) ?? null,
    droppedEvents: count(run.receiptsDropped),
    events: (run.receipts ?? []).map(publicEvent).filter((event) => event !== null),
    file,
  };
}
