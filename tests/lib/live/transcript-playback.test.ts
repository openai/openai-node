import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createPCMPlayback } from '../../../examples/live/transcript-playback';

it.each(['before-eof', 'after-eof', 'complete', 'missing', 'nonzero'])(
  'handles %s playback without leaving a child running',
  async (stage) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'transcript-player-'));
    const ready = path.join(dir, 'ready');
    const eof = path.join(dir, 'eof');
    const oldPath = process.env['PATH'];
    let player: ReturnType<typeof createPCMPlayback> | undefined;
    if (stage !== 'missing') {
      await writeFile(
        path.join(dir, 'ffplay'),
        `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'player.mjs')}"\n`,
        { mode: 0o700 },
      );
      await writeFile(
        path.join(dir, 'player.mjs'),
        `
          import fs from 'node:fs';
          fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid));
          const chunks = [];
          process.stdin.on('data', (chunk) => chunks.push(chunk));
          process.stdin.on('end', () => {
            fs.writeFileSync(${JSON.stringify(eof)}, Buffer.concat(chunks));
            setTimeout(() => process.exit(${stage === 'nonzero' ? 21 : 0}),
              ${stage === 'after-eof' ? 2400 : 40});
          });
        `,
      );
    }
    // The example must find the controlled executable, never a machine's real audio player.
    process.env['PATH'] = dir;
    try {
      player = createPCMPlayback();
      if (stage === 'missing') {
        await expect(player.finish()).rejects.toThrow();
        expect(() => player?.write(Buffer.alloc(2))).toThrow();
        return;
      }
      player.write(Buffer.alloc(480, 3));
      const pid = Number(await vi.waitFor(() => readFile(ready, 'utf-8')));
      if (stage === 'before-eof') {
        await player.close();
        expect(await readFile(eof).catch(() => {})).toBeUndefined();
      } else {
        const result = player.finish().then(
          () => 'completed',
          () => 'failed',
        );
        const input = await vi.waitFor(() => readFile(eof));
        expect(input.toString('ascii', 0, 4)).toBe('RIFF');
        expect(input.readUInt32LE(4)).toBe(0xff_ff_ff_ff);
        expect(input.toString('ascii', 8, 16)).toBe('WAVEfmt ');
        expect(input.readUInt32LE(16)).toBe(16);
        expect(input.readUInt16LE(20)).toBe(1);
        expect(input.readUInt16LE(22)).toBe(1);
        expect(input.readUInt32LE(24)).toBe(24_000);
        expect(input.readUInt32LE(28)).toBe(48_000);
        expect(input.readUInt16LE(32)).toBe(2);
        expect(input.readUInt16LE(34)).toBe(16);
        expect(input.toString('ascii', 36, 40)).toBe('data');
        expect(input.readUInt32LE(40)).toBe(0xff_ff_ff_ff);
        expect(input.subarray(44)).toEqual(Buffer.alloc(480, 3));
        if (stage === 'after-eof') {
          const start = performance.now();
          await player.close();
          expect(performance.now() - start).toBeLessThan(900);
          expect(await result).toBe('failed');
        } else {
          expect(await result).toBe(stage === 'complete' ? 'completed' : 'failed');
        }
      }
      await player.close();
      await player.close();
      expect(() => player?.write(Buffer.alloc(2))).toThrow();
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      await player?.close();
      if (oldPath === undefined) {
        delete process.env['PATH'];
      } else {
        process.env['PATH'] = oldPath;
      }
      await rm(dir, { recursive: true, force: true });
    }
  },
  5000,
);
