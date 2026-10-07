import { once } from 'node:events';
import { createServer } from 'node:http';
import { arrayBuffer } from 'node:stream/consumers';
import { promisify } from 'node:util';
import OpenAI, { toFile } from 'openai';
import { afterAll, beforeAll, expect, test } from 'vitest';

const contents = 'synthetic download\n';
const server = createServer(async (request, response) => {
  if (request.method === 'GET') {
    response.end(contents);
    return;
  }
  try {
    const body = await arrayBuffer(request);
    const multipart = new Response(body, {
      headers: { 'content-type': request.headers['content-type'] ?? '' },
    });
    const form = await multipart.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new Error('Missing file');
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ filename: file.name, contents: await file.text() }));
  } catch {
    response.writeHead(500).end('Invalid test upload');
  }
});
let origin: string;

beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing test server address');
  }
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await promisify(server.close.bind(server))();
});

test.each([
  ['monthly%20notes.txt', 'monthly notes.txt'],
  ['caf%C3%A9.txt', 'café.txt'],
  ['a+b.txt', 'a+b.txt'],
  ['literal%2520.txt', 'literal%20.txt'],
  ['dir%2Fleaf.txt', 'leaf.txt'],
  ['dir%5Cleaf.txt', 'leaf.txt'],
  ['dir%2F', 'unknown_file'],
  ['bad%FF%20name.txt', 'bad%FF%20name.txt'],
  ['bad%escape.txt', 'bad%escape.txt'],
  ['a%00%01%7Fb.txt', 'a%00%01%7Fb.txt'],
  ['a%20b%00.txt', 'a b%00.txt'],
])('infers %s consistently for conversion and upload', async (path, expected) => {
  const url = `${origin}/downloads/${path}?ignored=other.txt`;
  const file = await toFile(await fetch(url));
  expect(file.name).toBe(expected);
  await expect(file.text()).resolves.toBe(contents);

  const client = new OpenAI({
    apiKey: 'synthetic',
    organization: null,
    project: null,
    baseURL: origin,
    maxRetries: 0,
  });
  const result = await client.files.create({ purpose: 'assistants', file: await fetch(url) });
  expect(result).toEqual({ filename: expected, contents });

  const explicit = await toFile(await fetch(url), 'literal%20name.txt');
  expect(explicit.name).toBe('literal%20name.txt');
});
