import { launch } from 'puppeteer';

(async () => {
  const browser = await launch({
    args: ['--no-sandbox'],
  });
  let page;
  try {
    page = await browser.newPage();
    const live =
      process.env.OPENAI_ECOSYSTEM_TEST_LIVE === undefined
        ? Boolean(process.env.OPENAI_API_KEY)
        : process.env.OPENAI_ECOSYSTEM_TEST_LIVE === 'true';
    const apiKey = live ? process.env.OPENAI_API_KEY : 'synthetic-browser-api-key';

    if (!apiKey) {throw new Error('missing process.env.OPENAI_API_KEY');}

    const origin = 'http://localhost:8081';
    let rejectBrowserFailure: (error: Error) => void;
    const browserFailure = new Promise<never>((_resolve, reject) => {
      rejectBrowserFailure = reject;
    });
    if (!live) {
      await page.setRequestInterception(true);
    }
    const debugEvent = (subj: string) => subj.padEnd('requestfailed'.length);
    page
      .on('console', (message) =>
        console.error(
          `${debugEvent('console')} ${message
            .type()
            .slice(0, 'warning'.length)
            .toUpperCase()
            .padEnd('warning'.length)} ${message.text()}`,
        ),
      )
      .on('pageerror', (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`${debugEvent('pageerror')} ${message}`);
        rejectBrowserFailure(new Error(`Browser direct import failed: ${message}`));
      })
      .on('request', async (request) => {
        if (live) {
          return;
        }
        try {
          if (new URL(request.url()).origin !== origin) {
            await request.abort();
            rejectBrowserFailure(new Error(`Unexpected network request during browser import: ${request.url()}`));
            return;
          }
          await request.continue();
        } catch (error) {
          rejectBrowserFailure(error instanceof Error ? error : new Error(String(error)));
        }
      })
      .on('response', (response) => {
        console.error(`${debugEvent('response')} ${response.status()} ${response.url()}`);
        if (response.request().resourceType() === 'script' && !response.ok()) {
          rejectBrowserFailure(new Error(`Browser module request failed: ${response.status()} ${response.url()}`));
        }
      })
      .on('requestfailed', (request) => {
        const message = `${request.failure()?.errorText} ${request.url()}`;
        console.error(`${debugEvent('requestfailed')} ${message}`);
        if (request.resourceType() === 'script') {
          rejectBrowserFailure(new Error(`Browser module request failed: ${message}`));
        }
      });

    await page.evaluateOnNewDocument(
      (key, expectedOrigin) => {
        if (location.origin !== expectedOrigin) {
          return;
        }
        Object.defineProperty(globalThis, '__OPENAI_ECOSYSTEM_TEST_API_KEY__', {
          value: key,
          configurable: false,
          enumerable: false,
          writable: false,
        });
      },
      apiKey,
      origin,
    );
    await page.evaluateOnNewDocument((isLive) => {
      Object.defineProperty(globalThis, '__OPENAI_ECOSYSTEM_TEST_LIVE__', {
        value: isLive,
        configurable: false,
        enumerable: false,
        writable: false,
      });
    }, live);

    await Promise.race([
      browserFailure,
      (async () => {
        await page.goto(`${origin}/index.html`);
        await page.waitForSelector('#results', { timeout: 15_000 });
        await page.waitForFunction(() => !document.querySelector('#running'), {
          timeout: live ? 3 * 60_000 : 15_000,
        });

        let results;
        const resultsEl = await page.$('#results');
        if (resultsEl) {
          const text = await page.evaluate((el) => el.textContent, resultsEl);
          results = text ? JSON.parse(text) : undefined;
        }

        if (!Array.isArray(results)) {
          throw new TypeError(`failed to get test results from page`);
        }
        const failed = results.filter((r) => !r.passed);
        if (failed.length) {
          throw new Error(
            `${failed.length} of ${results.length} tests failed: ${JSON.stringify(failed, null, 2)}`,
          );
        }
        console.log(`${results.length} tests passed!`);
      })(),
    ]);
  } catch (error) {
    if (page) {
      try {
        const html = await page.evaluate(() => document.body.innerHTML);
        console.error(`\n====================\nBODY HTML\n====================\n\n${html}\n\n`);
      } catch (error) {
        console.error(`failed to get body HTML for debugging`, error);
      }
    }
    throw error;
  } finally {
    await browser.close();
  }
})();
