import OpenAI from 'openai';
import { Desktop } from '../computer-desktop/desktop.mjs';
import { DesktopStartupError } from '../computer-desktop/startup-error.mjs';
import {
  createMixedFixture,
  createMixedSession,
  MixedSetupCleanupError,
} from '../responses/browser/mixed-session.mjs';
import { recordReceipt, recordRequest } from './run-receipt.mjs';
import { waitForDecision } from '../responses/browser/file-state.mjs';

/** Fieldwork owns one fixed mixed task, independently of the currently visible workspace. */
export async function createFieldworkMixed({ runtimeDir, run }) {
  const lifetime = new AbortController();
  let desktop;
  let fixture;
  let mixed;
  let refresh;
  let closing;
  let closed = false;
  let view = 'host';
  let selection = 0;
  let frameSequence = 0;
  const creation = Desktop.create({ runtimeDir, signal: lifetime.signal });
  const session = {
    viewBinding: null,
    get closed() {
      return closed;
    },
    get refreshing() {
      return Boolean(refresh);
    },
    get ledgerDirectory() {
      return mixed?.ledgerDirectory ?? null;
    },
    binding() {
      return !closed && mixed && run.owner !== 'stopped'
        ? {
            desktopId: mixed.desktopId,
            tabId: mixed.tabId,
            view,
            sequence: selection,
            ownerVersion: run.ownerVersion,
          }
        : null;
    },
    matches(value) {
      const current = session.binding();
      return Boolean(
        current &&
        value &&
        current.desktopId === value.desktopId &&
        current.tabId === value.tabId &&
        current.view === value.view &&
        current.sequence === value.sequence &&
        current.ownerVersion === value.ownerVersion,
      );
    },
    hasUncertainEffects() {
      return mixed?.hasUncertainEffects() === true;
    },
    fileState() {
      return mixed?.fileState() ?? null;
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
          const captured = await mixed.frame(binding.view, { signal });
          if (!captured || signal?.aborted || !session.matches(binding)) {
            return;
          }
          frameSequence += 1;
          run.liveView = {
            frame: captured.frame,
            state: {
              status: 'live',
              sequence: frameSequence,
              at: Date.now(),
              width: captured.width,
              height: captured.height,
            },
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
      await mixed.observe(execution?.signal);
    },
    async selectView(selected) {
      if (!['host', 'guest'].includes(selected)) {
        throw new Error('Choose Host browser or Guest editor.');
      }
      // Rotate immediately: neither late images nor approvals issued for the old view remain current.
      view = selected;
      selection += 1;
      session.viewBinding = null;
      run.liveView = null;
      await refresh;
      await session.refreshView();
    },
    async capture(execution) {
      await waitForDecision(() => refresh, execution?.signal);
      await session.refreshView(execution);
      execution?.signal?.throwIfAborted();
      if (!session.matches(session.viewBinding) || !run.liveView?.frame) {
        throw new Error('No current mixed workspace frame is available.');
      }
      const { frame: pixels, state } = run.liveView;
      run.screenshot = pixels;
      run.screenshotAt = state.at;
      run.screenshotBinding = session.viewBinding;
      run.checkpointSequence += 1;
      run.diagnostics?.frame(
        {
          sequence: run.checkpointSequence,
          owner: run.owner,
          role: view === 'host' ? 'Host browser' : 'Guest editor',
          mime: 'image/png',
        },
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
        role: view === 'host' ? 'Host browser' : 'Guest editor',
        pixels,
      });
      run.checkpointBytes += pixels.length;
      while (run.checkpoints.length > 12 || run.checkpointBytes > 8 * 1024 * 1024) {
        run.checkpointBytes -= run.checkpoints.shift().pixels.length;
        run.checkpointDropped += 1;
      }
    },
    permits(action) {
      return mixed?.permits(view, action) === true;
    },
    async humanInput(action) {
      await mixed.humanInput(view, action);
      await session.capture();
    },
    async runPhase(options) {
      try {
        return await mixed.runPhase(options);
      } finally {
        if (mixed.cleanupFailed) {
          run.cleanup = 'failed';
          run.result = mixed.failureProof().verified ? 'verified' : 'unverified';
          recordReceipt(run, { kind: 'cleanup', outcome: 'failed' });
        }
      }
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
        const activeMixed = mixed;
        const retirement = Promise.allSettled([activeMixed ? activeMixed.close() : desktop.stop()]);
        // oxlint-disable-next-line eslint/no-use-before-define -- Published before setup; close awaits creation first, after setup has been assigned.
        await Promise.allSettled([setup, refresh]);
        const remainder = await Promise.allSettled(activeMixed ? [] : [(mixed ?? fixture)?.close()]);
        const failures = [...(await retirement), ...remainder]
          .filter((entry) => entry.status === 'rejected')
          .map((entry) => entry.reason);
        if (failures.length) {
          throw new AggregateError(failures, 'Mixed workspace cleanup failed.');
        }
      })();
      return closing;
    },
  };
  run.session = session;
  const setup = (async () => {
    desktop = await creation;
    lifetime.signal.throwIfAborted();
    fixture = await createMixedFixture();
    lifetime.signal.throwIfAborted();
    mixed = await createMixedSession({
      desktop,
      fixture,
      signal: lifetime.signal,
      onLaunchRetirement: (retirement) => {
        run.launchRetirement = retirement;
      },
      onClose: () => {
        if (run.owner !== 'stopped' && !run.refused) {
          run.stop('browser_closed');
        }
      },
    });
    lifetime.signal.throwIfAborted();
    await session.capture();
    return session;
  })();
  try {
    return await setup;
  } catch (error) {
    if (error instanceof MixedSetupCleanupError) {
      run.cleanup = 'failed';
      recordReceipt(run, { kind: 'cleanup', outcome: 'failed' });
    }
    await session.close();
    throw error;
  }
}

export async function executeFieldworkMixed({ apiKey, models, run }) {
  const phase = run.controller;
  const client = new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: 30_000,
    fetch: async (url, options) => {
      phase.signal.throwIfAborted();
      if (run.owner !== 'agent' || run.controller !== phase) {
        throw new Error('No mixed request is admitted in this phase.');
      }
      run.requests += 1;
      const { response } = await recordRequest(run, () => fetch(url, options), options?.signal);
      run.addEvent('request', `Responses · HTTP ${response.status}`);
      return response;
    },
  });
  const proof = await run.session.runPhase({
    client,
    model: models.responses,
    signal: phase.signal,
    approve: (label) => run.askApproval(label),
    progress: (message) => run.addEvent('task', message),
    onDiagnostic: (event) => run.diagnostics?.event(event),
    onLedger(value) {
      run.turns = value.consumedRequests;
      recordReceipt(run, {
        kind: 'tools',
        phaseIndex: value.phaseIndex,
        phase: value.phase,
        attempted: value.attempted,
        returned: value.returned,
      });
    },
  });
  run.status = run.stopReason ?? (proof.status === 'verified' ? 'complete' : proof.status);
  run.result = proof.verified ? 'verified' : 'unverified';
  run.uncertainEffects ||=
    proof.uncertainEffects.file || proof.uncertainEffects.desktop || run.session.hasUncertainEffects();
  run.addEvent('result', `Host Route, one approved receipt and isolated guest file · ${run.result}`);
}
