// One bounded main-document walk for caller-owned contexts. Never collect an
// unbounded selector list or body.innerText before applying the report limits.
// oxlint-disable-next-line eslint/complexity -- Keep the serialized walk and its bounded private bindings together.
export function borrowedRead({ nonce, nextRef, full, textOnly, checkedNode, finding = false }) {
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
