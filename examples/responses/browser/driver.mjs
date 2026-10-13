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

// One bounded main-document walk for caller-owned contexts. Never collect an
// unbounded selector list or body.innerText before applying the report limits.
// oxlint-disable-next-line eslint/complexity -- Keep the serialized walk and its bounded private bindings together.
function borrowedRead({ nonce, nextRef, full, textOnly, checkedNode, finding = false }) {
  // Transfer only this fixed-schema primitive. The host still owns the UTF-8
  // acceptance checks; this ceiling bounds UTF-16 units before leaving the page.
  /* oxlint-disable eslint/no-unmodified-loop-condition -- append() revokes valid at the shared transfer ceiling. */
  // oxlint-disable-next-line eslint/complexity, unicorn/consistent-function-scoping -- This fixed-schema serializer must travel with borrowedRead into the page.
  function borrowedReport(report) {
    let output = '';
    let valid = true;
    const append = (piece) => {
      if (output.length + piece.length > 65_536) {
        valid = false;
      } else if (valid) {
        output += piece;
      }
    };
    const quoted = (value) => {
      if (typeof value !== 'string') {
        valid = false;
        return;
      }
      append('"');
      const { length } = value;
      // Literal characters and numeric indices avoid page string iterators/encoders.
      const controls =
        '\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u0009\u000A\u000B\u000C\u000D\u000E\u000F\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001A\u001B\u001C\u001D\u001E\u001F';
      const digits = '0123456789abcdef';
      for (let index = 0; valid && index < length; index += 1) {
        const character = value[index];
        if (character === '"' || character === '\\') {
          append(`\\${character}`);
        } else if (character === '\b') {
          append('\\b');
        } else if (character === '\f') {
          append('\\f');
        } else if (character === '\n') {
          append('\\n');
        } else if (character === '\r') {
          append('\\r');
        } else if (character === '\t') {
          append('\\t');
        } else if (character < ' ') {
          for (let control = 0; control < 32; control += 1) {
            if (character === controls[control]) {
              const low = control % 16;
              append(`\\u00${digits[(control - low) / 16]}${digits[low]}`);
              break;
            }
          }
        } else {
          append(character);
        }
      }
      append('"');
    };
    const flag = (value) => {
      if (value === true) {
        append('true');
      } else if (value === false) {
        append('false');
      } else {
        valid = false;
      }
    };
    if (!report || report.version !== 1) {
      return null;
    }
    append('{"version":1,"text":');
    quoted(report.text);
    append(',"elements":[');
    const { elements } = report;
    const count = elements?.length;
    if (typeof count !== 'number' || count < 0 || count > 2000 || count % 1 !== 0) {
      return null;
    }
    for (let index = 0; valid && index < count; index += 1) {
      const item = elements[index];
      if (!item) {
        return null;
      }
      if (index > 0) {
        append(',');
      }
      append('{"ref":');
      quoted(item.ref);
      append(',"role":');
      quoted(item.role);
      append(',"label":');
      quoted(item.label);
      const { value } = item;
      if (value !== undefined) {
        append(',"value":');
        quoted(value);
      }
      const { checked } = item;
      if (checked !== undefined) {
        append(',"checked":');
        flag(checked);
      }
      const { options } = item;
      if (options !== undefined) {
        const size = options?.length;
        if (typeof size !== 'number' || size < 0 || size > 32 || size % 1 !== 0) {
          return null;
        }
        append(',"options":[');
        for (let position = 0; valid && position < size; position += 1) {
          const option = options[position];
          if (!option) {
            return null;
          }
          if (position > 0) {
            append(',');
          }
          append('{"label":');
          quoted(option.label);
          append(',"value":');
          quoted(option.value);
          const { selected } = option;
          if (selected !== undefined) {
            append(',"selected":');
            flag(selected);
          }
          append('}');
        }
        append(']');
      }
      append('}');
    }
    append('],"omitted":[');
    const { omitted } = report;
    const omissions = omitted?.length;
    if (typeof omissions !== 'number' || omissions < 0 || omissions > 2000 || omissions % 1 !== 0) {
      return null;
    }
    for (let index = 0; valid && index < omissions; index += 1) {
      if (index > 0) {
        append(',');
      }
      quoted(omitted[index]);
    }
    append(']}');
    return valid ? output : null;
  }
  /* oxlint-enable eslint/no-unmodified-loop-condition */

  const report = {
    __proto__: null,
    version: 1,
    text: '',
    elements: { __proto__: null, length: 0 },
    omitted: { __proto__: null, length: 0 },
  };
  const targets = { __proto__: null, length: 0 };
  const targetLimit = finding || checkedNode ? 2000 : 100;
  // Count UTF-8 bytes without calling a page-owned encoder or string iterator.
  // oxlint-disable-next-line consistent-function-scoping -- Serialized into the page with borrowedRead.
  const byteLength = (value) => {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
      const unit = value[index];
      if (unit <= '\u007F') {
        bytes += 1;
      } else if (unit <= '\u07FF') {
        bytes += 2;
      } else if (
        unit >= '\uD800' &&
        unit <= '\uDBFF' &&
        index + 1 < value.length &&
        value[index + 1] >= '\uDC00' &&
        value[index + 1] <= '\uDFFF'
      ) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  };
  let visited = 0;
  let textBytes = 0;
  const omit = (reason) => {
    const { omitted } = report;
    // oxlint-disable-next-line typescript/prefer-for-of -- Private numeric storage has no page-owned iterator.
    for (let index = 0; index < omitted.length; index += 1) {
      if (omitted[index] === reason) {
        return;
      }
    }
    omitted[omitted.length] = reason;
    omitted.length += 1;
  };
  const bounded = (raw, limit, reason) => {
    let text = '';
    let bytes = 0;
    let inspected = 0;
    // Index primitive strings so page-owned iterators cannot run during a read.
    for (let index = 0; index < raw.length;) {
      if (inspected >= limit) {
        omit(reason);
        break;
      }
      inspected += 1;
      let scalar = raw[index];
      index += 1;
      if (
        scalar >= '\uD800' &&
        scalar <= '\uDBFF' &&
        index < raw.length &&
        raw[index] >= '\uDC00' &&
        raw[index] <= '\uDFFF'
      ) {
        scalar += raw[index];
        index += 1;
      }
      let normalized = scalar;
      if (
        scalar.length === 1 &&
        (scalar < ' ' ||
          (scalar >= '\u007F' && scalar <= '\u009F') ||
          (scalar >= '\uD800' && scalar <= '\uDFFF'))
      ) {
        if (scalar < '\t' || scalar > '\r') {
          continue;
        }
        normalized = ' ';
      }
      const size = byteLength(normalized);
      if (bytes + size > limit) {
        omit(reason);
        break;
      }
      text += normalized;
      bytes += size;
    }
    return text;
  };
  const labelNames = { __proto__: null, length: 0 };
  const appendText = (node, owner) => {
    if (full) {
      const fragment = bounded(node.data, Math.max(0, 16_384 - textBytes), 'text_limit');
      const addition = bounded(` ${fragment}`, Math.max(0, 16_384 - textBytes), 'text_limit');
      report.text += addition;
      textBytes += byteLength(addition);
    }
    if (owner && !owner.named && owner.labelBytes < 256) {
      const fragment = bounded(node.data, 256 - owner.labelBytes, 'name_limit');
      const addition = bounded(` ${fragment}`, 256 - owner.labelBytes, 'name_limit');
      owner.item.label += addition;
      owner.labelBytes += byteLength(addition);
    }
  };
  // Serialized into the page with borrowedRead.
  // oxlint-disable-next-line consistent-function-scoping
  const hidden = (node) => {
    const style = getComputedStyle(node);
    return (
      node.hidden ||
      Object.hasOwn(node.dataset, 'browserPrivate') ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      Number(style.opacity) === 0
    );
  };
  // oxlint-disable-next-line consistent-function-scoping
  const roleFor = (node, tag) => {
    if (tag === 'select') {
      return node.multiple ? 'listbox' : 'combobox';
    }
    if (tag === 'input') {
      if (['submit', 'button', 'reset', 'image'].includes(node.type)) {
        return 'button';
      }
      if (['checkbox', 'radio'].includes(node.type)) {
        return node.type;
      }
      if (node.type === 'range') {
        return 'slider';
      }
      return 'textbox';
    }
    return tag === 'textarea' || node.isContentEditable ? 'textbox' : 'button';
  };
  const makeTarget = (node, tag) => {
    const role = roleFor(node, tag);
    const name =
      node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.getAttribute('title') || '';
    const label = bounded(name, 256, 'name_limit').trim();
    const item = { __proto__: null, ref: `${nonce}:${nextRef + targets.length + 1}`, role, label };
    if (['input', 'textarea'].includes(tag) && role !== 'button') {
      item.value = bounded(node.value, 512, 'value');
      if (role === 'checkbox' || role === 'radio') {
        item.checked = node.checked;
      }
    }
    if (tag === 'select') {
      item.options = { __proto__: null, length: 0 };
      const { options } = node;
      const count = options.length;
      for (let index = 0; index < count; index += 1) {
        const option = options[index];
        if (visited >= 2000 || item.options.length >= 32) {
          omit('work_limit');
          break;
        }
        visited += 1;
        if (option.matches(':disabled') || hidden(option)) {
          continue;
        }
        const value = bounded(option.value, 512, 'value');
        if (value !== option.value) {
          omit('value');
          continue;
        }
        const optionLabel = bounded(option.label, 256, 'name_limit').trim();
        if (!optionLabel) {
          continue;
        }
        const choice = { __proto__: null, label: optionLabel, value };
        if (role === 'listbox') {
          choice.selected = option.selected;
        } else if (option.selected) {
          item.value = value;
        }
        item.options[item.options.length] = choice;
        item.options.length += 1;
      }
    }
    const target = {
      __proto__: null,
      node,
      item,
      named: Boolean(label),
      labelBytes: byteLength(label),
    };
    targets[targets.length] = target;
    targets.length += 1;
    return target;
  };
  // oxlint-disable-next-line eslint/complexity -- One bounded traversal owns visibility, privacy and reference budgets.
  const walk = (node, owner, depth) => {
    if (visited >= 2000 || depth > 64) {
      omit('work_limit');
      return;
    }
    visited += 1;
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node, owner);
      return;
    }
    if (!(node instanceof HTMLElement) || hidden(node)) {
      return;
    }
    const tag = node.tagName.toLowerCase();
    if (['script', 'style', 'template', 'noscript'].includes(tag)) {
      return;
    }
    const inputType = tag === 'input' ? node.type : null;
    if (inputType === 'password' || inputType === 'file' || inputType === 'hidden') {
      omit('private');
      return;
    }
    let target = owner;
    if (node instanceof HTMLLabelElement && node.control) {
      target = { __proto__: null, item: { __proto__: null, label: '' }, named: false, labelBytes: 0 };
      labelNames[labelNames.length] = { __proto__: null, node: node.control, item: target.item };
      labelNames.length += 1;
    }
    if (
      !textOnly &&
      (node.matches('a[href],button,input,textarea,select,[role=button]') ||
        (node.isContentEditable && !node.parentElement?.isContentEditable))
    ) {
      if (targets.length >= targetLimit) {
        omit('target_limit');
      } else {
        target = makeTarget(node, tag);
      }
    }
    // Do not render textarea/select default text into page text.
    if (['input', 'textarea', 'select'].includes(tag)) {
      return;
    }
    // Recursive visits consume the same global budget.
    // oxlint-disable-next-line no-unmodified-loop-condition
    for (let child = node.firstChild; child && visited < 2000; child = child.nextSibling) {
      walk(child, target, depth + 1);
    }
    if (visited >= 2000) {
      omit('work_limit');
    }
  };
  // Serialized with borrowedRead into the page.
  // oxlint-disable-next-line consistent-function-scoping
  function semanticsFor(target) {
    const { node } = target;
    const form = node.form ?? null;
    return [
      node.tagName,
      node.getAttribute('role'),
      node.getAttribute('type'),
      target.item.role,
      target.item.label,
      target.item.checked ?? null,
      target.item.options ?? null,
      node.matches(':disabled'),
      Boolean(node.readOnly),
      node.getAttribute('href'),
      node.getAttribute('target'),
      node.getAttribute('onclick'),
      node.getAttribute('formaction'),
      node.getAttribute('formmethod'),
      node.getAttribute('formtarget'),
      form?.getAttribute('action') ?? null,
      form?.getAttribute('method') ?? null,
      form?.getAttribute('target') ?? null,
      node.tagName === 'A' || form ? node.baseURI : null,
      node.tagName === 'A' || form ? (document.querySelector('base[target]')?.target ?? null) : null,
      target.item.value ?? null,
    ];
  }
  if (document.body) {
    walk(document.body, null, 0);
  } else {
    omit('unsupported_root');
  }
  const accepted = { __proto__: null };
  let acceptedCount = 0;
  // oxlint-disable-next-line typescript/prefer-for-of -- This private numeric collection has no page-provided iterator.
  for (let position = 0; position < targets.length; position += 1) {
    const target = targets[position];
    const { node } = target;
    let label = target.item.label.trim();
    if (!label) {
      for (let index = labelNames.length - 1; index >= 0; index -= 1) {
        const associated = labelNames[index];
        if (associated.node === node) {
          label = associated.item.label.trim();
          break;
        }
      }
    }
    target.item.label =
      label ||
      (node instanceof HTMLInputElement && target.item.role === 'button'
        ? bounded(node.type === 'image' ? node.alt : node.value, 256, 'name_limit').trim()
        : '') ||
      target.item.role;
    const semantics = semanticsFor(target);
    if (semantics[7] || semantics[8]) {
      omit('unsupported_control');
      continue;
    }
    // Never store a truncated destination or action as proof of its identity.
    let overLimit = false;
    // oxlint-disable-next-line typescript/prefer-for-of -- Read private fields without page-provided iterators.
    for (let index = 0; index < semantics.length; index += 1) {
      const value = semantics[index];
      if (typeof value === 'string' && value.length > 4096) {
        overLimit = true;
        break;
      }
    }
    if (overLimit) {
      omit('unsupported_control');
      continue;
    }
    if (checkedNode === node) {
      return semantics;
    }
    if (checkedNode) {
      continue;
    }
    report.elements[report.elements.length] = target.item;
    report.elements.length += 1;
    const encoded = borrowedReport(report);
    if (encoded === null || byteLength(encoded) > 65_536) {
      report.elements.length -= 1;
      omit('report_limit');
      break;
    }
    accepted[acceptedCount] = { __proto__: null, node, item: target.item, binding: semantics };
    acceptedCount += 1;
  }
  if (checkedNode) {
    return null;
  }
  return { report: borrowedReport(report), targets: accepted, nextRef: nextRef + targets.length };
}

