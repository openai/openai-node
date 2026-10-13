import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { E2BComputerError } from './errors.mjs';

const DEFAULT_MAX_SCREENSHOT_PIXELS = 7680 * 4320;

function screenshotLimit(value, name = 'maxScreenshotPixels') {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

const MAX_TEXT_BYTES = 4096;
const MODIFIERS = new Set(['ctrl', 'alt', 'shift', 'super']);
const KEYS = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  super: 'super',
  cmd: 'super',
  meta: 'super',
  enter: 'enter',
  return: 'enter',
  escape: 'escape',
  esc: 'escape',
  tab: 'tab',
  space: 'space',
  backspace: 'backspace',
  delete: 'delete',
  left: 'left',
  arrowleft: 'left',
  right: 'right',
  arrowright: 'right',
  up: 'up',
  arrowup: 'up',
  down: 'down',
  arrowdown: 'down',
  home: 'home',
  end: 'end',
  pageup: 'page_up',
  pagedown: 'page_down',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, `f${i + 1}`])),
};

function dimensions(value, pixelLimit) {
  const { width, height } = value ?? {};
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > Math.floor(pixelLimit / height)
  ) {
    throw new E2BComputerError('Invalid desktop dimensions.');
  }
  return { width, height };
}

function keyChord(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 5) {
    throw new E2BComputerError('Unsupported key chord.');
  }
  const keys = values.map((value) => {
    if (typeof value !== 'string') {
      throw new E2BComputerError('Unsupported key.');
    }
    const lower = value.toLowerCase();
    if (/^[a-zA-Z0-9]$/u.test(value)) {
      return lower;
    }
    if (!Object.hasOwn(KEYS, lower)) {
      throw new E2BComputerError('Unsupported key.');
    }
    return KEYS[lower];
  });
  if (
    MODIFIERS.has(keys.at(-1)) ||
    keys.slice(0, -1).some((key) => !MODIFIERS.has(key)) ||
    new Set(keys).size !== keys.length
  ) {
    throw new E2BComputerError('Unsupported key chord.');
  }
  return keys;
}

export class E2BComputer {
  #sandbox;
  #identity;
  #size;
  #pixelLimit;
  #byteLimit;
  #hasFrame = false;
  #retired = false;
  #closed = false;
  #busy = false;
  #file;

  constructor(
    sandbox,
    identity,
    size,
    maxScreenshotPixels = DEFAULT_MAX_SCREENSHOT_PIXELS,
    maxScreenshotBytes = null,
  ) {
    this.#sandbox = sandbox;
    this.#identity = identity;
    this.#pixelLimit = screenshotLimit(maxScreenshotPixels);
    this.#size = dimensions(size, this.#pixelLimit);
    const encodedBudget = Math.min(
      Number.MAX_SAFE_INTEGER,
      2 * (8 * this.#size.width + 1) * this.#size.height + 65_536,
    );
    this.#byteLimit = screenshotLimit(maxScreenshotBytes ?? encodedBudget, 'maxScreenshotBytes');
  }

  static async fromStartedDesktop(
    sandbox,
    maxScreenshotPixels = DEFAULT_MAX_SCREENSHOT_PIXELS,
    maxScreenshotBytes = null,
  ) {
    const pixelLimit = screenshotLimit(maxScreenshotPixels);
    const byteLimit =
      maxScreenshotBytes === null ? undefined : screenshotLimit(maxScreenshotBytes, 'maxScreenshotBytes');
    const identity = sandbox.sandboxId;
    if (typeof identity !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(identity)) {
      throw new E2BComputerError('A known desktop identity is required.');
    }
    try {
      return new E2BComputer(sandbox, identity, await sandbox.getScreenSize(), pixelLimit, byteLimit);
    } catch {
      throw new E2BComputerError('Cannot read desktop dimensions.');
    }
  }

  async #check() {
    if (this.#sandbox.sandboxId !== this.#identity) {
      throw new E2BComputerError('The desktop identity changed.');
    }
    const size = dimensions(await this.#sandbox.getScreenSize(), this.#pixelLimit);
    if (this.#sandbox.sandboxId !== this.#identity) {
      throw new E2BComputerError('The desktop identity changed.');
    }
    if (size.width !== this.#size.width || size.height !== this.#size.height) {
      throw new E2BComputerError('The desktop dimensions changed.');
    }
  }

  async #operation(work, signal) {
    if (this.#closed || this.#retired) {
      throw new E2BComputerError('The adapter is closed or retired.');
    }
    if (this.#busy) {
      throw new E2BComputerError('A desktop operation is already running.');
    }
    this.#busy = true;
    try {
      signal?.throwIfAborted();
      await this.#check();
      signal?.throwIfAborted();
      const result = await work();
      signal?.throwIfAborted();
      await this.#check();
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      this.#retired = true;
      this.#hasFrame = false;
      signal?.throwIfAborted();
      if (error instanceof E2BComputerError) {
        throw error;
      }
      throw new E2BComputerError('The desktop operation failed; the adapter is retired.');
    } finally {
      this.#busy = false;
    }
  }

