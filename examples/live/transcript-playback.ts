import { spawn } from 'node:child_process';

/** Play the demo's mono, 24 kHz, 16-bit PCM and retain the child for cancellation. */
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

  // We own the child so close() can stop queued playback even after its input has ended.
  const player = spawn('ffplay', ['-autoexit', '-nodisp', '-i', 'pipe:0']);
  player.stdout.resume();
  player.stderr.resume();
  const stream = player.stdin;
  let failure: Error | undefined;
  // Record failures immediately and settle only when the child has exited.
  // oxlint-disable-next-line promise/avoid-new -- Await child close even after spawn or stdin errors, so cleanup never leaves a player running.
  const finished = new Promise<void>((resolve) => {
    player.once('error', (error) => {
      failure ??= error;
    });
    stream.once('error', (error) => {
      failure ??= error;
      player.kill();
    });
    player.once('close', (code) => {
      if (code !== 0) {
        failure ??= new Error(`ffplay process exited with code ${code}`);
      }
      resolve();
    });
  });
  stream.write(header);

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
      player.kill();
      await finished;
    },
  };
}
