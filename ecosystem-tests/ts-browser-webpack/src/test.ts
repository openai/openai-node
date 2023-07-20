import puppeteer from 'puppeteer'

(async () => {
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();

    const apiKey = process.env.OPENAI_API_KEY

    if (!apiKey) throw new Error('missing process.env.OPENAI_API_KEY')

    // Navigate the page to a URL
    await page.goto(`http://localhost:8080/index.html?apiKey=${apiKey}`);

    await page.waitForSelector('#running', { timeout: 15000 })

    let start = Date.now()
    while (await page.$('#running') != null && Date.now() - start < 60000) {
      await new Promise(r => setTimeout(r, 1000))
    }

    let results
    const resultsEl = await page.$('#results')
    if (resultsEl) {
      const text = await page.evaluate(el => el.textContent, resultsEl)
      results = text ? JSON.parse(text) : undefined
    }

    if (!Array.isArray(results)) {
      throw new Error(`failed to get test results from page`)
    }
    const failed = results.filter(r => !r.passed)
    if (failed.length) {
      throw new Error(`${failed.length} of ${results.length} tests failed: ${JSON.stringify(failed, null, 2)}`)
    }
    console.log(`${results.length} tests passed!`)
  } finally {
    await browser.close();
  }
})();
