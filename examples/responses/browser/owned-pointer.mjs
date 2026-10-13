// Optional isolated-fixture pixels and native input. No SDK runtime dependency on Playwright.
// Only a launcher-captured original ElementHandle can bind a computer adapter.
import { BrowserError } from 'openai/helpers/browser';
import { setTimeout as delay } from 'node:timers/promises';

const refused = () => new BrowserError('Owned viewport is stale, private, unsupported or busy.');
const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// This deliberately admits only a fixed, secret-free top-level public fixture.
// It is a bounded full-document privacy scan, not the privacy-filtered text report.
function publicView() {
  const walk = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
  let count = 0;
  let node = walk.currentNode;
  while (node) {
    count += 1;
    if (
      count > 2000 ||
      Object.hasOwn(node.dataset, 'browserPrivate') ||
      node.matches(
        'input,textarea,select,[contenteditable]:not([contenteditable=false]),iframe,frame,object,embed,video,audio',
      ) ||
      node.shadowRoot ||
      node.localName.includes('-')
    ) {
      return null;
    }
    node = walk.nextNode();
  }
  const view = window.visualViewport;
  if (!view || view.scale !== 1 || view.offsetLeft !== 0 || view.offsetTop !== 0) {
    return null;
  }
  return [innerWidth, innerHeight, scrollX, scrollY, devicePixelRatio, view.width, view.height, view.scale];
}

async function readPublicView(page, canvases = []) {
  // These owned Chromium fixtures require a scan whose DOM wrappers page scripts cannot alter.
  const session = await page.context().newCDPSession(page);
  let view;
  try {
    const { frameTree } = await session.send('Page.getFrameTree');
    const { executionContextId } = await session.send('Page.createIsolatedWorld', {
      frameId: frameTree.frame.id,
      worldName: 'openai-owned-viewport',
    });
    const result = await session.send('Runtime.evaluate', {
      expression: `(${publicView})()`,
      contextId: executionContextId,
      returnByValue: true,
    });
    view = result.result.value;
    if (result.exceptionDetails || !Array.isArray(view) || view.length !== 8) {
      return null;
    }
  } finally {
    await session.detach();
  }
  const currentCanvases = page.locator('css=canvas');
  const count = await currentCanvases.count();
  if (count > 2000 || count > canvases.length) {
    return null;
  }
  for (let index = 0; index < count; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Bound each temporary handle to its identity check.
    const current = await currentCanvases.nth(index).elementHandle();
    try {
      // oxlint-disable-next-line no-await-in-loop -- Compare against the launcher's original handles.
      const allowed = await current.evaluate((node, originals) => {
        // oxlint-disable-next-line typescript/prefer-for-of -- Page scripts can replace the array iterator.
        for (let original = 0; original < originals.length; original += 1) {
          if (node === originals[original]) {
            return true;
          }
        }
        return false;
      }, canvases);
      if (!allowed) {
        return null;
      }
    } finally {
      // oxlint-disable-next-line no-await-in-loop -- Disposal stays inside the observed operation.
      await current.dispose();
    }
  }
  return view;
}

