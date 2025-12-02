import { Fetch, RequestInfo, RequestInit } from 'openai/internal/builtin-types';
import { PassThrough } from 'stream';

export function mockFetch(): {
  fetch: Fetch;
  handleRequest: (handle: Fetch) => void;
  handleStreamEvents: (events: any[]) => void;
  handleMessageStreamEvents: (iter: AsyncIterable<any>) => void;
} {
  const queue: Promise<typeof fetch>[] = [];
  const readResolvers: ((handler: typeof fetch) => void)[] = [];

  let index = 0;

  async function fetch(req: string | RequestInfo, init?: RequestInit): Promise<Response> {
    const idx = index++;
    if (!queue[idx]) {
      queue.push(new Promise((resolve) => readResolvers.push(resolve)));
    }

    const handler = await queue[idx]!;
    return await Promise.race([
      handler(req, init),
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          // @ts-ignore
          reject(new DOMException('The user aborted a request.', 'AbortError'));
          return;
        }
        init?.signal?.addEventListener('abort', (_e) => {
          // @ts-ignore
          reject(new DOMException('The user aborted a request.', 'AbortError'));
        });
      }),
    ]);
  }

  function handleRequest(handler: typeof fetch): void {
    if (readResolvers.length) {
      const resolver = readResolvers.shift()!;
      resolver(handler);
      return;
    }
    queue.push(Promise.resolve(handler));
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
