import { type RequestInfo, type RequestInit } from 'openai/_shims/index';
import { Response } from 'node-fetch';

type Fetch = (req: string | RequestInfo, init?: RequestInit) => Promise<Response>;

/**
 * Creates a mock `fetch` function and a `handleRequest` function for intercepting `fetch` calls.
 *
 * You call `handleRequest` with a callback function that handles the next `fetch` call.
 * It returns a Promise that:
 * - waits for the next call to `fetch`
 * - calls the callback with the `fetch` arguments
 * - resolves `fetch` with the callback output
 */
export function mockFetch(): { fetch: Fetch; handleRequest: (handle: Fetch) => Promise<void> } {
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

  return { fetch, handleRequest };
}
