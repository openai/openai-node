import { once } from 'node:events';
import { createServer } from 'node:http';
import { arrayBuffer } from 'node:stream/consumers';

import OpenAI, { toFile } from 'openai';
import { expect, test } from 'vitest';

test.each([
  ['report%20name.txt', 'report name.txt'],
  ['r%C3%A9sum%C3%A9.txt', 'résumé.txt'],
])('preserves the downloaded filename %s over HTTP', async (path, expected) => {
  const received: { name: string; contents: string }[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('contents');
      return;
    }
    try {
      const form = await new Response(await arrayBuffer(request), {
        headers: { 'content-type': request.headers['content-type'] ?? '' },
      }).formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        throw new Error('Expected an uploaded file');
      }
      received.push({ name: file.name, contents: await file.text() });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'file-local',
          object: 'file',
          bytes: file.size,
          created_at: 0,
          filename: file.name,
          purpose: 'assistants',
        }),
      );
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end(String(error));
    }
  });

  try {
    const listening = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await listening;
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a loopback TCP address');
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const url = `${origin}/${path}?download=1`;
    const converted = await toFile(await fetch(url));
    const client = new OpenAI({
      apiKey: 'synthetic-upload-test-key',
      organization: null,
      project: null,
      baseURL: `${origin}/v1`,
      maxRetries: 0,
      timeout: 5000,
      logLevel: 'off',
    });
    const uploaded = await client.files.create({ file: await fetch(url), purpose: 'assistants' });

    expect(converted.name).toBe(expected);
    await expect(converted.text()).resolves.toBe('contents');
    expect(uploaded.filename).toBe(expected);
    expect(received).toEqual([{ name: expected, contents: 'contents' }]);
  } finally {
    if (server.listening) {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    }
  }
});
