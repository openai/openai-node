import { once } from 'node:events';
import { BrowserError } from 'openai/helpers/browser';
import { createBrowserDriver } from './driver.mjs';

// Only for a new, launcher-owned secret-free local fixture context.
export function createSensitiveDriver(context, { url, diagnostics = false, scripts = false }) {
  if (context.pages().length !== 0) {
    throw new TypeError('Sensitive tools require an empty owned context.');
  }
  const fixture = new URL(url);
  if (
    fixture.protocol !== 'http:' ||
    fixture.hostname !== '127.0.0.1' ||
    fixture.username ||
    fixture.password ||
    fixture.search ||
    fixture.hash
  ) {
    throw new TypeError('Sensitive tools require an exact secret-free local fixture URL.');
  }
  const driver = createBrowserDriver(context, { ownedFixture: { urls: [fixture.href] } });
  const { new_tab: newTab, navigate } = driver;
  driver.new_tab = (action, options) =>
    newTab({ ...action, url: action.url === url ? fixture.href : action.url }, options);
  driver.navigate = (action, options) =>
    navigate({ ...action, url: action.url === url ? fixture.href : action.url }, options);
  const current = (tabId) => {
    const view = driver.currentOwnedView();
    if (!view || (tabId !== null && view.tabId !== tabId) || view.page.url() !== fixture.href) {
      throw new BrowserError('Sensitive tools require the active installed fixture.');
    }
    return view;
  };
  if (diagnostics === true) {
    const history = new WeakMap();
    context.on('page', (page) => {
      const records = { console: [], network: [], consoleDropped: false, networkDropped: false };
      history.set(page, records);
      const add = (source, text) => {
        records[source].push(text);
        if (records[source].length > 100) {
          records[source].shift();
          records[`${source}Dropped`] = true;
        }
      };
      page.on('console', (message) => {
        const type = message.type();
        const level = ['warning', 'error', 'info', 'debug', 'log'].includes(type) ? type : 'other';
        add('console', `console:${level}`);
      });
      page.on('response', (response) => add('network', `status:${response.status()}`));
      page.on('requestfailed', () => add('network', 'failed'));
    });
    driver.read_diagnostics = async ({ tab_id, source, limit }) => {
      const records = history.get(current(tab_id).page);
      return {
        version: 1,
        text: records[source].slice(-limit).join('\n'),
        elements: [],
        omitted: records[`${source}Dropped`] || records[source].length > limit ? ['work_limit'] : [],
      };
    };
  }
  if (scripts === true) {
    driver.run_script = async ({ tab_id, source, timeout_ms }, { signal } = {}) => {
      const before = current(tab_id);
      const stop = AbortSignal.any([AbortSignal.timeout(timeout_ms), ...(signal ? [signal] : [])]);
      const work = async () => {
        stop.throwIfAborted();
        const root = await before.page.locator('html').elementHandle();
        try {
          stop.throwIfAborted();
          if (!root) {
            throw new BrowserError('Fixture document is unavailable.');
          }
          await driver.invalidateReferences();
          stop.throwIfAborted();
          if (current(tab_id).sequence !== before.sequence) {
            throw new Error('Fixture changed.');
          }
          const result = await root.evaluate(async (element, body) => {
            if (!element.isConnected || element.ownerDocument !== document) {
              throw new Error('Fixture document changed.');
            }
            const AsyncFunction = Object.getPrototypeOf(async () => null).constructor;
            return await new AsyncFunction(body)();
          }, source);
          stop.throwIfAborted();
          const after = current(tab_id);
          if (
            typeof result !== 'string' ||
            result.length > 16_384 ||
            /[\uD800-\uDFFF]/u.test(result) ||
            Buffer.byteLength(result, 'utf-8') > 16_384 ||
            after.page !== before.page ||
            after.sequence !== before.sequence ||
            !(await root.evaluate((element) => element.isConnected && element.ownerDocument === document))
          ) {
            throw new Error('Fixture changed.');
          }
          return result;
        } finally {
          await root?.dispose();
        }
      };
      const finished = new AbortController();
      try {
        const result = await Promise.race([work(), once(stop, 'abort', { signal: finished.signal })]);
        stop.throwIfAborted();
        return result;
      } catch {
        // A cancelled evaluate may still execute in Chromium. Never reuse this context.
        await driver.retire(undefined, { signal: stop });
        throw new BrowserError('Script completion is uncertain; fixture retired.');
      } finally {
        finished.abort();
      }
    };
  }
  return driver;
}
