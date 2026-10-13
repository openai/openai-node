import { createServer } from 'node:http';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { BrowserToolset } from 'openai/helpers/browser';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';
import { createBrowserDriver, exampleBrowserChannel, guardBrowserContext } from './driver.mjs';
import { chromium } from 'playwright';

const model = process.env['OPENAI_MODEL'];
const channel = exampleBrowserChannel();
if (!model) {
  throw new Error('Set OPENAI_MODEL to a model available to your project.');
}
const fixture = await readFile(new URL('fixture.html', import.meta.url));
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(fixture);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const allowed = (url) => {
  try {
    return new URL(url).origin === origin || url === 'about:blank';
  } catch {
    return false;
  }
};
let browser;
try {
  // Never propagate SDK credentials to the Chromium process.
  browser = await chromium.launch({
    headless: true,
    channel,
    chromiumSandbox: true,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
      TMPDIR: process.env['TMPDIR'] ?? '/tmp',
    },
  });
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    serviceWorkers: 'block',
  });
  // Context-level interception also covers redirects, subresources and newly opened tabs.
  await guardBrowserContext(context, allowed);
  const driver = createBrowserDriver(context);
  await driver.new_tab({ url: origin });
  const confirmations = [];
  const toolset = new BrowserToolset(driver, {
    urlPolicy: (_, url) => allowed(url),
    confirm: ({ member }) =>
      [
        'navigate',
        'new_tab',
        'switch_tab',
        'close_tab',
        'click',
        'type',
        'select_option',
        'key',
        'scroll',
        'hover',
      ].includes(member),
  });
  const runner = new ResponsesToolRunner({
    browser: toolset,
    functions: [
      {
        tool: {
          type: 'function',
          name: 'record_confirmation',
          description: 'Record the visible confirmation text after submitting the form.',
          strict: true,
          parameters: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
            additionalProperties: false,
          },
        },
        execute: ({ text }) => {
          confirmations.push(text);
          return 'Recorded.';
        },
      },
    ],
  });
  await runner.run(
    new OpenAI(),
    {
      model,
      store: false,
      input:
        'Read the page. Fill the name Ada, select Blue, submit. Record the visible confirmation with record_confirmation. Take a screenshot. Open a second tab at the same URL and list the tabs. Then finish.',
    },
    { maxSteps: 16, stream: process.env['SDK_STREAM'] === '1' },
  );
  const tabs = await driver.state();
  const [first] = tabs.tabs;
  const text = await driver.get_page_text({ tab_id: first.id });
  if (
    !text.includes('Hello, Ada! Color: Blue') ||
    !confirmations.some((value) => String(value).includes('Ada')) ||
    tabs.tabs.length < 2
  ) {
    throw new Error('Fixture verification failed: form, record or tabs did not complete.');
  }
  console.log('Verified the form, confirmation function, and two tabs.');
} finally {
  try {
    await browser?.close();
  } finally {
    await promisify(server.close.bind(server))();
  }
}
