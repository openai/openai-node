import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
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
        NODE_COMPILE_CACHE: process.env['NODE_COMPILE_CACHE'],
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
  test.each([
    ['path traversal', 'images/../../victim', false],
    ['null', null, false],
    ['numeric string', '0', false],
    ['fraction', 0.5, false],
    ['negative', -1, false],
    ['out of range', 3, false],
    ['missing', undefined, false],
    ['boolean', true, false],
    ['object', {}, false],
    ['array', [], false],
    ['first partial', 0, true],
    ['last partial', 2, true],
  ] as const)(
    'validates the partial image index before writing or logging: %s',
    async (_name, index, valid) => {
      const directory = await mkdtemp(path.join(tmpdir(), 'openai-image-stream-index-'));
      const work = path.join(directory, 'work');
      const victim = path.join(directory, 'victim1.png');
      const sentinel = Buffer.from('original sentinel');
      let requestBody = '';
      const server = createServer((request, response) => {
        request.setEncoding('utf-8');
        request.on('data', (chunk: string) => {
          requestBody += chunk;
        });
        request.on('end', () => {
          response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
          response.end(
            [
              {
                type: 'image_generation.partial_image',
                partial_image_index: index,
                b64_json: partialImage.toString('base64'),
              },
              { type: 'image_generation.completed', b64_json: finalImage.toString('base64') },
            ]
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(''),
          );
        });
      });

      try {
        // The vulnerable filename resolves through this directory to the parent sentinel.
        await mkdir(path.join(work, 'partial_images'), { recursive: true });
        await writeFile(victim, sentinel);
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('Expected a loopback HTTP address');
        }
        const result = await runExample(work, `http://127.0.0.1:${address.port}/v1`);

        expect(result.signal).toBeNull();
        expect(JSON.parse(requestBody).partial_images).toBe(3);
        expect(await readFile(victim)).toEqual(sentinel);
        expect(await readdir(path.join(work, 'partial_images'))).toEqual([]);
        if (valid && typeof index === 'number') {
          const filename = `partial_${index + 1}.png`;
          expect(result.code).toBe(0);
          expect(result.stderr).toBe('');
          expect(result.stdout).toContain(`Partial image ${index + 1}/3 received`);
          expect(await readFile(path.join(work, filename))).toEqual(partialImage);
          expect(await readFile(path.join(work, 'final_image.png'))).toEqual(finalImage);
          expect(new Set(await readdir(work))).toEqual(
            new Set(['final_image.png', filename, 'partial_images']),
          );
        } else {
          expect(result.code).toBe(1);
          expect(result.stdout).toBe('');
          expect(result.stderr).toContain('Error generating image: Error: Invalid partial image index.');
          expect(result.stderr).not.toContain('images/../../victim');
          expect(result.stderr).not.toContain(partialImage.toString('base64'));
          expect(result.stderr).not.toContain('synthetic-image-example-key');
          expect(await readdir(work)).toEqual(['partial_images']);
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

  test.each([
    'HTTP rejection',
    'SSE error',
    'output write failure',
    'success',
    'empty EOF',
    'partial-only EOF',
    'completed without partial',
  ] as const)(
    'reports the executable process result, output image files, and diagnostics for %s',
    async (scenario) => {
      const directory = await mkdtemp(path.join(tmpdir(), 'openai-image-stream-example-'));
      const incomplete = scenario === 'empty EOF' || scenario === 'partial-only EOF';
      const hasPartial =
        scenario !== 'HTTP rejection' && scenario !== 'empty EOF' && scenario !== 'completed without partial';
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
        if (hasPartial) {
          response.write(
            `data: ${JSON.stringify({
              type: 'image_generation.partial_image',
              partial_image_index: 0,
              b64_json: partialImage.toString('base64'),
            })}\n\n`,
          );
        }
        if (incomplete) {
          response.end();
          return;
        }
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
        if (scenario === 'HTTP rejection' || scenario === 'empty EOF') {
          expect(await readdir(directory)).toEqual([]);
        } else if (hasPartial) {
          expect(await readFile(path.join(directory, 'partial_1.png'))).toEqual(partialImage);
        } else {
          expect(await readdir(directory)).toEqual(['final_image.png']);
        }
        if (scenario === 'success' || scenario === 'completed without partial') {
          expect(await readFile(path.join(directory, 'final_image.png'))).toEqual(finalImage);
          expect(result.stdout).toContain('Saved to:');
          expect(result.stderr).toBe('');
          expect(result.code).toBe(0);
        } else if (incomplete) {
          expect(result.code).toBe(1);
          expect(result.stderr).toContain('Error generating image:');
          expect(result.stderr).toContain('Image stream ended without a final image.');
          expect(await readdir(directory)).toEqual(hasPartial ? ['partial_1.png'] : []);
          expect(result.stdout + result.stderr).not.toContain(partialImage.toString('base64'));
          expect(result.stdout + result.stderr).not.toContain(finalImage.toString('base64'));
          expect(result.stdout + result.stderr).not.toContain('synthetic-image-example-key');
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
