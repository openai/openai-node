jest.mock('node:child_process', () => ({ spawn: jest.fn() }));

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable, Writable } from 'node:stream';
import { playAudio, recordAudio } from 'openai/helpers/audio';

const spawnMock = spawn as jest.MockedFunction<typeof spawn>;

function mockFfmpeg() {
  const ffmpeg = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: jest.fn(() => true),
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
  const ffplay = Object.assign(new EventEmitter(), { stdin, kill: jest.fn() });
  stdin.on('finish', () => ffplay.emit('close', exitCode));
  spawnMock.mockReturnValue(ffplay as any);
  return { chunks, ffplay };
}

afterEach(() => {
  jest.restoreAllMocks();
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

    ffmpeg.emit('close', 255);
    await recording;
  });

  test('terminates ffmpeg when the configured timeout expires', async () => {
    const ffmpeg = mockFfmpeg();
    const timeoutController = new AbortController();
    const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    const recording = recordAudio({ timeout: 50 });

    expect(timeout).toHaveBeenCalledWith(50);
    timeoutController.abort();
    expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');

    ffmpeg.emit('close', 255);
    await recording;
  });

  test('reports an exit failure that happens before an abort signal', async () => {
    const ffmpeg = mockFfmpeg();
    const controller = new AbortController();
    const recording = recordAudio({ signal: controller.signal });

    ffmpeg.exitCode = 3;
    controller.abort();
    ffmpeg.emit('close', 3);

    expect(ffmpeg.kill).not.toHaveBeenCalled();
    await expect(recording).rejects.toThrow('ffmpeg process exited with code 3');
  });

  test('reports an exit failure if ffmpeg could not be terminated', async () => {
    const ffmpeg = mockFfmpeg();
    ffmpeg.kill.mockReturnValue(false);
    const controller = new AbortController();
    const recording = recordAudio({ signal: controller.signal });

    controller.abort();
    ffmpeg.emit('close', 255);

    expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');
    await expect(recording).rejects.toThrow('ffmpeg process exited with code 255');
  });

  test.each([0, -10])('does not install a timeout for %i milliseconds', async (timeout) => {
    const ffmpeg = mockFfmpeg();
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    const recording = recordAudio({ timeout });
    ffmpeg.emit('close', 0);

    await recording;

    expect(timeoutSpy).not.toHaveBeenCalled();
  });

  test('reports ffmpeg process errors', async () => {
    const ffmpeg = mockFfmpeg();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('microphone unavailable');
    const recording = recordAudio();

    ffmpeg.emit('error', failure);

    await expect(recording).rejects.toBe(failure);
    expect(consoleError).toHaveBeenCalledWith(failure);
  });

  test('rejects unsuccessful ffmpeg exit codes', async () => {
    const ffmpeg = mockFfmpeg();
    const recording = recordAudio();

    ffmpeg.stdout.write(Buffer.from('partial audio'));
    ffmpeg.emit('close', 3);

    await expect(recording).rejects.toThrow('ffmpeg process exited with code 3');
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
