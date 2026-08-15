import { setImmediate as nextEventLoopTurn } from 'node:timers/promises';

import { vi } from 'vitest';

import { multipartFormRequestOptions, toStreamingFile } from 'openai/internal/uploads';

const multipart = (body: Record<string, unknown>) => multipartFormRequestOptions({ body }, fetch);

describe('streaming multipart reader cleanup', () => {
  test('unlocks native readers when capturing read throws and cancellation rejects', async () => {
    const cancel = vi.fn(() => Promise.reject(new Error('cancellation failed')));
    const source = new ReadableStream<string>({ cancel });
    Object.assign(source, {
      [Symbol.asyncIterator]: undefined,
      getReader() {
        return Object.defineProperty(ReadableStream.prototype.getReader.call(source), 'read', {
          get() {
            throw new Error('read accessor failed');
          },
        });
      },
    });
    const options = await multipart({ upload: source });

    await expect((options.body as ReadableStream).getReader().read()).rejects.toThrow('read accessor failed');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(source.locked).toBe(false);
  });

  test.each(['accessor', 'method', 'poisoned binding'] as const)(
    'releases a native reader during active cancellation despite its %s',
    async (failure) => {
      const error = new Error(`cancel ${failure} failed`);
      const release = vi.fn();
      const getBinding = vi.fn(() => {
        throw error;
      });
      const source = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('original');
        },
      });
      Object.assign(source, {
        [Symbol.asyncIterator]: undefined,
        getReader() {
          const reader = ReadableStream.prototype.getReader.call(source);
          const releaseLock = reader.releaseLock.bind(reader);
          Object.defineProperties(reader, {
            cancel: {
              get() {
                if (failure === 'accessor') {
                  throw error;
                }
                const cancel = () => {
                  expect(source.locked).toBe(true);
                  if (failure === 'method') {
                    throw error;
                  }
                  return Promise.resolve();
                };
                return failure === 'poisoned binding'
                  ? Object.defineProperty(cancel, 'bind', { get: getBinding })
                  : cancel;
              },
            },
            releaseLock: {
              value() {
                release();
                releaseLock();
              },
            },
          });
          return reader;
        },
      });
      const options = await multipart({ upload: toStreamingFile(source, 'original.txt') });
      const reader = (options.body as ReadableStream).getReader();
      await reader.read();
      await reader.read();
      await reader.read();

      expect(source.locked).toBe(true);
      const cancellation = reader.cancel();
      await (failure === 'poisoned binding'
        ? expect(cancellation).resolves.toBeUndefined()
        : expect(cancellation).rejects.toBe(error));
      expect(release).toHaveBeenCalledTimes(1);
      expect(getBinding).not.toHaveBeenCalled();
      expect(source.locked).toBe(false);
    },
  );

  test.each([true, false])(
    'settles cancellation when release throws (cancel rejects: %s)',
    async (rejects) => {
      const cancelError = new Error('cancellation failed');
      const releaseError = new Error('release failed');
      const cancel = vi.fn(() => (rejects ? Promise.reject(cancelError) : Promise.resolve()));
      const release = vi.fn();
      const unhandled = vi.fn();
      const source = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('original');
        },
        cancel,
      });
      Object.assign(source, {
        [Symbol.asyncIterator]: undefined,
        getReader() {
          const reader = ReadableStream.prototype.getReader.call(source);
          const { releaseLock } = reader;
          return Object.defineProperty(reader, 'releaseLock', {
            value() {
              release();
              Reflect.apply(releaseLock, reader, []);
              throw releaseError;
            },
          });
        },
      });
      const options = await multipart({ upload: toStreamingFile(source, 'original.txt') });
      const reader = (options.body as ReadableStream).getReader();
      await reader.read();
      await reader.read();
      await reader.read();

      process.on('unhandledRejection', unhandled);
      try {
        await expect(reader.cancel()).rejects.toBe(rejects ? cancelError : releaseError);
        await nextEventLoopTurn();
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledTimes(1);
        expect(unhandled).not.toHaveBeenCalled();
        expect(source.locked).toBe(false);
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    },
  );
});
