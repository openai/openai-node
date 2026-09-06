import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const root = process.cwd();
const probe = String.raw`
const childProcess = require('node:child_process');
const { getEventListeners } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const scenario = process.env.AUDIO_SCENARIO;
let receivedSigterms = 0;
const kills = [];
process.on('SIGTERM', () => { receivedSigterms += 1; });
console.error = () => {};
if (scenario.startsWith('synthetic')) {
  const nativeSpawn = childProcess.spawn;
  childProcess.spawn = (command, args, options) => {
    if (command !== 'ffmpeg') throw new Error('Unexpected recording command');
    const child = nativeSpawn(process.execPath, ['-e', 'process.stdout.write("synthetic WAV bytes")'], options);
    const nativeKill = child.kill;
    child.kill = function(signal) {
      kills.push({ pid: this.pid, signal });
      return nativeKill.call(this, signal);
    };
    return child;
  };
}
const { recordAudio } = require('openai/helpers/audio');
const caller = new AbortController();
if (scenario.includes('pre-aborted')) caller.abort();
if (scenario === 'setup failure') {
  Object.defineProperty(caller.signal, 'addEventListener', {
    value() { throw new Error('synthetic caller-listener setup failure'); },
  });
}
(async () => {
  let outcome;
  try {
    const file = await recordAudio({ signal: caller.signal });
    outcome = { name: file.name, type: file.type, content: await file.text() };
  } catch (error) {
    outcome = { code: error.code, message: error.message };
  }
  // Give any incorrectly sent process-group signal time to reach this owned wrapper.
  await delay(50);
  console.log(JSON.stringify({ receivedSigterms, listeners: getEventListeners(caller.signal, 'abort').length, kills, outcome }));
})().catch(error => { console.error(error); process.exitCode = 1; });
`;

async function runRecorder(emptyPath: string, scenario: string) {
  const child = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/ts-node/dist/bin.js'),
      '--swc',
      '-r',
      path.join(root, 'node_modules/tsconfig-paths/register.js'),
      '-e',
      probe,
    ],
    {
      // A failed-spawn kill must never reach the test runner's process group.
      detached: true,
      cwd: root,
      env: {
        PATH: emptyPath,
        AUDIO_SCENARIO: scenario,
        TS_NODE_PROJECT: path.join(root, 'tsconfig.json'),
        TS_NODE_TRANSPILE_ONLY: 'true',
        DISABLE_V8_COMPILE_CACHE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
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
  const timeout = setTimeout(() => {
    if (child.pid) {
      child.kill('SIGKILL');
    }
  }, 10_000);
  try {
    const [code, signal] = await once(child, 'close');
    return { code, signal, stdout, stderr };
  } finally {
    clearTimeout(timeout);
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
}

const describeOnUnix = process.platform === 'win32' ? describe.skip : describe;
describeOnUnix('recordAudio subprocess ownership', () => {
  test.each([
    'missing ffmpeg',
    'pre-aborted caller',
    'setup failure',
    'synthetic success',
    'synthetic pre-aborted caller',
  ])('preserves its caller process after %s', async (scenario) => {
    const emptyPath = await mkdtemp(path.join(tmpdir(), 'openai-recording-path-'));
    try {
      const result = await runRecorder(emptyPath, scenario);
      expect(result.signal).toBeNull();
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      const recorded = JSON.parse(result.stdout);
      expect(recorded.receivedSigterms).toBe(0);
      expect(recorded.listeners).toBe(0);
      if (scenario.startsWith('synthetic')) {
        expect(recorded.outcome).toMatchObject({
          name: 'audio.wav',
          type: 'audio/wav',
        });
        if (scenario === 'synthetic success') {
          expect(recorded.outcome.content).toBe('synthetic WAV bytes');
          expect(recorded.kills).toEqual([]);
        } else {
          expect(recorded.kills).toHaveLength(1);
          expect(recorded.kills[0].pid).toBeGreaterThan(0);
          expect(recorded.kills[0].signal).toBe('SIGTERM');
        }
      } else if (scenario === 'setup failure') {
        expect(recorded.outcome).toEqual({ message: 'synthetic caller-listener setup failure' });
      } else {
        expect(recorded.outcome).toEqual({ code: 'ENOENT', message: 'spawn ffmpeg ENOENT' });
      }
    } finally {
      await rm(emptyPath, { recursive: true, force: true });
    }
  });
});
