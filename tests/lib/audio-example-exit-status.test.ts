import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const audio = Buffer.from('synthetic audio bytes');
const transcript = 'synthetic audio transcript';
const failure = { message: 'synthetic audio API rejection', type: 'invalid_request_error' };
const audioTool = [
  '#!/usr/bin/env node',
  "const fs = require('node:fs');",
  "const tool = require('node:path').basename(process.argv[1]);",
  "const failed = process.env.AUDIO_TOOL_FAILURE === 'true';",
  "if (tool === 'ffmpeg') {",
  '  fs.writeFileSync(process.env.AUDIO_TRACE, JSON.stringify({ tool }));',
  '  if (failed) process.exitCode = 47;',
  "  else process.stdout.write(Buffer.from(process.env.AUDIO_BYTES, 'hex'));",
  '} else {',
  '  const chunks = [];',
  "  process.stdin.on('data', (chunk) => chunks.push(chunk));",
  "  process.stdin.on('end', () => {",
  "    fs.writeFileSync(process.env.AUDIO_TRACE, JSON.stringify({ tool, audio: Buffer.concat(chunks).toString('hex') }));",
  '    process.exitCode = failed ? 47 : 0;',
  '  });',
  '}',
  '',
].join('\n');

async function runExample(directory: string, example: string, baseURL: string, toolFailure: boolean) {
  const child = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/ts-node/dist/bin.js'),
      '-r',
      path.join(root, 'node_modules/tsconfig-paths/register.js'),
      path.join(root, 'examples/audio', `${example}.ts`),
    ],
    {
      cwd: directory,
      env: {
        PATH: `${path.join(directory, 'bin')}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env['PATH'] ?? ''}`,
        OPENAI_API_KEY: 'synthetic-audio-example-key',
        OPENAI_BASE_URL: baseURL,
        OPENAI_LOG: 'off',
        NO_PROXY: '127.0.0.1',
        no_proxy: '127.0.0.1',
        DISABLE_V8_COMPILE_CACHE: '1',
        TS_NODE_PROJECT: path.join(root, 'tsconfig.json'),
        TS_NODE_TRANSPILE_ONLY: 'true',
        AUDIO_TRACE: path.join(directory, 'tool.json'),
        AUDIO_BYTES: audio.toString('hex'),
        AUDIO_TOOL_FAILURE: String(toolFailure),
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

// The synthetic executables use Unix shebangs; no real audio hardware is used.
const describeOnUnix = process.platform === 'win32' ? describe.skip : describe;
describeOnUnix('audio executable examples', () => {
  test.each([
    { example: 'text-to-speech', scenario: 'HTTP rejection' },
    { example: 'text-to-speech', scenario: 'tool failure' },
    { example: 'text-to-speech', scenario: 'success' },
    { example: 'speech-to-text', scenario: 'HTTP rejection' },
    { example: 'speech-to-text', scenario: 'tool failure' },
    { example: 'speech-to-text', scenario: 'success' },
  ])('reports $example $scenario', async ({ example, scenario }) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'openai-audio-example-'));
    const recording = example === 'speech-to-text';
    const requests: {
      method: string | undefined;
      url: string | undefined;
      authorization: string | undefined;
      body: Buffer;
    }[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requests.push({
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
          body: Buffer.concat(chunks),
        });
        if (scenario === 'HTTP rejection') {
          response.writeHead(400, { 'content-type': 'application/json', connection: 'close' });
          response.end(JSON.stringify({ error: failure }));
        } else if (recording) {
          response.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
          response.end(JSON.stringify({ text: transcript }));
        } else {
          response.writeHead(200, { 'content-type': 'audio/mpeg', connection: 'close' });
          response.end(audio);
        }
      });
    });

    try {
      await mkdir(path.join(directory, 'bin'));
      await Promise.all(
        ['ffmpeg', 'ffplay'].map((tool) =>
          writeFile(path.join(directory, 'bin', tool), audioTool, { mode: 0o755 }),
        ),
      );
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected a loopback HTTP address');
      }
      const result = await runExample(
        directory,
        example,
        `http://127.0.0.1:${address.port}/v1`,
        scenario === 'tool failure',
      );

      expect(result.signal).toBeNull();
      expect(result.stdout + result.stderr).not.toContain('synthetic-audio-example-key');
      if (recording && scenario === 'tool failure') {
        expect(requests).toEqual([]);
      } else {
        expect(requests.map(({ body: _body, ...request }) => request)).toEqual([
          {
            method: 'POST',
            url: recording ? '/v1/audio/transcriptions' : '/v1/audio/speech',
            authorization: 'Bearer synthetic-audio-example-key',
          },
        ]);
        if (recording) {
          expect(requests[0]?.body.includes(audio)).toBe(true);
          expect(requests[0]?.body.toString()).toContain('filename="audio.wav"');
        }
      }
      const trace = path.join(directory, 'tool.json');
      if (!recording && scenario === 'HTTP rejection') {
        expect(existsSync(trace)).toBe(false);
      } else {
        expect(JSON.parse(await readFile(trace, 'utf-8'))).toEqual(
          recording ? { tool: 'ffmpeg' } : { tool: 'ffplay', audio: audio.toString('hex') },
        );
      }
      if (scenario === 'success') {
        expect(result.stderr).toBe('');
        if (recording) {
          expect(result.stdout).toContain(transcript);
        }
        expect(result.code).toBe(0);
      } else {
        expect(result.stderr).toContain(
          scenario === 'HTTP rejection'
            ? failure.message
            : `${recording ? 'ffmpeg' : 'ffplay'} process exited with code 47`,
        );
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
  });
});
