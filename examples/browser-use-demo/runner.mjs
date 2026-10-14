import OpenAI from 'openai';
import { BrowserError, BrowserToolset } from 'openai/helpers/browser';
import { DecisionsToolRunner } from 'openai/helpers/decisions-tool-runner';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';
import { createBrowserDriver, waitForDecision } from './booking.mjs';
import { tasks, inspectTask } from './tasks.mjs';
import { createLiveView } from './live-view.mjs';

const done = {
  id: 'done',
  description: 'Finish only when the page shows all items complete or the reservation confirmation.',
  done: true,
};

/** The rehearsal is a scripted HTTP response consumed by the real SDK, never a live model run. */
function rehearsalDecision(state, candidates) {
  if (state.finished) {
    return 'done';
  }
  return candidates.find((candidate) => candidate.id !== 'done').id;
}

function decisionReply(choice) {
  return {
    object: 'decision',
    id: 'rehearsal',
    model: '',
    answers: [
      {
        name: 'next_action',
        type: 'choice',
        choice,
        confidence: 1,
        probabilities: [{ value: choice, probability: 1 }],
      },
    ],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

function publicAPIText(value, apiKey, models) {
  let text = value.replaceAll(/sk-[\w-]+/gu, '[redacted]');
  for (const secret of [apiKey, ...Object.values(models)]) {
    if (typeof secret === 'string' && secret.length > 0) {
      text = text.replaceAll(secret, '[redacted]');
    }
  }
  return text.slice(0, 400);
}

// oxlint-disable-next-line eslint/complexity -- One browser phase owns three existing runner modes and classifies Stop separately from verified host effects.
async function runInBrowser({ origin, apiKey, models, run }) {
  const phaseOwnerVersion = run.ownerVersion;
  const phase = run.controller;
  const phaseExecution = { signal: phase.signal };
  const task = tasks[run.taskId];
  const instruction = `This is an isolated synthetic browser demonstration. All records and actions are local fixtures; no real booking, payment, or customer data is involved. Complete the simulated task using the supplied tools. To request a gated action, call its tool: the application pauses and asks the operator before execution. Do not ask for approval in a final answer, because a final answer ends this run. ${task.instruction}`;
  const fixtureURL = `${origin}/fixture/${run.taskId}`;
  const { base, capture } = run.session;
  const page = run.session.taskPage;
  let observation;
  let choiceForRehearsal;
  let observedRevision = 0;
  let observedView;
  const ensureCurrent = async (
    revision = observedRevision,
    view = observedView,
    owner = 'agent',
    version = run.ownerVersion,
    execution = phaseExecution,
  ) => {
    if (owner === 'agent') {
      run.controller.signal.throwIfAborted();
    }
    if (run.owner !== owner || run.ownerVersion !== version) {
      throw new Error('The agent no longer controls this session.');
    }
    const state = await waitForDecision(() => inspectTask(page), execution?.signal);
    if (page.url() !== fixtureURL || state.revision !== revision || !run.session.matches(view)) {
      throw new BrowserError('The workspace changed. Read the current page again.');
    }
    return state;
  };
  // oxlint-disable-next-line eslint/complexity -- This action owns approval, fixture permission, and the existing paired read-back.
  const act = async (
    member,
    args,
    label,
    revision = observedRevision,
    owner = 'agent',
    version = run.ownerVersion,
    execution = phaseExecution,
  ) => {
    run.session.checkTarget(args);
    const before = await ensureCurrent(revision, observedView, owner, version, execution);
    if (member === 'click' && label === 'Reserve table') {
      if (!(await run.askApproval(label, undefined, owner))) {
        throw new Error('The operator refused the action.');
      }
      await ensureCurrent(revision, observedView, owner, version, execution);
    }
    run.addEvent('action', label || member);
    await base[member](args, execution);
    const state = await waitForDecision(() => inspectTask(page), execution?.signal);
    observedRevision = state.revision;
    if (JSON.stringify(before.results) !== JSON.stringify(state.results)) {
      observedView = undefined;
    }
    await capture(execution);
  };
  const readPage = async (args, execution) => {
    run.session.checkTarget(args);
    const browser = run.session.browser();
    const result = await base.read_page(args, execution);
    if (!run.session.matches(browser)) {
      throw new BrowserError('The page changed during observation. Read the current page again.');
    }
    const state = await waitForDecision(() => inspectTask(page), execution?.signal);
    await capture(execution);
    if (!run.session.matches(browser) || !run.session.matches(run.screenshotBinding)) {
      throw new BrowserError('The page changed during observation. Read the current page again.');
    }
    observation = { ...result, tabs: browser.tabs, active_tab_id: browser.tabId };
    observedView = browser;
    observedRevision = state.revision;
    return result;
  };
  const observe = async () => {
    await readPage({ tab_id: null, filter: 'all' }, phaseExecution);
    const result = [
      { type: 'input_text', text: JSON.stringify(observation) },
      { type: 'input_image', image_url: `data:image/jpeg;base64,${run.screenshot.toString('base64')}` },
    ];
    return result;
  };
  const candidates = async () => {
    const state = await waitForDecision(() => inspectTask(page), phaseExecution.signal);
    if (state.finished) {
      return [done];
    }
    const { revision } = state;
    const { fields } = state;
    const actions = [];
    for (const element of observation.elements) {
      if (element.role === 'button') {
        if (!Object.entries(task.fields).every(([name, value]) => fields[name] === value)) {
          continue;
        }
        const args = { tab_id: null, target: element.ref };
        actions.push({
          id: element.ref,
          description: `Click ${element.label}`,
          execute: () => act('click', args, element.label, revision),
        });
      } else if (
        task.fields &&
        fields &&
        Object.hasOwn(task.fields, element.label) &&
        fields[element.label] !== task.fields[element.label]
      ) {
        const value = task.fields[element.label];
        const member = element.role === 'combobox' ? 'select_option' : 'type';
        const args =
          element.role === 'combobox'
            ? { tab_id: null, target: element.ref, values: [value] }
            : { tab_id: null, target: element.ref, text: value };
        actions.push({
          id: element.ref,
          description: `Fill ${element.label} with ${value}`,
          execute: () => act(member, args, `Fill ${element.label}`, revision),
        });
      }
    }
    const result = [...actions, done];
    if (run.mode === 'rehearsal') {
      choiceForRehearsal = rehearsalDecision(state, result);
    }
    return result;
  };
  const client = new OpenAI({
    apiKey: run.mode === 'rehearsal' ? 'local-rehearsal' : apiKey,
    maxRetries: 0,
    fetch: async (url, options) => {
      run.controller.signal.throwIfAborted();
      if (run.owner !== 'agent' || run.turns >= run.stepLimit) {
        throw new Error('No further request is admitted for this task.');
      }
      run.turns += 1;
      if (run.mode === 'live') {
        run.requests += 1;
      }
      const started = performance.now();
      const response =
        run.mode === 'rehearsal'
          ? Response.json(decisionReply(choiceForRehearsal))
          : await fetch(url, options);
      const headersMs = performance.now() - started;
      run.requestHeadersMs += headersMs;
      run.addEvent(
        'request',
        run.mode === 'rehearsal'
          ? 'Scripted local choice · No API request'
          : `${run.api === 'decisions' ? 'Decisions' : 'Responses'} · HTTP ${response.status} · ${Math.round(headersMs)} ms to headers`,
      );
      if (!response.ok) {
        run.apiStatus = response.status;
        const body = response.headers.get('content-type')?.includes('application/json')
          ? await response
              .clone()
              .json()
              .catch(() => null)
          : null;
        const requestId = response.headers.get('x-request-id');
        run.apiFailure = {
          status: response.status,
          requestId: requestId ? publicAPIText(requestId, apiKey, models) : null,
          code: typeof body?.error?.code === 'string' ? publicAPIText(body.error.code, apiKey, models) : null,
          message:
            typeof body?.error?.message === 'string'
              ? publicAPIText(body.error.message, apiKey, models)
              : 'The API denied this request.',
        };
      }
      return response;
    },
  });
  run.session.toolset = (owner = 'agent') => {
    const version = run.ownerVersion;
    const driver = {
      state: base.state,
      read_page: readPage,
      get_page_text(args, execution) {
        run.session.checkTarget(args);
        return base.get_page_text(args, execution);
      },
      click: (args, execution) =>
        act(
          'click',
          args,
          observation?.elements.find((element) => element.ref === args.target)?.label,
          observedRevision,
          owner,
          version,
          execution,
        ),
      type: (args, execution) => act('type', args, 'Fill field', observedRevision, owner, version, execution),
      select_option: (args, execution) =>
        act('select_option', args, 'Select field', observedRevision, owner, version, execution),
    };
    return new BrowserToolset(driver, {
      confirm: () =>
        !run.refused &&
        run.owner === owner &&
        run.ownerVersion === version &&
        (owner !== 'agent' || !run.controller.signal.aborted),
    });
  };
  const model = models[run.api] ?? '';
  try {
    run.controller.signal.throwIfAborted();
    await capture(phaseExecution);
    run.controller.signal.throwIfAborted();
    if (run.owner !== 'agent' || run.ownerVersion !== phaseOwnerVersion) {
      return;
    }
    const initialState = await waitForDecision(() => inspectTask(page), phase.signal);
    if (initialState.finished) {
      run.result = initialState.verified ? 'verified' : 'unverified';
    }
    run.controller.signal.throwIfAborted();
    if (run.owner !== 'agent' || run.ownerVersion !== phaseOwnerVersion) {
      return;
    }
    if (initialState.finished) {
      run.status = run.result === 'verified' ? 'complete' : 'unverified';
      run.addEvent('result', `Current browser state · ${run.result}`);
      return;
    }
    const remainingSteps = run.stepLimit - run.turns;
    if (remainingSteps < 1) {
      throw new Error('The task request limit has been reached.');
    }
    if (run.api === 'decisions') {
      const runner = new DecisionsToolRunner({
        observe,
        candidates,
        verify: async () => {
          const state = await waitForDecision(() => inspectTask(page), phase.signal);
          return state.verified;
        },
      });
      const result = await runner.run(
        client,
        { model, input: instruction },
        {
          maxSteps: remainingSteps,
          signal: run.controller.signal,
        },
      );
      run.result = result.status === 'verified' ? 'verified' : 'unverified';
      if (result.status === 'refused') {
        run.status = 'refused';
      }
    } else {
      const toolset = run.session.toolset();
      const runner = new ResponsesToolRunner({ browser: toolset });
      const initialObservation = await observe();
      const response = await runner.run(
        client,
        {
          model,
          store: false,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: `${instruction} Continue from the current page below. Use read_page to refresh refs after changes. Read the final visible result before finishing.`,
                },
                ...initialObservation,
              ],
            },
          ],
        },
        {
          maxSteps: remainingSteps,
          signal: run.controller.signal,
          stream: true,
          onEvent(event) {
            if (
              event.type === 'response.created' &&
              run.owner === 'agent' &&
              !run.controller.signal.aborted
            ) {
              run.addEvent('request', 'Responses stream receiving');
            }
          },
        },
      );
      run.finalText = publicAPIText(response.output_text, apiKey, models);
      const state = await waitForDecision(() => inspectTask(page), phase.signal);
      run.result = state.verified ? 'verified' : 'unverified';
    }
    run.controller.signal.throwIfAborted();
    await capture(phaseExecution);
    run.controller.signal.throwIfAborted();
    if (run.status !== 'refused') {
      run.status = run.result === 'verified' ? 'complete' : run.result;
    }
    run.addEvent('result', `${run.mode === 'live' ? 'Live' : 'Rehearsal'} · ${run.result}`);
  } catch {
    run.status = 'failed';
    if (run.stopReason) {
      run.status = run.stopReason;
    } else if (run.refused) {
      run.status = 'refused';
    } else if (run.approvalExpired) {
      run.status = 'approval_expired';
    } else if (run.controller.signal.aborted) {
      run.status = 'stopped';
    }
    run.result = run.result === 'verified' ? 'verified' : 'unverified';
    run.addEvent(
      'result',
      run.apiStatus
        ? `API request failed (HTTP ${run.apiStatus}). No automatic fallback.`
        : `${run.status}. Inspect the browser before retrying.`,
    );
    try {
      await capture(phaseExecution);
    } catch {
      run.addEvent('result', 'The browser closed before a final screenshot was available.');
    }
  }
}

