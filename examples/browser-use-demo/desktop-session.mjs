import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';
import { Desktop } from '../computer-desktop/desktop.mjs';
import { DesktopStartupError } from '../computer-desktop/startup-error.mjs';
import { createDesktopLedger } from './desktop-ledger.mjs';
import { recordReceipt, recordRequest } from './run-receipt.mjs';
import { waitForDecision } from '../responses/browser/file-state.mjs';

const task =
  'This is an isolated Linux desktop with a local synthetic task. In the browser on the left, route D-2201. In the editor on the right, write exactly Desktop receipt D-2201 and save the open result.txt. Inspect the current screen before acting: a human may have completed part of the task. Do not repeat completed work. Stop once both results are present.';

const keys = new Map([
  ['Enter', ['ENTER']],
  ['Tab', ['TAB']],
  ['Backspace', ['BACKSPACE']],
  ['Delete', ['DELETE']],
  ['Escape', ['ESC']],
  ['ArrowUp', ['ARROWUP']],
  ['ArrowDown', ['ARROWDOWN']],
  ['ArrowLeft', ['ARROWLEFT']],
  ['ArrowRight', ['ARROWRIGHT']],
  ['Home', ['HOME']],
  ['End', ['END']],
  ['PageUp', ['PAGEUP']],
  ['PageDown', ['PAGEDOWN']],
  ['Space', ['SPACE']],
  ['ControlOrMeta+A', ['CTRL', 'A']],
  ['ControlOrMeta+S', ['CTRL', 'S']],
]);

export function desktopInput(body, point) {
  const fields = { click: ['x', 'y'], type: ['text'], key: ['key'], scroll: ['direction', 'amount'] };
  if (
    !Object.hasOwn(fields, body.action) ||
    Object.keys(body).some(
      (key) => !['runId', 'ownerVersion', 'desktopId', 'action', ...fields[body.action]].includes(key),
    )
  ) {
    return null;
  }
  if (body.action === 'click') {
    return [body.x, body.y].every(Number.isSafeInteger) &&
      body.x >= 0 &&
      body.x < 1024 &&
      body.y >= 0 &&
      body.y < 768
      ? { type: 'click', button: 'left', x: body.x, y: body.y }
      : null;
  }
  if (body.action === 'type') {
    return typeof body.text === 'string' && body.text.length > 0 && body.text.length <= 2000
      ? { type: 'type', text: body.text }
      : null;
  }
  if (body.action === 'key') {
    return keys.has(body.key) ? { type: 'keypress', keys: keys.get(body.key) } : null;
  }
  if (
    !point ||
    !['up', 'down', 'left', 'right'].includes(body.direction) ||
    !Number.isSafeInteger(body.amount) ||
    body.amount < 1 ||
    body.amount > 2048
  ) {
    return null;
  }
  return {
    type: 'scroll',
    x: point.x,
    y: point.y,
    scroll_x: { left: -body.amount, right: body.amount, up: 0, down: 0 }[body.direction],
    scroll_y: { up: -body.amount, down: body.amount, left: 0, right: 0 }[body.direction],
  };
}

