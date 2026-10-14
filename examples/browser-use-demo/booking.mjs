import { randomUUID } from 'node:crypto';
import { BrowserError } from 'openai/helpers/browser';

export function exampleBrowserChannel() {
  const channel = process.env['OPENAI_EXAMPLE_BROWSER_CHANNEL'];
  if (channel !== undefined && channel !== 'chrome') {
    throw new TypeError('OPENAI_EXAMPLE_BROWSER_CHANNEL must be unset or chrome.');
  }
  return channel;
}

/** A partial driver for the local booking fixture only, never an arbitrary or borrowed page. */
export function createBrowserDriver(context, { ownedFixture }) {
  const [fixtureURL] = ownedFixture.urls;
  const id = randomUUID();
  let page;
  let sequence = 0;
  let uncertain = false;
  const refs = new Map();
  const guards = (async () => {
    await context.route('**/*', async (route) => {
      await (route.request().url() === fixtureURL && route.request().method() === 'GET'
        ? route.continue()
        : route.abort());
    });
    await context.routeWebSocket('**/*', (route) => route.close());
    context.on('page', (opened) => {
      opened.on('popup', async (popup) => {
        await popup.close();
      });
    });
  })();
  function invalidateReferences() {
    refs.clear();
    sequence += 1;
  }
  function requirePage(tabId, signal) {
    signal?.throwIfAborted();
    if (
      !page ||
      page.isClosed() ||
      page.url() !== fixtureURL ||
      uncertain ||
      (tabId !== null && tabId !== id)
    ) {
      throw new BrowserError('The booking page is not current. Start a fresh task.');
    }
  }
  async function act({ tab_id, target }, signal, member, value) {
    requirePage(tab_id, signal);
    const item = refs.get(target);
    if (!item || !item.members.includes(member)) {
      throw new BrowserError('Read the current booking form before acting on it.');
    }
    try {
      signal?.throwIfAborted();
      await (member === 'click'
        ? item.locator.click({ timeout: 5000 })
        : item.locator[member](value, { timeout: 5000 }));
      signal?.throwIfAborted();
    } catch {
      uncertain = true;
      invalidateReferences();
      throw new BrowserError('The booking input outcome is uncertain; close this task.');
    }
    invalidateReferences();
  }
  return {
    invalidateReferences,
    hasUncertainEffects: () => uncertain,
    currentOwnedView: () => (page && !page.isClosed() ? { page, tabId: id, sequence } : null),
    async new_tab({ url }, { signal } = {}) {
      signal?.throwIfAborted();
      if (page || url !== fixtureURL) {
        throw new BrowserError('This driver owns one booking page only.');
      }
      await guards;
      signal?.throwIfAborted();
      page = await context.newPage();
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
          invalidateReferences();
        }
      });
      page.once('close', invalidateReferences);
      await page.goto(fixtureURL, { waitUntil: 'domcontentloaded', timeout: 5000 });
      signal?.throwIfAborted();
      return id;
    },
    async state({ signal } = {}) {
      requirePage(id, signal);
      return { tabs: [{ id, title: 'Book a table', url: fixtureURL, active: true }] };
    },
    async read_page({ tab_id }, { signal } = {}) {
      requirePage(tab_id, signal);
      refs.clear();
      const version = sequence;
      const elements = [];
      // oxlint-disable-next-line no-await-in-loop -- Each read below checks the same four fixed controls in display order.
      for (const [label, role, members] of [
        ['Guest name', 'textbox', ['fill']],
        ['Party size', 'combobox', ['selectOption']],
        ['Time', 'combobox', ['selectOption']],
        ['Seating', 'combobox', ['selectOption']],
      ]) {
        const locator = page.getByLabel(label, { exact: true });
        const ref = randomUUID();
        // oxlint-disable-next-line no-await-in-loop -- Snapshot the four fixed controls in order.
        const value = await locator.inputValue({ timeout: 5000 });
        refs.set(ref, { locator, members });
        const element = { ref, role, label, value };
        if (role === 'combobox') {
          // oxlint-disable-next-line no-await-in-loop -- Associate options with the same fixed control.
          element.options = await locator
            .locator('option')
            .evaluateAll((options) =>
              options.map((option) => ({ label: option.label, value: option.value })),
            );
        }
        elements.push(element);
      }
      const button = page.getByRole('button', { name: 'Reserve table', exact: true });
      if (await button.isEnabled()) {
        const ref = randomUUID();
        refs.set(ref, { locator: button, members: ['click'] });
        elements.push({ ref, role: 'button', label: 'Reserve table' });
      }
      const text = await page.locator('[role=status]').textContent({ timeout: 5000 });
      requirePage(tab_id, signal);
      if (sequence !== version) {
        throw new BrowserError('The booking page changed. Read it again.');
      }
      return { version: 1, text, elements, omitted: [] };
    },
    async get_page_text({ tab_id }, { signal } = {}) {
      requirePage(tab_id, signal);
      const text = await page.locator('[role=status]').textContent({ timeout: 5000 });
      requirePage(tab_id, signal);
      return { version: 1, text, elements: [], omitted: [] };
    },
    click(args, { signal } = {}) {
      return act(args, signal, 'click');
    },
    type(args, { signal } = {}) {
      return act(args, signal, 'fill', args.text);
    },
    select_option(args, { signal } = {}) {
      return act(args, signal, 'selectOption', args.values);
    },
  };
}

export async function waitForDecision(work, signal) {
  if (!signal) {
    return work();
  }
  signal.throwIfAborted();
  let onAbort;
  // oxlint-disable-next-line promise/avoid-new -- Observe approval or effect-free eligibility without taking ownership of its work.
  const interrupted = new Promise((_resolve, reject) => {
    onAbort = () => reject(new Error('Browser observation interrupted.'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    // oxlint-disable-next-line promise/prefer-await-to-then -- Observe synchronous callback failures before cancellation can reject the race.
    const deciding = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return work();
    });
    const result = await Promise.race([deciding, interrupted]);
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
