import { vi, type MockedFunction } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable, Writable } from 'node:stream';
import { playAudio, recordAudio } from 'openai/helpers/audio';

const spawnMock = spawn as MockedFunction<typeof spawn>;

function mockFfmpeg() {
  const ffmpeg = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  spawnMock.mockReturnValue(ffmpeg as any);
  return ffmpeg;
}

function mockFfplay(exitCode = 0) {
  const chunks: Buffer[] = [];
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  const ffplay = Object.assign(new EventEmitter(), { stdin, kill: vi.fn() });
  stdin.on('finish', () => ffplay.emit('close', exitCode));
  spawnMock.mockReturnValue(ffplay as any);
  return { chunks, ffplay };
}

afterEach(() => {
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

describe('recordAudio', () => {
  test('collects ffmpeg output into a WAV File', async () => {
    const ffmpeg = mockFfmpeg();
    const recording = recordAudio();

    ffmpeg.stdout.write(Buffer.from('first'));
    ffmpeg.stdout.write(Buffer.from(' second'));
    ffmpeg.emit('close', 0);

    const file = await recording;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('audio.wav');
    expect(file.type).toBe('audio/wav');
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('first second');
    expect(spawnMock).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-i', ':0', '-ar', '24000', '-ac', '1', '-f', 'wav', 'pipe:1']),
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  });

  test('uses the requested audio input device', async () => {
    const ffmpeg = mockFfmpeg();
    const recording = recordAudio({ device: 3 });
    ffmpeg.emit('close', 0);

    await recording;

    expect(spawnMock).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-i', ':3']),
      expect.any(Object),
    );
  });

  test('terminates ffmpeg when its external abort signal is triggered', async () => {
    const ffmpeg = mockFfmpeg();
    const controller = new AbortController();
    const recording = recordAudio({ signal: controller.signal });

    controller.abort();
    expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');

    ffmpeg.emit('close', 0);
    await recording;
  });

  test('terminates ffmpeg when the configured timeout expires', async () => {
    const ffmpeg = mockFfmpeg();
    const timeoutController = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    const recording = recordAudio({ timeout: 50 });

    expect(timeout).toHaveBeenCalledWith(50);
    timeoutController.abort();
    expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');

    ffmpeg.emit('close', 0);
    await recording;
  });

  test.each([0, -10])('does not install a timeout for %i milliseconds', async (timeout) => {
    const ffmpeg = mockFfmpeg();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const recording = recordAudio({ timeout });
    ffmpeg.emit('close', 0);

    await recording;

    expect(timeoutSpy).not.toHaveBeenCalled();
  });

  test('reports ffmpeg process errors', async () => {
    const ffmpeg = mockFfmpeg();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('microphone unavailable');
    const recording = recordAudio();

    ffmpeg.emit('error', failure);

    await expect(recording).rejects.toBe(failure);
    expect(consoleError).toHaveBeenCalledWith(failure);
  });

  test('reports synchronous ffmpeg startup failures', async () => {
    spawnMock.mockImplementation(() => {
      throw new Error('ffmpeg was not found');
    });

    await expect(recordAudio()).rejects.toThrow('ffmpeg was not found');
  });
});

describe('playAudio input and process errors', () => {
  test('plays File inputs through their readable stream', async () => {
    const { chunks } = mockFfplay();

    await playAudio(new File(['file audio'], 'audio.wav', { type: 'audio/wav' }));

    expect(Buffer.concat(chunks).toString()).toBe('file audio');
  });

  test('plays Node readable stream inputs directly', async () => {
    const { chunks } = mockFfplay();

    await playAudio(Readable.from(['node audio']));

    expect(Buffer.concat(chunks).toString()).toBe('node audio');
  });

  test('rejects unsuccessful ffplay exit codes', async () => {
    mockFfplay(3);

    await expect(playAudio(Readable.from(['audio']))).rejects.toThrow('ffplay process exited with code 3');
  });

  test('rejects synchronous ffplay startup failures', async () => {
    spawnMock.mockImplementation(() => {
      throw new Error('ffplay was not found');
    });

    await expect(playAudio(Readable.from(['audio']))).rejects.toThrow('ffplay was not found');
  });
});
