// @ts-check
import OpenAI, { toFile } from './node_modules/openai/index.mjs';
import { distance } from './node_modules/fastest-levenshtein/esm/mod.js';

/** @typedef {{ path: string[]; run: () => any; timeout?: number; }} TestCase */

/** @type {TestCase[]} */
const tests = [];

/** @typedef {{ path: string[]; passed: boolean; error?: string }} TestResult */

async function runTests() {
  /** @type {TestResult[]} */
  const results = [];
  function displayResults() {
    let pre = document.querySelector('#results');
    if (!pre) {
      pre = document.createElement('pre');
      pre.id = 'results';
      document.body.append(pre);
    }
    pre.textContent = JSON.stringify(results, null, 2);
  }
  for (const { path, run, timeout } of tests) {
    console.log('running', ...path);
    try {
      await Promise.race([
        run(),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error(`Test timed out after ${timeout} ms`)), timeout),
        ),
      ]);
      console.log('passed', ...path);
      results.push({ path, passed: true });
    } catch (error) {
      console.log('error', ...path);
      console.error(error);
      results.push({ path, passed: false, error: error instanceof Error ? error.stack : String(error) });
    }
    displayResults();
  }
  const runningEl = document.querySelector('#running');
  if (runningEl) {runningEl.remove();}
}

/** @type {string[]} */
const testPath = [];

/**
 * @param {string} description - Test suite description.
 * @param {() => void} handler - Test suite callback.
 */
function describe(description, handler) {
  testPath.push(description);
  try {
    handler();
  } finally {
    testPath.pop();
  }
}

/**
 * @param {string} description - Test case description.
 * @param {() => any} run - Test case callback.
 * @param {number} [timeout] - Defaults to `60000`.
 */
function it(description, run, timeout = 60_000) {
  tests.push({ path: [...testPath, description], run, timeout });
}

/**
 * @param {any} received - Value being asserted.
 * @returns {{
 *   toEqual: (expected: any) => void;
 *   toBeSimilarTo: (comparedTo: string, expectedDistance: number) => void;
 * }} Matchers for validating the received value.
 */
function expect(received) {
  return {
    toEqual(expected) {
      if (!Object.is(received, expected)) {
        throw new Error(
          [`Received: ${JSON.stringify(received)}`, `Expected: ${JSON.stringify(expected)}`].join('\n'),
        );
      }
    },
    toBeSimilarTo(comparedTo, expectedDistance) {
      const actualDistance = distance(received, comparedTo);
      if (actualDistance < expectedDistance) {return;}

      throw new Error(
        [
          `Received: ${JSON.stringify(received)}`,
          `Expected: ${JSON.stringify(comparedTo)}`,
          `Expected distance: ${expectedDistance}`,
          `Received distance: ${actualDistance}`,
        ].join('\n'),
      );
    },
  };
}

const url = 'https://audio-samples.github.io/samples/mp3/blizzard_biased/sample-1.mp3';
const filename = 'sample-1.mp3';

const correctAnswer =
  'It was anxious to find him no one that expectation of a man who were giving his father enjoyment. But he was avoided in sight in the minister to which indeed,';
const model = 'whisper-1';

const apiKey = /** @type {typeof globalThis & { __OPENAI_ECOSYSTEM_TEST_API_KEY__?: string }} */ (
  globalThis
).__OPENAI_ECOSYSTEM_TEST_API_KEY__;

const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });

async function typeTests() {
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await client.audio.transcriptions.create({ file: { foo: true }, model: 'whisper-1' });
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await client.audio.transcriptions.create({ file: null, model: 'whisper-1' });
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await client.audio.transcriptions.create({ file: 'test', model: 'whisper-1' });
}

it(`raw response`, async () => {
  const response = await client.chat.completions
    .create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Reply with exactly this text and nothing else: This is a test' }],
    })
    .asResponse();

  // test that we can use web Response API
  const { body } = response;
  if (!body) {throw new Error('expected response.body to be defined');}

  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let result;
  do {
    result = await reader.read();
    if (!result.done) {chunks.push(result.value);}
  } while (!result.done);

  reader.releaseLock();

  let offset = 0;
  const merged = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  const json = /** @type {OpenAI.ChatCompletion} */ (JSON.parse(new TextDecoder().decode(merged)));
  expect(json.choices[0]?.message.content || '').toBeSimilarTo('This is a test', 10);
});

it(`streaming works`, async () => {
  const stream = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Reply with exactly this text and nothing else: This is a test' }],
    stream: true,
  });
  const chunks = [];
  for await (const part of stream) {
    chunks.push(part);
  }
  expect(chunks.map((c) => c.choices[0]?.delta.content || '').join('')).toBeSimilarTo('This is a test', 10);
});

if (typeof File !== 'undefined') {
  it('handles builtinFile', async () => {
    const file = await fetch(url)
      .then((x) => x.arrayBuffer())
      .then((x) => new File([x], filename));

    const result = await client.audio.transcriptions.create({ file, model });
    expect(result.text).toBeSimilarTo(correctAnswer, 12);
  });
}

it('handles Response', async () => {
  const file = await fetch(url);

  const result = await client.audio.transcriptions.create({ file, model });
  expect(result.text).toBeSimilarTo(correctAnswer, 12);
});

const fineTune = `{"prompt": "<prompt text>", "completion": "<ideal generated text>"}`;

describe('toFile', () => {
  if (typeof Blob !== 'undefined') {
    it('handles builtin Blob', async () => {
      const result = await client.files.create({
        file: await toFile(
          // @ts-ignore avoid DOM lib for testing purposes
          new Blob([new TextEncoder().encode(fineTune)]),
          'finetune.jsonl',
        ),
        purpose: 'fine-tune',
      });
      expect(result.filename).toEqual('finetune.jsonl');
    });
  }
  it('handles Uint8Array', async () => {
    const result = await client.files.create({
      file: await toFile(new TextEncoder().encode(fineTune), 'finetune.jsonl'),
      purpose: 'fine-tune',
    });
    expect(result.filename).toEqual('finetune.jsonl');
  });
  it('handles ArrayBuffer', async () => {
    const result = await client.files.create({
      file: await toFile(new TextEncoder().encode(fineTune).buffer, 'finetune.jsonl'),
      purpose: 'fine-tune',
    });
    expect(result.filename).toEqual('finetune.jsonl');
  });
  it('handles DataView', async () => {
    const result = await client.files.create({
      file: await toFile(new DataView(new TextEncoder().encode(fineTune).buffer), 'finetune.jsonl'),
      purpose: 'fine-tune',
    });
    expect(result.filename).toEqual('finetune.jsonl');
  });
});

runTests();
