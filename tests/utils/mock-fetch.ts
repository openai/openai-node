import { type Fetch, type RequestInfo, type RequestInit, type Response } from 'openai/internal/builtin-types';
import { PassThrough } from 'stream';

/**
 * Creates a mock `fetch` function and a `handleRequest` function for intercepting `fetch` calls.
 *
 * You call `handleRequest` with a callback function that handles the next `fetch` call.
 * It returns a Promise that:
 * - waits for the next call to `fetch`
 * - calls the callback with the `fetch` arguments
 * - resolves `fetch` with the callback output
 */
export function mockFetch(): {
  fetch: Fetch;
  handleRequest: (handle: Fetch) => void;
  handleStreamEvents: (events: any[]) => void;
  handleMessageStreamEvents: (iter: AsyncIterable<any>) => void;
} {
  const fetchQueue: ((handler: typeof fetch) => void)[] = [];
  const handlerQueue: Promise<typeof fetch>[] = [];

  const enqueueHandler = () => {
    handlerQueue.push(
      new Promise<typeof fetch>((resolve) => {
        fetchQueue.push((handle: typeof fetch) => {
          enqueueHandler();
          resolve(handle);
        });
      }),
    );
  };
  enqueueHandler();

  async function fetch(req: string | RequestInfo, init?: RequestInit): Promise<Response> {
    const handler = await handlerQueue.shift();
    if (!handler) throw new Error('expected handler to be defined');
    const signal = init?.signal;
    if (!signal) return await handler(req, init);
    return await Promise.race([
      handler(req, init),
      new Promise<Response>((resolve, reject) => {
        if (signal.aborted) {
          // @ts-ignore does exist in Node
          reject(new DOMException('The user aborted a request.', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', (e) => {
          // @ts-ignore does exist in Node
          reject(new DOMException('The user aborted a request.', 'AbortError'));
        });
      }),
    ]);
  }

  function handleRequest(handle: typeof fetch): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      fetchQueue.shift()?.(async (req, init) => {
        try {
          return await handle(req, init);
        } catch (err) {
          reject(err);
          return err as any;
        } finally {
          resolve();
        }
      });
    });
  }

  function handleStreamEvents(events: any[]) {
    handleRequest(async () => {
      const stream = new PassThrough();
      (async () => {
        for (const event of events) {
          stream.write(`event: ${event.type}\n`);
          stream.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        stream.end(`\n`);
      })();
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Transfer-Encoding': 'chunked',
        },
      });
    });
  }

  function handleMessageStreamEvents(iter: AsyncIterable<any>) {
    handleRequest(async () => {
      const stream = new PassThrough();
      (async () => {
        for await (const chunk of iter) {
          stream.write(`event: ${chunk.type}\n`);
          stream.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        stream.end(`\n`);
      })();
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Transfer-Encoding': 'chunked',
        },
      });
    });
  }

  return { fetch: fetch as any, handleRequest, handleStreamEvents, handleMessageStreamEvents };
}
