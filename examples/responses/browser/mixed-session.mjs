// oxlint-disable eslint/max-classes-per-file -- Keep both error identities at the session owner so callers do not classify failures by message text.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { BrowserToolset } from 'openai/helpers/browser';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';
import { createDesktopLedger } from '../../browser-use-demo/desktop-ledger.mjs';
import { createBrowserDriver, exampleBrowserChannel } from './driver.mjs';
import { newDownloadOwner, digest } from './file-download.mjs';
import { waitForDecision } from './file-state.mjs';

export class MixedHostInputRefusedError extends Error {
  constructor() {
    super('Choose Route D-2201 in the host view.');
    this.name = 'MixedHostInputRefusedError';
  }
}

export const receiptText = 'Desktop receipt D-2201';
const receiptBytes = Buffer.from(receiptText, 'utf-8');
const fixtureHTML = await readFile(new URL('mixed-fixture.html', import.meta.url));

export async function createMixedFixture({ result = receiptBytes, partial = false } = {}) {
  const workspaceToken = randomUUID();
  const resultPath = `/result/${randomUUID()}`;
  let routes = 0;
  let resultRequests = 0;
  let admission = 'idle';
  let pending = null;
  let closing;
  const document = Buffer.from(result);
  const commit = (response) => {
    routes += 1;
    response.writeHead(204).end();
  };
  // Keep the fixed POST admission and its HTTP reply under the same fixture owner.
  // oxlint-disable-next-line eslint/complexity
  const server = createServer(async (request, response) => {
    try {
      const resultRequest = request.method === 'GET' && request.url === resultPath;
      const authorized = request.headers.cookie
        ?.split(';')
        .some((value) => value.trim() === `mixed_workspace=${workspaceToken}`);
      if (!resultRequest && !authorized) {
        response.writeHead(403).end();
        return;
      }
      if (request.method === 'GET' && request.url === '/dispatch') {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy':
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
        });
        response.end(fixtureHTML);
        return;
      }
      if (request.method === 'POST' && request.url === '/route') {
        const length = Number(request.headers['content-length']);
        if (
          request.headers['content-type'] !== 'application/json' ||
          !Number.isSafeInteger(length) ||
          length <= 0 ||
          length > 256
        ) {
          response.writeHead(400).end();
          return;
        }
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (Buffer.byteLength(body) > 256) {
            throw new Error('Route refused');
          }
        }
        const value = JSON.parse(body);
        if (
          !value ||
          Object.keys(value).length !== 2 ||
          value.case_id !== 'D-2201' ||
          value.action !== 'route' ||
          !['checking', 'checked'].includes(admission)
        ) {
          response.writeHead(400).end();
          return;
        }
        if (routes || pending) {
          response.writeHead(409).end();
          return;
        }
        if (admission === 'checking') {
          pending = response;
        } else {
          commit(response);
        }
        return;
      }
      if (resultRequest) {
        if (routes !== 1 || admission !== 'completed') {
          response.writeHead(409).end();
          return;
        }
        resultRequests += 1;
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-encoding': 'identity',
          'content-length': document.length,
          'cache-control': 'no-store',
        });
        if (partial) {
          response.write(document.subarray(0, 4));
          response.socket.end();
        } else {
          response.end(document);
        }
        return;
      }
      response.writeHead(404).end();
    } catch {
      response.writeHead(400).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    authorize: (context) =>
      context.addCookies([
        { name: 'mixed_workspace', value: workspaceToken, url: origin, httpOnly: true, sameSite: 'Strict' },
      ]),
    resultURL: () => `${origin}${resultPath}`,
    port: server.address().port,
    proof: () => ({ routes, resultRequests, browserRouted: admission === 'completed' }),
    uncertain: () => admission === 'retired',
    async checkedRoute(click, control, signal) {
      signal.throwIfAborted();
      if (admission !== 'idle') {
        throw new Error('Route cannot be repeated.');
      }
      admission = 'checking';
      try {
        await click();
        signal.throwIfAborted();
        admission = 'checked';
        if (pending) {
          commit(pending);
          pending = null;
        }
        await control.waitForElementState('enabled', { timeout: 2000 });
        signal.throwIfAborted();
        if (routes !== 1) {
          throw new Error('Missing Route receipt.');
        }
        admission = 'completed';
      } finally {
        if (admission !== 'completed') {
          admission = 'retired';
          pending?.writeHead(400).end();
          pending = null;
        }
      }
    },
    close: () => (closing ??= promisify(server.close.bind(server))()),
  };
}

