import { borrowedRead } from './borrowed-read.mjs';
import { ownedElement } from './owned-element.mjs';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { BrowserError } from 'openai/helpers/browser';
import { ownedPointer } from './owned-pointer.mjs';

export function exampleBrowserChannel() {
  const channel = process.env['OPENAI_EXAMPLE_BROWSER_CHANNEL'];
  if (channel !== undefined && channel !== 'chrome') {
    throw new TypeError('OPENAI_EXAMPLE_BROWSER_CHANNEL must be unset or chrome.');
  }
  return channel;
}

function urlFor(page) {
  const raw = page.url();
  const url = new URL(raw);
  let projected = url.protocol;
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    projected = url.origin;
  } else if (raw === 'about:blank') {
    projected = raw;
  }
  if (Buffer.byteLength(projected, 'utf-8') > 2048) {
    throw new BrowserError('Browser URL exceeds the supported state budget.');
  }
  return projected;
}

function serializeBinding(value, item) {
  if (!Array.isArray(value) || (item && (value.length < 21 || value[20] !== (item.value ?? null)))) {
    throw new BrowserError('Browser changed during the read. Read again.');
  }
  const options = value.at(6);
  if (
    options !== null &&
    (typeof options !== 'object' ||
      !options ||
      Array.isArray(options) ||
      !Number.isInteger(options.length) ||
      options.length < 0 ||
      options.length > 32)
  ) {
    throw new BrowserError('Browser changed during the read. Read again.');
  }
  // The last field binds this read's value, not the identity of a reusable control.
  const fields = value.slice(0, 20);
  if (item) {
    fields.splice(3, 4, item.role, item.label, item.checked ?? null, item.options ?? null);
  } else if (options !== null) {
    fields[6] = Array.from({ length: options.length }, (_, index) => options[index]);
  }
  fields[6] = fields[6]?.map(({ label, value: option }) => [label, option]) ?? null;
  return JSON.stringify(fields);
}

async function checkBorrowedInput(handle) {
  // Playwright's native CSS engine uses its utility world, independent of main-world input properties.
  const privateInput = await handle.$(
    'css=:scope:is(input[type="password" i], input[type="file" i], input[type="hidden" i])',
  );
  if (privateInput) {
    await privateInput.dispose();
    throw new BrowserError('Browser changed during the read. Read again.');
  }
}

function exactFixtureURL(value) {
  if (typeof value !== 'string' || value.includes('#')) {
    return false;
  }
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href === value;
  } catch {
    return false;
  }
}

/**
 * Install HTTP and WebSocket guards before opening pages. The launcher must
 * create the context with serviceWorkers: 'block'; routing cannot block them later.
 */
export async function guardBrowserContext(context, allowed, refused) {
  await context.routeWebSocket('**', (socket) => socket.close());
  await context.route('**/*', async (route) => {
    try {
      if (!allowed(route.request().url())) {
        try {
          if (route.request().isNavigationRequest()) {
            refused?.(route.request());
          }
        } finally {
          await route.abort();
        }
        return;
      }
      const response = await route.fetch({ maxRedirects: 0, timeout: 0 });
      try {
        if ([301, 302, 303, 307, 308].includes(response.status())) {
          // The initial URL was allowed. Redirects are unsupported, not policy refusals.
          // A POST could already have caused an effect; never retry it.
          await route.abort('failed');
          return;
        }
        await route.fulfill({ response });
      } finally {
        await response.dispose();
      }
    } catch {
      // A request or context can close while the response is in flight. That
      // is a failed request, not evidence of a navigation policy rejection.
      await route.abort('failed').catch(() => {
        // The context may already be closed.
      });
    }
  });
}

/**
 * Adapt a clean Playwright context to BrowserToolset. The caller owns network policy and closing the context.
 * The fixture runner below provides both. Never point this driver at a personal browser profile.
 * ownedFixture opts a disposable, launcher-owned context into narrow fixture DOM actions and delegates
 * context closure on uncertain effects. urls must be exact URLs installed/owned by the launcher.
 */
