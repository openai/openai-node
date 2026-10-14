import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import OpenAI from 'openai';
import { chromium } from 'playwright';
import { answerQuestion, openReader } from './read-only.mjs';

const documents = JSON.parse(await readFile(new URL('reader-site.json', import.meta.url), 'utf-8'));
const original = JSON.stringify(documents);
const call = (member, args, id = 'manual') => ({
  type: 'function_call',
  id,
  call_id: id,
  name: `browser_${member}`,
  arguments: JSON.stringify(args),
  status: 'completed',
});
const payload = (output) =>
  JSON.parse(
    typeof output.output === 'string'
      ? output.output
      : output.output.find((part) => part.type === 'input_text').text,
  );
const textResult = (output) => payload(output).result;

// Only wrap pages belonging to these local reader exercises. Do not expose a test hook in openReader.
const { launch: originalLaunch } = chromium;
// oxlint-disable no-await-in-loop -- Each held startup owns a separate browser and signal.
for (const phase of ['launch', 'context', 'navigation']) {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const closed = Promise.withResolvers();
  let owned;
  const hold = async (value, at) => {
    if (phase === at) {
      entered.resolve();
      await release.promise;
    }
    return value;
  };
  chromium.launch = async function launch(options) {
    const browser = await originalLaunch.call(this, options);
    owned = browser;
    browser.once('disconnected', () => closed.resolve());
    const originalContext = browser.newContext.bind(browser);
    browser.newContext = async function newContext(contextOptions) {
      const context = await originalContext(contextOptions);
      context.on('page', (page) => {
        const originalGoto = page.goto.bind(page);
        page.goto = async function goto(url, gotoOptions) {
          return hold(await originalGoto(url, gotoOptions), 'navigation');
        };
      });
      return hold(context, 'context');
    };
    return hold(browser, 'launch');
  };
  const controller = new AbortController();
  const reason = new Error('Reader startup interrupted.');
  const opening = openReader({ documents, signal: controller.signal });
  // oxlint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks -- Observe rejection before triggering the controlled cancellation.
  const outcome = opening.catch((error) => error);
  try {
    await Promise.race([entered.promise, delay(5000).then(() => assert.fail('Startup did not enter'))]);
    controller.abort(reason);
    assert.equal(await Promise.race([outcome, delay(250, 'still waiting')]), reason);
    release.resolve();
    await Promise.race([closed.promise, delay(5000).then(() => assert.fail('Late browser was not closed'))]);
  } finally {
    release.resolve();
    const result = await outcome;
    await result?.close?.();
    await owned?.close();
    chromium.launch = originalLaunch;
  }
}
// oxlint-enable no-await-in-loop
chromium.launch = async function launch(options) {
  const browser = await originalLaunch.call(this, options);
  const { newContext: originalContext } = browser;
  browser.newContext = async function newContext(contextOptions) {
    const context = await originalContext.call(this, contextOptions);
    context.on('page', (page) => {
      const { goto: originalGoto } = page;
      page.goto = async function goto(url, gotoOptions) {
        const response = await originalGoto.call(this, url, gotoOptions);
        if (url === 'http://reader.invalid/hours') {
          assert.equal(this.url(), url);
          throw new Error('Local fixture failed after navigation commit');
        }
        return response;
      };
    });
    return context;
  };
  return browser;
};
try {
  // oxlint-disable no-await-in-loop -- Separate owned readers for absent and present per-call signals.
  for (const options of [undefined, { signal: new AbortController().signal }]) {
    const reader = await openReader({ documents });
    try {
      await assert.rejects(
        reader.tools.execute(call('navigate', { tab_id: null, url: 'http://reader.invalid/hours' }), options),
        /Browser state report failed/u,
      );
      await assert.rejects(
        reader.tools.execute(call('get_page_text', { tab_id: null }), options),
        /Browser state report failed/u,
      );
    } finally {
      await reader.close();
    }
  }
  // oxlint-enable no-await-in-loop
} finally {
  chromium.launch = originalLaunch;
}

const boundary = `/${'a'.repeat(16_384 - Buffer.byteLength('http://reader.invalid/'))}`;
let opened;
try {
  await assert.rejects(async () => {
    opened = await openReader({ documents: { ...documents, [`${boundary}b`]: documents['/'] } });
  }, /16 KiB/u);
} finally {
  await opened?.close();
}
const longTitles = await openReader({
  documents: {
    ...documents,
    '/': { ...documents['/'], title: `${'😺'.repeat(256)}é${'large'.repeat(2000)}` },
    [boundary]: { title: 'Short guide title', paragraphs: [], links: {} },
  },
});
try {
  const initial = payload(await longTitles.tools.execute(call('list_tabs', {})));
  assert.equal(initial.state.tabs[0].title, '😺'.repeat(256));
  const destination = `http://reader.invalid${boundary}`;
  const next = payload(await longTitles.tools.execute(call('navigate', { tab_id: null, url: destination })));
  assert.equal(next.ok, true);
  assert.equal(next.state.tabs[0].url, 'http://reader.invalid');
  assert.equal(next.state.tabs[0].title, 'Short guide title');
} finally {
  await longTitles.close();
}

