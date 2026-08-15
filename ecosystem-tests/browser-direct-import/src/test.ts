import { launch } from 'puppeteer';

(async () => {
  const browser = await launch({
    args: ['--no-sandbox'],
  });
  let page;
  try {
    page = await browser.newPage();
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
      .on('pageerror', (error) =>
        console.error(`${debugEvent('pageerror')} ${error instanceof Error ? error.message : String(error)}`),
      )
      .on('response', (response) =>
        console.error(`${debugEvent('response')} ${response.status()} ${response.url()}`),
      )
      .on('requestfailed', (request) =>
        console.error(`${debugEvent('requestfailed')} ${request.failure()?.errorText} ${request.url()}`),
      );

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {throw new Error('missing process.env.OPENAI_API_KEY');}

    const origin = 'http://localhost:8081';
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
    await page.goto(`${origin}/index.html`);

    await page.waitForSelector('#running', { timeout: 15_000 });

    const start = Date.now();
    while ((await page.$('#running')) != null && Date.now() - start < 3 * 60_000) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

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
