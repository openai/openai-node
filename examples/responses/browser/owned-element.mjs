// This function runs as one browser task. Only launcher-owned fixtures with
// immutable record handlers may use these DOM activation/input semantics.
// Functions in this serialized task cannot capture module-scope helpers.
export function ownedElement(element, request) {
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
