import type { Response } from 'openai/_shims/fetch';
import { APIResponse, Headers, createResponseHeaders } from '~/core';

type ServerSentEvent = {
  event: string | null;
  data: string;
  raw: string[];
};

class SSEDecoder {
  private data: string[];
  private event: string | null;
  private chunks: string[];

  constructor() {
    this.event = null;
    this.data = [];
    this.chunks = [];
  }

  decode(line: string) {
    if (line.endsWith('\r')) {
      line = line.substring(0, line.length - 1);
    }

    if (!line) {
      // empty line and we didn't previously encounter any messages
      if (!this.event && !this.data.length) return null;

      const sse: ServerSentEvent = {
        event: this.event,
        data: this.data.join('\n'),
        raw: this.chunks,
      };

      this.event = null;
      this.data = [];
      this.chunks = [];

      return sse;
    }

    this.chunks.push(line);

    if (line.startsWith(':')) {
      return null;
    }

    let [fieldname, _, value] = partition(line, ':');

    if (value.startsWith(' ')) {
      value = value.substring(1);
    }

    if (fieldname === 'event') {
      this.event = value;
    } else if (fieldname === 'data') {
      this.data.push(value);
    }

    return null;
  }
}

export class Stream<Item> implements AsyncIterable<Item>, APIResponse<Stream<Item>> {
  response: Response;
  responseHeaders: Headers;
  controller: AbortController;

  private decoder: SSEDecoder;

  constructor(response: Response, controller: AbortController) {
    this.response = response;
    this.controller = controller;
    this.decoder = new SSEDecoder();
    this.responseHeaders = createResponseHeaders(response.headers);
  }

  private async *iterMessages(): AsyncGenerator<ServerSentEvent, void, unknown> {
    if (!this.response.body) {
      this.controller.abort();
      throw new Error(`Attempted to iterate over a response with no body`);
    }

    const lineDecoder = new LineDecoder();

    for await (const chunk of this.response.body) {
      let text;
      if (chunk instanceof Buffer) {
        text = chunk.toString();
      } else if ((chunk as any) instanceof Uint8Array) {
        text = Buffer.from(chunk).toString();
      } else {
        text = chunk;
      }

      for (const line of lineDecoder.decode(text)) {
        const sse = this.decoder.decode(line);
        if (sse) yield sse;
      }
    }

    for (const line of lineDecoder.flush()) {
      const sse = this.decoder.decode(line);
      if (sse) yield sse;
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Item, any, undefined> {
    try {
      for await (const sse of this.iterMessages()) {
        if (sse.data.startsWith('[DONE]')) {
          break;
        }

        if (sse.event === null) {
          try {
            yield JSON.parse(sse.data);
          } catch (e) {
            console.error(`Could not parse message into JSON:`, sse.data);
            console.error(`From chunk:`, sse.raw);
            throw e;
          }
        }
      }
    } catch (e) {
      // If the user calls `stream.controller.abort()`, we should exit without throwing.
      if (e instanceof Error && e.name === 'AbortError') return;
      throw e;
    } finally {
      // If the user `break`s, abort the ongoing request.
      this.controller.abort();
    }
  }
}

const NEWLINE_CHARS = '\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029';

/**
 * A re-implementation of httpx's `LineDecoder` in Python that handles incrementally
 * reading lines from text.
 *
 * https://github.com/encode/httpx/blob/920333ea98118e9cf617f246905d7b202510941c/httpx/_decoders.py#L258
 */
class LineDecoder {
  buffer: string[];
  trailingCR: boolean;

  constructor() {
    this.buffer = [];
    this.trailingCR = false;
  }

  decode(text: string): string[] {
    if (this.trailingCR) {
      text = '\r' + text;
      this.trailingCR = false;
    }
    if (text.endsWith('\r')) {
      this.trailingCR = true;
      text = text.slice(0, -1);
    }

    if (!text) {
      return [];
    }

    const trailing_newline = NEWLINE_CHARS.includes(text.slice(-1));
    let lines = text.split(/\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/g);

    if (lines.length === 1 && !trailing_newline) {
      this.buffer.push(lines[0]!);
      return [];
    }

    if (this.buffer.length > 0) {
      lines = [this.buffer.join('') + lines[0], ...lines.slice(1)];
      this.buffer = [];
    }

    if (!trailing_newline) {
      this.buffer = [lines.pop() || ''];
    }

    return lines;
  }

  flush(): string[] {
    if (!this.buffer.length && !this.trailingCR) {
      return [];
    }

    const lines = [this.buffer.join('')];
    this.buffer = [];
    this.trailingCR = false;
    return lines;
  }
}

function partition(str: string, delimiter: string): [string, string, string] {
  const index = str.indexOf(delimiter);
  if (index !== -1) {
    return [str.substring(0, index), delimiter, str.substring(index + delimiter.length)];
  }

  return [str, '', ''];
}