function allowedNative(action, disclosed) {
  if (action.type === 'screenshot' || action.type === 'wait') {
    return true;
  }
  if (action.type === 'type') {
    return disclosed && action.text === receiptText;
  }
  if (action.type === 'keypress') {
    return (
      disclosed &&
      action.keys.length === 2 &&
      action.keys[0] === 'CTRL' &&
      ['A', 'S'].includes(action.keys[1])
    );
  }
  if (action.type === 'click' || action.type === 'move') {
    return (
      action.x >= 540 &&
      action.x < 1024 &&
      action.y >= 80 &&
      action.y < 740 &&
      (!action.keys || action.keys.length === 0) &&
      (action.type === 'move' || action.button === 'left')
    );
  }
  return false;
}

// The fixture, one grant and all completed effects outlive any single agent conversation.
export class MixedSetupCleanupError extends Error {
  name = 'MixedSetupCleanupError';
}

export async function cleanupMixedSetup(desktop, fixture) {
  const results = await Promise.allSettled([desktop?.stop(), fixture?.close()]);
  if (results.some((result) => result.status === 'rejected')) {
    throw new MixedSetupCleanupError('Mixed workspace initialization cleanup failed.');
  }
}

// oxlint-disable-next-line complexity -- One owner admits setup resources and records whether its interruption or final cleanup failed.
export async function createMixedSession({
  desktop,
  fixture,
  signal: setupSignal,
  onClose,
  onLaunchRetirement,
}) {
  let browser;
  let download;
  let retiring;
  const interrupted = () => {
    if (browser) {
      retiring ??= Promise.allSettled([browser.close()]);
    }
  };
  setupSignal?.addEventListener('abort', interrupted, { once: true });
  try {
    setupSignal?.throwIfAborted();
    const starting = chromium.launch({
      headless: true,
      channel: exampleBrowserChannel(),
      chromiumSandbox: true,
      handleSIGINT: false,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        TMPDIR: process.env['TMPDIR'] ?? '/tmp',
      },
    });
    if (setupSignal && onLaunchRetirement) {
      // The caller joins late cleanup. Without a caller owner, initialization must drain it here.
      const launching = new AbortController();
      try {
        const opened = await Promise.race([
          starting,
          once(setupSignal, 'abort', { signal: launching.signal }),
        ]);
        if (setupSignal.aborted) {
          const lateClose = (async () => {
            const late = await starting.catch(() => null);
            await late?.close();
          })();
          // oxlint-disable-next-line promise/prefer-await-to-then -- The caller joins this owner after initialization settles.
          void lateClose.catch(() => null);
          onLaunchRetirement(lateClose);
          setupSignal.throwIfAborted();
        }
        browser = opened;
      } finally {
        launching.abort();
      }
    } else {
      browser = await starting;
    }
    setupSignal?.throwIfAborted();
    const context = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    setupSignal?.throwIfAborted();
    await fixture.authorize(context);
    setupSignal?.throwIfAborted();
    const pageURL = `${fixture.origin}/dispatch`;
    const driver = createBrowserDriver(context, {
      ownedFixture: { urls: [pageURL, `${fixture.origin}/route`], publicViewports: [] },
    });
    const tabId = await driver.new_tab({ url: pageURL }, { signal: setupSignal });
    const [page] = context.pages();
    let currentPermission;
    const originalDocument = await page.evaluateHandle(() => window.document);
    const originalRecord = await page.locator('[data-record-id="result-case"]').elementHandle();
    download = await newDownloadOwner(
      page,
      {
        allowDownload: true,
        record: originalRecord,
        control: await page.locator('button[data-result]').elementHandle(),
        recordId: 'result-case',
      },
      () =>
        currentPermission
          ? currentPermission(
              'Local function: fetch the fixed receipt and show its public text to the model?',
            )
          : false,
    );
    setupSignal?.throwIfAborted();
    const routeControl = await page.locator('#route').elementHandle();
    const originalCase = await page.locator('[data-record-id="D-2201"]').elementHandle();
    if (!routeControl || !originalRecord || !originalCase) {
      throw new Error('Mixed controls are missing.');
    }
    setupSignal?.throwIfAborted();
    let routeRef = null;
    let disclosed = false;
    let grant;
    let grantExpiresAt;
    let consumed = 0;
    let phaseIndex = 0;
    let lease;
    let closing;
    let closed = false;
    let cleanupFailed = false;
    let phaseVerified = false;
    const attempted = new Set();
    const completed = new Set();
    const lifetime = new AbortController();
    const browserClosed = new Error('The mixed workspace browser closed.');
    const disconnected = () => {
      lifetime.abort(browserClosed);
      onClose?.();
    };
    browser.once('disconnected', disconnected);

    // oxlint-disable-next-line eslint/complexity -- One admission decision binds the original controls, grant and independent guest verifier.
    const observe = async (signal = lifetime.signal, finalize = false) => {
      signal.throwIfAborted();
      if (
        closed ||
        fixture.uncertain() ||
        desktop.uncertainEffects ||
        download.receipt().status === 'unknown'
      ) {
        throw new Error('Mixed work cannot be resumed.');
      }
      let onAbort;
      // oxlint-disable-next-line promise/avoid-new -- Bridge Stop to an effect-free check of the original controls.
      const stopped = new Promise((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
      });
      let original;
      try {
        original = await Promise.race([
          download.control.evaluate(
            (control, [record, route, caseRecord, documentAtSetup]) =>
              control.isConnected &&
              record.isConnected &&
              route.isConnected &&
              caseRecord.isConnected &&
              control.ownerDocument === documentAtSetup &&
              documentAtSetup === document &&
              record.ownerDocument === document &&
              route.ownerDocument === document &&
              caseRecord.ownerDocument === document &&
              control.closest('[data-record-id]') === record &&
              route.closest('[data-record-id]') === caseRecord,
            [originalRecord, routeControl, originalCase, originalDocument],
          ),
          stopped,
        ]);
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
      signal.throwIfAborted();
      const tabs = await driver.state({ signal });
      if (
        !original ||
        tabs.tabs.length !== 1 ||
        tabs.tabs[0].id !== tabId ||
        !tabs.tabs[0].active ||
        page.url() !== pageURL ||
        (grant && !download.receipt().completed && Date.now() >= grantExpiresAt)
      ) {
        throw new Error('The original mixed fixture or its grant is no longer available.');
      }
      const observed = await driver.read_page({ tab_id: tabId, filter: 'all' }, { signal });
      const route = observed.elements.find(
        (element) => element.role === 'button' && element.label === 'Route D-2201',
      );
      const guest = finalize ? await desktop.seal({ signal }) : await desktop.verify({ signal });
      signal.throwIfAborted();
      routeRef = route?.ref ?? null;
      const host = fixture.proof();
      const transfer = download.receipt();
      const verified =
        disclosed &&
        host.browserRouted &&
        host.routes === 1 &&
        host.resultRequests === 1 &&
        transfer.status === 'completed' &&
        transfer.completed &&
        guest.file_matches &&
        !guest.file_empty &&
        !guest.browser_matches &&
        guest.browser_effects === 0;
      return { verified, guest, observed };
    };

    const proof = (failure, observation) => {
      const transfer = download.receipt();
      return {
        status: failure ?? (observation?.verified ? 'verified' : 'unverified'),
        verified: phaseVerified,
        host: fixture.proof(),
        transfer: {
          status: transfer.status,
          attempted: transfer.attempted === true,
          completed: transfer.completed === true,
          disclosed,
        },
        guest: observation
          ? {
              fileMatches: observation.guest.file_matches,
              fileEmpty: observation.guest.file_empty,
              browserMatches: observation.guest.browser_matches,
              browserEffects: observation.guest.browser_effects,
            }
          : null,
        uncertainEffects: { file: transfer.status === 'unknown', desktop: desktop.uncertainEffects },
        attempted: attempted.size,
        completed: completed.size,
        consumedRequests: consumed,
      };
    };

    // Admission covers native, browser, file and ledger work until their whole caller has settled.
    const admit = (work) => {
      if (closed || cleanupFailed || lease) {
        return Promise.reject(new Error('Mixed input is busy or stopped.'));
      }
      // oxlint-disable-next-line promise/prefer-await-to-then -- Publish the lease before any reentrant application work starts.
      const task = Promise.resolve().then(work);
      lease = task;
      return task.finally(() => {
        if (lease === task) {
          lease = null;
        }
      });
    };

    const session = {
      tabId,
      desktopId: desktop.id,
      get consumedRequests() {
        return consumed;
      },
      get ledgerDirectory() {
        return session.activeLedger?.directory ?? null;
      },
      get cleanupFailed() {
        return cleanupFailed;
      },
      fileState: () => download.state(),
      failureProof: () => proof(cleanupFailed ? 'cleanup_failed' : 'failed', null),
      hasUncertainEffects() {
        const file = download.state().current;
        return (
          fixture.uncertain() ||
          desktop.uncertainEffects ||
          (file?.effect === 'unknown' && file.status !== 'in_progress')
        );
      },
      observe: (signal) =>
        admit(() => observe(signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal)),
      async frame(view, { signal } = {}) {
        if (closed) {
          return null;
        }
        if (view === 'host') {
          const frame = await waitForDecision(() => page.screenshot({ type: 'png', timeout: 2000 }), signal);
          return { frame, width: 1024, height: 768 };
        }
        if (view === 'guest') {
          return desktop.captureFrame({ signal });
        }
        throw new Error('Unknown mixed view.');
      },
      permits(view, action) {
        if (closed || cleanupFailed || !action) {
          return false;
        }
        if (view === 'host') {
          return action.type === 'click' && action.button === 'left';
        }
        return view === 'guest' && allowedNative(action, disclosed);
      },
      humanInput(view, action) {
        return admit(async () => {
          if (!session.permits(view, action)) {
            throw new Error('That gesture is outside this task.');
          }
          if (view === 'host') {
            await observe();
            const box = await routeControl.boundingBox();
            if (!box || !routeRef) {
              throw new Error('The original Host route control is unavailable.');
            }
            if (
              action.x < box.x ||
              action.x >= box.x + box.width ||
              action.y < box.y ||
              action.y >= box.y + box.height
            ) {
              throw new MixedHostInputRefusedError();
            }
            await fixture.checkedRoute(
              () => driver.click({ tab_id: tabId, target: routeRef }),
              download.control,
              lifetime.signal,
            );
          } else {
            const id = randomUUID();
            await desktop.withComputer(
              (computer, signal) =>
                computer.execute(
                  { type: 'computer_call', id, call_id: id, status: 'completed', actions: [action] },
                  { signal, beforeAction: (next) => !closed && allowedNative(next, disclosed) },
                ),
              { signal: lifetime.signal },
            );
          }
        });
      },
      runPhase({ client, model, signal, approve, progress, onLedger, onDiagnostic }) {
        return admit(async () => {
          phaseVerified = false;
          const stop = new AbortController();
          const live = AbortSignal.any([lifetime.signal, stop.signal, ...(signal ? [signal] : [])]);
          let refused = false;
          let observation;
          const permission = async (label) => {
            if (live.aborted) {
              return false;
            }
            const agreed = await approve(label, live);
            if (live.aborted) {
              return false;
            }
            if (agreed !== true) {
              refused = true;
              stop.abort();
              return false;
            }
            return true;
          };
          currentPermission = permission;
          phaseIndex += 1;
          let ledger;
          let previousRequests = 0;
          try {
            live.throwIfAborted();
            observation = await observe(live);
            live.throwIfAborted();
            if (observation.verified) {
              observation = await observe(live, true);
              live.throwIfAborted();
              phaseVerified = observation.verified;
              return proof(null, observation);
            }
            const remaining = 20 - consumed;
            if (remaining < 1) {
              throw new Error('The mixed request limit has been reached.');
            }
            ledger = await createDesktopLedger(`${randomUUID()}:${phaseIndex}`);
            session.activeLedger = ledger;
            await desktop.withComputer(
              async (computer, desktopSignal) => {
                const active = AbortSignal.any([live, desktopSignal]);
                const host = new BrowserToolset(
                  {
                    state: driver.state,
                    get_page_text: driver.get_page_text,
                    async read_page(args, execution) {
                      const observed = await driver.read_page(args, execution);
                      const route = observed.elements.find(
                        (element) => element.role === 'button' && element.label === 'Route D-2201',
                      );
                      routeRef = route?.ref ?? null;
                      return observed;
                    },
                    async click(args, execution) {
                      if (routeRef === null || args.target !== routeRef) {
                        throw new Error('Use the observed Route reference.');
                      }
                      await fixture.checkedRoute(
                        () => driver.click(args, execution),
                        download.control,
                        execution.signal ?? active,
                      );
                    },
                    navigate: driver.navigate,
                  },
                  {
                    members: ['read_page', 'get_page_text', 'click', 'navigate'],
                    urlPolicy: (_, url) => url === pageURL,
                    confirm: ({ member }) =>
                      permission(`Host browser: approve ${member} in Dispatch receipts?`),
                  },
                );
                const runner = new ResponsesToolRunner({
                  browser: host,
                  computer,
                  functions: [
                    {
                      tool: {
                        type: 'function',
                        name: 'approved_receipt',
                        description:
                          'After the host case shows Routed, request the prepared receipt and consent to disclosure.',
                        strict: true,
                        parameters: {
                          type: 'object',
                          properties: { case_id: { type: 'string' } },
                          required: ['case_id'],
                          additionalProperties: false,
                        },
                      },
                      async execute(args) {
                        if (
                          active.aborted ||
                          !args ||
                          Object.keys(args).length !== 1 ||
                          args.case_id !== 'D-2201' ||
                          !fixture.proof().browserRouted ||
                          fixture.proof().routes !== 1 ||
                          !(await waitForDecision(() => download.control.isEnabled(), active))
                        ) {
                          throw new Error('Receipt request refused.');
                        }
                        const prior = download.receipt();
                        if (prior.status === 'completed' && prior.completed) {
                          if (
                            !(await permission(
                              'Local function: show the already verified fixed receipt to the model?',
                            ))
                          ) {
                            throw new Error('Receipt disclosure refused.');
                          }
                        } else {
                          if (!grant) {
                            grantExpiresAt = Date.now() + 30_000;
                            grant = download.issue(
                              {
                                url: fixture.resultURL(),
                                count: receiptBytes.length,
                                sha256: digest(receiptBytes),
                              },
                              grantExpiresAt,
                            );
                          }
                          let response;
                          try {
                            response = JSON.parse(
                              await download.download({ grant_id: grant.grant_id }, { signal: active }),
                            );
                          } finally {
                            const transferred = download.receipt();
                            if (
                              active.aborted &&
                              transferred.status === 'refused' &&
                              transferred.attempted === false
                            ) {
                              // The download owner revoked this unused grant; Return needs fresh approval.
                              grant = null;
                              grantExpiresAt = undefined;
                            }
                          }
                          if (
                            active.aborted ||
                            response.completed !== true ||
                            response.status !== 'completed'
                          ) {
                            throw new Error('Receipt transfer incomplete; no text disclosed.');
                          }
                        }
                        active.throwIfAborted();
                        disclosed = true;
                        progress?.('Local function: approved receipt verified and disclosed.');
                        return receiptText;
                      },
                    },
                  ],
                });
                const frameId = randomUUID();
                const frame = await computer.execute(
                  {
                    type: 'computer_call',
                    id: frameId,
                    call_id: frameId,
                    status: 'completed',
                    pending_safety_checks: [],
                    actions: [{ type: 'screenshot' }],
                  },
                  { signal: active, beforeAction: (action) => action.type === 'screenshot' },
                );
                await runner.run(
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
                            text:
                              `There are two workspaces. browser_* tools operate on the host Dispatch receipts page. ` +
                              `Use the fresh checked state below. Never repeat a completed Route. ` +
                              `Once Routed, call approved_receipt only if its text has not been disclosed. ` +
                              `The native computer is a separate isolated Linux guest. Leave its browser alone. ` +
                              `Use its fresh image, focus the editor on the right, replace its contents with the ` +
                              `disclosed receipt exactly and save with CTRL+S. No file selectors or extra paths. Finish after saving.\n${JSON.stringify(
                                {
                                  host: observation.observed,
                                  checked: proof(null, observation),
                                  ...(disclosed ? { approvedReceipt: receiptText } : {}),
                                },
                              )}`,
                          },
                          { ...frame.output, type: 'input_image', detail: 'auto' },
                        ],
                      },
                    ],
                  },
                  {
                    signal: active,
                    maxSteps: remaining,
                    onDiagnostic,
                    ledger: {
                      runId: ledger.runId,
                      async save(value) {
                        await ledger.save(value);
                        consumed += value.consumed_requests - previousRequests;
                        previousRequests = value.consumed_requests;
                        for (const id of value.attempted_call_ids) {
                          attempted.add(`${phaseIndex}:${id}`);
                        }
                        for (const id of value.returned_call_ids) {
                          completed.add(`${phaseIndex}:${id}`);
                        }
                        onLedger?.({
                          consumedRequests: consumed,
                          phaseIndex,
                          phase: value.phase,
                          attempted: value.attempted_call_ids.length,
                          returned: value.returned_call_ids.length,
                        });
                      },
                    },
                    computerOptions: {
                      signal: active,
                      beforeAction: async (action) => {
                        if (!allowedNative(action, disclosed)) {
                          refused = true;
                          stop.abort();
                          return false;
                        }
                        if (action.type === 'screenshot' || action.type === 'wait') {
                          return !active.aborted;
                        }
                        return permission('Isolated desktop: approve the next fixed editor gesture?');
                      },
                      approveSafetyChecks: () =>
                        permission('Isolated desktop: approve the pending computer safety check?'),
                    },
                  },
                );
              },
              { signal: live },
            );
            live.throwIfAborted();
            observation = await observe(live);
            if (observation.verified) {
              observation = await observe(live, true);
            }
            live.throwIfAborted();
            phaseVerified = observation.verified;
            progress?.('Isolated desktop: fixed file and unused browser checked.');
            return proof(null, observation);
          } catch {
            let failure = 'failed';
            if (live.reason === browserClosed) {
              failure = 'browser_closed';
            } else if (refused) {
              failure = 'refused';
            } else if (live.aborted) {
              failure = 'stopped';
            }
            return proof(failure, null);
          } finally {
            currentPermission = undefined;
            if (ledger) {
              try {
                await ledger.close();
              } catch (error) {
                cleanupFailed = true;
                // oxlint-disable-next-line eslint/no-unsafe-finally -- A failed private cleanup must invalidate any prior successful phase result.
                throw error;
              }
            }
            session.activeLedger = null;
          }
        });
      },
      close() {
        closed = true;
        browser.off('disconnected', disconnected);
        lifetime.abort();
        closing ??= (async () => {
          // Revoke independent environments together; one pending retirement must not retain another.
          const retired = await Promise.allSettled([
            desktop.stop(),
            download.stop(),
            browser.close(),
            fixture.close(),
          ]);
          const failures = retired
            .filter((entry) => entry.status === 'rejected')
            .map((entry) => entry.reason);
          if (cleanupFailed) {
            failures.push(new Error('Mixed workspace phase cleanup failed.'));
          }
          if (failures.length) {
            throw new AggregateError(failures, 'Mixed workspace cleanup failed.');
          }
        })();
        return closing;
      },
    };
    return session;
  } catch (error) {
    const cleanup = await Promise.allSettled([
      download?.stop(),
      browser?.close(),
      desktop.stop(),
      fixture.close(),
    ]);
    const interruptedCleanup = await retiring;
    if (
      cleanup.some((entry) => entry.status === 'rejected') ||
      interruptedCleanup?.some((entry) => entry.status === 'rejected')
    ) {
      throw new MixedSetupCleanupError('Mixed workspace initialization cleanup failed.');
    }
    throw error;
  } finally {
    setupSignal?.removeEventListener('abort', interrupted);
    await retiring;
  }
}

export async function runMixed(options) {
  let session;
  let result;
  let launchRetirement;
  try {
    session = await createMixedSession({
      ...options,
      onLaunchRetirement: (retirement) => {
        launchRetirement = retirement;
      },
    });
    result = await session.runPhase(options);
  } catch (error) {
    result = session?.failureProof() ?? {
      status: options.signal?.aborted ? 'stopped' : 'failed',
      verified: false,
      host: options.fixture.proof(),
      transfer: { status: 'refused', attempted: false, completed: false, disclosed: false },
      guest: null,
      uncertainEffects: { file: false, desktop: options.desktop.uncertainEffects },
      attempted: 0,
      completed: 0,
    };
    if (error instanceof MixedSetupCleanupError) {
      result.status = 'cleanup_failed';
    }
  }
  const cleanup = session
    ? await Promise.allSettled([session.close()])
    : await Promise.allSettled([options.desktop.stop(), options.fixture.close(), launchRetirement]);
  if (cleanup.some((entry) => entry.status === 'rejected')) {
    result.status = 'cleanup_failed';
  }
  return result;
}