/** Create one isolated task session. The server retains and closes it across handoff. */
export async function createDemoSession({ browser, origin, run, onClose }) {
  const context = await browser.newContext(
    {
      viewport: { width: 1024, height: 720 },
      serviceWorkers: 'block',
      acceptDownloads: false,
    },
    run,
  );
  if (run.owner !== 'agent' || run.controller.signal.aborted) {
    await context.close();
    return null;
  }
  let closed = false;
  let ownedCleanup = false;
  let closePromise;
  let refreshPromise;
  const viewLifetime = new AbortController();
  const fixtureURL = `${origin}/fixture/reservation`;
  const publicValues = ['guest_name', 'party_size', 'time', 'seating'].map((field) => [
    fixtureURL,
    'TABLE-204',
    field,
  ]);
  const base = createBrowserDriver(context, {
    ownedFixture: {
      urls: [fixtureURL],
      publicValues,
      publicViewports: [fixtureURL],
    },
  });
  const session = {
    context,
    base,
    invalidateReferences: base.invalidateReferences.bind(base),
    hasUncertainEffects: base.hasUncertainEffects.bind(base),
    taskPage: null,
    taskTabId: null,
    viewBinding: null,
    get page() {
      return session.taskPage ? base.currentOwnedView()?.page : null;
    },
    browser() {
      if (!session.taskPage || closed || run.owner === 'stopped' || session.hasUncertainEffects()) {
        return null;
      }
      const current = base.currentOwnedView();
      if (!current) {
        return null;
      }
      const tabs = [{ id: session.taskTabId, role: 'Task' }];
      const role = tabs.find((tab) => tab.id === current.tabId)?.role;
      // new_tab has not yet committed its role during setup; do not expose the intermediate page.
      return role ? { tabId: current.tabId, sequence: current.sequence, role, tabs } : null;
    },
    matches(binding) {
      const current = session.browser();
      return (
        !!binding && !!current && binding.tabId === current.tabId && binding.sequence === current.sequence
      );
    },
    checkTarget(args) {
      const current = session.browser();
      if (!current || (args.tab_id !== null && args.tab_id !== undefined && args.tab_id !== current.tabId)) {
        throw new BrowserError('Select the target tab and read its current page first.');
      }
    },
    refreshView(execution) {
      const phaseSignal =
        execution?.signal ?? (run.owner === 'agent' ? run.controller.signal : run.transferController?.signal);
      const signal = phaseSignal ? AbortSignal.any([phaseSignal, viewLifetime.signal]) : viewLifetime.signal;
      if (refreshPromise) {
        const pending = refreshPromise;
        return waitForDecision(() => pending, signal);
      }
      const binding = session.browser();
      if (!binding || session.matches(session.viewBinding)) {
        return Promise.resolve();
      }
      const version = run.ownerVersion;
      signal?.throwIfAborted();
      refreshPromise = (async () => {
        try {
          const previous = run.liveView;
          run.liveView = null;
          session.viewBinding = null;
          await previous?.close();
          if (!session.matches(binding) || run.ownerVersion !== version) {
            return;
          }
          const view = await createLiveView(session.page);
          if (!session.matches(binding) || run.ownerVersion !== version) {
            await view.close();
            return;
          }
          run.liveView = view;
          session.viewBinding = binding;
        } finally {
          refreshPromise = null;
        }
      })();
      const pending = refreshPromise;
      return waitForDecision(() => pending, signal);
    },
    get closed() {
      return closed;
    },
    get refreshing() {
      return Boolean(refreshPromise);
    },
    async capture(execution) {
      const binding = session.browser();
      const pixels = await waitForDecision(
        () => session.page.screenshot({ type: 'jpeg', quality: 80 }),
        execution?.signal,
      );
      const fixture = await waitForDecision(() => inspectTask(session.taskPage), execution?.signal);
      // A completed input may start navigation which finishes after the screenshot.
      // Discard mismatched pixels; the authenticated poll will refresh the live view.
      if (!session.matches(binding)) {
        return;
      }
      const at = Date.now();
      run.screenshot = pixels;
      run.screenshotAt = at;
      run.screenshotBinding = binding;
      run.fixture = fixture;
    },
    close() {
      ownedCleanup = true;
      viewLifetime.abort();
      closePromise ??= (async () => {
        // Closing Chromium revokes input even if a model request ignores cancellation.
        await context.close().catch((error) => {
          // The context close event proves a concurrent disconnect was reaped.
          if (!closed) {
            throw error;
          }
        });
        closed = true;
        try {
          await refreshPromise;
          await run.liveView?.close();
        } catch {
          run.addEvent('view', 'Frame capture ended with the browser session.');
        }
      })();
      return closePromise;
    },
  };
  // Publish the context before setup awaits so Stop can revoke it during initialization.
  run.session = session;
  context.once('close', () => {
    closed = true;
    if (!ownedCleanup && session.taskPage) {
      onClose();
    }
  });
  try {
    run.controller.signal.throwIfAborted();
    session.taskTabId = await session.base.new_tab({ url: fixtureURL });
    session.taskPage = base.currentOwnedView().page;
    session.taskPage.once('close', () => {
      if (!ownedCleanup) {
        onClose();
      }
    });
    try {
      await session.refreshView({ signal: run.controller.signal });
    } catch (error) {
      // Only final view setup may outlive Take; the established task page remains usable.
      if (run.owner !== 'draining-to-human' || !run.controller.signal.aborted || closed) {
        throw error;
      }
    }
    if (run.owner === 'stopped') {
      await session.close();
      return null;
    }
    return session;
  } catch (error) {
    await session.close();
    throw error;
  }
}

/** A fresh API loop observes the existing page; prior effects and request counts stay on the run. */
export async function executeDemo(options) {
  await runInBrowser(options);
}
