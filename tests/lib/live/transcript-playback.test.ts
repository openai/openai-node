import type { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playAudio } from 'openai/helpers/audio';
import { createPCMPlayback } from '../../../examples/live/transcript-playback';

vi.mock('openai/helpers/audio', () => ({ playAudio: vi.fn() }));

const chunks: Buffer[] = [];
let source: PassThrough | undefined;

beforeEach(() => {
  chunks.length = 0;
  source = undefined;
  vi.mocked(playAudio).mockReset();
  vi.mocked(playAudio).mockImplementation(async (input) => {
    source = input as PassThrough;
    for await (const chunk of source) {
      chunks.push(chunk);
    }
  });
});

describe('Live example PCM playback', () => {
  it('streams a mono 24 kHz WAV header and unchanged PCM through the existing helper', async () => {
    const playback = createPCMPlayback();
    const pcm = Buffer.from([0, 0, 255, 127]);
    playback.write(pcm);
    await vi.waitFor(() => expect(chunks.length).toBeGreaterThan(0));
    expect(source?.readableEnded).toBe(false);
    await playback.finish();

    const audio = Buffer.concat(chunks);
    expect(audio.toString('ascii', 0, 4)).toBe('RIFF');
    expect(audio.readUInt32LE(4)).toBe(0xff_ff_ff_ff);
    expect(audio.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(audio.readUInt32LE(16)).toBe(16);
    expect(audio.readUInt16LE(20)).toBe(1);
    expect(audio.readUInt16LE(22)).toBe(1);
    expect(audio.readUInt32LE(24)).toBe(24_000);
    expect(audio.readUInt32LE(28)).toBe(48_000);
    expect(audio.readUInt16LE(32)).toBe(2);
    expect(audio.readUInt16LE(34)).toBe(16);
    expect(audio.toString('ascii', 36, 40)).toBe('data');
    expect(audio.readUInt32LE(40)).toBe(0xff_ff_ff_ff);
    expect(audio.subarray(44)).toEqual(pcm);
    expect(playAudio).toHaveBeenCalledTimes(1);
    expect(() => playback.write(pcm)).toThrow('after closing');
    await playback.close();
  });

  it('destroys an unfinished stream on teardown and allows repeated close', async () => {
    const playback = createPCMPlayback();
    await playback.close();
    await playback.close();
    expect(source?.destroyed).toBe(true);
    expect(() => playback.write(Buffer.alloc(2))).toThrow();
  });

  it('handles a missing or failed player immediately and reports it on write and finish', async () => {
    const error = new Error('ffplay was not found');
    vi.mocked(playAudio).mockRejectedValueOnce(error);
    const playback = createPCMPlayback();
    await Promise.resolve();
    expect(() => playback.write(Buffer.alloc(2))).toThrow(error);
    await expect(playback.finish()).rejects.toBe(error);
    await playback.close();
  });
});
