import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { launch } from 'puppeteer';

(async () => {
  const browser = await launch({ args: ['--no-sandbox'] });

  try {
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      if (new URL(request.url()).protocol === 'file:') {
        await request.continue();
        return;
      }

      await request.abort();
    });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(globalThis, '__OPENAI_ECOSYSTEM_TEST_API_KEY__', {
        value: 'synthetic-browser-webpack-test-key',
        configurable: false,
        enumerable: false,
        writable: false,
      });
      Object.defineProperty(globalThis, '__OPENAI_ECOSYSTEM_TEST_BUNDLE_ONLY__', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false,
      });
    });

    const bundleURL = pathToFileURL('dist/index.html').href;
    await Promise.race([
      (async () => {
        await page.goto(bundleURL);
        await page.waitForSelector('#running', { hidden: true, timeout: 15_000 });
      })(),
      (async () => {
        const [error] = await once(page, 'pageerror');
        throw error instanceof Error ? error : new Error(String(error));
      })(),
      (async () => {
        const [request] = await once(page, 'requestfailed');
        throw new Error(`Unexpected network request: ${request.url()}`);
      })(),
    ]);

    console.log('Webpack bundle executed in Chrome without live credentials or network requests');
  } finally {
    await browser.close();
  }
})();
