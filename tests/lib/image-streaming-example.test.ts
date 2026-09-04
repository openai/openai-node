import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const partialImage = Buffer.from('synthetic partial image');
const finalImage = Buffer.from('synthetic final image');
const failure = { message: 'synthetic image failure', type: 'invalid_request_error', code: 'image_failure' };

async function runExample(directory: string, baseURL: string) {
  const child = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/ts-node/dist/bin.js'),
      '--swc',
      '-r',
      path.join(root, 'node_modules/tsconfig-paths/register.js'),
      path.join(root, 'examples/images/image-stream.ts'),
    ],
    {
      cwd: directory,
      env: {
        PATH: process.env['PATH'],
        SystemRoot: process.env['SystemRoot'],
        OPENAI_API_KEY: 'synthetic-image-example-key',
        OPENAI_BASE_URL: baseURL,
        OPENAI_LOG: 'off',
        NO_PROXY: '127.0.0.1',
        no_proxy: '127.0.0.1',
        DISABLE_V8_COMPILE_CACHE: '1',
        TS_NODE_PROJECT: path.join(root, 'tsconfig.json'),
        TS_NODE_TRANSPILE_ONLY: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf-8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf-8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  try {
    const [code, signal] = await once(child, 'close');
    return { code, signal, stdout, stderr };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }
}

describe('image-streaming executable example', () => {
  test.each(['HTTP rejection', 'SSE error', 'output write failure', 'success'] as const)(
    'reports the process result for %s',
    async (scenario) => {
      const directory = await mkdtemp(path.join(tmpdir(), 'openai-image-stream-example-'));
      const requests: {
        method: string | undefined;
        url: string | undefined;
        authorization: string | undefined;
      }[] = [];
      const server = createServer((request, response) => {
        request.resume();
        requests.push({
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
        });
        if (scenario === 'HTTP rejection') {
          response.writeHead(400, { 'content-type': 'application/json', connection: 'close' });
          response.end(JSON.stringify({ error: failure }));
          return;
        }

        response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
        response.write(
          `data: ${JSON.stringify({
            type: 'image_generation.partial_image',
            partial_image_index: 0,
            b64_json: partialImage.toString('base64'),
          })}\n\n`,
        );
        response.end(
          scenario === 'SSE error'
            ? `event: error\ndata: ${JSON.stringify({ error: failure })}\n\n`
            : `data: ${JSON.stringify({
                type: 'image_generation.completed',
                b64_json: finalImage.toString('base64'),
              })}\n\n`,
        );
      });

      try {
        if (scenario === 'output write failure') {
          await mkdir(path.join(directory, 'final_image.png'));
        }
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('Expected a loopback HTTP address');
        }
        const result = await runExample(directory, `http://127.0.0.1:${address.port}/v1`);

        expect(result.signal).toBeNull();
        expect(requests).toEqual([
          {
            method: 'POST',
            url: '/v1/images/generations',
            authorization: 'Bearer synthetic-image-example-key',
          },
        ]);
        if (scenario === 'HTTP rejection') {
          expect(await readdir(directory)).toEqual([]);
        } else {
          expect(await readFile(path.join(directory, 'partial_1.png'))).toEqual(partialImage);
        }
        if (scenario === 'success') {
          expect(await readFile(path.join(directory, 'final_image.png'))).toEqual(finalImage);
          expect(result.stdout).toContain('Saved to:');
          expect(result.stderr).toBe('');
          expect(result.code).toBe(0);
        } else {
          expect(result.stderr).toContain('Error generating image:');
          expect(result.stderr).toContain(
            scenario === 'output write failure' ? 'final_image.png' : failure.message,
          );
          if (scenario === 'output write failure') {
            const output = await stat(path.join(directory, 'final_image.png'));
            expect(output.isDirectory()).toBe(true);
          } else if (scenario === 'SSE error') {
            expect(await readdir(directory)).toEqual(['partial_1.png']);
          }
          expect(result.code).toBe(1);
        }
      } finally {
        try {
          if (server.listening) {
            const closed = once(server, 'close');
            server.close();
            server.closeAllConnections();
            await closed;
          }
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }
    },
  );
});