  #point(action) {
    const { x, y, keys } = action;
    if (keys !== null && keys !== undefined && (!Array.isArray(keys) || keys.length !== 0)) {
      throw new E2BComputerError('Held pointer modifiers are unsupported.');
    }
    if (
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= this.#size.width ||
      y >= this.#size.height
    ) {
      throw new E2BComputerError('Point is outside the desktop.');
    }
    if (!this.#hasFrame) {
      throw new E2BComputerError('Take a matching screenshot before pointer input.');
    }
    return { x, y };
  }

  async click(action, { signal } = {}) {
    const { x, y } = this.#point(action);
    const { button } = action;
    if (!['left', 'right'].includes(button)) {
      throw new E2BComputerError('Unsupported mouse button.');
    }
    return this.#operation(async () => {
      await this.#sandbox.moveMouse(x, y);
      signal?.throwIfAborted();
      await this.#check();
      signal?.throwIfAborted();
      await (button === 'left' ? this.#sandbox.leftClick() : this.#sandbox.rightClick());
    }, signal);
  }

  async double_click(action, { signal } = {}) {
    const { x, y } = this.#point(action);
    return this.#operation(async () => {
      await this.#sandbox.moveMouse(x, y);
      signal?.throwIfAborted();
      await this.#check();
      signal?.throwIfAborted();
      await this.#sandbox.doubleClick();
    }, signal);
  }

  async move(action, { signal } = {}) {
    const { x, y } = this.#point(action);
    return this.#operation(() => this.#sandbox.moveMouse(x, y), signal);
  }

  // eslint-disable-next-line class-methods-use-this -- ComputerDriver requires an instance method.
  async drag() {
    throw new E2BComputerError('Drag is unsupported without guaranteed input release.');
  }
  // eslint-disable-next-line class-methods-use-this -- ComputerDriver requires an instance method.
  async scroll() {
    throw new E2BComputerError('Pixel scrolling has no verified wheel-step mapping.');
  }

  async keypress(action, { signal } = {}) {
    const keys = keyChord(action.keys);
    return this.#operation(() => this.#sandbox.press(keys), signal);
  }

  async type(action, { signal } = {}) {
    const { text } = action;
    if (
      typeof text !== 'string' ||
      !text.isWellFormed() ||
      text.includes('\0') ||
      Buffer.byteLength(text, 'utf-8') > MAX_TEXT_BYTES
    ) {
      throw new E2BComputerError('Text must be valid Unicode without NUL, within 4096 UTF-8 bytes.');
    }
    return this.#operation(
      () =>
        this.#sandbox.write(text, {
          chunkSize: Math.max(1, text.length),
          delayInMs: 0,
        }),
      signal,
    );
  }

  async wait(_action, { signal } = {}) {
    return this.#operation(() => delay(1000, undefined, { signal }), signal);
  }

  async #remove(path) {
    if (this.#sandbox.sandboxId !== this.#identity) {
      throw new E2BComputerError('Cannot clean a changed desktop.');
    }
    await this.#sandbox.files.remove(path);
    this.#file = undefined;
  }

  async screenshot({ signal } = {}) {
    return this.#operation(async () => {
      this.#hasFrame = false;
      const path = `/tmp/openai-computer-${randomUUID()}.png`;
      this.#file = path;
      let data;
      try {
        await this.#sandbox.commands.run(`scrot --pointer ${path}`, {
          timeoutMs: 5000,
          requestTimeoutMs: 2500,
          ...(signal ? { signal } : {}),
        });
        await this.#check();
        signal?.throwIfAborted();
        const stream = await this.#sandbox.files.read(path, {
          format: 'stream',
          requestTimeoutMs: 2500,
          streamIdleTimeoutMs: 2500,
          ...(signal ? { signal } : {}),
        });
        await this.#check();
        const chunks = [];
        let size = 0;
        const header = Buffer.alloc(33);
        let headerSize = 0;
        for await (const value of stream) {
          signal?.throwIfAborted();
          if (!(value instanceof Uint8Array)) {
            throw new E2BComputerError('Screenshot contains invalid data.');
          }
          if (headerSize < header.length) {
            const prefix = value.subarray(0, header.length - headerSize);
            header.set(prefix, headerSize);
            headerSize += prefix.byteLength;
            if (
              headerSize === header.length &&
              (!header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
                header.readUInt32BE(8) !== 13 ||
                header.toString('ascii', 12, 16) !== 'IHDR' ||
                header.readUInt32BE(16) !== this.#size.width ||
                header.readUInt32BE(20) !== this.#size.height ||
                header[28] !== 0)
            ) {
              throw new E2BComputerError('Expected a matching non-interlaced full-desktop PNG.');
            }
          }
          if (value.byteLength > this.#byteLimit - size) {
            throw new E2BComputerError('Image exceeds the encoded screenshot byte budget.');
          }
          size += value.byteLength;
          chunks.push(Buffer.from(value));
        }
        if (headerSize < header.length) {
          throw new E2BComputerError('Expected a matching non-interlaced full-desktop PNG.');
        }
        data = Buffer.concat(chunks, size);
        PNG.sync.read(data);
        await this.#check();
      } finally {
        await this.#remove(path);
      }
      this.#hasFrame = true;
      return { type: 'computer_screenshot', image_url: `data:image/png;base64,${data.toString('base64')}` };
    }, signal);
  }

  async close() {
    this.#closed = true;
    this.#hasFrame = false;
    if (this.#busy) {
      throw new E2BComputerError('Drain the active operation before cleanup.');
    }
    this.#busy = true;
    try {
      if (this.#file !== undefined) {
        await this.#remove(this.#file);
      }
    } catch {
      throw new E2BComputerError('Screenshot cleanup remains unverified.');
    } finally {
      this.#busy = false;
    }
  }
}