// This function runs as one browser task. Only launcher-owned fixtures with
// immutable record handlers may use these DOM activation/input semantics.
// Functions in this serialized task cannot capture module-scope helpers.
function ownedElement(element, request) {
  const report = request.report ?? { version: 1, text: '', elements: [], omitted: [] };
  let visited = request.visited ?? 0;
  const omit = (reason) => {
    if (!report.omitted.includes(reason)) {
      report.omitted.push(reason);
    }
  };
  const charge = () => {
    if (visited >= 2000) {
      omit('work_limit');
      return false;
    }
    visited += 1;
    return true;
  };
  function framePathIsVisible(x, y) {
    let view = element.ownerDocument.defaultView;
    let parentX = x;
    let parentY = y;
    try {
      while (view !== view.top) {
        const frame = view.frameElement;
        // Cross-origin frameElement is null. Its parent hit test cannot be proved.
        if (!frame || frame.clientWidth !== view.innerWidth || frame.clientHeight !== view.innerHeight) {
          return false;
        }
        const { parent } = view;
        for (
          let node = frame;
          node;
          node = node.assignedSlot ?? node.parentElement ?? node.getRootNode().host ?? null
        ) {
          if (!charge()) {
            return false;
          }
          if (Object.hasOwn(node.dataset, 'browserPrivate')) {
            omit('private');
            return false;
          }
          const style = parent.getComputedStyle(node);
          // Coordinates below support untransformed frame paths only.
          if (
            style.transform !== 'none' ||
            style.scale !== 'none' ||
            style.rotate !== 'none' ||
            style.translate !== 'none' ||
            style.perspective !== 'none' ||
            !['1', 'normal'].includes(style.zoom) ||
            Number(style.opacity) === 0
          ) {
            return false;
          }
        }
        const box = frame.getBoundingClientRect();
        parentX += box.left + frame.clientLeft;
        parentY += box.top + frame.clientTop;
        if (parent.document.elementFromPoint(parentX, parentY) !== frame) {
          return false;
        }
        view = parent;
      }
      return true;
    } catch {
      // An inaccessible ancestor is unsupported; no DOM action was dispatched.
      return false;
    }
  }
  // oxlint-disable-next-line consistent-function-scoping
  const parent = (node) => node.assignedSlot ?? node.parentElement ?? node.getRootNode().host ?? null;
  // oxlint-disable-next-line consistent-function-scoping
  const normalize = (text) => text.replaceAll(/\s+/gu, ' ').trim();
  const bounded = (text, limit, reason) => {
    let value = '';
    let bytes = 0;
    for (const scalar of text) {
      const point = scalar.codePointAt(0);
      const size = new TextEncoder().encode(scalar).length;
      if ((point >= 0xd8_00 && point <= 0xdf_ff) || bytes + size > limit) {
        omit(reason);
        break;
      }
      value += scalar;
      bytes += size;
    }
    return value;
  };
  function visible(node) {
    for (let current = node; current; current = parent(current)) {
      if (!charge()) {
        return false;
      }
      const style = getComputedStyle(current);
      const inputType = current instanceof HTMLInputElement ? current.type : null;
      if (
        Object.hasOwn(current.dataset, 'browserPrivate') ||
        inputType === 'password' ||
        inputType === 'file' ||
        inputType === 'hidden'
      ) {
        omit('private');
        return false;
      }
      if (
        style.display === 'none' ||
        style.visibility !== 'visible' ||
        Number(style.opacity) === 0 ||
        current.hidden
      ) {
        omit('private');
        return false;
      }
    }
    return true;
  }
  // This function is serialized with ownedElement into the browser task.
  // oxlint-disable-next-line consistent-function-scoping
  function hitAt(x, y) {
    // Follow inspectable shadow roots at this point, never a selector.
    let at = document.elementFromPoint(x, y);
    while (at?.shadowRoot) {
      const deeper = at.shadowRoot.elementFromPoint(x, y);
      if (!deeper || deeper === at) {
        break;
      }
      at = deeper;
    }
    return at;
  }
  function hitsScrollFlow(node, target, x, y) {
    let at = hitAt(x, y);
    if (!at || !visible(at) || !framePathIsVisible(x, y)) {
      return false;
    }
    // Ordinary flow content can be between the point and the clipping
    // ancestor. Refuse a positioned/layered sibling covering it.
    while (at && at !== node) {
      if (!charge()) {
        return false;
      }
      const style = getComputedStyle(at);
      if (
        !at.contains(target) &&
        (style.position !== 'static' ||
          style.zIndex !== 'auto' ||
          ![style.transform, style.scale, style.rotate, style.translate].every((value) => value === 'none'))
      ) {
        return false;
      }
      at = parent(at);
    }
    return at === node;
  }
  function scrollTargetClipped(target, x, y) {
    let clipped = false;
    for (let node = parent(target); node; node = parent(node)) {
      if (!charge()) {
        return false;
      }
      const style = getComputedStyle(node);
      // Do not convert transformed/clipped coordinates into an action.
      if (
        ![style.transform, style.scale, style.rotate, style.translate, style.perspective].every(
          (value) => value === 'none',
        ) ||
        !['1', 'normal'].includes(style.zoom)
      ) {
        return false;
      }
      const rect = node.getBoundingClientRect();
      const left = Math.max(0, rect.left + node.clientLeft);
      const top = Math.max(0, rect.top + node.clientTop);
      const right = Math.min(innerWidth, rect.left + node.clientLeft + node.clientWidth);
      const bottom = Math.min(innerHeight, rect.top + node.clientTop + node.clientHeight);
      let clips = false;
      for (const [coordinate, start, end, overflow, size, client] of [
        [x, rect.left, rect.right, style.overflowX, node.scrollWidth, node.clientWidth],
        [y, rect.top, rect.bottom, style.overflowY, node.scrollHeight, node.clientHeight],
      ]) {
        if (overflow !== 'visible' && (coordinate < start || coordinate >= end)) {
          if (!['auto', 'scroll', 'hidden'].includes(overflow) || size <= client) {
            return false;
          }
          clips = true;
        }
      }
      if (clips) {
        if (
          left >= right ||
          top >= bottom ||
          !hitsScrollFlow(node, target, (left + right) / 2, (top + bottom) / 2)
        ) {
          return false;
        }
        clipped = true;
      }
    }
    // A target outside the viewport alone does not prove an uncovered route.
    return clipped;
  }
  function isReady(target) {
    if (!visible(target)) {
      return false;
    }
    const box = target.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const at = hitAt(x, y);
    return !!(
      box.width &&
      box.height &&
      ((at && (at === target || target.contains(at)) && (request.remote || framePathIsVisible(x, y))) ||
        (request.action === 'scroll_to' && scrollTargetClipped(target, x, y))) &&
      !target.matches(':disabled') &&
      !target.readOnly
    );
  }
  function rendered(root, label = false) {
    let text = '';
    function walk(node) {
      if (!charge()) {
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        const container = node.parentElement;
        if (container && visible(container)) {
          text = bounded(text + node.data, label ? 256 : 16_384, label ? 'name_limit' : 'text_limit');
        }
        return;
      }
      if (!(node instanceof Element) || !visible(node)) {
        return;
      }
      // Embedded values and scripts never supply a rendered label or page text.
      if (
        ['SCRIPT', 'STYLE', 'TEMPLATE', 'INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) ||
        (node.tagName === 'OPTION' && node !== root)
      ) {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) {
          omit('value');
        }
        return;
      }
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (visited >= 2000) {
          break;
        }
        walk(child);
      }
    }
    walk(root);
    return normalize(text);
  }
  function nameOf(target) {
    const root = target.getRootNode();
    let label = '';
    const labelled = target.getAttribute('aria-labelledby');
    if (labelled) {
      // Limit ID lookup before iterating, never read recursive labelledby.
      let count = 0;
      for (const id of labelled.matchAll(/\S+/gu)) {
        if (count === 8) {
          omit('name_limit');
          break;
        }
        count += 1;
        if (!charge()) {
          break;
        }
        // Native ID lookup stays in this root and never parses a selector from page text.
        // oxlint-disable-next-line unicorn/prefer-query-selector
        const source = root.getElementById(id[0]);
        if (source && visible(source)) {
          label += ` ${rendered(source, true)}`;
        }
      }
    }
    if (!normalize(label)) {
      label = target.getAttribute('aria-label') ?? '';
    }
    if (!normalize(label) && target.labels) {
      for (let index = 0; index < Math.min(target.labels.length, 8); index += 1) {
        if (!charge()) {
          break;
        }
        const source = target.labels[index];
        if (visible(source)) {
          label += ` ${rendered(source, true)}`;
        }
      }
      if (target.labels.length > 8) {
        omit('name_limit');
      }
    }
    if (!normalize(label)) {
      label = rendered(target, true);
    }
    if (!normalize(label)) {
      label = target.getAttribute('placeholder') ?? '';
    }
    label = bounded(normalize(label), 256, 'name_limit');
    return label;
  }
  function recordOf(target) {
    let row = target;
    while (row && !Object.hasOwn(row.dataset, 'recordId')) {
      if (!charge()) {
        return null;
      }
      row = parent(row);
    }
    return row;
  }
  function radioGroup(target, row) {
    const group = [];
    // Same tree root + form owner + nonempty name, including external form=
    // controls. Unnamed radios are independent.
    if (!target.name) {
      return group;
    }
    const walker = document.createTreeWalker(target.getRootNode(), NodeFilter.SHOW_ELEMENT);
    for (let peer = walker.nextNode(); peer; peer = walker.nextNode()) {
      if (!charge()) {
        return null;
      }
      if (
        peer instanceof HTMLInputElement &&
        peer.type === 'radio' &&
        peer.name === target.name &&
        peer.form === target.form
      ) {
        if (recordOf(peer) !== row || !isReady(peer)) {
          return null;
        }
        group.push({ node: peer, checked: peer.checked });
      }
    }
    return group;
  }
  // Native element constructors belong to the serialized task's document.
  // oxlint-disable-next-line consistent-function-scoping
  function nativeRole(target) {
    if (target instanceof HTMLButtonElement) {
      return 'button';
    }
    if (target instanceof HTMLSelectElement) {
      return target.multiple ? 'listbox' : 'combobox';
    }
    if (target instanceof HTMLTextAreaElement) {
      return 'textbox';
    }
    if (target instanceof HTMLInputElement) {
      switch (target.type) {
        case 'checkbox':
        case 'radio': {
          return target.type;
        }
        case 'range': {
          return 'slider';
        }
        case 'text':
        case 'date': {
          return 'textbox';
        }
        default: {
          return null;
        }
      }
    }
    return null;
  }
  function observe(target) {
    const role = nativeRole(target);
    if (!role) {
      if (
        target.matches('input,textarea,select,button,[role],[contenteditable=true],a[href]') &&
        visible(target)
      ) {
        omit('unsupported_control');
      }
      return null;
    }
    const row = recordOf(target);
    if (!row || !target.isConnected || target.ownerDocument !== document || !isReady(target)) {
      return null;
    }
    const label = nameOf(target);
    if (!label) {
      omit('unsupported_control');
      return null;
    }
    const observation = {
      record: row.dataset.recordId,
      tag: target.tagName.toLowerCase(),
      rawRole: target.getAttribute('role'),
      role,
      label,
      field: target.dataset.browserField ?? null,
      inputType: target instanceof HTMLInputElement ? target.type : null,
      multiple: target instanceof HTMLSelectElement ? target.multiple : null,
    };
    if (role === 'checkbox' || role === 'radio') {
      observation.checked = target.checked;
    }
    if (role === 'radio') {
      observation.group = radioGroup(target, row);
      observation.groupName = target.name;
      observation.form = target.form;
      observation.root = target.getRootNode();
      if (!observation.group) {
        return null;
      }
    }
    return observation;
  }
  // Serialized with this browser task, not available in module scope.
  // oxlint-disable-next-line consistent-function-scoping
  function matches(observation, expected, beforeEffect) {
    if (
      !observation ||
      observation.record !== expected.record ||
      observation.tag !== expected.tag ||
      observation.label !== expected.label ||
      observation.role !== expected.role ||
      observation.rawRole !== expected.rawRole ||
      observation.field !== expected.field ||
      observation.inputType !== expected.inputType ||
      observation.multiple !== expected.multiple
    ) {
      return false;
    }
    if (beforeEffect && observation.checked !== expected.checked) {
      return false;
    }
    return (
      !beforeEffect ||
      !observation.group ||
      (observation.groupName === expected.groupName &&
        observation.form === expected.form &&
        observation.root === expected.root &&
        observation.group.length === expected.group.length &&
        observation.group.every((peer, index) => {
          const previous = expected.group[index];
          return previous.node === peer.node && previous.checked === peer.checked;
        }))
    );
  }
  if (request.action === 'scan') {
    const targets = [];
    // No trusted inventory can prove a closed root absent in these fixtures.
    omit('unsupported_root');
    const fits = () =>
      new TextEncoder().encode(
        JSON.stringify({
          ...report,
          // A later frame can add any omission after this entry is accepted.
          omitted: [
            'report_limit',
            'text_limit',
            'target_limit',
            'work_limit',
            'frame_limit',
            'unsupported_root',
            'unsupported_control',
            'remote_action',
            'private',
            'value',
            'name_limit',
          ],
        }),
      ).length <= 65_536;
    const scopeLabel = (node) => {
      if (
        !node.isConnected ||
        node.ownerDocument !== document ||
        !(['SECTION', 'ARTICLE', 'NAV'].includes(node.tagName) || node.getAttribute('role') === 'region') ||
        !visible(node)
      ) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return null;
      }
      const label = bounded(normalize(node.getAttribute('aria-label') ?? ''), 256, 'name_limit');
      return label || null;
    };
    if (request.scopeRoot && scopeLabel(element) !== request.expected.label) {
      throw new Error('Scope changed during the read.');
    }
    const addText = (node) => {
      if (!request.full || request.remote || !node.parentElement || !visible(node.parentElement)) {
        return;
      }
      if (window !== window.top) {
        // Child text needs the same inspected parent path as child refs.
        // A local range supplies the actual rendered point; no selector or saved DOM path.
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        if (!box.width || !box.height || !framePathIsVisible(box.x + box.width / 2, box.y + box.height / 2)) {
          return;
        }
      }
      const previous = report.text;
      report.text = bounded(normalize(`${previous} ${node.data}`), 16_384, 'text_limit');
      if (!fits()) {
        report.text = previous;
        omit('report_limit');
      }
    };
    const publicValues = new Set(request.publicValues);
    // Keep value consent and whole-report admission next to the actual emitted entry.
    // oxlint-disable-next-line complexity
    const addTarget = (node) => {
      const observation = request.textOnly ? null : observe(node);
      if (observation && (!request.query || observation.label.toLowerCase().includes(request.query))) {
        const item = {
          ref: `${request.nonce}:${request.nextRef + targets.length + 1}`,
          role: observation.role,
          label: observation.label,
        };
        if (
          node instanceof HTMLInputElement ||
          node instanceof HTMLTextAreaElement ||
          node instanceof HTMLSelectElement
        ) {
          const permitted = publicValues.has(
            JSON.stringify([document.URL, observation.record, observation.field]),
          );
          if (permitted) {
            if (observation.role === 'checkbox' || observation.role === 'radio') {
              item.checked = node.checked;
            } else if (
              !(node instanceof HTMLSelectElement) ||
              (!node.multiple && (node.selectedIndex < 0 || visible(node.options[node.selectedIndex])))
            ) {
              item.value = bounded(node.value, 512, 'value');
            } else if (!node.multiple) {
              omit('value');
            }
            if (node instanceof HTMLSelectElement) {
              item.options = [];
              for (const option of node.options) {
                if (!charge()) {
                  break;
                }
                if (item.options.length === 32) {
                  omit('target_limit');
                  break;
                }
                if (!visible(option)) {
                  continue;
                }
                const label = rendered(option, true);
                if (!label) {
                  omit('name_limit');
                  continue;
                }
                const value = bounded(option.value, 512, 'value');
                if (value !== option.value) {
                  continue;
                }
                const choice = { label, value };
                if (node.multiple) {
                  choice.selected = option.selected;
                }
                item.options.push(choice);
              }
            }
          } else {
            omit('value');
          }
        }
        if (request.remote && targets.length >= 100) {
          omit('target_limit');
        } else if (request.remote) {
          omit('remote_action');
          const box = node.getBoundingClientRect();
          targets.push({ node, observation, item, x: box.x + box.width / 2, y: box.y + box.height / 2 });
        } else if (report.elements.length >= 100) {
          omit('target_limit');
        } else {
          report.elements.push(item);
          if (fits()) {
            targets.push({ node, observation, item });
          } else {
            report.elements.pop();
            omit('report_limit');
          }
        }
      }
    };
    const addScope = (node) => {
      if (!report.scopes || (request.scopeRoot && node === element)) {
        return;
      }
      const label = scopeLabel(node);
      if (label === null) {
        return;
      }
      if (report.scopes.length >= 100) {
        omit('target_limit');
        return;
      }
      const item = { ref: `${request.nonce}:${request.nextRef + targets.length + 1}`, label };
      report.scopes.push(item);
      if (fits()) {
        targets.push({ node, observation: { label }, item, scope: true });
      } else {
        report.scopes.pop();
        omit('report_limit');
      }
    };
    const walk = (node, depth, domDepth) => {
      if (!charge()) {
        return;
      }
      if (depth > 8) {
        omit('frame_limit');
        return;
      }
      if (request.domDepth !== undefined && domDepth > request.domDepth) {
        omit('unsupported_root');
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        addText(node);
        return;
      }
      if (!(node instanceof Element) || !visible(node)) {
        return;
      }
      // Current field values require an immutable launcher declaration.
      if (request.textOnly && ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) {
        omit('value');
      }
      addScope(node);
      addTarget(node);
      if (['SCRIPT', 'STYLE', 'TEMPLATE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(node.tagName)) {
        return;
      }
      if (node.shadowRoot) {
        for (let child = node.shadowRoot.firstChild; child; child = child.nextSibling) {
          if (visited >= 2000) {
            break;
          }
          walk(child, depth + 1, domDepth + 1);
        }
      }
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (visited >= 2000) {
          break;
        }
        // Light DOM under an open host renders only if assigned to a slot.
        // Visit every sibling without materializing assignedNodes(), including nonrendered ones.
        if (node.shadowRoot && !child.assignedSlot) {
          charge();
          continue;
        }
        walk(child, depth, domDepth + 1);
      }
    };
    walk(element, request.depth, 0);
    if (visited >= 2000) {
      omit('work_limit');
    }
    return { report, targets, visited };
  }
  function typeControl() {
    const constrained = element instanceof HTMLInputElement && ['date', 'range'].includes(element.type);
    if (constrained) {
      const probe = document.createElement('input');
      probe.type = element.type;
      probe.min = element.min;
      probe.max = element.max;
      probe.step = element.step;
      probe.required = element.required;
      // The content attribute is the native step base when min is absent.
      // Never copy the mutable current value into this constraint.
      const defaultValue = element.getAttribute('value');
      if (defaultValue !== null) {
        probe.setAttribute('value', defaultValue);
      }
      probe.value = request.text;
      if (element.type === 'date' && probe.value !== request.text) {
        return 'invalid_native_date';
      }
      if (probe.value !== request.text || !probe.validity.valid) {
        return null;
      }
    }
    const prototype =
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, request.text);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    if (constrained) {
      if (!matches(observe(element), request.expected, false) || visited >= 2000) {
        throw new Error('Owned form target changed after input.');
      }
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (
      !matches(observe(element), request.expected, false) ||
      visited >= 2000 ||
      element.value !== request.text
    ) {
      throw new Error('Owned text field changed or refused the requested value after input.');
    }
    return true;
  }
  function verifySelection(requested) {
    const selected = new Set();
    for (const option of element.options) {
      if (!charge()) {
        throw new Error('Owned select exceeded the observation budget after input.');
      }
      if (option.selected) {
        selected.add(option.value);
      }
    }
    if (
      !matches(observe(element), request.expected, false) ||
      visited >= 2000 ||
      selected.size !== requested.size ||
      [...requested].some((value) => !selected.has(value))
    ) {
      throw new Error('Owned select changed or refused the requested values after input.');
    }
  }
  function selectOptions() {
    if ((!element.multiple && request.values.length !== 1) || request.values.length > 2000) {
      return null;
    }
    const requested = new Set(request.values);
    if (requested.size !== request.values.length) {
      return null;
    }
    const chosen = new Set();
    for (const option of element.options) {
      if (!charge()) {
        return null;
      }
      const wanted = requested.has(option.value);
      if ((wanted || option.selected) && (option.matches(':disabled') || !visible(option))) {
        return null;
      }
      if (wanted) {
        if (chosen.has(option.value)) {
          return null;
        }
        chosen.add(option.value);
      }
    }
    if (chosen.size !== requested.size || visited >= 2000) {
      return null;
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, 'selected').set;
    for (const option of element.options) {
      setter.call(option, requested.has(option.value));
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    if (!matches(observe(element), request.expected, false) || visited >= 2000) {
      throw new Error('Owned form target changed after input.');
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
    verifySelection(requested);
    return true;
  }
  function setChecked() {
    if (!(element instanceof HTMLInputElement) || element.type !== 'checkbox') {
      return null;
    }
    if (element.checked !== request.checked) {
      HTMLElement.prototype.click.call(element);
      if (
        !matches(observe(element), request.expected, false) ||
        visited >= 2000 ||
        element.checked !== request.checked
      ) {
        throw new Error('Owned checkbox changed or refused the requested state after input.');
      }
    }
    return true;
  }
  function applyAction() {
    if (request.action === 'set_checked') {
      return setChecked();
    }
    if (request.action === 'scroll_to') {
      Element.prototype.scrollIntoView.call(element, {
        behavior: 'instant',
        block: 'nearest',
        inline: 'nearest',
      });
      return true;
    }
    if (
      request.action === 'click' &&
      (element instanceof HTMLButtonElement ||
        (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)))
    ) {
      if (element.type === 'submit' && element.form) {
        const fields = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'elements').get.call(
          element.form,
        );
        for (let index = 0; index < fields.length; index += 1) {
          if (!charge()) {
            return null;
          }
          const field = fields.item(index);
          if (field.willValidate && !field.validity.valid) {
            return null;
          }
        }
      }
      HTMLElement.prototype.click.call(element);
      return true;
    }
    if (
      request.action === 'type' &&
      (element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLInputElement && ['text', 'date', 'range'].includes(element.type)))
    ) {
      return typeControl();
    }
    if (request.action === 'select_option' && element instanceof HTMLSelectElement) {
      return selectOptions();
    }
    return null;
  }
  const observation = observe(element);
  if (!observation || visited >= 2000) {
    return null;
  }
  if (request.action === 'read') {
    return observation;
  }
  const unchangedOrAlreadySet = request.action === 'set_checked' && observation.checked === request.checked;
  if (!matches(observation, request.expected, !unchangedOrAlreadySet)) {
    return null;
  }
  if (request.action === 'describe') {
    return { label: observation.label, role: observation.role };
  }
  return applyAction();
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
      if (ownedURLs && tabs.size >= 100) {
        unusable = true;
        refs.clear();
        // This disposable context belongs to the fixture, not its caller.
        // oxlint-disable-next-line promise/prefer-await-to-then -- The synchronous page event retires immediately and drains close.
        void context.close().catch(() => {
          // Remain retired even when close fails.
        });
        return;
      }
      sequence += 1;
      const tabId = `tab_${sequence}`;
      tabs.set(tabId, page);
      pageGenerations.set(page, 0);
      void invalidateReferences();
      page.on('framenavigated', () => {
        if (!unusable) {
          pageGenerations.set(page, pageGenerations.get(page) + 1);
          void invalidateReferences();
        }
        notice('navigation', tabId);
      });
      page.on('framedetached', () => {
        if (!unusable) {
          pageGenerations.set(page, pageGenerations.get(page) + 1);
          void invalidateReferences();
        }
      });
      page.on('close', () => {
        if (!unusable) {
          void invalidateReferences();
        }
        notice('tab_closed', tabId);
        tabs.delete(tabId);
        pageGenerations.delete(page);
        if (active === tabId) {
          active = [...tabs.keys()][0] ?? null;
        }
      });
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
      await entry.handle.dispose();
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

  const observation = async (work, signal, mayHaveEffects = false, timeoutMs = null) => {
    signal?.throwIfAborted();
    if (!signal && timeoutMs === null) {
      return await work();
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
      return await Promise.race([work(), stopped]);
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
      return await observation(observeState, signal);
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
      return await observation(() => readBorrowed(page, { full: filter === 'all' }), signal, false, 5000);
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
