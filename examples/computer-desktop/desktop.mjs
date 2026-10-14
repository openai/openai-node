import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { ComputerToolset } from 'openai/helpers/computer';
import { start, exchange, healthy, remove } from './guest.mjs';
import { DesktopStartupError } from './startup-error.mjs';

const replyLimit = 4 * 1024;
const screenshotLimit = 6 * 1024 * 1024;
const effectTypes = new Set(['click', 'double_click', 'drag', 'keypress', 'move', 'scroll', 'type', 'wait']);
const createdHere = Symbol('created desktop');

async function screenshotFrame(value) {
  const prefix = 'data:image/png;base64,';
  if (typeof value !== 'string' || !value.startsWith(prefix)) {
    throw new Error('Private desktop returned no PNG.');
  }
  const encoded = value.slice(prefix.length);
  const frame = Buffer.from(encoded, 'base64');
  if (
    frame.length < 33 ||
    frame.length > 4 * 1024 * 1024 ||
    frame.toString('base64') !== encoded ||
    !frame.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    frame.readUInt32BE(8) !== 13 ||
    frame.toString('ascii', 12, 16) !== 'IHDR' ||
    frame.readUInt32BE(16) !== 1024 ||
    frame.readUInt32BE(20) !== 768
  ) {
    throw new Error('Private desktop returned an invalid bounded PNG.');
  }
  // Optional desktop dependency; importing browser-only examples never needs it.
  const { PNG } = await import('pngjs');
  PNG.sync.read(frame);
  return frame;
}

/**
 * Own one fresh guest from a private runtime selected in trusted launcher setup.
 * Computer actions cannot choose its image, command, display, socket or files.
 */
export class Desktop {
  #id;
  #guest;
  #closed = false;
  #active = null;
  #transport = null;
  #waitingRequest = false;
  #inputPending = false;
  #removal;
  #controller = new AbortController();
  uncertainEffects = false;

  constructor(guest, authority) {
    if (authority !== createdHere) {
      throw new Error('Use Desktop.create() for a fresh desktop.');
    }
    this.#guest = guest;
    this.#id = guest.id;
  }

