import OpenAI, { toFile } from 'openai';
import { TranscriptionCreateParams } from 'openai/resources/audio/transcriptions';
import { ChatCompletion } from 'openai/resources/chat/completions';

/**
 * Tests uploads using various Web API data objects.
 * This is structured to support running these tests on builtins in the environment in
 * Node or Cloudflare workers etc. or on polyfills like from node-fetch/formdata-node
 */
export function uploadWebApiTestCases({
  client,
  it,
  expectEqual,
  expectSimilar,
  runtime = 'node',
}: {
  /**
   * OpenAI client instance
   */
  client: OpenAI;
  /**
   * Jest it() function, or an imitation in envs like Cloudflare workers
   */
  it: (desc: string, handler: () => Promise<void>) => void;
  /**
   * Jest expect(a).toEqual(b) function, or an imitation in envs like Cloudflare workers
   */
  expectEqual(a: unknown, b: unknown): void;
  /**
   * Assert that the levenshtein distance between the two given strings is less than the given max distance.
   */
  expectSimilar(received: string, expected: string, maxDistance: number): void;
  runtime?: 'node' | 'edge';
}) {
  const url = 'https://audio-samples.github.io/samples/mp3/blizzard_biased/sample-1.mp3';
  const filename = 'sample-1.mp3';

  const correctAnswer =
    'It was anxious to find him no one that expectation of a man who were giving his father enjoyment. But he was avoided in sight in the minister to which indeed,';
  const model = 'whisper-1';

  async function typeTests() {
    // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
    await client.audio.transcriptions.create({ file: { foo: true }, model: 'whisper-1' });
    // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
    await client.audio.transcriptions.create({ file: null, model: 'whisper-1' });
    // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
    await client.audio.transcriptions.create({ file: 'test', model: 'whisper-1' });
  }

  if (runtime === 'node') {
    it(`raw response`, async function () {
      const response = await client.chat.completions
        .create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Say this is a test' }],
        })
        .asResponse();

      const decoder = new TextDecoder();
      const chunks: string[] = [];

      // We need to cast to any as we're using both node types and web types.
      // This works with the node types but to get this to work with web types
      // we would need to bump `typescript` to ~5.5 and add `DOM.AsyncIterable`
      // to `lib` but we want to test older ts versions
      const body = response.body! as any;
      for await (const chunk of body) {
        chunks.push(decoder.decode(chunk));
      }

      const json: ChatCompletion = JSON.parse(chunks.join(''));
      expectSimilar(json.choices[0]?.message.content || '', 'This is a test', 10);
    });
  } else {
    it(`raw response`, async function () {
      const response = await client.chat.completions
        .create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Say this is a test' }],
        })
        .asResponse();

      // test that we can use web Response API
      const { body } = response;
      if (!body) throw new Error('expected response.body to be defined');

      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let result;
      do {
        result = await reader.read();
        if (!result.done) chunks.push(result.value);
      } while (!result.done);

      reader.releaseLock();

      let offset = 0;
      const merged = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      const json: ChatCompletion = JSON.parse(new TextDecoder().decode(merged));
      expectSimilar(json.choices[0]?.message.content || '', 'This is a test', 10);
    });
  }

  it(`streaming works`, async function () {
    const stream = await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Say this is a test' }],
      stream: true,
    });
    const chunks = [];
    for await (const part of stream) {
      chunks.push(part);
    }
    expectSimilar(chunks.map((c) => c.choices[0]?.delta.content || '').join(''), 'This is a test', 10);
  });

  if (runtime !== 'node') {
    it('handles File', async () => {
      const file = await fetch(url)
        .then((x) => x.arrayBuffer())
        .then((x) => new File([x], filename));

      const params: TranscriptionCreateParams = { file, model };

      const result = await client.audio.transcriptions.create(params);
      expectSimilar(result.text, correctAnswer, 12);
    });

    it('handles Response', async () => {
      const file = await fetch(url);

      const result = await client.audio.transcriptions.create({ file, model });
      expectSimilar(result.text, correctAnswer, 12);
    });
  }

  const fineTune = `{"prompt": "<prompt text>", "completion": "<ideal generated text>"}`;

  it('toFile handles string', async () => {
    // @ts-ignore this only doesn't error in vercel build...
    const file = await toFile(fineTune, 'finetune.jsonl');
    const result = await client.files.create({ file, purpose: 'fine-tune' });
    expectEqual(result.filename, 'finetune.jsonl');
  });
  it('toFile handles Blob', async () => {
    const result = await client.files.create({
      file: await toFile(new Blob([fineTune]), 'finetune.jsonl'),
      purpose: 'fine-tune',
    });
    expectEqual(result.filename, 'finetune.jsonl');
  });
  it('toFile handles Uint8Array', async () => {
    const result = await client.files.create({
      file: await toFile(new TextEncoder().encode(fineTune), 'finetune.jsonl'),
      purpose: 'fine-tune',
    });
    expectEqual(result.filename, 'finetune.jsonl');
  });
  it('toFile handles ArrayBuffer', async () => {
    const result = await client.files.create({
      file: await toFile(new TextEncoder().encode(fineTune).buffer, 'finetune.jsonl'),
      purpose: 'fine-tune',
    });
    expectEqual(result.filename, 'finetune.jsonl');
  });
  if (runtime !== 'edge') {
    // this fails in edge for some reason
    it('toFile handles DataView', async () => {
      const result = await client.files.create({
        file: await toFile(new DataView(new TextEncoder().encode(fineTune).buffer), 'finetune.jsonl'),
        purpose: 'fine-tune',
      });
      expectEqual(result.filename, 'finetune.jsonl');
    });
  }
}
