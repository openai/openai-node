/* eslint-disable no-await-in-loop -- Each case observes the prior capture or cleanup counter before proceeding. */
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import CrcCalculator from 'pngjs/lib/crc.js';

import { fromStartedDesktop } from '../computer-daytona/adapter.mjs';
import { E2BComputer } from './adapter.mjs';

const png = PNG.sync.write({ width: 2, height: 2, data: Buffer.alloc(16, 255) });
const interlaced = PNG.sync.write({ width: 1, height: 1, data: Buffer.alloc(4, 255) });
interlaced[28] = 1;
interlaced.writeInt32BE(CrcCalculator.crc32(interlaced.subarray(12, 29)), 29);
assert.equal(PNG.sync.read(interlaced).width, 1);
const results = [];
for (const vendor of ['daytona', 'e2b']) {
  let removed = 0;
  let captures = 0;
  let chunksRead = 0;
  let streamsClosed = 0;
  const make = async (width, height, limit, image = png, bytesLimit = null) => {
    if (vendor === 'daytona') {
      return fromStartedDesktop(
        {
          display: {
            async getInfo() {
              return { displays: [{ id: 1, isActive: true, x: 0, y: 0, width, height }] };
            },
          },
          screenshot: {
            async takeFullScreen() {
              captures += 1;
              return { screenshot: image.toString('base64') };
            },
          },
        },
        limit,
      );
    }
    return E2BComputer.fromStartedDesktop(
      {
        sandboxId: 'local-fixture',
        async getScreenSize() {
          return { width, height };
        },
        commands: {
          async run() {
            captures += 1;
          },
        },
        files: {
          async *read() {
            try {
              for (const part of [image.subarray(0, 7), image.subarray(7, 20), image.subarray(20, 33)]) {
                chunksRead += 1;
                yield part;
              }
              for (let offset = 33; offset < image.length; offset += 4096) {
                chunksRead += 1;
                yield image.subarray(offset, offset + 4096);
              }
            } finally {
              streamsClosed += 1;
            }
          },
          async remove() {
            removed += 1;
          },
        },
      },
      limit,
      bytesLimit,
    );
  };
  const tests = [
    [
      'configured budget refuses before capture',
      async () => {
        await assert.rejects(make(2, 2, 3));
        assert.equal(captures, 0);
      },
    ],
    [
      'explicit budget accepts normal PNG',
      async () => {
        const d = await make(2, 2, 4);
        const shot = await d.screenshot();
        assert.equal(shot.image_url, `data:image/png;base64,${png.toString('base64')}`);
      },
    ],
    [
      'default permits 8K geometry',
      async () => {
        await make(7680, 4320);
      },
    ],
    [
      'default refuses larger geometry',
      async () => {
        await assert.rejects(make(7680, 4321));
      },
    ],
    [
      'trusted caller can raise budget',
      async () => {
        await make(7680, 4321, 7680 * 4321);
      },
    ],
    [
      'invalid budgets rejected',
      async () => {
        for (const limit of [0, -1, 1.5, Number.NaN, Infinity, '4', null]) {
          await assert.rejects(make(2, 2, limit));
        }
      },
    ],
    [
      'valid tiny interlaced PNG refused',
      async () => {
        const before = removed;
        const d = await make(1, 1, undefined, interlaced);
        await assert.rejects(d.screenshot());
        if (vendor === 'e2b') {
          assert.equal(removed, before + 1);
        }
      },
    ],
  ];
  if (vendor === 'e2b') {
    tests.push(
      [
        'encoded byte budget stops reading, cleans up and permits an explicit larger budget',
        async () => {
          const metadata = Buffer.concat([Buffer.from('Comment\0'), Buffer.alloc(300_000, 120)]);
          const chunk = Buffer.alloc(metadata.length + 12);
          chunk.writeUInt32BE(metadata.length, 0);
          chunk.write('tEXt', 4);
          metadata.copy(chunk, 8);
          chunk.writeInt32BE(CrcCalculator.crc32(chunk.subarray(4, -4)), chunk.length - 4);
          const tagged = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
          assert.equal(PNG.sync.read(tagged).width, 2);
          const priorReads = chunksRead;
          const priorClosed = streamsClosed;
          const priorRemoved = removed;
          const limited = await make(2, 2, undefined, tagged);
          await assert.rejects(limited.screenshot(), /encoded screenshot byte budget/u);
          assert.ok(chunksRead - priorReads < 3 + Math.ceil((tagged.length - 33) / 4096));
          assert.equal(streamsClosed, priorClosed + 1);
          assert.equal(removed, priorRemoved + 1);
          const afterReads = chunksRead;
          await assert.rejects(limited.screenshot(), /closed or retired/u);
          assert.equal(chunksRead, afterReads);
          const raised = await make(2, 2, undefined, tagged, tagged.length);
          const result = await raised.screenshot();
          assert.deepEqual(Buffer.from(result.image_url.split(',')[1], 'base64'), tagged);
          const exact = await make(2, 2, undefined, png, png.length);
          const exactShot = await exact.screenshot();
          assert.equal(exactShot.image_url, `data:image/png;base64,${png.toString('base64')}`);
          const short = await make(2, 2, undefined, png, png.length - 1);
          await assert.rejects(short.screenshot(), /encoded screenshot byte budget/u);
          for (const invalid of [0, -1, 1.5, Number.NaN, Infinity, '4']) {
            await assert.rejects(make(2, 2, undefined, png, invalid));
          }
        },
      ],
      [
        'valid PNG beyond 8 MiB follows the pixel budget; broken PNGs still retire',
        async () => {
          const large = PNG.sync.write(
            { width: 2048, height: 1536, data: Buffer.alloc(2048 * 1536 * 4, 255) },
            { deflateLevel: 0 },
          );
          assert.ok(large.byteLength > 8 * 1024 * 1024);
          const before = removed;
          const driver = await make(2048, 1536, undefined, large);
          const shot = await driver.screenshot();
          assert.deepEqual(Buffer.from(shot.image_url.split(',')[1], 'base64'), large);
          assert.equal(removed, before + 1);
          for (const malformed of [
            png.subarray(0, 32),
            png.subarray(0, 33),
            png.subarray(0, -12),
            Buffer.alloc(64, 120),
          ]) {
            const prior = removed;
            const broken = await make(2, 2, undefined, malformed);
            await assert.rejects(broken.screenshot());
            assert.equal(removed, prior + 1);
          }
        },
      ],
    );
  }
  for (const [name, run] of tests) {
    try {
      await run();
      results.push({ vendor, name, passed: true });
    } catch (error) {
      results.push({ vendor, name, passed: false, error: String(error.message) });
    }
  }
}
console.log(JSON.stringify(results, null, 2));
process.exitCode = results.some((x) => !x.passed) ? 1 : 0;
