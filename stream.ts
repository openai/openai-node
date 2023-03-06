import { Readable } from 'node:stream';

async function* chunksToLines(chunksAsync: AsyncIterable<Buffer>): AsyncIterable<string> {
  let previous = "";
  for await (const chunk of chunksAsync) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    previous += bufferChunk;
    let eolIndex;
    while ((eolIndex = previous.indexOf("\n")) >= 0) {
      // line includes the EOL
      const line = previous.slice(0, eolIndex + 1).trimEnd();
      if (line === "data: [DONE]") break;
      if (line.startsWith("data: ")) yield line;
      previous = previous.slice(eolIndex + 1);
    }
  }
}

async function* linesToMessages(linesAsync: AsyncIterable<string>): AsyncIterable<string> {
  for await (const line of linesAsync) {
    const message = line.substring("data :".length);

    yield message;
  }
}

export async function* streamCompletion(stream: Readable): AsyncGenerator<string, void, undefined> {
  yield* linesToMessages(chunksToLines(stream));
}