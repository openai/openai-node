import OpenAI from 'openai';
import { BrowserError, BrowserToolset } from 'openai/helpers/browser';
import { DecisionsToolRunner } from 'openai/helpers/decisions-tool-runner';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { createBrowserDriver } from '../responses/browser/driver.mjs';
import { newUploadOwner } from '../responses/browser/file-upload.mjs';
import { tasks, inspectTask } from './tasks.mjs';
import { createLiveView } from './live-view.mjs';
import { intakeNote, readServiceFields, shipmentLabel } from './business-state.mjs';
import { waitForDecision } from '../responses/browser/file-state.mjs';
import { recordRequest } from './run-receipt.mjs';
import { diagnosticObservation } from './diagnostics.mjs';

const done = {
  id: 'done',
  description: 'Finish only when the page shows all items complete or the reservation confirmation.',
  done: true,
};

/** The rehearsal is a scripted HTTP response consumed by the real SDK, never a live model run. */
function rehearsalDecision(task, state, candidates) {
  if (state.finished) {
    return 'done';
  }
  if (task.items) {
    const { expected } = task.items[state.results.length];
    return candidates.find((candidate) => candidate.description === `Click ${expected}`).id;
  }
  if (task.stock) {
    const order = task.orders[state.results.length];
    const available = task.stock.find((stock) => stock.colour === order.colour);
    const label = shipmentLabel(order.id, available.sku);
    return candidates.find((candidate) => candidate.description === `Click ${label}`).id;
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
  let businessBindings;
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
    const state = await waitForDecision(() => inspectTask(page, run.taskId, run.business), execution?.signal);
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
    run.session.checkTarget(args, member === 'switch_tab');
    const before = await ensureCurrent(revision, observedView, owner, version, execution);
    const operation = member === 'click' ? businessBindings?.get(args.target) : null;
    if (member === 'click' && run.business && !operation) {
      throw new BrowserError('Read an unambiguous business control and its current fields before approval.');
    }
    if (member === 'click' && (operation || ['Reserve table', 'Approve'].includes(label))) {
      const approvalLabel =
        operation?.operation === 'schedule'
          ? `${label} · ${operation.date} · ${operation.technician} · ${operation.note}`
          : label;
      if (!(await run.askApproval(approvalLabel, undefined, owner))) {
        throw new Error('The operator refused the action.');
      }
      await ensureCurrent(revision, observedView, owner, version, execution);
    }
    run.addEvent('action', label || member);
    const permit = operation ? run.business.authorize(operation) : null;
    const started = performance.now();
    try {
      await base[member](args, execution);
      if (permit) {
        await run.business.finish(permit, page);
      }
    } finally {
      run.diagnostics.measure('actionMs', performance.now() - started);
      if (permit) {
        run.business.revoke(permit);
      }
    }
    const state = await waitForDecision(() => inspectTask(page, run.taskId, run.business), execution?.signal);
    run.diagnostics.record('effect', { member, state });
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
    const bindings =
      run.business && browser.tabId === run.session.taskTabId
        ? await waitForDecision(() => run.business.bindRead(page, result.elements), execution?.signal)
        : null;
    if (!run.session.matches(browser)) {
      throw new BrowserError('The page changed during observation. Read the current page again.');
    }
    const state = await waitForDecision(() => inspectTask(page, run.taskId, run.business), execution?.signal);
    await capture(execution);
    if (!run.session.matches(browser) || !run.session.matches(run.screenshotBinding)) {
      throw new BrowserError('The page changed during observation. Read the current page again.');
    }
    businessBindings = bindings;
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
    if (run.api === 'decisions') {
      run.diagnostics.record('observation', diagnosticObservation(result));
    }
    return result;
  };
  const candidates = async () => {
    const state = await waitForDecision(
      () => inspectTask(page, run.taskId, run.business),
      phaseExecution.signal,
    );
    if (state.finished) {
      return [done];
    }
    if (observedView.tabId !== run.session.taskTabId) {
      const action = {
        id: 'switch_to_task',
        description: 'Switch to the Task tab',
        execute: () => act('switch_tab', { tab_id: run.session.taskTabId }, 'Switch to Task', state.revision),
      };
      if (run.mode === 'rehearsal') {
        choiceForRehearsal = action.id;
      }
      return [action, done];
    }
    if (run.taskId === 'files') {
      const action = {
        id: 'attach_intake_note',
        description: 'Attach Approved fixture document to INTAKE-501; operator approval required',
        execute: () => run.session.attachFile(),
      };
      if (run.mode === 'rehearsal') {
        choiceForRehearsal = action.id;
      }
      return [action, done];
    }
    const { revision } = state;
    const fields = run.taskId === 'service' ? readServiceFields(observation.elements) : state.fields;
    const actions = [];
    for (const element of observation.elements) {
      if (element.role === 'button') {
        if (
          task.fields &&
          (run.taskId === 'service'
            ? !businessBindings?.has(element.ref)
            : !Object.entries(task.fields).every(([name, value]) => fields[name] === value))
        ) {
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
      choiceForRehearsal = rehearsalDecision(task, state, result);
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
      const { response, headersMs } = await recordRequest(
        run,
        () =>
          run.mode === 'rehearsal' ? Response.json(decisionReply(choiceForRehearsal)) : fetch(url, options),
        options?.signal,
      );
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
      ...(['reservation', 'service', 'files'].includes(run.taskId)
        ? {}
        : {
            screenshot(args, execution) {
              run.session.checkTarget(args);
              return base.screenshot(args, execution);
            },
          }),
      switch_tab: (args, execution) =>
        act('switch_tab', args, 'Switch tab', observedRevision, owner, version, execution),
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
    const initialState = await waitForDecision(
      () => inspectTask(page, run.taskId, run.business),
      phase.signal,
    );
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
        candidates: async (current) => {
          const choices = await candidates(current);
          run.diagnostics.record(
            'choices',
            choices.map(({ id, description, done: finished }) => ({
              id,
              description,
              done: finished === true,
            })),
          );
          return choices;
        },
        verify: async () => {
          const state = await waitForDecision(
            () => inspectTask(page, run.taskId, run.business),
            phase.signal,
          );
          run.diagnostics.record('verification', state);
          return state.verified;
        },
      });
      const result = await runner.run(
        client,
        { model, input: instruction },
        {
          maxSteps: remainingSteps,
          signal: run.controller.signal,
          onDiagnostic: (event) => run.diagnostics.event(event),
        },
      );
      run.result =
        result.status === 'verified' || run.business?.snapshot().verified ? 'verified' : 'unverified';
      if (result.status === 'refused') {
        run.status = 'refused';
      }
    } else {
      const toolset = run.session.toolset();
      const runner = new ResponsesToolRunner({
        browser: toolset,
        functions:
          run.taskId === 'files'
            ? [
                {
                  tool: {
                    type: 'function',
                    name: 'attach_intake_note',
                    strict: true,
                    description:
                      'Attach the approved fixture document to INTAKE-501. Requires operator approval; a consumed or expired grant cannot be renewed.',
                    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
                  },
                  execute: async (args) => {
                    if (Object.keys(args).length) {
                      throw new Error('This fixed file task accepts no arguments.');
                    }
                    return run.session.attachFile();
                  },
                },
              ]
            : [],
      });
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
          onDiagnostic: (event) => run.diagnostics.event(event),
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
      const state = await waitForDecision(() => inspectTask(page, run.taskId, run.business), phase.signal);
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
    run.result = run.result === 'verified' || run.business?.snapshot().verified ? 'verified' : 'unverified';
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
  let fileOwner;
  let filePreparation;
  let fileExpiresAt;
  let filePermit;
  const fixtureURL = `${origin}/fixture/${run.taskId}`;
  const notesURL = `${fixtureURL}/notes/`;
  const publicViewports = [fixtureURL, `${notesURL}brief`, `${notesURL}rules`];
  let publicValues = [];
  if (run.taskId === 'reservation') {
    publicValues = ['guest_name', 'party_size', 'time', 'seating'].map((field) => [
      fixtureURL,
      'TABLE-204',
      field,
    ]);
  } else if (run.taskId === 'service') {
    publicValues = ['visit_date', 'technician', 'note'].map((field) => [fixtureURL, 'SERVICE-401', field]);
  }
  const base = createBrowserDriver(context, {
    ownedFixture: {
      urls: [
        ...publicViewports,
        ...(run.business
          ? [`${fixtureURL}/effect?run=${run.id}${run.taskId === 'files' ? '&case=INTAKE-501' : ''}`]
          : []),
      ],
      publicValues,
      publicViewports,
    },
  });
  const session = {
    context,
    base,
    invalidateReferences: base.invalidateReferences.bind(base),
    hasUncertainEffects: base.hasUncertainEffects.bind(base),
    taskPage: null,
    taskTabId: null,
    notesTabId: null,
    notesURL,
    viewBinding: null,
    fileState() {
      return fileOwner?.state() ?? null;
    },
    async attachFile() {
      session.checkTarget({ tab_id: session.taskTabId });
      run.controller.signal.throwIfAborted();
      if (
        !fileOwner ||
        run.owner !== 'agent' ||
        filePermit ||
        session.browser()?.tabId !== session.taskTabId
      ) {
        throw new Error('No active file task.');
      }
      filePreparation ??= (async () => {
        const name = fileOwner.generatedName();
        await writeFile(path.join(fileOwner.uploadRoot, name), intakeNote, { flag: 'wx', mode: 0o600 });
        run.controller.signal.throwIfAborted();
        fileExpiresAt = Date.now() + 30_000;
        return fileOwner.prepare(fileOwner.uploadRoot, name, fileExpiresAt);
      })();
      try {
        const grant = await filePreparation;
        const result = JSON.parse(await fileOwner.upload({ grant_id: grant.grant_id }));
        if (!result.completed || !filePermit) {
          throw new Error('File selection was refused or its outcome is unknown.');
        }
        run.addEvent('action', 'Selected locally · awaiting fixture receipt');
        await run.business.finish(filePermit, session.taskPage);
        run.addEvent('action', 'Received by fixture · INTAKE-501');
        await session.capture();
        return JSON.stringify(fileOwner.state());
      } finally {
        if (filePermit) {
          run.business.revoke(filePermit);
          filePermit = null;
        }
      }
    },
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
      if (session.notesTabId) {
        tabs.push({ id: session.notesTabId, role: 'Notes' });
      }
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
    checkTarget(args, switching = false) {
      const current = session.browser();
      if (
        !current ||
        (args.tab_id !== null &&
          args.tab_id !== undefined &&
          (switching ? !current.tabs.some((tab) => tab.id === args.tab_id) : args.tab_id !== current.tabId))
      ) {
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
      const fixture = await waitForDecision(
        () => inspectTask(session.taskPage, run.taskId, run.business),
        execution?.signal,
      );
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
      run.checkpointSequence += 1;
      run.diagnostics?.frame(
        { sequence: run.checkpointSequence, owner: run.owner, role: binding.role, mime: 'image/jpeg' },
        pixels,
      );
      if (pixels.length > 1024 * 1024) {
        run.checkpointDropped += 1;
        return;
      }
      run.checkpoints.push({
        sequence: run.checkpointSequence,
        at,
        atMs: Math.round(performance.now() - run.started),
        owner: run.owner,
        role: binding.role,
        pixels,
      });
      run.checkpointBytes += pixels.length;
      while (run.checkpoints.length > 12 || run.checkpointBytes > 8 * 1024 * 1024) {
        run.checkpointBytes -= run.checkpoints.shift().pixels.length;
        run.checkpointDropped += 1;
      }
    },
    close() {
      ownedCleanup = true;
      viewLifetime.abort();
      closePromise ??= (async () => {
        // Closing Chromium revokes input even if a model request ignores cancellation.
        const resources = await Promise.allSettled([
          context.close().catch((error) => {
            // A disconnect may race this close. The context's own close event
            // proves it was reaped; file cleanup still has its separate result.
            if (!closed) {
              throw error;
            }
          }),
          fileOwner?.stop(),
        ]);
        try {
          await filePreparation;
        } catch {
          // The original runner sees the preparation failure.
        }
        closed = true;
        try {
          await refreshPromise;
          await run.liveView?.close();
        } catch {
          run.addEvent('view', 'Frame capture ended with the browser session.');
        }
        const failure = resources.find((result) => result.status === 'rejected');
        if (failure) {
          throw failure.reason;
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
    if (run.business) {
      const finished = new AbortController();
      const interrupted = once(run.controller.signal, 'abort', { signal: finished.signal });
      try {
        await Promise.race([
          context.addCookies([
            {
              name: 'fieldwork_workspace',
              value: run.workspaceToken,
              domain: '127.0.0.1',
              path: `/fixture/${run.taskId}`,
              httpOnly: true,
              sameSite: 'Strict',
            },
          ]),
          interrupted,
        ]);
      } finally {
        finished.abort();
      }
      if (run.owner !== 'agent' || run.controller.signal.aborted) {
        await session.close();
        return null;
      }
    }
    session.taskTabId = await session.base.new_tab({ url: fixtureURL });
    session.taskPage = base.currentOwnedView().page;
    session.taskPage.once('close', () => {
      if (!ownedCleanup) {
        onClose();
      }
    });
    if (run.taskId === 'files') {
      const created = await newUploadOwner(
        session.taskPage,
        {
          allowUpload: true,
          record: await session.taskPage.locator('[data-record-id="transfer-case"]').elementHandle(),
          control: await session.taskPage.locator('input[type=file]').elementHandle(),
          recordId: 'transfer-case',
        },
        async (transfer) => {
          const binding = session.browser();
          const { revision } = run.business.snapshot();
          if (
            !binding ||
            binding.tabId !== session.taskTabId ||
            run.owner !== 'agent' ||
            !(await run.askApproval('Attach Approved fixture document to INTAKE-501', fileExpiresAt)) ||
            !session.matches(binding) ||
            session.taskPage.url() !== fixtureURL ||
            run.business.snapshot().revision !== revision ||
            run.controller.signal.aborted
          ) {
            return false;
          }
          filePermit = run.business.authorize({
            operation: 'attach',
            job: tasks.files.job,
            count: transfer.count,
            sha256: transfer.sha256,
          });
          return true;
        },
      );
      if (closed || run.owner !== 'agent' || run.controller.signal.aborted) {
        await created.stop();
        throw new Error('File task setup ended.');
      }
      fileOwner = created;
    }
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
