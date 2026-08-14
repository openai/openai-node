import { vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { spawn } from 'node:child_process';
import { EventEmitter, getEventListeners } from 'node:events';
import { PassThrough, Readable, Writable } from 'node:stream';
import { playAudio, recordAudio } from 'openai/helpers/audio';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

const spawnMock = spawn as MockedFunction<typeof spawn>;

function mockFfmpeg() {
  const ffmpeg = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn().mockReturnValue(true),
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
  const ffplay = Object.assign(new EventEmitter(), {
    stdin,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
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
      { stdio: ['ignore', 'pipe', 'ignore'] },
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

  test.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 4_294_967_296])(
    'rejects an invalid timeout (%s) before starting ffmpeg',
    async (timeout) => {
      mockFfmpeg();

      await expect(recordAudio({ timeout })).rejects.toBeInstanceOf(RangeError);
      expect(spawnMock).not.toHaveBeenCalled();
    },
  );

  test('terminates ffmpeg when its external abort signal is triggered', async () => {
    const ffmpeg = mockFfmpeg();
    const controller = new AbortController();
    const recording = recordAudio({ signal: controller.signal });

    controller.abort();
    expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');

    ffmpeg.emit('close', 0);
    await recording;
  });

  test.each([
    ['a successful exit', 0, undefined],
    ['an unsuccessful exit', 2, undefined],
    ['a process error', undefined, new Error('microphone unavailable')],
  ] as const)(
    'removes external and timeout abort listeners after %s',
    async (_description, exitCode, failure) => {
      const ffmpeg = mockFfmpeg();
      const controller = new AbortController();
      const timeoutController = new AbortController();
      vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
      const recording = recordAudio({ signal: controller.signal, timeout: 50 });

      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1);
      expect(getEventListeners(timeoutController.signal, 'abort')).toHaveLength(1);
      expect(ffmpeg.stdout.listenerCount('data')).toBe(1);

      if (failure) {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        ffmpeg.emit('error', failure);
        await expect(recording).rejects.toBe(failure);
      } else {
        ffmpeg.emit('close', exitCode);
        const expectation =
          exitCode === 0
            ? expect(recording).resolves.toBeInstanceOf(File)
            : expect(recording).rejects.toThrow(`ffmpeg process exited with code ${exitCode}`);
        await expectation;
      }

      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
      expect(getEventListeners(timeoutController.signal, 'abort')).toHaveLength(0);
      expect(ffmpeg.stdout.listenerCount('data')).toBe(0);
    },
  );

  test('does not stop ffmpeg when an external signal aborts after recording completes', async () => {
    const ffmpeg = mockFfmpeg();
    const controller = new AbortController();
    const recording = recordAudio({ signal: controller.signal });

    ffmpeg.emit('close', 0);
    await recording;
    controller.abort();

    expect(ffmpeg.kill).not.toHaveBeenCalled();
  });

  test('does not stop ffmpeg when a timeout signal aborts after recording completes', async () => {
    const ffmpeg = mockFfmpeg();
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    const recording = recordAudio({ timeout: 50 });

    ffmpeg.emit('close', 0);
    await recording;
    timeoutController.abort();

    expect(ffmpeg.kill).not.toHaveBeenCalled();
  });

  test('retains captured audio when an intentional abort exits with a nonzero code', async () => {
    const ffmpeg = mockFfmpeg();
    const controller = new AbortController();
    const recording = recordAudio({ signal: controller.signal });

    ffmpeg.stdout.write(Buffer.from('captured before abort'));
    controller.abort();
    ffmpeg.emit('close', 255);

    const file = await recording;
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('captured before abort');
  });

  test('rejects a failed ffmpeg process when abort cannot deliver its termination signal', async () => {
    const ffmpeg = mockFfmpeg();
    ffmpeg.kill.mockReturnValue(false);
    const controller = new AbortController();
    const recording = recordAudio({ signal: controller.signal });

    controller.abort();
    expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');
    ffmpeg.emit('close', 2);

    await expect(recording).rejects.toThrow('ffmpeg process exited with code 2');
  });

  test('immediately stops recording for an already-aborted signal', async () => {
    const ffmpeg = mockFfmpeg();
    const controller = new AbortController();
    controller.abort();

    const recording = recordAudio({ signal: controller.signal });

    expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');
    ffmpeg.emit('close', 255);
    await expect(recording).resolves.toBeInstanceOf(File);
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

  test('retains captured audio when a recording timeout exits with a nonzero code', async () => {
    const ffmpeg = mockFfmpeg();
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    const recording = recordAudio({ timeout: 50 });

    ffmpeg.stdout.write(Buffer.from('captured before timeout'));
    timeoutController.abort();
    ffmpeg.emit('close', 255);

    const file = await recording;
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('captured before timeout');
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

  test('terminates ffmpeg when recording setup fails after it starts', async () => {
    const ffmpeg = mockFfmpeg();
    const failure = new Error('microphone output could not be observed');
    vi.spyOn(ffmpeg.stdout, 'on').mockImplementationOnce(() => {
      throw failure;
    });

    await expect(recordAudio()).rejects.toBe(failure);
    expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');
    expect(ffmpeg.stdout.listenerCount('data')).toBe(0);
  });

  test('rejects an unexpected unsuccessful ffmpeg exit', async () => {
    const ffmpeg = mockFfmpeg();
    const recording = recordAudio();

    ffmpeg.emit('close', 2);

    await expect(recording).rejects.toThrow('ffmpeg process exited with code 2');
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

  test('drains ffplay output without changing its spawn arguments', async () => {
    const { ffplay } = mockFfplay();

    await playAudio(Readable.from(['audio']));

    expect(spawnMock).toHaveBeenCalledWith('ffplay', ['-autoexit', '-nodisp', '-i', 'pipe:0']);
    expect(ffplay.stdout.readableFlowing).toBe(true);
    expect(ffplay.stderr.readableFlowing).toBe(true);
  });

  test('rejects source pipeline failures and stops ffplay', async () => {
    const { ffplay } = mockFfplay();
    const source = new PassThrough();
    const failure = new Error('audio source failed');
    const playback = playAudio(source);

    source.destroy(failure);

    await expect(playback).rejects.toBe(failure);
    expect(ffplay.kill).toHaveBeenCalledTimes(1);
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

  test('rejects bodyless responses without spawning an ffplay process', async () => {
    const response = new Response(null, { status: 204 });

    await expect(playAudio(response)).rejects.toThrow('Cannot play audio from a response without a body');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test('rejects consumed responses without spawning an ffplay process', async () => {
    const response = new Response('audio');
    await response.arrayBuffer();

    await expect(playAudio(response)).rejects.toThrow('Invalid state: ReadableStream is locked');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test('rejects a File stream failure before spawning an ffplay process', async () => {
    const audio = new File(['audio'], 'audio.wav', { type: 'audio/wav' });
    const failure = new Error('Cannot open audio stream');
    vi.spyOn(audio, 'stream').mockImplementation(() => {
      throw failure;
    });

    await expect(playAudio(audio)).rejects.toBe(failure);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test('rejects asynchronous ffplay process errors', async () => {
    const { ffplay } = mockFfplay();
    const source = new PassThrough();
    const playback = playAudio(source);
    const failure = new Error('ffplay was not found');

    expect(ffplay.listenerCount('error')).toBe(1);
    ffplay.emit('error', failure);

    await expect(playback).rejects.toBe(failure);
    source.end();
  });
});