function pointIn(point, view) {
  return (
    point &&
    Number.isSafeInteger(point.x) &&
    Number.isSafeInteger(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < view[0] &&
    point.y < view[1]
  );
}
function equalView(a, b) {
  return !!a && !!b && a.length === b.length && a.every((value, index) => value === b[index]);
}
function image(png, native) {
  const image_url = `data:image/png;base64,${png.toString('base64')}`;
  return native
    ? { type: 'computer_screenshot', image_url }
    : { type: 'input_image', detail: 'auto', image_url };
}

function validBox(box, width, height) {
  return (
    Array.isArray(box) &&
    box.length === 4 &&
    box.every((n) => Number.isSafeInteger(n) && n >= 0) &&
    box[0] < box[2] &&
    box[1] < box[3] &&
    box[2] <= width &&
    box[3] <= height &&
    (box[2] - box[0]) * (box[3] - box[1]) <= 4_194_304
  );
}
function validPNG(png, box) {
  return (
    png.length >= 24 &&
    png.length <= 16 * 1024 * 1024 &&
    png.subarray(0, 8).equals(pngHeader) &&
    png.subarray(12, 16).toString('ascii') === 'IHDR' &&
    png.readUInt32BE(16) === box[2] - box[0] &&
    png.readUInt32BE(20) === box[3] - box[1]
  );
}
function validGestureFields(action, browser) {
  const allowed = new Set(['type', 'keys']);
  if (action.type === 'click' || action.type === 'move') {
    allowed.add('x').add('y');
  }
  if (action.type === 'click') {
    allowed.add('button');
    if (browser) {
      allowed.add('click_count');
    }
  }
  if (browser && action.type === 'keypress') {
    allowed.add('duration_ms');
  }
  if (action.type === 'drag') {
    allowed.add('path');
    if (
      !Array.isArray(action.path) ||
      action.path.some(
        (point) =>
          !point || typeof point !== 'object' || Object.keys(point).some((key) => key !== 'x' && key !== 'y'),
      )
    ) {
      return false;
    }
  }
  return Object.keys(action).every((key) => allowed.has(key));
}
function validGestureKeys(keys, isKey, browser) {
  if (!Array.isArray(keys)) {
    return false;
  }
  if (!browser) {
    if (isKey) {
      return keys.length === 1 && ['Enter', 'Escape'].includes(keys[0]);
    }
    return keys.length === 0 || (keys.length === 1 && keys[0] === 'Shift');
  }
  if (new Set(keys).size !== keys.length) {
    return false;
  }
  const modifiers = ['Control', 'Alt', 'Meta', 'Shift'];
  if (!isKey) {
    return keys.length <= 4 && keys.every((key) => modifiers.includes(key));
  }
  const allowed = new Set([
    ...modifiers,
    'Enter',
    'Escape',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Space',
    'Home',
    'End',
    'PageUp',
    'PageDown',
  ]);
  return keys.length >= 1 && keys.length <= 8 && keys.every((key) => allowed.has(key));
}
function validBrowserGesture(action) {
  if (action.type === 'click') {
    return [1, 2, 3].includes(action.click_count);
  }
  if (action.type === 'keypress') {
    return Number.isSafeInteger(action.duration_ms) && action.duration_ms >= 1 && action.duration_ms <= 3000;
  }
  return true;
}
function gesturePath(action, view, browser) {
  const keys = action.keys ?? [];
  const isKey = action.type === 'keypress';
  if (
    !validGestureFields(action, browser) ||
    !validGestureKeys(keys, isKey, browser) ||
    (browser && !validBrowserGesture(action))
  ) {
    throw refused();
  }
  const buttons = browser ? ['left', 'right', 'middle'] : ['left', 'right'];
  if (action.type === 'click' && !buttons.includes(action.button)) {
    throw refused();
  }
  let path = isKey ? [] : [action];
  if (action.type === 'drag') {
    ({ path } = action);
  }
  if (
    !Array.isArray(path) ||
    (action.type === 'drag' && (path.length < 2 || path.length > 100)) ||
    path.some((at) => !pointIn(at, view))
  ) {
    throw refused();
  }
  return { keys, isKey, path };
}

export function ownedPointer({ pageFor, pixelURLs, generation, invalidateReferences, retire, observation }) {
  // Shared only for the duration of native capture/gesture. No queue and no permit registry.
  let busy = false;
  const claim = () => {
    if (busy) {
      throw refused();
    }
    busy = true;
  };
  async function capture(page, region, signal, canvases = []) {
    signal?.throwIfAborted();
    const start = generation();
    if (pageFor(null) !== page || !pixelURLs.has(page.url())) {
      throw refused();
    }
    const view = await readPublicView(page, canvases);
    if (!view) {
      throw refused();
    }
    const [width, height] = view;
    const box = region ?? [0, 0, width, height];
    if (!validBox(box, width, height)) {
      throw refused();
    }
    const png = await page.screenshot({
      type: 'png',
      fullPage: false,
      scale: 'css',
      ...(region ? { clip: { x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1] } } : {}),
    });
    signal?.throwIfAborted();
    const after = await readPublicView(page, canvases);
    signal?.throwIfAborted();
    if (
      start !== generation() ||
      pageFor(null) !== page ||
      !pixelURLs.has(page.url()) ||
      !equalView(view, after) ||
      !validPNG(png, box)
    ) {
      throw refused();
    }
    return { png, view, generation: start };
  }
  async function browserCapture(tab_id, region, signal) {
    claim();
    try {
      return await observation(async () => {
        const captured = await capture(pageFor(tab_id), region, signal);
        return image(captured.png, false);
      }, signal);
    } finally {
      busy = false;
    }
  }
  const driver = {
    screenshot: ({ tab_id }, { signal } = {}) => browserCapture(tab_id, undefined, signal),
    zoom: ({ tab_id, region }, { signal } = {}) => browserCapture(tab_id, region, signal),
    async createOwnedComputer({ signal, record, canvases: suppliedCanvases = [], browser = false }) {
      if (!Array.isArray(suppliedCanvases)) {
        throw refused();
      }
      const canvases = [...suppliedCanvases];
      const page = pageFor(null);
      if (!signal || !pixelURLs.has(page.url()) || !record) {
        throw refused();
      }
      signal.throwIfAborted();
      if (!browser && canvases.length) {
        throw refused();
      }
      let doc;
      const originalURL = page.url();
      let permit = null;
      async function checked(view, at, focus = false, currentSignal = signal) {
        currentSignal.throwIfAborted();
        if (pageFor(null) !== page || page.url() !== originalURL || !pixelURLs.has(originalURL)) {
          throw refused();
        }
        const currentView = await readPublicView(page, canvases);
        if (!currentView || (view && !equalView(view, currentView))) {
          throw refused();
        }
        const admitted = await record.evaluate(
          (root, { doc: original, view: before, at: target, focus: menu }) => {
            // Serialized with this browser task. Never walk past the original document or its work budget.
            // oxlint-disable-next-line consistent-function-scoping -- Playwright serializes this enclosing task.
            function rendered(hit) {
              let visited = 0;
              for (let node = hit; node; node = node.parentElement) {
                visited += 1;
                const style = getComputedStyle(node);
                if (
                  visited > 2000 ||
                  node.hidden ||
                  Object.hasOwn(node.dataset, 'browserPrivate') ||
                  style.display === 'none' ||
                  style.visibility !== 'visible' ||
                  Number(style.opacity) === 0
                ) {
                  return false;
                }
              }
              return true;
            }
            const viewport = window.visualViewport;
            const now = [
              innerWidth,
              innerHeight,
              scrollX,
              scrollY,
              devicePixelRatio,
              viewport?.width,
              viewport?.height,
              viewport?.scale,
            ];
            if (
              !root.isConnected ||
              root.ownerDocument !== original ||
              original !== document ||
              (before && !now.every((n, i) => n === before[i]))
            ) {
              return false;
            }
            if (!target && !menu) {
              return true;
            }
            const hit = menu ? document.activeElement : document.elementFromPoint(target.x, target.y);
            if (
              !hit ||
              !root.contains(hit) ||
              hit.getClientRects().length === 0 ||
              hit.matches(':disabled')
            ) {
              return false;
            }
            // A transparent control still receives native hits.
            return rendered(hit) && (!menu || menu === 'record' || hit.matches('button[role=menuitem]'));
          },
          { doc, view: currentView, at, focus },
        );
        currentSignal.throwIfAborted();
        if (!admitted) {
          throw refused();
        }
      }
      await observation(async () => {
        if ((await record.ownerFrame()) !== page.mainFrame()) {
          throw refused();
        }
        const validCanvases = await Promise.all(
          canvases.map(
            async (canvas) =>
              (await canvas.ownerFrame()) === page.mainFrame() &&
              (await canvas.evaluate((node) => node.tagName === 'CANVAS')),
          ),
        );
        if (validCanvases.some((valid) => !valid)) {
          throw refused();
        }
        doc = await page.evaluateHandle(() => document);
        try {
          await checked();
        } catch (error) {
          await doc.dispose();
          throw error;
        }
      }, signal);
      async function releaseAfterFailure(mouse, keys) {
        // Always attempt both releases in reverse order. The caller retires regardless of a lost up reply.
        try {
          if (mouse) {
            await page.mouse.up({ button: mouse });
          }
        } catch {
          // Still try the key and retire.
        }
        for (const key of keys.toReversed()) {
          try {
            // oxlint-disable-next-line no-await-in-loop -- Release admitted keys in reverse order.
            await page.keyboard.up(key);
          } catch {
            // Still release the remaining keys before retirement.
          }
        }
      }
      async function gesture(raw, options = {}) {
        const currentSignal = options.signal ? AbortSignal.any([signal, options.signal]) : signal;
        const saved = permit;
        // Even refused or malformed input consumes its local view before any await.
        permit = null;
        claim();
        let effect = false;
        let mouse = null;
        const held = [];
        let clickTarget = null;
        try {
          if (!saved || saved.generation !== generation()) {
            throw refused();
          }
          const action = structuredClone(raw);
          const { keys, isKey, path } = gesturePath(action, saved.view, browser);
          let focus = false;
          if (isKey) {
            focus = browser ? 'record' : true;
          }
          await observation(() => checked(saved.view, path[0], focus, currentSignal), currentSignal);
          const fresh = await observation(
            () => capture(page, undefined, currentSignal, canvases),
            currentSignal,
          );
          if (fresh.generation !== saved.generation || !fresh.png.equals(saved.png)) {
            throw refused();
          }
          // Revoke all structured refs before native input; don't dispose the launcher's separate record.
          await observation(invalidateReferences, currentSignal);
          const admittedGeneration = generation();
          const check = async (at) => {
            if (generation() !== admittedGeneration) {
              throw refused();
            }
            await checked(saved.view, at, focus, currentSignal);
            if (generation() !== admittedGeneration) {
              throw refused();
            }
          };
          const performInput = async () => {
            if (browser && action.type === 'click' && action.click_count > 1) {
              clickTarget = await page.evaluateHandle(({ x, y }) => document.elementFromPoint(x, y), path[0]);
            }
            for (const key of keys) {
              // oxlint-disable-next-line no-await-in-loop -- Each admitted key changes the next input state.
              await check(path[0]);
              held.push(key);
              effect = true;
              // oxlint-disable-next-line no-await-in-loop -- Preserve modifier order.
              await page.keyboard.down(key);
              if (isKey) {
                // Enter/Escape may change focus as their intended effect.
                if (generation() !== admittedGeneration) {
                  throw refused();
                }
                // oxlint-disable-next-line no-await-in-loop -- A key can change focus or the document.
                await checked(saved.view, undefined, false, currentSignal);
              }
            }
            if (browser && isKey) {
              await delay(action.duration_ms, undefined, { signal: currentSignal });
            }
            if (!isKey) {
              // Steps run in supplied order; each admitted endpoint uses full-viewport CSS coordinates.
              for (let index = 0; index < path.length; index += 1) {
                const at = path[index];
                // oxlint-disable-next-line no-await-in-loop -- Each native event changes the next hit test.
                await check(at);
                effect = true;
                // oxlint-disable-next-line no-await-in-loop -- Do not interpolate unchecked intermediate hits.
                await page.mouse.move(at.x, at.y);
                // oxlint-disable-next-line no-await-in-loop -- Hover may rearrange the document.
                await check(at);
                if (index === 0 && action.type !== 'move') {
                  mouse = action.type === 'click' ? action.button : 'left';
                  // oxlint-disable-next-line no-await-in-loop -- Track attempted down before its browser reply.
                  await page.mouse.down({ button: mouse });
                  // oxlint-disable-next-line no-await-in-loop -- A down event may replace the target.
                  await check(at);
                }
              }
            }
            if (mouse) {
              await page.mouse.up({ button: mouse });
              mouse = null;
            }
            if (clickTarget) {
              for (let clickCount = 2; clickCount <= action.click_count; clickCount += 1) {
                // oxlint-disable-next-line no-await-in-loop -- Revalidate before each click in the admitted gesture.
                await check(path[0]);
                if (
                  // oxlint-disable-next-line no-await-in-loop -- A preceding click may replace the original target.
                  !(await clickTarget.evaluate(
                    (target, at) => target?.isConnected && document.elementFromPoint(at.x, at.y) === target,
                    path[0],
                  ))
                ) {
                  throw refused();
                }
                // oxlint-disable-next-line no-await-in-loop -- A pending target check can outlive Stop.
                await check(path[0]);
                mouse = action.button;
                // oxlint-disable-next-line no-await-in-loop -- Keep the native click sequence in order.
                await page.mouse.down({ button: mouse, clickCount });
                // oxlint-disable-next-line no-await-in-loop -- A down event may invalidate the admitted target.
                await check(path[0]);
                // oxlint-disable-next-line no-await-in-loop -- Release each native click before the next.
                await page.mouse.up({ button: mouse, clickCount });
                mouse = null;
              }
            }
            while (held.length) {
              const key = held.at(-1);
              // oxlint-disable-next-line no-await-in-loop -- Release in the reverse of keydown order.
              await page.keyboard.up(key);
              held.pop();
            }
            if (generation() !== admittedGeneration) {
              throw refused();
            }
            await checked(saved.view, undefined, false, currentSignal);
          };
          let onStop;
          // oxlint-disable-next-line promise/avoid-new -- Bridge the owned task's Stop to one input sequence.
          const stopped = new Promise((_resolve, reject) => {
            onStop = () => reject(currentSignal.reason);
            currentSignal.addEventListener('abort', onStop, { once: true });
          });
          try {
            currentSignal.throwIfAborted();
            // This observes a late native reply; the current owner still releases before it closes.
            await Promise.race([
              // oxlint-disable-next-line promise/prefer-await-to-then -- Keep cleanup inside the owned input task, including when Stop wins the race.
              performInput().finally(async () => {
                await clickTarget?.dispose().catch(() => {
                  // A retired context may already have disposed its handles.
                });
              }),
              stopped,
            ]);
          } finally {
            currentSignal.removeEventListener('abort', onStop);
          }
        } catch (error) {
          if (effect) {
            await retire(async () => {
              const limit = new AbortController();
              try {
                await Promise.race([
                  releaseAfterFailure(mouse, held),
                  delay(5000, undefined, { signal: limit.signal }),
                ]);
              } finally {
                limit.abort();
              }
            }, currentSignal);
            // Do not expose driver exceptions or page data to the caller.
            // oxlint-disable-next-line preserve-caught-error
            throw new Error('Owned native input outcome is unknown; context retired.');
          }
          if (currentSignal.aborted) {
            throw currentSignal.reason;
          }
          throw error instanceof BrowserError ? error : refused();
        } finally {
          busy = false;
        }
      }
      const unsupported = () => {
        permit = null;
        throw refused();
      };
      async function screenshot(native, options = {}) {
        permit = null;
        claim();
        try {
          const currentSignal = options.signal ? AbortSignal.any([signal, options.signal]) : signal;
          return await observation(async () => {
            await checked(undefined, undefined, false, currentSignal);
            const captured = await capture(page, undefined, currentSignal, canvases);
            await checked(captured.view, undefined, false, currentSignal);
            if (captured.generation !== generation()) {
              throw refused();
            }
            permit = captured;
            return image(captured.png, native);
          }, currentSignal);
        } finally {
          busy = false;
        }
      }
      if (browser) {
        const current = (tab) => {
          if (pageFor(tab) !== page) {
            permit = null;
            throw refused();
          }
        };
        return {
          screenshot: ({ tab_id }, options) => {
            current(tab_id);
            return screenshot(false, options);
          },
          click_at: ({ tab_id, ...args }, options) => {
            current(tab_id);
            return gesture({ type: 'click', ...args }, options);
          },
          hover_at: ({ tab_id, ...args }, options) => {
            current(tab_id);
            return gesture({ type: 'move', ...args }, options);
          },
          drag_path: ({ tab_id, ...args }, options) => {
            current(tab_id);
            return gesture({ type: 'drag', ...args }, options);
          },
          hold_keys: ({ tab_id, ...args }, options) => {
            current(tab_id);
            return gesture({ type: 'keypress', ...args }, options);
          },
        };
      }
      return {
        click: gesture,
        move: gesture,
        drag: gesture,
        keypress: gesture,
        double_click: unsupported,
        scroll: unsupported,
        type: unsupported,
        wait: unsupported,
        screenshot: (options) => screenshot(true, options),
      };
    },
  };
  driver.createOwnedBrowser = (options) => driver.createOwnedComputer({ ...options, browser: true });
  return driver;
}