  static async create({ runtimeDir, signal } = {}) {
    signal?.throwIfAborted();
    const guest = await start(runtimeDir, { signal });
    const desktop = new Desktop(guest, createdHere);
    try {
      const end = performance.now() + 90_000;
      const deadline = AbortSignal.timeout(90_000);
      const startup = signal ? AbortSignal.any([signal, deadline]) : deadline;
      while (performance.now() < end) {
        startup.throwIfAborted();
        // Readiness waits for this owned guest; concurrent retries could race Stop.
        // oxlint-disable-next-line no-await-in-loop
        if (!(await healthy(guest, { signal: startup }))) {
          throw new Error('Guest stopped during startup.');
        }
        let state;
        try {
          // Only readiness is retried while this exact guest starts.
          // oxlint-disable-next-line no-await-in-loop
          state = await desktop.#request(
            { type: 'ready' },
            Math.min(3000, end - performance.now()),
            false,
            startup,
          );
        } catch {
          // No effects are sent before readiness; allow the guest to start its fixed socket.
          state = { ok: false };
        }
        startup.throwIfAborted();
        if (state.ok === true) {
          return desktop;
        }
        // oxlint-disable-next-line no-await-in-loop
        await delay(200, undefined, { signal: startup });
      }
      throw new Error('Desktop startup timed out.');
    } catch {
      await desktop.stop();
      signal?.throwIfAborted();
      throw new DesktopStartupError();
    }
  }

  /** Safe metadata for local resource receipts, never accepted as input. */
  get id() {
    return this.#id;
  }

  /** The whole SDK call, including approval and final capture, is owned until it settles or is revoked. */
  async withComputer(operation, { signal } = {}) {
    return this.#admit((phaseSignal, phase) => {
      const driver = {
        click: (action, options) => this.#action(phase, action, options),
        double_click: (action, options) => this.#action(phase, action, options),
        drag: (action, options) => this.#action(phase, action, options),
        keypress: (action, options) => this.#action(phase, action, options),
        move: (action, options) => this.#action(phase, action, options),
        scroll: (action, options) => this.#action(phase, action, options),
        type: (action, options) => this.#action(phase, action, options),
        wait: (action, options) => this.#action(phase, action, options),
        screenshot: async (options) => {
          const result = await this.#action(phase, { type: 'screenshot' }, options);
          return { type: 'computer_screenshot', image_url: result.image_url };
        },
      };
      return operation(new ComputerToolset(driver), phaseSignal);
    }, signal);
  }

  async verify({ signal } = {}) {
    return this.#admit(
      (phaseSignal) => this.#request({ type: 'verify' }, undefined, false, phaseSignal),
      signal,
    );
  }

  async seal({ signal } = {}) {
    return this.#admit((phaseSignal) => this.#request({ type: 'seal' }, 15_000, false, phaseSignal), signal);
  }

  async #admit(operation, signal) {
    if (this.#closed || this.#active) {
      throw new Error('Desktop is stopped or another operation is active.');
    }
    // Establish admission before user code, which may synchronously call stop().
    // A microtask must defer synchronous user code until #active owns its promise.
    const signals = signal ? [this.#controller.signal, signal] : [this.#controller.signal];
    const phaseSignal = signal ? AbortSignal.any(signals) : this.#controller.signal;
    const active = {
      // Keep source signals alive while Node 22 composes their cancellation.
      signals,
      signal: phaseSignal,
      dispatchedInput: false,
      // oxlint-disable-next-line promise/prefer-await-to-then
      promise: Promise.resolve().then(() => {
        phaseSignal.throwIfAborted();
        return operation(phaseSignal, active);
      }),
    };
    this.#active = active;
    try {
      const value = await active.promise;
      phaseSignal.throwIfAborted();
      if (this.#closed) {
        throw new Error('Desktop stopped before its result could be used.');
      }
      return value;
    } finally {
      // Cancellation after dispatch invalidates this guest even if a reply later
      // confirmed the input. Do not mistake that confirmed receipt for uncertainty.
      if (active.dispatchedInput && (phaseSignal.aborted || this.#inputPending) && !this.#closed) {
        if (this.#inputPending) {
          this.uncertainEffects = true;
        }
        this.#closed = true;
        this.#controller.abort();
        await this.#remove();
      }
      if (this.#active === active) {
        this.#active = null;
      }
    }
  }

  /** Return current private pixels, or null when capture would contend with guest work. */
  async captureFrame({ signal } = {}) {
    if (this.#closed) {
      throw new Error('Desktop is stopped.');
    }
    if (this.#transport || this.#waitingRequest) {
      return null;
    }
    signal?.throwIfAborted();
    const result = await this.#request({ type: 'screenshot' }, undefined, true, signal);
    signal?.throwIfAborted();
    if (this.#closed || !result.ok) {
      throw new Error('Private desktop frame is unavailable.');
    }
    return { frame: result.frame, width: 1024, height: 768 };
  }

  async #action(active, action, { signal } = {}) {
    if (this.#closed || this.#active !== active) {
      throw new Error('Desktop no longer owns this action.');
    }
    if (signal) {
      active.signals.push(signal);
    }
    const current = signal ? AbortSignal.any([active.signal, signal]) : active.signal;
    let result;
    try {
      result = await this.#request(action, undefined, false, current);
    } catch (error) {
      const cancelled = current.aborted && error === current.reason;
      if (!this.#closed) {
        this.#closed = true;
        this.#controller.abort();
        await this.#remove();
      }
      if (cancelled) {
        throw error;
      }
      // oxlint-disable-next-line preserve-caught-error -- Never expose raw guest diagnostics outside this owner.
      throw new Error('Desktop operation ended without a usable result.');
    } finally {
      if (signal) {
        active.signals.pop();
      }
    }
    if (this.#closed || this.#active !== active) {
      throw new Error('Desktop stopped or retired before its result could be used.');
    }
    if (!result.ok) {
      throw new Error('Desktop refused the action.');
    }
    return result;
  }

  async #request(action, deadline, viewer = false, signal = null) {
    const active = this.#active;
    const request = `${JSON.stringify(action)}\n`;
    if (Buffer.byteLength(request) > 16_384) {
      return { ok: false, uncertain: false };
    }
    if (this.#transport) {
      if (viewer || this.#waitingRequest || signal?.aborted) {
        return { ok: false, uncertain: false };
      }
      this.#waitingRequest = true;
      const waiting = new AbortController();
      try {
        await Promise.race([this.#transport, once(signal, 'abort', { signal: waiting.signal })]);
      } finally {
        waiting.abort();
        this.#waitingRequest = false;
      }
    }
    if (
      this.#closed ||
      signal?.aborted ||
      (action.type !== 'ready' && !viewer && (!active || this.#active !== active || active.signal.aborted))
    ) {
      return { ok: false, uncertain: false };
    }
    const transport = Promise.withResolvers();
    this.#transport = transport.promise;
    try {
      return await this.#sendRequest(action, request, deadline, signal);
    } finally {
      this.#transport = null;
      transport.resolve();
    }
  }

  // oxlint-disable-next-line complexity -- Distinguish cancelled read-only verification from uncertain input.
  async #sendRequest(action, request, deadline, signal) {
    const screenshot = action.type === 'screenshot';
    const input = effectTypes.has(action.type);
    if (input || action.type === 'seal') {
      this.#active.dispatchedInput = true;
    }
    if (input) {
      this.#inputPending = true;
    }
    try {
      const raw = await exchange(
        this.#guest,
        request,
        deadline ?? 10_000,
        screenshot ? screenshotLimit : replyLimit,
        { signal },
      );
      let result;
      try {
        result = JSON.parse(raw);
      } catch {
        throw new Error('Invalid private desktop reply.');
      }
      if (!result || typeof result.ok !== 'boolean') {
        throw new Error('Invalid private desktop reply.');
      }
      if ((action.type === 'verify' || action.type === 'seal') && result.ok) {
        if (
          !['file_matches', 'browser_matches', 'file_empty'].every(
            (name) => Object.hasOwn(result, name) && typeof result[name] === 'boolean',
          ) ||
          !Object.hasOwn(result, 'browser_effects') ||
          (result.browser_effects !== null &&
            (!Number.isSafeInteger(result.browser_effects) || result.browser_effects < 0))
        ) {
          throw new Error('Invalid private desktop reply.');
        }
        return {
          ok: true,
          file_matches: result.file_matches,
          browser_matches: result.browser_matches,
          file_empty: result.file_empty,
          browser_effects: result.browser_effects,
        };
      }
      if (input && !result.ok && result.uncertain !== false) {
        this.uncertainEffects = true;
      }
      if (action.type !== 'ready' && !result.ok && result.uncertain !== false) {
        throw new Error('Private desktop did not confirm the request outcome.');
      }
      if (screenshot && result.ok) {
        result.frame = await screenshotFrame(result.image_url);
      }
      return result;
    } catch (error) {
      if (input) {
        this.uncertainEffects = true;
      }
      if (action.type !== 'ready' && !signal?.aborted && !this.#closed) {
        this.#closed = true;
        this.#controller.abort();
        await this.#remove();
      }
      throw error;
    } finally {
      if (input) {
        this.#inputPending = false;
      }
    }
  }

  #remove() {
    this.#removal ??= (async () => {
      try {
        await remove(this.#guest);
      } catch (error) {
        this.#removal = undefined;
        throw error;
      }
    })();
    return this.#removal;
  }

  async stop() {
    this.#closed = true;
    this.#controller.abort();
    const active = this.#active;
    const transport = this.#transport;
    if (active || transport) {
      const timer = new AbortController();
      try {
        await Promise.race([
          Promise.allSettled([active?.promise, transport]),
          delay(5000, undefined, { signal: timer.signal }),
        ]);
      } finally {
        timer.abort();
      }
    }
    if (this.#inputPending) {
      this.uncertainEffects = true;
    }
    // Reap the owned guest after the bounded drain; stale input cannot outlive it.
    await this.#remove();
  }
}
