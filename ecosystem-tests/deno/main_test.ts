import { assertEquals } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import OpenAI, { toFile } from 'npm:openai@3.3.0';

const url = 'https://audio-samples.github.io/samples/mp3/blizzard_biased/sample-1.mp3';
const filename = 'sample-1.mp3';

const correctAnswer =
  'It was anxious to find him no one that expectation of a man who were giving his father enjoyment. But he was avoided in sight in the minister to which indeed,';
const model = 'whisper-1';

const client = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });

Deno.test(async function handlesFile() {
  const file = await fetch(url)
    .then((x) => x.arrayBuffer())
    .then((x) => new File([x], filename));

  const result = await client.audio.transcriptions.create({ file, model });
  assertEquals(result.text, correctAnswer);
});
Deno.test(async function handlesResponse() {
  const file = await fetch(url);

  const result = await client.audio.transcriptions.create({ file, model });
  assertEquals(result.text, correctAnswer);
});

const fineTune = `{"prompt": "<prompt text>", "completion": "<ideal generated text>"}`;

Deno.test(async function toFileHandlesBlob() {
  const result = await client.files.create({
    file: await toFile(new Blob([fineTune]), 'finetune.jsonl'),
    purpose: 'fine-tune',
  });
  assertEquals(result.status, 'uploaded');
});
Deno.test(async function toFileHandlesUint8Array() {
  const result = await client.files.create({
    file: await toFile(new TextEncoder().encode(fineTune), 'finetune.jsonl'),
    purpose: 'fine-tune',
  });
  assertEquals(result.status, 'uploaded');
});
Deno.test(async function toFileHandlesArrayBuffer() {
  const result = await client.files.create({
    file: await toFile(new TextEncoder().encode(fineTune).buffer, 'finetune.jsonl'),
    purpose: 'fine-tune',
  });
  assertEquals(result.status, 'uploaded');
});
Deno.test(async function toFileHandlesDataView() {
  const result = await client.files.create({
    file: await toFile(new DataView(new TextEncoder().encode(fineTune).buffer), 'finetune.json'),
    purpose: 'fine-tune',
  });
  assertEquals(result.status, 'uploaded');
});
