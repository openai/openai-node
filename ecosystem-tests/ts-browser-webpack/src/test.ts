import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox'],
  });
  let page;
  try {
    page = await browser.newPage();
    function debugEvent(subj: string) {
      return subj.padEnd('requestfailed'.length);
    }
    page
      .on('console', (message) =>
        console.error(
          `${debugEvent('console')} ${message
            .type()
            .substr(0, 'warning'.length)
            .toUpperCase()
            .padEnd('warning'.length)} ${message.text()}`,
        ),
      )
      .on('pageerror', ({ message }) => console.error(`${debugEvent('pageerror')} ${message}`))
      .on('response', (response) =>
        console.error(`${debugEvent('response')} ${response.status()} ${response.url()}`),
      )
      .on('requestfailed', (request) =>
        console.error(`${debugEvent('requestfailed')} ${request.failure()?.errorText} ${request.url()}`),
      );

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) throw new Error('missing process.env.OPENAI_API_KEY');

    // Navigate the page to a URL
    await page.goto(`http://localhost:8080/index.html?apiKey=${apiKey}`);

    await page.waitForSelector('#running', { timeout: 15000 });

    let start = Date.now();
    while ((await page.$('#running')) != null && Date.now() - start < 3 * 60000) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    let results;
    const resultsEl = await page.$('#results');
    if (resultsEl) {
      const text = await page.evaluate((el) => el.textContent, resultsEl);
      results = text ? JSON.parse(text) : undefined;
    }

    if (!Array.isArray(results)) {
      throw new Error(`failed to get test results from page`);
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