for (const key of [
  'data:,local-text',
  'about:blank',
  'https://outside.invalid/',
  '//outside.invalid/',
  '/hours#fragment',
  '/hours?view=short',
  'relative',
]) {
  // Validate inert fixture keys before opening a browser; never navigate to them.
  // oxlint-disable-next-line no-await-in-loop
  await assert.rejects(openReader({ documents: { ...documents, [key]: documents['/'] } }), /document keys/u);
}

async function checkQuestion({ question, target, expected }) {
  const reader = await openReader({ documents });
  let step = 0;
  let transportError;
  try {
    const client = new OpenAI({
      apiKey: 'synthetic-local-reader',
      maxRetries: 0,
      fetch: async (input, init) => {
        try {
          const request = new Request(input, init);
          const body = await request.json();
          step += 1;
          let output;
          if (step === 1) {
            assert.ok(JSON.stringify(body.input).includes(question));
            assert.deepEqual(body.tools.map((tool) => tool.name).toSorted(), [
              'browser_get_page_text',
              'browser_list_tabs',
              'browser_navigate',
            ]);
            output = [call('get_page_text', { tab_id: null }, `read-${step}`)];
          } else if (step === 2) {
            assert.ok(textResult(body.input.at(-1)).includes(`http://reader.invalid${target}`));
            output = [
              call('navigate', { tab_id: null, url: `http://reader.invalid${target}` }, `go-${step}`),
            ];
          } else if (step === 3) {
            output = [call('get_page_text', { tab_id: null }, `read-${step}`)];
          } else {
            const text = textResult(body.input.at(-1));
            assert.ok(text.includes(expected));
            output = [
              {
                type: 'message',
                id: 'answer',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text, annotations: [] }],
              },
            ];
          }
          return Response.json({ id: `response-${step}`, object: 'response', status: 'completed', output });
        } catch (error) {
          transportError = error;
          throw error;
        }
      },
    });
    const response = await answerQuestion(client, reader, { model: 'local-reader-check', question }).catch(
      (error) => {
        throw transportError ?? error;
      },
    );
    assert.ok(response.output_text.includes(expected));
    assert.equal(step, 4);
    const denied = await reader.tools.execute(
      call('navigate', { tab_id: null, url: 'https://outside.invalid/' }),
    );
    assert.equal(payload(denied).ok, false);
    await assert.rejects(reader.tools.execute(call('click', { tab_id: null, target: 'invented' })));
    assert.equal(JSON.stringify(documents), original);
  } finally {
    await reader.close();
  }
}

const stoppedReader = await openReader({ documents });
try {
  const controller = new AbortController();
  let requests = 0;
  let transportAborted = false;
  const client = new OpenAI({
    apiKey: 'synthetic-local-reader',
    maxRetries: 0,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests += 1;
      controller.abort();
      transportAborted = request.signal.aborted;
      throw new Error('Synthetic interrupted transport');
    },
  });
  await assert.rejects(
    answerQuestion(client, stoppedReader, {
      model: 'local-reader-check',
      question: 'When is the museum closed?',
      signal: controller.signal,
    }),
  );
  assert.equal(requests, 1);
  assert.equal(transportAborted, true, 'Stop must abort the actual Responses transport');
} finally {
  await stoppedReader.close();
}

await checkQuestion({
  question: 'When is the museum closed?',
  target: '/hours',
  expected: 'closed on Monday',
});
await checkQuestion({
  question: 'Where is the accessible entrance?',
  target: '/groups',
  expected: 'East Courtyard',
});

documents['/hours'].paragraphs = ['Today only: the museum closes at 14:35.'];
const fresh = await openReader({ documents });
try {
  await fresh.tools.execute(call('navigate', { tab_id: null, url: 'http://reader.invalid/hours' }));
  const result = await fresh.tools.execute(call('get_page_text', { tab_id: null }));
  assert.ok(textResult(result).includes('14:35'));
  assert.equal(textResult(result).includes('17:00'), false);
} finally {
  await fresh.close();
}
// oxlint-disable no-await-in-loop -- Start and retire each reader before testing the next independent budget case.
for (const source of [
  { title: 'Large guide', paragraphs: ['😀'.repeat(9000)], links: {} },
  { title: 'Many guide entries', paragraphs: Array.from({ length: 2100 }, () => 'item'), links: {} },
  { title: 'Large link', paragraphs: ['Read the index.'], links: { [`/${'x'.repeat(17_000)}`]: 'Long' } },
]) {
  const reader = await openReader({ documents: { '/': source } });
  try {
    const result = await reader.tools.execute(call('get_page_text', { tab_id: null }));
    const text = textResult(result);
    assert.equal(typeof text, 'string');
    assert.ok(Buffer.byteLength(text) <= 16_384);
    assert.ok(
      text.endsWith('\nLinks:\n\n[Some document content was omitted.]'),
      'Omitted content must not expose any partial link in the Links section',
    );
  } finally {
    await reader.close();
  }
}
// oxlint-enable no-await-in-loop
console.log(
  'PASS two questions, current page content, outside navigation refusal, bounded documents and disabled mutations',
);