/** One concrete guest owner. It has no browser tab, caller-supplied path or remote provider. */
export async function createDesktopSession({ runtimeDir, run }) {
  const lifetime = new AbortController();
  let desktop;
  let closing;
  let refresh;
  let closed = false;
  let sequence = 0;
  const creation = Desktop.create({ runtimeDir, signal: lifetime.signal });
  const session = {
    viewBinding: null,
    get closed() {
      return closed;
    },
    get refreshing() {
      return Boolean(refresh);
    },
    binding() {
      return !closed && desktop && run.owner !== 'stopped'
        ? { desktopId: desktop.id, ownerVersion: run.ownerVersion }
        : null;
    },
    matches(value) {
      const current = session.binding();
      return Boolean(
        current &&
        value &&
        current.desktopId === value.desktopId &&
        current.ownerVersion === value.ownerVersion,
      );
    },
    hasUncertainEffects() {
      return desktop?.uncertainEffects === true;
    },
    refreshView(execution) {
      if (refresh) {
        return waitForDecision(() => refresh, execution?.signal);
      }
      const binding = session.binding();
      if (!binding) {
        return Promise.resolve();
      }
      const signal = execution?.signal ?? (run.owner === 'agent' ? run.controller?.signal : undefined);
      refresh = (async () => {
        try {
          const capture = await desktop.captureFrame({ signal });
          if (!capture || signal?.aborted || !session.matches(binding)) {
            return;
          }
          sequence += 1;
          run.liveView = {
            frame: capture.frame,
            state: { status: 'live', sequence, at: Date.now(), width: capture.width, height: capture.height },
          };
          session.viewBinding = binding;
        } catch (error) {
          if (execution?.poll && signal?.aborted) {
            return;
          }
          if (!closed && !signal?.aborted) {
            session.viewBinding = null;
            run.stop('view_failed');
          }
          throw error;
        } finally {
          refresh = null;
        }
      })();
      return refresh;
    },
    async invalidateReferences(execution) {
      await waitForDecision(() => refresh, execution?.signal);
      session.viewBinding = null;
      run.liveView = null;
    },
    async capture(execution) {
      // A poll may still be returning pixels for the owner that just gave up control.
      await waitForDecision(() => refresh, execution?.signal);
      await session.refreshView(execution);
      execution?.signal?.throwIfAborted();
      if (!session.matches(session.viewBinding) || !run.liveView?.frame) {
        throw new Error('No current desktop frame is available.');
      }
      const { frame: pixels, state } = run.liveView;
      run.screenshot = pixels;
      run.screenshotAt = state.at;
      run.screenshotBinding = session.viewBinding;
      run.checkpointSequence += 1;
      run.diagnostics?.frame(
        { sequence: run.checkpointSequence, owner: run.owner, role: 'Desktop', mime: 'image/png' },
        pixels,
      );
      if (pixels.length > 1024 * 1024) {
        run.checkpointDropped += 1;
        return;
      }
      run.checkpoints.push({
        sequence: run.checkpointSequence,
        at: state.at,
        atMs: Math.round(performance.now() - run.started),
        owner: run.owner,
        role: 'Desktop',
        pixels,
      });
      run.checkpointBytes += pixels.length;
      while (run.checkpoints.length > 12 || run.checkpointBytes > 8 * 1024 * 1024) {
        run.checkpointBytes -= run.checkpoints.shift().pixels.length;
        run.checkpointDropped += 1;
      }
    },
    async humanInput(action) {
      const id = randomUUID();
      await desktop.withComputer((computer, signal) =>
        computer.execute(
          { type: 'computer_call', id, call_id: id, status: 'completed', actions: [action] },
          { signal, beforeAction: () => !closed },
        ),
      );
      await session.capture();
    },
    withComputer(work, signal) {
      return desktop.withComputer(work, { signal });
    },
    verify(options) {
      return desktop.verify(options);
    },
    seal(options) {
      return desktop.seal(options);
    },
    close() {
      closed = true;
      lifetime.abort();
      closing ??= (async () => {
        try {
          await creation;
        } catch (error) {
          if (error instanceof DesktopStartupError) {
            return;
          }
          throw error;
        }
        try {
          await desktop.stop();
        } finally {
          await Promise.allSettled([refresh]);
        }
      })();
      return closing;
    },
  };
  // Stop can revoke startup before the first readiness request or frame completes.
  run.session = session;
  try {
    desktop = await creation;
    if (closed) {
      await desktop.stop();
      throw new Error('Desktop startup was stopped.');
    }
    await session.capture();
    return session;
  } catch (error) {
    closed = true;
    lifetime.abort();
    if (desktop) {
      await desktop.stop();
    }
    throw error;
  }
}