export function createBrowserDriver(context, { ownedFixture } = {}) {
  if (
    ownedFixture &&
    (!Array.isArray(ownedFixture.urls) ||
      !ownedFixture.urls.length ||
      ownedFixture.urls.some((url) => !exactFixtureURL(url)))
  ) {
    throw new TypeError('Owned fixtures require exact installed HTTP(S) URLs.');
  }
  const ownedURLs = ownedFixture ? new Set(ownedFixture.urls) : null;
  const publicValues = ownedFixture?.publicValues ?? [];
  if (
    !Array.isArray(publicValues) ||
    publicValues.some(
      (entry) =>
        !Array.isArray(entry) ||
        entry.length !== 3 ||
        !ownedURLs?.has(entry[0]) ||
        entry.some((value) => typeof value !== 'string' || !value.length || !value.isWellFormed()),
    )
  ) {
    throw new TypeError('publicValues requires exact owned URL, record and field tuples.');
  }
  const declaredValues = publicValues.map((entry) => JSON.stringify(entry));
  const publicViewports = ownedFixture?.publicViewports ?? [];
  if (!Array.isArray(publicViewports) || publicViewports.some((url) => !ownedURLs?.has(url))) {
    throw new TypeError('publicViewports requires exact installed owned URLs.');
  }
  const pixelURLs = new Set(publicViewports);
  const nonce = randomBytes(16).toString('hex');
  const tabs = new Map();
  const pageListeners = new Map();
  const pageGenerations = new WeakMap();
  let active = null;
  let sequence = 0;
  let nextRef = 0;
  const refs = new Map();
  const changes = [];
  let eventSequence = 0;
  let droppedChanges = 0;
  let unusable = false;
  let interruptedRead = false;
  let referenceGeneration = 0;
  let retirement;
  let referenceActionActive = false;
  const usable = () => {
    if (unusable) {
      throw new Error('Browser driver was retired after an uncertain action.');
    }
  };
  const allowed = (url) => url === 'about:blank' || ownedURLs.has(url);
  const notice = (type, tabId, details = {}) => {
    if (!ownedURLs || unusable) {
      return;
    }
    if (eventSequence === Number.MAX_SAFE_INTEGER) {
      throw new Error('Browser event sequence exhausted.');
    }
    eventSequence += 1;
    changes.push({ type, sequence: eventSequence, tab_id: tabId, ...details });
    if (changes.length > 32) {
      changes.shift();
      droppedChanges += 1;
    }
  };
  const idFor = (page) => [...tabs].find(([, candidate]) => candidate === page)?.[0] ?? null;
  const disposeReferences = async () => {
    const previous = [...refs.values()];
    refs.clear();
    await Promise.all(
      previous.map(({ handle, observation }) =>
        Promise.all([handle.dispose(), ...(ownedURLs ? [observation.dispose()] : [])]).catch(() => {
          // Navigation may already have destroyed this handle.
        }),
      ),
    );
  };
  const invalidateReferences = async () => {
    usable();
    referenceGeneration += 1;
    await disposeReferences();
  };
  const retireBorrowedReferences = () => {
    // Dispose only the references captured now; Stop must not await the caller's renderer.
    retirement ??= disposeReferences();
    // oxlint-disable-next-line promise/prefer-await-to-then -- Observe borrowed cleanup without delaying Stop on Playwright.
    void retirement.catch(() => {
      // A caller-owned page may have closed while its held references were disposed.
    });
  };
  const joinRetirement = async (signal) => {
    // Observe cached cleanup even if Stop wins the join, without reclassifying input as a read.
    // oxlint-disable-next-line promise/prefer-await-to-then -- Close remains owned after cancellation releases this join.
    void retirement.catch(() => {
      // Individual callers preserve their established close failure behavior.
    });
    if (!signal) {
      return await retirement;
    }
    let onStop;
    // oxlint-disable-next-line promise/avoid-new -- One AbortSignal controls this cleanup join, never the cleanup itself.
    const stopped = new Promise((_resolve, reject) => {
      onStop = () => {
        reject(signal.reason);
      };
      signal.addEventListener('abort', onStop, { once: true });
      if (signal.aborted) {
        onStop();
      }
    });
    try {
      return await Promise.race([retirement, stopped]);
    } finally {
      signal.removeEventListener('abort', onStop);
    }
  };
  const retireFromEvent = async () => {
    unusable = true;
    refs.clear();
    retirement ??= context.close();
    try {
      await retirement;
    } catch {
      // Retain retirement if the disposable context was already closing.
    }
  };
  const guards = ownedURLs
    ? guardBrowserContext(context, allowed, (request) => {
        let tabId = null;
        try {
          tabId = idFor(request.frame().page());
        } catch {
          // A popup's first navigation can precede its frame. Refusal still applies.
        }
        notice('navigation_refused', tabId, { reason: 'policy' });
      })
    : undefined;

  const remember = (page) => {
    if (unusable) {
      return;
    }
    if (![...tabs.values()].includes(page)) {
      if (tabs.size >= 100) {
        unusable = true;
        referenceGeneration += 1;
        if (ownedURLs) {
          refs.clear();
          // This disposable context belongs to the fixture, not its caller.
          // oxlint-disable-next-line promise/prefer-await-to-then -- The synchronous page event retires immediately and drains close.
          void context.close().catch(() => {
            // Remain retired even when close fails.
          });
        } else {
          context.removeListener('page', remember);
          for (const [tracked, listeners] of pageListeners) {
            for (const [event, listener] of Object.entries(listeners)) {
              tracked.removeListener(event, listener);
            }
          }
          retireBorrowedReferences();
          tabs.clear();
          pageListeners.clear();
        }
        return;
      }
      sequence += 1;
      const tabId = `tab_${sequence}`;
      tabs.set(tabId, page);
      pageGenerations.set(page, 0);
      void invalidateReferences();
      const framenavigated = () => {
        if (!unusable) {
          pageGenerations.set(page, pageGenerations.get(page) + 1);
          void invalidateReferences();
        }
        notice('navigation', tabId);
      };
      const framedetached = () => {
        if (!unusable) {
          pageGenerations.set(page, pageGenerations.get(page) + 1);
          void invalidateReferences();
        }
      };
      const close = () => {
        if (!unusable) {
          void invalidateReferences();
        }
        notice('tab_closed', tabId);
        tabs.delete(tabId);
        pageListeners.delete(page);
        pageGenerations.delete(page);
        if (active === tabId) {
          active = [...tabs.keys()][0] ?? null;
        }
      };
      const listeners = { framenavigated, framedetached, close };
      pageListeners.set(page, listeners);
      for (const [event, listener] of Object.entries(listeners)) {
        page.on(event, listener);
      }
      if (ownedURLs) {
        active = tabId;
        notice('tab_opened', tabId);
        page.on('dialog', async (dialog) => {
          const kind = ['alert', 'confirm', 'prompt', 'beforeunload'].includes(dialog.type())
            ? dialog.type()
            : 'other';
          try {
            await dialog.dismiss();
            notice('dialog_dismissed', tabId, { kind });
          } catch {
            // A close may race an in-flight event. No dismissal was confirmed.
            await retireFromEvent();
          }
        });
        page.on('download', async (download) => {
          try {
            await download.cancel();
            notice('download', tabId, { status: 'blocked' });
          } catch {
            await retireFromEvent();
          }
        });
      }
    }
  };
  context.on('page', remember);

  const pageFor = (id) => {
    usable();
    const page = tabs.get(id ?? active);
    if (!page || page.isClosed()) {
      throw new BrowserError('Tab is closed or unknown. Call list_tabs again.');
    }
    if (ownedURLs && !allowed(page.url())) {
      throw new BrowserError('Page is outside this owned fixture.');
    }
    return page;
  };
  const checkedTarget = async (page, ref) => {
    const entry = refs.get(ref);
    if (!entry || entry.page !== page) {
      throw new BrowserError('Unknown element ref. Read the page again.');
    }
    try {
      await checkBorrowedInput(entry.handle);
      const observed = await page.evaluate(borrowedRead, {
        nonce,
        nextRef,
        full: false,
        textOnly: false,
        checkedNode: entry.handle,
      });
      if (serializeBinding(observed) !== entry.binding || refs.get(ref) !== entry) {
        throw new BrowserError('Element is no longer in the document. Read the page again.');
      }
    } catch {
      refs.delete(ref);
      await entry.handle.dispose().catch(() => {
        // Navigation may already have destroyed this captured handle.
      });
      throw new BrowserError('Element ref is stale. Read the page again.');
    }
    return entry.handle;
  };
  // Keep publication, projection agreement and generation-owned failure cleanup together.
  // oxlint-disable-next-line eslint/complexity
  const readBorrowed = async (page, { full, textOnly = false, query = '', finding = false }) => {
    let generation = referenceGeneration;
    if (!textOnly) {
      const invalidating = invalidateReferences();
      generation = referenceGeneration;
      await invalidating;
    }
    usable();
    const scan = await page.evaluateHandle(borrowedRead, { nonce, nextRef, full, textOnly, finding });
    try {
      const reportHandle = await scan.getProperty('report');
      let report;
      try {
        const encoded = await reportHandle.jsonValue();
        report = typeof encoded === 'string' ? JSON.parse(encoded) : null;
      } finally {
        await reportHandle.dispose();
      }
      if (
        !report ||
        typeof report.text !== 'string' ||
        Buffer.byteLength(report.text, 'utf-8') > 16_384 ||
        Buffer.byteLength(JSON.stringify(report), 'utf-8') > 65_536
      ) {
        throw new BrowserError('Browser read exceeds the supported report budget.');
      }
      report.text = report.text.trim();
      report.elements = report.elements.filter((item) =>
        item.label.replaceAll(/\s+/gu, ' ').trim().toLowerCase().includes(query),
      );
      if (report.elements.length > 100) {
        report.elements = report.elements.slice(0, 100);
        if (!report.omitted.includes('target_limit')) {
          report.omitted.push('target_limit');
        }
      }
      const returned = new Map(report.elements.map((item) => [item.ref, item]));
      const counter = await scan.getProperty('nextRef');
      let observedNext;
      try {
        observedNext = await counter.jsonValue();
      } finally {
        await counter.dispose();
      }
      const targets = await scan.getProperty('targets');
      try {
        const properties = await targets.getProperties();
        for (const candidate of properties.values()) {
          try {
            // oxlint-disable-next-line no-await-in-loop
            const itemHandle = await candidate.getProperty('item');
            let item;
            try {
              // oxlint-disable-next-line no-await-in-loop
              const ref = await itemHandle.evaluate((value) => {
                const { ref: observedRef } = value;
                return typeof observedRef === 'string' && observedRef.length <= 65_536 ? observedRef : null;
              });
              item = { ref };
            } finally {
              // oxlint-disable-next-line no-await-in-loop
              await itemHandle.dispose();
            }
            const published = returned.get(item.ref);
            if (!published) {
              continue;
            }
            // Binding stays private to this driver and never enters model output.
            // oxlint-disable-next-line no-await-in-loop
            const bindingHandle = await candidate.getProperty('binding');
            let binding;
            try {
              // oxlint-disable-next-line no-await-in-loop
              const observed = await bindingHandle.jsonValue();
              binding = serializeBinding(observed);
              if (binding !== serializeBinding(observed, published)) {
                throw new BrowserError('Browser changed during the read. Read again.');
              }
            } finally {
              // oxlint-disable-next-line no-await-in-loop
              await bindingHandle.dispose();
            }
            // oxlint-disable-next-line no-await-in-loop
            const node = await candidate.getProperty('node');
            const handle = node.asElement();
            if (!handle) {
              // oxlint-disable-next-line no-await-in-loop
              await node.dispose();
              throw new BrowserError('Browser changed during the read. Read again.');
            }
            try {
              // oxlint-disable-next-line no-await-in-loop
              await checkBorrowedInput(handle);
              if (unusable || generation !== referenceGeneration || page.isClosed()) {
                throw new BrowserError('Browser changed during the read. Read again.');
              }
            } catch (error) {
              // oxlint-disable-next-line no-await-in-loop
              await handle.dispose();
              throw error;
            }
            refs.set(published.ref, {
              page,
              frame: page.mainFrame(),
              handle,
              observation: published,
              binding,
            });
          } finally {
            // oxlint-disable-next-line no-await-in-loop
            await candidate.dispose();
          }
        }
      } finally {
        await targets.dispose();
      }
      if (unusable || generation !== referenceGeneration || page.isClosed()) {
        throw new BrowserError('Browser changed during the read. Read again.');
      }
      if (!textOnly) {
        nextRef = observedNext;
      }
      return report;
    } catch (error) {
      if (!textOnly && !unusable && generation === referenceGeneration) {
        await invalidateReferences();
      }
      throw error;
    } finally {
      await scan.dispose();
    }
  };

  const observation = async (
    work,
    signal,
    mayHaveEffects = false,
    timeoutMs = null,
    sanitizeBorrowed = false,
  ) => {
    signal?.throwIfAborted();
    const observe = async () => {
      try {
        return await work();
      } catch (error) {
        if (sanitizeBorrowed && !ownedURLs && !(error instanceof BrowserError)) {
          usable();
          throw new BrowserError('Browser observation failed. Read the page again.');
        }
        throw error;
      }
    };
    if (!signal && timeoutMs === null) {
      return await observe();
    }
    let onAbort;
    let timer;
    // oxlint-disable-next-line promise/avoid-new -- Bridge AbortSignal to the pending renderer race.
    const stopped = new Promise((_resolve, reject) => {
      const retire = (reason) => {
        // Retire before close. Only an owned fixture delegates context disposal.
        interruptedRead = !mayHaveEffects;
        unusable = true;
        referenceGeneration += 1;
        if (ownedURLs) {
          refs.clear();
        } else {
          retireBorrowedReferences();
        }
        reject(reason);
      };
      onAbort = () => retire(signal.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (timeoutMs !== null) {
        timer = setTimeout(() => retire(new BrowserError('Browser observation timed out.')), timeoutMs);
      }
    });
    try {
      // Promise.race observes late renderer rejection, even after Stop wins.
      return await Promise.race([observe(), stopped]);
    } finally {
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      if (signal?.aborted && ownedURLs) {
        // Stop has already retired admission. Observe teardown without holding
        // cancellation on a browser process that may no longer respond.
        retirement ??= context.close();
        // oxlint-disable-next-line promise/prefer-await-to-then -- Stop cannot wait on browser teardown.
        void retirement.catch(() => {
          // Admission stays retired if the owned context fails to close.
        });
      }
    }
  };
  const referenceAction = async (work) => {
    usable();
    if (referenceActionActive) {
      throw new BrowserError('A reference action is already active on this driver.');
    }
    referenceActionActive = true;
    try {
      return await work();
    } finally {
      referenceActionActive = false;
    }
  };
  const targetFor = (page, ref, signal, work) =>
    referenceAction(async () => {
      const handle = await observation(() => checkedTarget(page, ref), signal, false, 5000);
      return await work(handle);
    });
  const ownedAction = (page, ref, action, signal) =>
    referenceAction(async () => {
      signal?.throwIfAborted();
      // Ref validity remains with its original handles, but native observations cannot survive a ref action.
      referenceGeneration += 1;
      const entry = refs.get(ref);
      if (
        !entry ||
        entry.scope ||
        entry.page !== page ||
        entry.frame.isDetached() ||
        !allowed(entry.frame.url())
      ) {
        throw new BrowserError('Element ref is stale or not ready. Read the page again.');
      }
      let accepted;
      try {
        accepted = await observation(
          () => entry.handle.evaluate(ownedElement, { ...action, expected: entry.observation }),
          signal,
          true,
        );
        signal?.throwIfAborted();
      } catch {
        // The checked action may already have run. Retire before awaiting close;
        // a stalled/failed close cannot let a new turn act through this driver.
        if (!unusable) {
          unusable = true;
          refs.clear();
          try {
            retirement ??= context.close();
            await joinRetirement(signal);
          } catch {
            /* still retired */
          }
        }
        throw new Error('Owned browser action outcome is unknown; context retired.');
      }
      if (accepted === 'invalid_native_date') {
        throw new BrowserError('Use a valid native date in YYYY-MM-DD format.');
      }
      if (accepted !== true) {
        throw new BrowserError('Element ref is stale or unsupported. Read the page again.');
      }
    });

  const guardedInput = async (work, signal, interruptible = true) => {
    signal?.throwIfAborted();
    try {
      await (ownedURLs || !interruptible ? work() : observation(work, signal, true));
      signal?.throwIfAborted();
    } catch {
      unusable = true;
      if (ownedURLs) {
        refs.clear();
        try {
          retirement ??= context.close();
          await joinRetirement(signal);
        } catch {
          /* still retired */
        }
        throw new Error('Owned browser action outcome is unknown; context retired.');
      }
      retireBorrowedReferences();
      throw new Error('Borrowed browser input outcome is unknown; driver retired.');
    }
  };

  const observeState = async () => {
    usable();
    await guards;
    const result = [];
    let titleTruncated = false;
    for (const [id, page] of tabs) {
      if (!page.isClosed()) {
        // Titles and pages describe one observed browser state.
        // oxlint-disable no-await-in-loop -- Each title belongs to this observed tab.
        const fullTitle = ownedURLs
          ? await page.title()
          : await page.evaluate(() => {
              const source = document.title;
              if (typeof source !== 'string') {
                return '';
              }
              let captured = '';
              for (let index = 0; index < source.length && index < 1024; index += 1) {
                captured += source[index];
              }
              return captured;
            });
        // oxlint-enable no-await-in-loop
        if (ownedURLs && !allowed(page.url())) {
          throw new Error('Owned browser is outside its installed fixture URLs.');
        }
        let title = '';
        for (const character of fullTitle) {
          if (Buffer.byteLength(title + character, 'utf-8') > 1024) {
            titleTruncated = true;
            break;
          }
          title += character;
        }
        const url = ownedURLs && page.url() !== 'about:blank' ? new URL(page.url()).origin : urlFor(page);
        result.push({ id, title, url, active: id === active });
      }
    }
    return ownedURLs
      ? {
          tabs: result,
          observation: {
            version: 1,
            sequence: eventSequence,
            dropped_changes: droppedChanges,
            title_truncated: titleTruncated,
            changes: structuredClone(changes),
          },
        }
      : { tabs: result };
  };

  // Remote frames only produce read evidence. Exact frame handles are checked
  // in each parent realm; no cross-realm sequence can authorize a DOM action.
  const remoteVisible = async (frame, point, initialVisited) => {
    let visited = initialVisited;
    let child = frame;
    let coordinates = point;
    while (child.parentFrame()) {
      const parentFrame = child.parentFrame();
      if (!allowed(child.url()) || !allowed(parentFrame.url())) {
        return { visible: false, visited };
      }
      // oxlint-disable-next-line no-await-in-loop
      const handle = await child.frameElement();
      try {
        // Serialized in the parent realm, which cannot capture module helpers.
        // oxlint-disable-next-line no-await-in-loop
        const checked = await handle.evaluate(
          (element, at) => {
            let count = at.visited;
            // oxlint-disable-next-line consistent-function-scoping
            const parent = (node) =>
              node.assignedSlot ?? node.parentElement ?? node.getRootNode().host ?? null;
            for (let node = element; node; node = parent(node)) {
              if (count >= 2000) {
                return { point: null, count };
              }
              count += 1;
              const style = getComputedStyle(node);
              if (
                Object.hasOwn(node.dataset, 'browserPrivate') ||
                node.hidden ||
                style.display === 'none' ||
                style.visibility !== 'visible' ||
                Number(style.opacity) === 0 ||
                style.transform !== 'none' ||
                style.scale !== 'none' ||
                style.rotate !== 'none' ||
                style.translate !== 'none' ||
                style.perspective !== 'none' ||
                !['1', 'normal'].includes(style.zoom)
              ) {
                return { point: null, count };
              }
            }
            const box = element.getBoundingClientRect();
            const x = box.left + element.clientLeft + at.x;
            const y = box.top + element.clientTop + at.y;
            if (
              at.x < 0 ||
              at.y < 0 ||
              at.x >= element.clientWidth ||
              at.y >= element.clientHeight ||
              document.elementFromPoint(x, y) !== element
            ) {
              return { point: null, count };
            }
            return { point: { x, y }, count };
          },
          { ...coordinates, visited },
        );
        coordinates = checked.point;
        visited = checked.count;
      } finally {
        // oxlint-disable-next-line no-await-in-loop
        await handle.dispose();
      }
      if (!coordinates) {
        return { visible: false, visited };
      }
      child = parentFrame;
    }
    return { visible: true, visited };
  };
  // Keep reference publication, generation check and failure cleanup together.
  // oxlint-disable-next-line eslint/complexity
  const readOwned = async (page, { full, textOnly, query, scoped, waitGeneration }) => {
    usable();
    const tabId = idFor(page);
    const events = eventSequence;
    let generation = referenceGeneration;
    let root;
    if (scoped?.root !== null && scoped?.root !== undefined) {
      root = refs.get(scoped.root);
      if (!root?.scope || root.page !== page || root.frame !== page.mainFrame()) {
        throw new BrowserError('Unknown or expired scope. Read the page again.');
      }
      // Keep this one handle alive through invalidation; every old ref remains unusable.
      refs.delete(scoped.root);
    }
    let report = { version: 1, text: '', elements: [], omitted: [], ...(scoped ? { scopes: [] } : {}) };
    const omit = (reason) => {
      if (!report.omitted.includes(reason)) {
        report.omitted.push(reason);
      }
    };
    let visited = 0;
    let frames = 0;
    try {
      if (!textOnly) {
        const invalidating = invalidateReferences();
        generation = referenceGeneration;
        await invalidating;
      }
      for (const frame of page.frames()) {
        if (scoped && frame !== page.mainFrame()) {
          omit('unsupported_root');
          continue;
        }
        if (frames >= 16) {
          omit('frame_limit');
          break;
        }
        frames += 1;
        let depth = 0;
        let remote = false;
        let child = frame;
        while (child.parentFrame()) {
          const parent = child.parentFrame();
          depth += 1;
          if (!allowed(child.url()) || !allowed(parent.url())) {
            break;
          }
          if (new URL(child.url()).origin !== new URL(parent.url()).origin) {
            remote = true;
          }
          child = parent;
        }
        if (depth > 8 || child !== page.mainFrame() || !allowed(frame.url())) {
          omit(depth > 8 ? 'frame_limit' : 'unsupported_root');
          continue;
        }
        if (visited >= 2000) {
          omit('work_limit');
          break;
        }
        // Keep DOM handles in Chromium until each bounded report entry is accepted.
        // The scan returns at most 100 actionable entries per whole observation.
        // oxlint-disable-next-line no-await-in-loop
        const request = {
          action: 'scan',
          report,
          visited,
          depth,
          full,
          textOnly: textOnly && !remote,
          query,
          remote,
          publicValues: declaredValues,
          nonce,
          nextRef,
          ...(scoped
            ? { domDepth: scoped.depth, scopeRoot: Boolean(root), expected: root?.observation }
            : {}),
        };
        // oxlint-disable-next-line no-await-in-loop
        const scan = await (root ? root.handle : frame.locator('html')).evaluateHandle(ownedElement, request);
        try {
          // oxlint-disable-next-line no-await-in-loop
          const extracted = await scan.evaluate(({ report: value, visited: count }) => ({
            report: value,
            visited: count,
          }));
          ({ report, visited } = extracted);
          // oxlint-disable-next-line no-await-in-loop
          const candidates = await scan.getProperty('targets');
          try {
            // oxlint-disable-next-line no-await-in-loop
            const properties = await candidates.getProperties();
            for (const candidate of properties.values()) {
              try {
                // oxlint-disable-next-line no-await-in-loop
                const value = await candidate.evaluate(({ item, x, y, scope }) => ({
                  item,
                  x,
                  y,
                  scope,
                }));
                if (remote) {
                  // oxlint-disable-next-line no-await-in-loop
                  const visibility = await remoteVisible(frame, { x: value.x, y: value.y }, visited);
                  ({ visited } = visibility);
                  if (visibility.visible) {
                    const summary = [
                      'Read only: remote frame',
                      value.item.role,
                      value.item.label,
                      value.item.value,
                      ...(value.item.options?.map((option) => option.label) ?? []),
                    ]
                      .filter((piece) => piece !== undefined)
                      .join(' ');
                    const text = [report.text, summary].filter(Boolean).join(' ');
                    const proposed = {
                      ...report,
                      text,
                      omitted: [...new Set([...report.omitted, 'report_limit'])],
                    };
                    if (Buffer.byteLength(text) > 16_384) {
                      omit('text_limit');
                    } else if (Buffer.byteLength(JSON.stringify(proposed)) > 65_536) {
                      omit('report_limit');
                    } else {
                      report.text = text;
                    }
                  } else {
                    omit(visited >= 2000 ? 'work_limit' : 'unsupported_root');
                  }
                } else {
                  // oxlint-disable-next-line no-await-in-loop
                  const nodeHandle = await candidate.getProperty('node');
                  const handle = nodeHandle.asElement();
                  if (!handle) {
                    throw new Error('Owned read lost an element.');
                  }
                  // Retain group DOM identities only in the existing private ref
                  // record. Never serialize radio peers into an SDK read result.
                  // oxlint-disable-next-line no-await-in-loop
                  const heldObservation = await candidate.getProperty('observation');
                  if (
                    unusable ||
                    generation !== referenceGeneration ||
                    events !== eventSequence ||
                    tabId !== idFor(page) ||
                    page.isClosed()
                  ) {
                    // oxlint-disable-next-line no-await-in-loop
                    await Promise.all([handle.dispose(), heldObservation.dispose()]);
                    throw new BrowserError('Browser changed during the read. Read again.');
                  }
                  nextRef += 1;
                  refs.set(value.item.ref, {
                    page,
                    frame,
                    handle,
                    observation: heldObservation,
                    scope: value.scope === true,
                  });
                }
              } finally {
                // oxlint-disable-next-line no-await-in-loop
                await candidate.dispose();
              }
            }
          } finally {
            // oxlint-disable-next-line no-await-in-loop
            await candidates.dispose();
          }
        } finally {
          // oxlint-disable-next-line no-await-in-loop
          await scan.dispose();
        }
      }
      if (
        unusable ||
        (!textOnly || waitGeneration === undefined
          ? generation !== referenceGeneration || events !== eventSequence
          : waitGeneration !== pageGenerations.get(page)) ||
        tabId !== idFor(page) ||
        page.isClosed()
      ) {
        throw new BrowserError('Browser changed during the read. Read again.');
      }
      return report;
    } catch (error) {
      if (!textOnly && !unusable && generation === referenceGeneration) {
        await invalidateReferences();
      }
      if (scoped) {
        throw new BrowserError('Scope is stale, hidden or unsupported. Read the page again.');
      }
      throw error;
    } finally {
      if (root) {
        await Promise.all([root.handle.dispose(), root.observation.dispose()]).catch(() => {
          // Navigation can destroy the root before its scan settles.
        });
      }
    }
  };

  const driver = {
    async state({ signal } = {}) {
      return await observation(observeState, signal, false, ownedURLs ? null : 5000, !ownedURLs);
    },
    async new_tab({ url }, { signal } = {}) {
      usable();
      if (ownedURLs && url !== null && !allowed(url)) {
        notice('navigation_refused', null, { reason: 'policy' });
        throw new BrowserError('URL is outside this owned fixture.');
      }
      if (!ownedURLs && url !== null && (typeof url !== 'string' || !URL.canParse(url))) {
        throw new BrowserError('Navigation requires an absolute URL.');
      }
      signal?.throwIfAborted();
      await observation(() => guards, signal);
      await observation(invalidateReferences, signal);
      let created;
      let closing;
      const closeCreated = () => {
        if (!ownedURLs && created) {
          // oxlint-disable-next-line promise/prefer-await-to-then -- Cache one joined page close for both Stop and late completion.
          closing ??= created.close().catch(() => {
            // This driver owns only the created page; its caller retains the context.
          });
        }
        return closing;
      };
      const openPage = async () => {
        let completed = false;
        try {
          created = await context.newPage();
          signal?.throwIfAborted();
          usable();
          remember(created);
          if (url !== null) {
            await created.goto(url);
          }
          signal?.throwIfAborted();
          usable();
          active = [...tabs].find(([, candidate]) => candidate === created)?.[0];
          completed = true;
        } finally {
          if (!completed) {
            await closeCreated();
          }
        }
      };
      // The late opening task owns its page cleanup even if Stop wins first.
      try {
        await guardedInput(() => observation(openPage, signal, true), signal, false);
      } catch (error) {
        if (signal?.aborted) {
          void closeCreated();
        } else {
          await closeCreated();
        }
        throw error;
      }
      return active;
    },
    async switch_tab({ tab_id }, { signal } = {}) {
      const page = pageFor(tab_id);
      await observation(invalidateReferences, signal);
      await observation(() => guardedInput(() => page.bringToFront(), signal, false), signal, true);
      active = tab_id;
      notice('tab_switched', tab_id);
    },
    async close_tab({ tab_id }, { signal } = {}) {
      const page = pageFor(tab_id);
      await observation(() => guardedInput(() => page.close(), signal, false), signal, true);
      tabs.delete(tab_id);
      if (active === tab_id) {
        active = [...tabs.keys()][0] ?? null;
      }
    },
    async navigate({ tab_id, url }, { signal } = {}) {
      const history = url === 'back' || url === 'forward' || url === 'reload';
      if (ownedURLs && !history && !allowed(url)) {
        usable();
        notice('navigation_refused', tab_id, { reason: 'policy' });
        throw new BrowserError('URL is outside this owned fixture.');
      }
      const page = pageFor(tab_id);
      // Network permission still belongs to the caller's toolset/context.
      if (!ownedURLs && !history && (typeof url !== 'string' || !URL.canParse(url))) {
        throw new BrowserError('Navigation requires an absolute URL.');
      }
      signal?.throwIfAborted();
      await observation(invalidateReferences, signal);
      const navigation = { timeout: 30_000, waitUntil: 'domcontentloaded' };
      if (history) {
        const navigateHistory = {
          back: page.goBack.bind(page),
          forward: page.goForward.bind(page),
          reload: page.reload.bind(page),
        }[url];
        await guardedInput(() => observation(() => navigateHistory(navigation), signal, true), signal, false);
      } else {
        await guardedInput(() => observation(() => page.goto(url, navigation), signal, true), signal, false);
      }
      pageFor(tab_id);
      return history ? 'History navigation checked.' : 'Navigation checked.';
    },
    async read_page({ tab_id, filter }, { signal } = {}) {
      const page = pageFor(tab_id);
      if (ownedURLs) {
        return await observation(
          () => readOwned(page, { full: filter === 'all', textOnly: false, query: '' }),
          signal,
        );
      }
      return await observation(
        () => readBorrowed(page, { full: filter === 'all' }),
        signal,
        false,
        5000,
        true,
      );
    },
    async get_page_text({ tab_id }, { signal } = {}) {
      const page = pageFor(tab_id);
      if (ownedURLs) {
        return await observation(() => readOwned(page, { full: true, textOnly: true, query: '' }), signal);
      }
      const report = await observation(
        () => readBorrowed(page, { full: true, textOnly: true }),
        signal,
        false,
        5000,
        true,
      );
      return report.text;
    },
    async find({ tab_id, query }, { signal } = {}) {
      const page = pageFor(tab_id);
      if (ownedURLs) {
        return await observation(
          () =>
            readOwned(page, {
              full: false,
              textOnly: false,
              query: query.replaceAll(/\s+/gu, ' ').trim().toLowerCase(),
            }),
          signal,
        );
      }
      return await observation(
        () =>
          readBorrowed(page, {
            full: false,
            query: query.replaceAll(/\s+/gu, ' ').trim().toLowerCase(),
            finding: true,
          }),
        signal,
        false,
        5000,
        true,
      );
    },
    async click({ tab_id, target }, { signal } = {}) {
      if (ownedURLs) {
        return await ownedAction(pageFor(tab_id), target, { action: 'click' }, signal);
      }
      return await targetFor(pageFor(tab_id), target, signal, async (handle) => {
        await guardedInput(async () => {
          signal?.throwIfAborted();
          refs.delete(target);
          try {
            await handle.click({ timeout: 3000 });
          } finally {
            await handle.dispose().catch(() => {
              // Navigation or a closed page can already have destroyed the consumed remote object.
            });
          }
        }, signal);
      });
    },
    async type({ tab_id, target, text }, { signal } = {}) {
      const page = pageFor(tab_id);
      if (ownedURLs) {
        return await ownedAction(page, target, { action: 'type', text }, signal);
      }
      // Resolve refs only when the caller actually requested a referenced element.
      // oxlint-disable-next-line prefer-ternary
      if (target === null) {
        await guardedInput(() => page.keyboard.insertText(text), signal);
      } else {
        await targetFor(page, target, signal, (handle) =>
          guardedInput(() => handle.fill(text, { timeout: 3000 }), signal),
        );
      }
    },
    async key({ tab_id, keys }, { signal } = {}) {
      const page = pageFor(tab_id);
      await guardedInput(() => page.keyboard.press(keys.join('+')), signal);
    },
    async scroll({ tab_id, direction, amount }, { signal } = {}) {
      const page = pageFor(tab_id);
      const delta = { up: [0, -amount], down: [0, amount], left: [-amount, 0], right: [amount, 0] };
      const [dx, dy] = delta[direction];
      await guardedInput(() => page.mouse.wheel(dx, dy), signal);
    },
    async select_option({ tab_id, target, values }, { signal } = {}) {
      if (ownedURLs) {
        return await ownedAction(pageFor(tab_id), target, { action: 'select_option', values }, signal);
      }
      if (!Array.isArray(values)) {
        throw new BrowserError('Option values must be a list of strings.');
      }
      const selected = [...values];
      if (selected.some((value) => typeof value !== 'string')) {
        throw new BrowserError('Option values must be a list of strings.');
      }
      await targetFor(pageFor(tab_id), target, signal, (handle) =>
        guardedInput(() => handle.selectOption(selected, { timeout: 3000 }), signal),
      );
    },
    async hover({ tab_id, target }, { signal } = {}) {
      await targetFor(pageFor(tab_id), target, signal, (handle) =>
        guardedInput(() => handle.hover({ timeout: 3000 }), signal),
      );
    },
    async screenshot({ tab_id }, { signal } = {}) {
      const png = await observation(() => pageFor(tab_id).screenshot(), signal);
      return {
        type: 'input_image',
        detail: 'auto',
        image_url: `data:image/png;base64,${png.toString('base64')}`,
      };
    },
  };
  if (ownedURLs) {
    driver.describe_target = async ({ tab_id, target }, { signal } = {}) =>
      observation(async () => {
        const page = pageFor(tab_id);
        const entry = refs.get(target);
        if (
          !entry ||
          entry.scope ||
          entry.page !== page ||
          entry.frame.isDetached() ||
          !allowed(entry.frame.url())
        ) {
          throw new BrowserError('Element ref is stale or not ready. Read the page again.');
        }
        let description;
        try {
          description = await entry.handle.evaluate(ownedElement, {
            action: 'describe',
            expected: entry.observation,
          });
        } catch {
          throw new BrowserError('Element ref is stale. Read the page again.');
        }
        if (!description || refs.get(target) !== entry || pageFor(tab_id) !== page) {
          throw new BrowserError('Element ref changed. Read the page again.');
        }
        return description;
      }, signal);
    driver.set_checked = async ({ tab_id, target, checked }, { signal } = {}) => {
      await ownedAction(pageFor(tab_id), target, { action: 'set_checked', checked }, signal);
    };
    driver.read_page_scoped = async ({ tab_id, root, depth, filter }, { signal } = {}) =>
      observation(
        () =>
          readOwned(pageFor(tab_id), {
            full: filter === 'all',
            textOnly: false,
            query: '',
            scoped: { root, depth },
          }),
        signal,
      );
    driver.scroll_to = async ({ tab_id, target }, { signal } = {}) => {
      await ownedAction(pageFor(tab_id), target, { action: 'scroll_to' }, signal);
      await observation(invalidateReferences, signal, true);
    };
    driver.wait_for = async ({ tab_id, text, timeout_ms }, { signal } = {}) => {
      const page = pageFor(tab_id);
      const id = idFor(page);
      const generation = referenceGeneration;
      const before = eventSequence;
      const waitGeneration = tab_id === null ? undefined : pageGenerations.get(page);
      const changed = () =>
        (waitGeneration === undefined
          ? generation !== referenceGeneration || before !== eventSequence || id !== active
          : waitGeneration !== pageGenerations.get(page)) || pageFor(id) !== page;
      const deadline = performance.now() + timeout_ms;
      const query = text.replaceAll(/\s+/gu, ' ').trim().toLowerCase();
      while (performance.now() < deadline) {
        signal?.throwIfAborted();
        if (changed()) {
          throw new BrowserError('Browser changed during wait. Read again.');
        }
        // Bound the entire observation, including extraction after the initial DOM scan.
        const readStarted = performance.now();
        const timer = new AbortController();
        const observationSignal = signal ? AbortSignal.any([timer.signal, signal]) : timer.signal;
        let settled = false;
        // oxlint-disable-next-line promise/prefer-await-to-then -- Retire only if the observation is still running when Stop or its timer wins.
        const reading = readOwned(page, { full: true, textOnly: true, query: '', waitGeneration }).finally(
          () => {
            settled = true;
          },
        );
        let report;
        try {
          // oxlint-disable-next-line no-await-in-loop
          report = await Promise.race([
            reading,
            // oxlint-disable-next-line promise/prefer-await-to-then -- This deadline competes with the complete observation.
            delay(Math.max(1, deadline - performance.now()), undefined, { signal: observationSignal }).then(
              () => {
                throw new BrowserError('Visible condition timed out.');
              },
            ),
          ]);
        } catch (error) {
          if (!settled) {
            interruptedRead = true;
            unusable = true;
            referenceGeneration += 1;
            refs.clear();
            retirement ??= context.close();
            // oxlint-disable-next-line promise/prefer-await-to-then -- Admission is retired; cancellation must not wait for Chromium teardown.
            void retirement.catch(() => {
              // Keep the original Stop or deadline error if the owned context fails to close.
            });
          }
          throw error;
        } finally {
          timer.abort();
        }
        signal?.throwIfAborted();
        if (changed()) {
          throw new BrowserError('Browser changed during wait. Read again.');
        }
        const remaining = deadline - performance.now();
        if (remaining <= 0) {
          break;
        }
        if (report.text.replaceAll(/\s+/gu, ' ').trim().toLowerCase().includes(query)) {
          return 'Visible condition met.';
        }
        // One bounded poll interval, interrupted by the caller's signal.
        // If another observation could not fit after the poll interval,
        // finish the wait here instead of starting a read at an expired deadline.
        const nextReadFits = remaining > 100 + (performance.now() - readStarted);
        // oxlint-disable-next-line no-await-in-loop -- Polls depend on the preceding observation.
        await delay(nextReadFits ? 100 : remaining, undefined, { signal });
      }
      throw new BrowserError('Visible condition timed out.');
    };
    driver.invalidateReferences = invalidateReferences;
    // Only the owning launcher may use this local outcome when it exports a run.
    driver.hasUncertainEffects = () => unusable && !interruptedRead;
    // Local launcher access only: preserve the driver's single checked tab registry.
    driver.currentOwnedView = () => {
      usable();
      return active === null ? null : { tabId: active, page: pageFor(active), sequence: eventSequence };
    };
    driver.retire = async (release, { signal } = {}) => {
      unusable = true;
      referenceGeneration += 1;
      refs.clear();
      // Finish bounded input release before close. Explicit launcher retirement still joins cleanup.
      try {
        await release?.();
      } finally {
        retirement ??= context.close();
        await joinRetirement(signal);
      }
    };
    const pointer = ownedPointer({
      pageFor,
      pixelURLs,
      observation,
      invalidateReferences,
      generation: () => {
        usable();
        return `${referenceGeneration}:${eventSequence}:${active}`;
      },
      retire: async (release, signal) => {
        try {
          await driver.retire(release, { signal });
        } catch {
          // Still retired if Chromium cannot acknowledge cleanup.
        }
      },
    });
    driver.screenshot = pointer.screenshot;
    if (pixelURLs.size) {
      driver.zoom = pointer.zoom;
    }
    driver.createOwnedComputer = pointer.createOwnedComputer;
    driver.createOwnedBrowser = pointer.createOwnedBrowser;
    delete driver.hover;
    delete driver.key;
    delete driver.scroll;
  }
  return driver;
}
