import { ChildProcess, spawn } from 'node:child_process';
import type * as ChildProcessModule from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { recordAudio } from 'openai/helpers/audio';

const runtime = vi.hoisted(() => ({ platform: 'linux' }));
vi.mock('node:process', () => ({
  get platform() {
    return runtime.platform;
  },
  versions: process.versions,
}));
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
  { platform: 'win32', provider: 'dshow', prefix: ':' },
])('recordAudio device arguments on $platform', ({ platform, provider, prefix }) => {
  test.each([undefined, 0, 3])('uses the provider-specific input for device %s', async (device) => {
    runtime.platform = platform;
    const output = Buffer.from('synthetic audio');
    const ffmpeg = Object.assign(new ChildProcess(), {
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