/** Each handoff starts a fresh conversation from current pixels; old pending calls never resume. */
export async function executeDesktop({ apiKey, models, run }) {
  const { session } = run;
  const phase = run.controller;
  const phaseIndex = (run.phaseIndex ?? 0) + 1;
  run.phaseIndex = phaseIndex;
  const ledger = await createDesktopLedger(`${run.id}:${phaseIndex}`);
  run.ledgerDirectory = ledger.directory;
  let approved = false;
  try {
    const client = new OpenAI({
      apiKey,
      maxRetries: 0,
      timeout: 30_000,
      fetch: async (url, options) => {
        phase.signal.throwIfAborted();
        if (run.owner !== 'agent' || run.controller !== phase || run.turns >= run.stepLimit) {
          throw new Error('No desktop request is admitted in this phase.');
        }
        run.turns += 1;
        run.requests += 1;
        const { response } = await recordRequest(run, () => fetch(url, options), options?.signal);
        run.addEvent('request', `Responses · HTTP ${response.status}`);
        return response;
      },
    });
    phase.signal.throwIfAborted();
    await session.capture();
    let proof = await session.verify({ signal: phase.signal });
    if (!proof.file_matches || !proof.browser_matches) {
      const remaining = run.stepLimit - run.turns;
      if (remaining < 1) {
        throw new Error('The desktop request limit has been reached.');
      }
      await session.withComputer(
        (computer, signal) =>
          new ResponsesToolRunner({ computer }).run(
            client,
            {
              model: models.responses,
              store: false,
              input: [
                {
                  role: 'user',
                  content: [
                    { type: 'input_text', text: task },
                    {
                      type: 'input_image',
                      image_url: `data:image/png;base64,${run.screenshot.toString('base64')}`,
                      detail: 'auto',
                    },
                  ],
                },
              ],
            },
            {
              maxSteps: remaining,
              signal,
              onDiagnostic: (event) => run.diagnostics?.event(event),
              ledger: {
                runId: ledger.runId,
                async save(value) {
                  await ledger.save(value);
                  recordReceipt(run, {
                    kind: 'tools',
                    phaseIndex,
                    phase: value.phase,
                    attempted: value.attempted_call_ids.length,
                    returned: value.returned_call_ids.length,
                  });
                },
              },
              computerOptions: {
                async beforeAction(action) {
                  signal.throwIfAborted();
                  if (action.type === 'screenshot') {
                    return true;
                  }
                  if (!approved) {
                    approved = await run.askApproval(
                      'Let this agent phase route D-2201 and save the fixed receipt in the isolated desktop',
                    );
                  }
                  return approved && !signal.aborted && run.owner === 'agent';
                },
                approveSafetyChecks: () =>
                  run.askApproval('Approve the pending desktop action flagged by the API safety check'),
              },
            },
          ),
        phase.signal,
      );
      phase.signal.throwIfAborted();
      proof = await session.verify({ signal: phase.signal });
    }
    if (proof.file_matches && proof.browser_matches) {
      proof = await session.seal({ signal: phase.signal });
    }
    run.result = proof.file_matches && proof.browser_matches ? 'verified' : 'unverified';
    await session.capture();
    run.status = run.result === 'verified' ? 'complete' : 'unverified';
    run.addEvent('result', `Desktop browser and saved receipt · ${run.result}`);
  } catch {
    run.status = 'failed';
    if (run.stopReason) {
      run.status = run.stopReason;
    } else if (run.refused) {
      run.status = 'refused';
    } else if (run.approvalExpired) {
      run.status = 'approval_expired';
    } else if (phase.signal.aborted) {
      run.status = 'stopped';
    }
    run.result = run.result === 'verified' ? 'verified' : 'unverified';
    run.uncertainEffects ||= session.hasUncertainEffects();
    run.addEvent('result', `Desktop phase ${run.status}. Earlier work is retained; no automatic replay.`);
  } finally {
    // The whole runner has settled here. A pending ledger is never reused after handoff.
    await ledger.close().catch((error) => {
      run.cleanup = 'failed';
      recordReceipt(run, { kind: 'cleanup', outcome: 'failed' });
      throw error;
    });
    run.ledgerDirectory = null;
  }
}
