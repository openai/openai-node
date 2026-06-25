jest.mock('node:child_process', () => ({ spawn: jest.fn() }));

import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { playAudio } from 'openai/helpers/audio';

const spawnMock = spawn as jest.MockedFunction<typeof spawn>;

function mockFfplay() {
  const chunks: Buffer[] = [];
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  const ffplay = {
    stdin,
    kill: jest.fn(),
    on: jest.fn(),
  };

  ffplay.on.mockImplementation((event: string, listener: (code: number) => void) => {
    if (event === 'close') {
      if (stdin.writableEnded) {
        queueMicrotask(() => listener(0));
      } else {
        stdin.on('finish', () => listener(0));
      }
    }
    return ffplay;
  });
  spawnMock.mockReturnValue(ffplay as any);

  return { chunks, ffplay };
}

describe('playAudio', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('pipes a Response Web ReadableStream body to ffplay', async () => {
    const { chunks } = mockFfplay();

    await playAudio(new Response('hello'));

    expect(spawnMock).toHaveBeenCalledWith('ffplay', ['-autoexit', '-nodisp', '-i', 'pipe:0']);
    expect(Buffer.concat(chunks).toString()).toBe('hello');
  });

  it('keeps Node Readable response bodies on the Node stream path', async () => {
    const { chunks } = mockFfplay();
    const response = { body: Readable.from(['hello']) };

    await playAudio(response as any);

    expect(Buffer.concat(chunks).toString()).toBe('hello');
  });

  it('rejects and stops ffplay when a Response Web ReadableStream errors', async () => {
    const { ffplay } = mockFfplay();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('stream failed'));
        },
      }),
    );

    await expect(playAudio(response)).rejects.toThrow('stream failed');

    expect(ffplay.kill).toHaveBeenCalled();
  });
});
