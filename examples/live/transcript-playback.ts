import { PassThrough } from 'node:stream';
import { playAudio } from 'openai/helpers/audio';

/** Play the demo's mono, 24 kHz, 16-bit PCM using the SDK's existing ffplay helper. */
export function createPCMPlayback() {
  // A streaming WAV header lets playAudio recognize raw Live/TTS PCM. The
  // unknown lengths are resolved by EOF, so playback can start before completion.
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(0xff_ff_ff_ff, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24_000, 24);
  header.writeUInt32LE(48_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(0xff_ff_ff_ff, 40);

  const stream = new PassThrough();
  stream.write(header);
  let failure: Error | undefined;
  // Attach rejection handling immediately, including when ffplay is missing.
  const finished = (async () => {
    try {
      await playAudio(stream);
    } catch (error) {
      failure = error instanceof Error ? error : new Error('Audio playback failed');
      stream.destroy();
    }
  })();

  return {
    /** Queue a PCM chunk without blocking the duplex transport. */
    write(pcm: Buffer): void {
      if (failure) {
        throw failure;
      }
      if (stream.destroyed || stream.writableEnded) {
        throw new Error('Cannot write audio after closing playback');
      }
      stream.write(pcm);
    },
    /** Finish queued audio and wait for the player to exit. */
    async finish(): Promise<void> {
      stream.end();
      await finished;
      if (failure) {
        throw failure;
      }
    },
    /** Stop playback on teardown, including after a failed Live session. */
    async close(): Promise<void> {
      stream.destroy();
      await finished;
    },
  };
}
