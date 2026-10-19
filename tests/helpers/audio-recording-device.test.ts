import { ChildProcess, spawn } from 'node:child_process';
import type * as ChildProcessModule from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { recordAudio } from 'openai/helpers/audio';

const runtime = vi.hoisted(() => ({ platform: 'linux' }));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Exercise OS-specific ffmpeg arguments from one host without changing the public audio helper API.
vi.mock('node:process', () => ({
  get platform() {
    return runtime.platform;
  },
  versions: process.versions,
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Capture platform-specific ffmpeg arguments without launching a microphone capture process.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  spawn: vi.fn(),
}));

afterEach(() => {
  vi.mocked(spawn).mockReset();
});

describe.each([
  { platform: 'linux', provider: 'alsa', prefix: 'hw:' },
  { platform: 'darwin', provider: 'avfoundation', prefix: ':' },
])('recordAudio device arguments on $platform', ({ platform, provider, prefix }) => {
  test.each([undefined, 0, 3])('uses the provider-specific input for device %s', async (device) => {
    runtime.platform = platform;
    const output = Buffer.from('synthetic audio');
    const ffmpeg = Object.assign(new ChildProcess(), {
      pid: 123,
      stdout: new PassThrough(),
      kill: vi.fn(),
    });
    vi.mocked(spawn).mockReturnValue(ffmpeg);

    const recording = recordAudio(device === undefined ? {} : { device });
    ffmpeg.stdout.end(output);
    ffmpeg.emit('close', 0);

    const file = await recording;
    expect(vi.mocked(spawn).mock.calls).toEqual([
      [
        'ffmpeg',
        ['-f', provider, '-i', `${prefix}${device ?? 0}`, '-ar', '24000', '-ac', '1', '-f', 'wav', 'pipe:1'],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      ],
    ]);
    expect(file.name).toBe('audio.wav');
    expect(file.type).toBe('audio/wav');
    expect(Buffer.from(await file.arrayBuffer())).toEqual(output);
  });
});

describe.each([
  { platform: 'linux', provider: 'alsa', device: 'hw:USB,0', input: 'hw:USB,0' },
  { platform: 'linux', provider: 'alsa', device: 'default', input: 'default' },
  { platform: 'darwin', provider: 'avfoundation', device: 'USB Microphone', input: ':USB Microphone' },
  { platform: 'win32', provider: 'dshow', device: 'USB Microphone', input: 'audio=USB Microphone' },
  { platform: 'cygwin', provider: 'dshow', device: 'USB Microphone', input: 'audio=USB Microphone' },
  {
    platform: 'win32',
    provider: 'dshow',
    device: ' Microphone (USB Audio) ',
    input: 'audio= Microphone (USB Audio) ',
  },
])('recordAudio named device on $platform', ({ platform, provider, device, input }) => {
  test('passes the device name as one provider-specific argument', async () => {
    runtime.platform = platform;
    const ffmpeg = Object.assign(new ChildProcess(), { pid: 123, stdout: new PassThrough(), kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(ffmpeg);

    const recording = recordAudio({ device });
    ffmpeg.stdout.end('synthetic audio');
    ffmpeg.emit('close', 0);

    const file = await recording;
    expect(await file.text()).toBe('synthetic audio');
    expect(vi.mocked(spawn).mock.calls).toEqual([
      [
        'ffmpeg',
        ['-f', provider, '-i', input, '-ar', '24000', '-ac', '1', '-f', 'wav', 'pipe:1'],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      ],
    ]);
  });
});

describe.each(['win32', 'cygwin'])('recordAudio device validation on %s', (platform) => {
  test.each([undefined, 0, 3, '', '   '])('rejects device %s before starting ffmpeg', async (device) => {
    runtime.platform = platform;
    const ffmpeg = Object.assign(new ChildProcess(), { pid: 123, stdout: new PassThrough(), kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(ffmpeg);

    const recording = recordAudio(device === undefined ? {} : { device });
    ffmpeg.emit('close', 0);

    await expect(recording).rejects.toThrow('Windows recording requires an audio device name');
    expect(spawn).not.toHaveBeenCalled();
  });
});
