import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';

const DEFAULT_MAX_SCREENSHOT_PIXELS = 7680 * 4320;

function screenshotLimit(value, name = 'maxScreenshotPixels') {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

const keys = new Map([
  ['arrowdown', 'down'],
  ['arrowleft', 'left'],
  ['arrowright', 'right'],
  ['arrowup', 'up'],
  ['option', 'alt'],
  ['super', 'cmd'],
  ['win', 'cmd'],
  ['control', 'ctrl'],
]);
const modifiers = new Set(['ctrl', 'shift', 'alt', 'cmd']);

function noHeldKeys(action) {
  if (action.keys?.length) {
    throw new Error('Daytona 0.220.0 cannot preserve held keys for pointer actions.');
  }
}

async function provider(work) {
  try {
    return await work();
  } catch {
    throw new Error('Daytona provider operation failed.');
  }
}

/**
 * Adapt an already-started, caller-owned desktop. Requires a fresh screenshot before pointer input.
 * @param {import('@daytona/sdk').ComputerUse} computerUse The caller's started desktop.
 * @param {number} [maxScreenshotPixels] The caller's screenshot pixel budget.
 * @param {number | null} [maxScreenshotBytes] The caller's encoded PNG byte budget.
 * @returns {Promise<import('openai/helpers/computer').ComputerDriver>} A driver with checked pointer geometry.
 */
export async function fromStartedDesktop(
  computerUse,
  maxScreenshotPixels = DEFAULT_MAX_SCREENSHOT_PIXELS,
  maxScreenshotBytes = null,
) {
  const pixelLimit = screenshotLimit(maxScreenshotPixels);
  if (maxScreenshotBytes !== null) {
    screenshotLimit(maxScreenshotBytes, 'maxScreenshotBytes');
  }
  const info = await provider(() => computerUse.display.getInfo());
  if (!Array.isArray(info.displays) || info.displays.length !== 1) {
    throw new Error('Exactly one active display is required.');
  }
  const [display] = info.displays;
  const { id, width, height, isActive, x: displayX, y: displayY } = display;
  if (
    isActive !== true ||
    displayX !== 0 ||
    displayY !== 0 ||
    !Number.isSafeInteger(id) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > Math.floor(pixelLimit / height)
  ) {
    throw new Error('Unsupported display geometry.');
  }
  const encodedBudget = Math.min(Number.MAX_SAFE_INTEGER, 2 * (8 * width + 1) * height + 65_536);
  const byteLimit = screenshotLimit(maxScreenshotBytes ?? encodedBudget, 'maxScreenshotBytes');
  let hasScreenshot = false;
  let retired = false;
  let busy = false;
  function checkCancelled(signal) {
    if (signal?.aborted) {
      retired = true;
      hasScreenshot = false;
      signal.throwIfAborted();
    }
  }
  async function checkDisplay(signal) {
    checkCancelled(signal);
    if (retired) {
      throw new Error('The display changed. Create a new adapter and take a fresh screenshot.');
    }
    const currentInfo = await provider(() => computerUse.display.getInfo());
    checkCancelled(signal);
    const current = currentInfo.displays;
    if (
      !Array.isArray(current) ||
      current.length !== 1 ||
      current[0].isActive !== true ||
      current[0].id !== id ||
      current[0].x !== 0 ||
      current[0].y !== 0 ||
      current[0].width !== width ||
      current[0].height !== height
    ) {
      retired = true;
      hasScreenshot = false;
      throw new Error('The display changed. Create a new adapter and take a fresh screenshot.');
    }
  }
  async function effect(work, signal) {
    signal?.throwIfAborted();
    if (busy) {
      throw new Error('Another Daytona operation is still active.');
    }
    busy = true;
    const hadScreenshot = hasScreenshot;
    hasScreenshot = false;
    let dispatched = false;
    try {
      await checkDisplay(signal);
      dispatched = true;
      const result = await provider(work);
      try {
        await checkDisplay(signal);
      } catch {
        retired = true;
        throw new Error('Post-action display identity could not be confirmed.');
      }
      hasScreenshot = hadScreenshot;
      return result;
    } catch (error) {
      if (dispatched || signal?.aborted) {
        retired = true;
      }
      hasScreenshot = false;
      checkCancelled(signal);
      throw error;
    } finally {
      busy = false;
    }
  }
  function point({ x, y }) {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || x >= width || y < 0 || y >= height) {
      throw new Error('Point is outside the selected display.');
    }
    if (!hasScreenshot) {
      throw new Error('A matching screenshot from an active adapter is required.');
    }
    return { x, y };
  }

  return {
    async click(action, { signal } = {}) {
      noHeldKeys(action);
      const { x, y } = point(action);
      const { button } = action;
      if (!['left', 'right'].includes(button)) {
        throw new Error('Only left and right clicks are supported.');
      }
      return effect(() => computerUse.mouse.click(x, y, button), signal);
    },
    async double_click(action, { signal } = {}) {
      noHeldKeys(action);
      const { x, y } = point(action);
      return effect(() => computerUse.mouse.click(x, y, 'left', true), signal);
    },
    async drag(action, { signal } = {}) {
      noHeldKeys(action);
      if (action.path.length !== 2) {
        throw new Error('Only a two-point drag is supported.');
      }
      const [start, end] = action.path;
      const from = point(start);
      const to = point(end);
      return effect(() => computerUse.mouse.drag(from.x, from.y, to.x, to.y), signal);
    },
    async move(action, { signal } = {}) {
      noHeldKeys(action);
      const { x, y } = point(action);
      return effect(() => computerUse.mouse.move(x, y), signal);
    },
    async scroll() {
      throw new Error('Pixel scroll distance has no verified Daytona wheel-step mapping.');
    },
    async keypress(action, { signal } = {}) {
      if (!action.keys.length || action.keys.some((k) => !k)) {
        throw new Error('A keypress needs a key.');
      }
      const mapped = action.keys.map((k) =>
        [...k].length === 1 ? k : (keys.get(k.toLowerCase()) ?? k.toLowerCase()),
      );
      if (
        modifiers.has(mapped.at(-1)) ||
        new Set(mapped).size !== mapped.length ||
        mapped.slice(0, -1).some((k) => !modifiers.has(k))
      ) {
        throw new Error('Unsupported key chord modifiers.');
      }
      return effect(
        () => computerUse.keyboard.press(mapped.at(-1), mapped.length > 1 ? mapped.slice(0, -1) : undefined),
        signal,
      );
    },
    async type(action, { signal } = {}) {
      const { text } = action;
      return effect(() => computerUse.keyboard.type(text), signal);
    },
    async wait(_action, { signal } = {}) {
      return effect(() => delay(1000, undefined, { signal }), signal);
    },
    async screenshot({ signal } = {}) {
      signal?.throwIfAborted();
      if (busy) {
        throw new Error('Another Daytona operation is still active.');
      }
      busy = true;
      try {
        hasScreenshot = false;
        await checkDisplay(signal);
        const shot = await provider(() => computerUse.screenshot.takeFullScreen());
        if (typeof shot.screenshot !== 'string') {
          throw new TypeError('Daytona returned no screenshot.');
        }
        const padding = Number(shot.screenshot.endsWith('=')) + Number(shot.screenshot.endsWith('=='));
        if (Math.ceil(shot.screenshot.length / 4) * 3 - padding > byteLimit) {
          throw new Error('Image exceeds the encoded screenshot byte budget.');
        }
        const data = Buffer.from(shot.screenshot, 'base64');
        if (
          data.toString('base64') !== shot.screenshot ||
          data.length < 33 ||
          !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          !data.subarray(8, 16).equals(Buffer.from([0, 0, 0, 13, 73, 72, 68, 82])) ||
          data.readUInt32BE(16) !== width ||
          data.readUInt32BE(20) !== height ||
          data[28] !== 0
        ) {
          throw new Error('Expected a non-interlaced full-screen PNG within the pixel budget.');
        }
        PNG.sync.read(data);
        await checkDisplay(signal);
        hasScreenshot = true;
        return { type: 'computer_screenshot', image_url: `data:image/png;base64,${shot.screenshot}` };
      } catch (error) {
        checkCancelled(signal);
        throw error;
      } finally {
        busy = false;
      }
    },
  };
}
