import { vi } from 'vitest';
import { spawn } from 'node:child_process';
import type * as ChildProcessModule from 'node:child_process';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { playAudio } from 'openai/helpers/audio';

// Keep native child-process pipes without invoking ffplay or accessing audio hardware.
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof ChildProcessModule>();
  return {
    ...original,
    spawn: vi.fn(() =>
      original.spawn(
        process.execPath,
        [
          '-e',
          [
            'const chunks = [];',
            "process.stdin.on('data', (chunk) => chunks.push(chunk));",
            "process.stdin.on('end', () => process.send(Buffer.concat(chunks).toString()));",
            "process.on('message', (code) => process.exit(code));",
          ].join('\n'),
        ],
        { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] },
      ),
    ),
  };
});

const spawnMock = vi.mocked(spawn);
const audio = 'synthetic audio';

function playbackChild() {
  const [result] = spawnMock.mock.results;
  if (result?.type !== 'return') {
    throw new Error('Playback did not start a child process');
  }
  return result.value;
}

afterEach(async () => {
  await Promise.all(
    spawnMock.mock.results.map(async (result) => {
      if (result.type !== 'return') {
        return;
      }
      const child = result.value;
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, 'close');
        child.kill();
        await closed;
      }
    }),
  );
  spawnMock.mockClear();
});

describe('playAudio completion', () => {
  test.each(['success', 'failure'] as const)('waits for input %s after ffplay exits', async (outcome) => {
    let finishInput: ((error?: Error | null) => void) | undefined;
    const source = new Readable({
      read() {
        this.push(audio);
        this.push(null);
      },
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Hold the native destruction callback to control pipeline completion.
      destroy(_error, callback) {
        finishInput = callback;
      },
    });
    let settled = false;
    const playback = playAudio(source);
    void playback.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    try {
      const child = playbackChild();
      const [received] = await once(child, 'message');
      expect(received).toBe(audio);
      const closed = once(child, 'close');
      child.send(0);
      expect(await closed).toEqual([0, null]);
      await nextTurn();
      const settledBeforeInput = settled;
      const failure = outcome === 'failure' ? new Error('input close failed') : undefined;
      expect(finishInput).toBeDefined();
      finishInput?.(failure);
      finishInput = undefined;

      if (failure) {
        await expect(playback).rejects.toBe(failure);
      } else {
        expect(settledBeforeInput).toBe(false);
        await playback;
      }
    } finally {
      finishInput?.();
      source.destroy();
    }
  });

  test('waits for ffplay to close after the input finishes', async () => {
    const source = Readable.from([audio]);
    const inputClosed = once(source, 'close');
    let settled = false;
    const playback = playAudio(source).then(() => {
      settled = true;
    });
    void playback.catch(() => {});
    const child = playbackChild();
    const [received] = await once(child, 'message');
    expect(received).toBe(audio);
    await inputClosed;
    await nextTurn();
    expect(settled).toBe(false);
    child.send(0);
    await playback;
  });

  test('preserves input failures and terminates the child', async () => {
    const failure = new Error('input read failed');
    const source = new Readable({
      read() {
        this.destroy(failure);
      },
    });
    const playback = playAudio(source);
    const closed = once(playbackChild(), 'close');

    await expect(playback).rejects.toBe(failure);
    await closed;
  });

  test('preserves unsuccessful ffplay exits', async () => {
    const playback = playAudio(Readable.from([audio]));
    void playback.catch(() => {});
    const child = playbackChild();
    const [received] = await once(child, 'message');
    expect(received).toBe(audio);
    child.send(47);

    await expect(playback).rejects.toThrow('ffplay process exited with code 47');
  });
});
